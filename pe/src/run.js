import { spawnSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { prepSpawn } from './spawn.js'
import { evidencePaths, initEvidence, journal } from './evidence.js'
import { writeWorktreeSettings, buildPrompt, remediationPrompt } from './settings.js'
import { delegate, usageOf } from './claude.js'
import { reviewAndSeal } from './cairn.js'
import { push, createPr, readyPr, renderBody, renderCairnBlock, writeBody } from './deliver.js'

// The five-stage pipeline. The model does the engineering (stage 2); the
// harness owns the worktree, every gate, delivery, and evidence.
export async function runPipeline({ repo, task, flags, cfg, log }) {
  const runId = 'pe-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5)
  const branch = `pe/${runId}`
  const base = flags.base ?? cfg.cairn?.base ?? 'main'
  const paths = evidencePaths(cfg.evidenceDir, repo, runId)
  initEvidence(paths, runId)
  journal(paths, 'run.start', { task, repo, branch, base, mode: cfg.cairn?.mode ?? 'none' })

  const totals = { turns: 0, tokens: 0 }
  const started = Date.now()
  const git = (args, cwd = repo) => spawnSync(...prepSpawn(cfg.bins.git, args, { cwd, encoding: 'utf8' }))
  const finish = (state, extra = {}) => ({
    state, runId, branch, paths, totals,
    durationS: Math.round((Date.now() - started) / 1000),
    ...extra,
  })

  // ---- Stage 1: stage the worktree -------------------------------------
  log(`stage    creating worktree for ${branch}`)
  const wtr = spawnSync(...prepSpawn(cfg.bins.wtree, ['new', branch, '-m', `pe: ${task}`], { cwd: repo, encoding: 'utf8' }))
  if (wtr.status !== 0 || !wtr.stdout.trim()) {
    journal(paths, 'stage.failed', { stderr: wtr.stderr })
    return finish('ERROR', { message: `wtree new failed: ${(wtr.stderr || '').trim()}` })
  }
  const wt = wtr.stdout.trim()
  writeWorktreeSettings(wt, cfg.bins.git)
  journal(paths, 'stage.done', { worktree: wt })

  // ---- Stage 2 + 3: delegate, then verify (with one remediation) -------
  const claudeEnv = { ...process.env, PE_EVIDENCE_DIR: paths.dir }
  const doDelegate = async (prompt, label) => {
    writeFileSync(paths.prompt, prompt, { flag: label === 'initial' ? 'w' : 'a' })
    journal(paths, 'delegate.start', { label })
    log(`delegate ${label} run (max ${flags.maxTurns ?? cfg.budgets.maxTurns} turns)`)
    const d = await delegate({
      bin: cfg.bins.claude,
      prompt,
      cwd: wt,
      maxTurns: flags.maxTurns ?? cfg.budgets.maxTurns,
      timeoutMs: cfg.budgets.timeoutMin * 60_000,
      transcriptPath: paths.transcript,
      env: claudeEnv,
    })
    const u = usageOf(d.result)
    totals.turns += u.turns
    totals.tokens += u.tokens
    journal(paths, 'delegate.done', { label, exit: d.code, timedOut: d.timedOut, ...u })
    return d
  }

  const verify = () => {
    const dirty = (git(['-C', wt, 'status', '--porcelain'], wt).stdout || '')
      .split('\n').filter((l) => l.trim() && !/\.claude([\\/]|$)/.test(l))
    if (dirty.length) return { ok: false, reason: 'uncommitted work in the tree', detail: dirty.join('\n') }
    const count = Number((git(['-C', wt, 'rev-list', '--count', `${base}..HEAD`], wt).stdout || '0').trim())
    if (!count) return { ok: false, reason: 'no commits on the branch', detail: '' }
    const tt = spawnSync(...prepSpawn(cfg.bins.tt, ['--tt-json'], { cwd: wt, encoding: 'utf8' }))
    let verdict = null
    try { verdict = JSON.parse(tt.stdout) } catch { /* fall through */ }
    const summary = verdict?.summary ?? { failed: null, passed: null }
    if (tt.status !== 0) {
      const rows = (verdict?.failures ?? []).map((f) => `${f.n ?? '?'}: ${f.head ?? ''} ${f.detail ?? ''}`.trim())
      return { ok: false, reason: 'tests failing', detail: rows.join('\n') || (tt.stderr || '').trim(), tt: summary }
    }
    return { ok: true, tt: summary }
  }

  let d = await doDelegate(buildPrompt({ task, cairn: cfg.cairn }), 'initial')
  if (d.timedOut) return finish('ABORTED_BUDGET', { worktree: wt, message: 'wall-clock budget exhausted' })

  let v = verify()
  journal(paths, 'verify.done', { ok: v.ok, reason: v.reason ?? null, tt: v.tt ?? null })
  let remediations = cfg.retries.verify
  while (!v.ok && remediations > 0) {
    remediations--
    d = await doDelegate(remediationPrompt(v.reason, v.detail), 'remediation')
    if (d.timedOut) return finish('ABORTED_BUDGET', { worktree: wt, message: 'wall-clock budget exhausted' })
    v = verify()
    journal(paths, 'verify.done', { ok: v.ok, reason: v.reason ?? null, tt: v.tt ?? null, remediation: true })
  }
  if (!v.ok) return finish('FAILED_TESTS', { worktree: wt, tt: v.tt, message: `${v.reason}${v.detail ? `\n${v.detail}` : ''}` })

  // Cairn: sealed in shadow mode, acted on in gate mode.
  let review = null
  if (cfg.cairn) {
    log('verify   recording Cairn review')
    review = reviewAndSeal({ cairn: cfg.cairn, repo: wt, branch, sealedPath: paths.sealed })
    journal(paths, 'cairn.recorded', { recorded: review.recorded, mode: cfg.cairn.mode })
    if (cfg.cairn.mode === 'gate' && review.recorded && review.status === 'BLOCKED' && remediations >= 0) {
      d = await doDelegate(remediationPrompt('the review gate BLOCKED this change', review.findings.join('\n')), 'gate-remediation')
      if (d.timedOut) return finish('ABORTED_BUDGET', { worktree: wt, message: 'wall-clock budget exhausted' })
      v = verify()
      if (!v.ok) return finish('FAILED_TESTS', { worktree: wt, tt: v.tt, message: v.reason })
      review = reviewAndSeal({ cairn: cfg.cairn, repo: wt, branch, sealedPath: paths.sealed })
      journal(paths, 'cairn.recorded', { recorded: review.recorded, mode: cfg.cairn.mode, remediation: true })
    }
  }

  // ---- Stage 4: deliver -------------------------------------------------
  log('deliver  pushing branch and opening PR')
  const pushErr = push({ git: cfg.bins.git, wt, branch })
  if (pushErr) return finish('ERROR', { worktree: wt, tt: v.tt, message: `push failed: ${pushErr.trim()}` })

  const commits = (git(['-C', wt, 'log', '--format=%s', `${base}..HEAD`], wt).stdout || '').trim().split('\n').filter(Boolean)
  const shortstat = (git(['-C', wt, 'diff', '--shortstat', `${base}...HEAD`], wt).stdout || '').trim()
  const body = renderBody({
    task, runId, commits, shortstat, tt: v.tt,
    cairnBlock: renderCairnBlock({ mode: cfg.cairn?.mode, runId, review }),
  })
  writeBody(paths.prBody, body)
  const pr = createPr({ ght: cfg.bins.ght, wt, title: task.slice(0, 72), bodyPath: paths.prBody, base })
  if (pr.error) return finish('ERROR', { worktree: wt, tt: v.tt, message: `pr create failed: ${pr.error.trim()}` })
  journal(paths, 'deliver.pr', { url: pr.url, number: pr.number })

  const gateBlocked = cfg.cairn?.mode === 'gate' && review?.recorded && review.status === 'BLOCKED'
  const wantReady = cfg.pr.readyOnGreen && !flags.draftOnly && !gateBlocked
  if (wantReady) {
    const readyErr = readyPr({ ght: cfg.bins.ght, wt, number: pr.number, url: pr.url })
    if (readyErr) return finish('ERROR', { worktree: wt, tt: v.tt, pr, message: `pr ready failed: ${readyErr.trim()}` })
  }

  const state = gateBlocked ? 'BLOCKED_CAIRN' : wantReady ? 'DELIVERED_READY' : 'DELIVERED_DRAFT'
  const humanRequired = cfg.cairn?.mode === 'gate' && review?.recorded && review.status === 'HUMAN_REQUIRED'
  return finish(state, { worktree: wt, tt: v.tt, pr, review, humanRequired })
}

export function exitCodeFor(result) {
  switch (result.state) {
    case 'DELIVERED_READY': return result.humanRequired ? 3 : 0
    case 'DELIVERED_DRAFT': return 0
    case 'FAILED_TESTS':
    case 'BLOCKED_CAIRN':
    case 'ABORTED_BUDGET': return 1
    default: return 2
  }
}
