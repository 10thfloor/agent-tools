import { appendFileSync, writeFileSync } from 'node:fs'
import { sh } from './exec.js'
import { evidencePaths, initEvidence, journal } from './evidence.js'
import { writeWorktreeSettings, buildPrompt, remediationPrompt } from './settings.js'
import { delegate, usageOf } from './claude.js'
import { reviewAndSeal } from './cairn.js'
import { push, createPr, readyPr, renderBody, renderCairnBlock } from './deliver.js'

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
  const finish = (state, extra = {}) => ({
    state, runId, branch, paths, totals,
    durationS: Math.round((Date.now() - started) / 1000),
    ...extra,
  })

  // ---- Stage 1: stage the worktree -------------------------------------
  log(`stage    creating worktree for ${branch}`)
  const wtr = sh(cfg.bins.wtree, ['new', branch, '-m', `pe: ${task}`], { cwd: repo })
  if (wtr.status !== 0 || !wtr.stdout.trim()) {
    journal(paths, 'stage.failed', { stderr: wtr.stderr })
    return finish('ERROR', { message: `wtree new failed: ${(wtr.stderr || '').trim()}` })
  }
  const wt = wtr.stdout.trim()
  const git = (args) => sh(cfg.bins.git, ['-C', wt, ...args])
  writeWorktreeSettings(wt, cfg.bins.git)
  journal(paths, 'stage.done', { worktree: wt })

  // ---- Stage 2: delegate ------------------------------------------------
  // Returns null on success; a terminal result on timeout or a session that
  // never completed (crash, missing binary): environment, not test failure.
  const claudeEnv = { ...process.env, PE_EVIDENCE_DIR: paths.dir }
  const delegateOnce = async (prompt, label) => {
    if (label === 'initial') writeFileSync(paths.prompt, prompt)
    else appendFileSync(paths.prompt, `\n---\n\n${prompt}`)
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
    if (d.timedOut) return finish('ABORTED_BUDGET', { worktree: wt, message: 'wall-clock budget exhausted' })
    if (!d.result) {
      const why = (d.stderr || `exit ${d.code}`).trim().split('\n').slice(-2).join(' ')
      return finish('ERROR', { worktree: wt, message: `claude did not complete: ${why}` })
    }
    return null
  }

  // ---- Stage 3: verify --------------------------------------------------
  // Gates in order: committed tree → real commits → tt green → (gate mode)
  // Cairn not BLOCKED. Each failure carries the remediation evidence. The
  // Cairn record is sealed on every pass that reaches it; in shadow mode the
  // returned view has no status, so it can never fail this gate (or leak).
  let review = null
  const verify = () => {
    const dirty = (git(['status', '--porcelain']).stdout || '')
      .split('\n').filter((l) => l.trim() && !/\.claude([\\/]|$)/.test(l))
    if (dirty.length) return { ok: false, gate: 'work', reason: 'uncommitted work in the tree', detail: dirty.join('\n') }
    const count = Number((git(['rev-list', '--count', `${base}..HEAD`]).stdout || '0').trim())
    if (!count) return { ok: false, gate: 'work', reason: 'no commits on the branch', detail: '' }
    const tt = sh(cfg.bins.tt, ['--tt-json'], { cwd: wt })
    let verdict = null
    try { verdict = JSON.parse(tt.stdout) } catch { /* fall through */ }
    const summary = verdict?.summary ?? { failed: null, passed: null }
    if (tt.status !== 0) {
      const rows = (verdict?.failures ?? []).map((f) => `${f.n ?? '?'}: ${f.head ?? ''} ${f.detail ?? ''}`.trim())
      return { ok: false, gate: 'tests', reason: 'tests failing', detail: rows.join('\n') || (tt.stderr || '').trim(), tt: summary }
    }
    if (cfg.cairn) {
      log('verify   recording Cairn review')
      review = reviewAndSeal({ cairn: cfg.cairn, repo: wt, branch, base, sealedPath: paths.sealed })
      journal(paths, 'cairn.recorded', { recorded: review.recorded, mode: cfg.cairn.mode })
      if (review.status === 'BLOCKED') {
        return { ok: false, gate: 'cairn', reason: 'the review gate BLOCKED this change', detail: review.findings.join('\n'), tt: summary }
      }
    }
    return { ok: true, tt: summary }
  }

  let fail = await delegateOnce(buildPrompt({ task, cairn: cfg.cairn }), 'initial')
  if (fail) return fail
  let v = verify()
  journal(paths, 'verify.done', { ok: v.ok, gate: v.gate ?? null, tt: v.tt ?? null })

  let remediations = cfg.retries.verify
  while (!v.ok && remediations-- > 0) {
    fail = await delegateOnce(remediationPrompt(v.reason, v.detail), 'remediation')
    if (fail) return fail
    v = verify()
    journal(paths, 'verify.done', { ok: v.ok, gate: v.gate ?? null, tt: v.tt ?? null, remediation: true })
  }
  if (!v.ok && v.gate !== 'cairn') {
    return finish('FAILED_TESTS', { worktree: wt, tt: v.tt, message: `${v.reason}${v.detail ? `\n${v.detail}` : ''}` })
  }
  const gateBlocked = !v.ok // only the Cairn gate can remain; still delivers, as a draft

  // ---- Stage 4: deliver -------------------------------------------------
  log('deliver  pushing branch and opening PR')
  const pushErr = push({ git: cfg.bins.git, wt, branch })
  if (pushErr) return finish('ERROR', { worktree: wt, tt: v.tt, message: `push failed: ${pushErr.trim()}` })

  const commits = (git(['log', '--reverse', '--format=%s', `${base}..HEAD`]).stdout || '').trim().split('\n').filter(Boolean)
  const shortstat = (git(['diff', '--shortstat', `${base}...HEAD`]).stdout || '').trim()
  const body = renderBody({
    task, runId, commits, shortstat, tt: v.tt,
    cairnBlock: renderCairnBlock({ mode: cfg.cairn?.mode, runId, review }),
  })
  writeFileSync(paths.prBody, body)
  const pr = createPr({ ght: cfg.bins.ght, wt, title: task.slice(0, 72), bodyPath: paths.prBody, base })
  if (pr.error) return finish('ERROR', { worktree: wt, tt: v.tt, message: `pr create failed: ${pr.error.trim()}` })
  journal(paths, 'deliver.pr', { url: pr.url, number: pr.number })

  const wantReady = cfg.pr.readyOnGreen && !flags.draftOnly && !gateBlocked
  if (wantReady) {
    const readyErr = readyPr({ ght: cfg.bins.ght, wt, number: pr.number, url: pr.url })
    if (readyErr) return finish('ERROR', { worktree: wt, tt: v.tt, pr, message: `pr ready failed: ${readyErr.trim()}` })
  }

  const state = gateBlocked ? 'BLOCKED_CAIRN' : wantReady ? 'DELIVERED_READY' : 'DELIVERED_DRAFT'
  return finish(state, { worktree: wt, tt: v.tt, pr, review, humanRequired: review?.status === 'HUMAN_REQUIRED' })
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
