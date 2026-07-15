import { existsSync, writeFileSync, appendFileSync } from 'node:fs'
import { sh } from './exec.js'
import { evidencePaths, initEvidence, journal } from './evidence.js'
import { writeWorktreeSettings, buildPrompt, remediationPrompt, revisePrompt, resumePrompt } from './settings.js'
import { delegate, usageOf } from './claude.js'
import { reviewAndSeal } from './cairn.js'
import { push, createPr, readyPr, renderBody, renderCairnBlock, prNumber } from './deliver.js'
import { scanDiff } from './secrets.js'
import { UsageError } from './config.js'

// Shared machinery for every flow that drives a delegated session against a
// worktree (run, revise, resume). The model does the engineering; the
// harness owns the worktree, every gate, delivery, and evidence.
function makeCtx({ repo, cfg, flags, log, runId, task, branch, base, paths, wt }) {
  const totals = { turns: 0, tokens: 0 }
  const started = Date.now()
  const ctx = {
    repo, cfg, flags, log, runId, task, branch, base, paths, wt, totals,
    review: null,
    git: (args) => sh(cfg.bins.git, ['-C', wt, ...args]),
    finish: (state, extra = {}) => ({
      state, runId, task, branch, paths, totals, worktree: wt, base,
      durationS: Math.round((Date.now() - started) / 1000),
      ...extra,
    }),
  }

  const claudeEnv = { ...process.env, PE_EVIDENCE_DIR: paths.dir }
  // Returns null on success; a terminal result on timeout or a session that
  // never completed (crash, missing binary): environment, not test failure.
  ctx.delegateOnce = async (prompt, label) => {
    if (existsSync(paths.prompt)) appendFileSync(paths.prompt, `\n---\n\n${prompt}`)
    else writeFileSync(paths.prompt, prompt)
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
    if (d.timedOut) return ctx.finish('ABORTED_BUDGET', { message: 'wall-clock budget exhausted' })
    if (!d.result) {
      const why = (d.stderr || `exit ${d.code}`).trim().split('\n').slice(-2).join(' ')
      return ctx.finish('ERROR', { message: `claude did not complete: ${why}` })
    }
    return null
  }

  // Gates in order: committed tree → real commits → tt green → (gate mode)
  // Cairn not BLOCKED. Each failure carries its remediation evidence and a
  // composed message. The Cairn record is sealed on every pass that reaches
  // it; in shadow mode the returned view has no status, so it can never fail
  // this gate (or leak).
  ctx.verify = ({ cairn = true } = {}) => {
    const bad = (gate, reason, detail, tt) =>
      ({ ok: false, gate, reason, detail, tt, message: `${reason}${detail ? `\n${detail}` : ''}` })
    const dirty = (ctx.git(['status', '--porcelain']).stdout || '')
      .split('\n').filter((l) => l.trim() && !/\.claude([\\/]|$)/.test(l))
    if (dirty.length) return bad('work', 'uncommitted work in the tree', dirty.join('\n'))
    const count = Number((ctx.git(['rev-list', '--count', `${base}..HEAD`]).stdout || '0').trim())
    if (!count) return bad('work', 'no commits on the branch', '')
    const tt = sh(cfg.bins.tt, ['--tt-json'], { cwd: wt })
    let verdict = null
    try { verdict = JSON.parse(tt.stdout) } catch { /* fall through */ }
    const summary = verdict?.summary ?? { failed: null, passed: null }
    if (tt.status !== 0) {
      const rows = (verdict?.failures ?? []).map((f) => `${f.n ?? '?'}: ${f.head ?? ''} ${f.detail ?? ''}`.trim())
      return bad('tests', 'tests failing', rows.join('\n') || (tt.stderr || '').trim(), summary)
    }
    if (cairn && cfg.cairn) {
      log('verify   recording Cairn review')
      ctx.review = reviewAndSeal({ cairn: cfg.cairn, repo: wt, branch, base, sealedPath: paths.sealed })
      journal(paths, 'cairn.recorded', { recorded: ctx.review.recorded, mode: cfg.cairn.mode })
      if (ctx.review.status === 'BLOCKED') {
        return bad('cairn', 'the review gate BLOCKED this change', ctx.review.findings.join('\n'), summary)
      }
    }
    return { ok: true, tt: summary }
  }

  return ctx
}

// Rehydrate a context from a recorded verdict (revise, resume).
function continuationCtx({ repo, cfg, flags, log, runId, verdict }) {
  if (!verdict.worktree || !existsSync(verdict.worktree)) {
    throw new UsageError(`pe: worktree for '${runId}' is gone`)
  }
  const paths = evidencePaths(cfg.evidenceDir, repo, runId)
  const base = flags.base ?? verdict.base ?? cfg.cairn?.base ?? 'main'
  return makeCtx({
    repo, cfg, flags, log, runId, task: verdict.task, branch: verdict.branch,
    base, paths, wt: verdict.worktree,
  })
}

// Initial delegation plus the budgeted remediation loop. Returns
// { fail } (a terminal result) or { v } (the last verification).
async function verifyLoop(ctx, firstPrompt, label, verifyOpts = {}) {
  let fail = await ctx.delegateOnce(firstPrompt, label)
  if (fail) return { fail }
  let v = ctx.verify(verifyOpts)
  journal(ctx.paths, 'verify.done', { ok: v.ok, gate: v.gate ?? null, tt: v.tt ?? null })
  let remediations = ctx.cfg.retries.verify
  while (!v.ok && remediations-- > 0) {
    fail = await ctx.delegateOnce(remediationPrompt(v.reason, v.detail), 'remediation')
    if (fail) return { fail }
    v = ctx.verify(verifyOpts)
    journal(ctx.paths, 'verify.done', { ok: v.ok, gate: v.gate ?? null, tt: v.tt ?? null, remediation: true })
  }
  return { v }
}

// The delegate → verify → deliver spine shared by run and resume.
async function delegateThenDeliver(ctx, prompt, label) {
  const { fail, v } = await verifyLoop(ctx, prompt, label)
  if (fail) return fail
  if (!v.ok && v.gate !== 'cairn') return ctx.finish('FAILED_TESTS', { tt: v.tt, message: v.message })
  // Only the Cairn gate can remain failing here; it still delivers, as a draft.
  return deliverStage(ctx, v, { gateBlocked: !v.ok })
}

// The secret gate plus the push itself. Returns null on success, a terminal
// result otherwise. Guards every route a diff can leave the machine.
function guardedPush(ctx, v) {
  const secrets = scanDiff(ctx.git(['diff', `${ctx.base}...HEAD`]).stdout || '')
  if (secrets.length) {
    journal(ctx.paths, 'secrets.blocked', { count: secrets.length })
    return ctx.finish('BLOCKED_SECRETS', {
      tt: v.tt,
      message: `refusing to push: ${secrets.length} credential-shaped addition(s)\n`
        + secrets.map((s) => `${s.file}: ${s.kind} ${s.sample}`).join('\n'),
    })
  }
  const pushErr = push({ git: ctx.cfg.bins.git, wt: ctx.wt, branch: ctx.branch })
  if (pushErr) return ctx.finish('ERROR', { tt: v.tt, message: `push failed: ${pushErr.trim()}` })
  return null
}

// Stage 4 + 5: push, PR, readiness, terminal state.
function deliverStage(ctx, v, { gateBlocked }) {
  const { cfg, flags, git, log, paths } = ctx
  log('deliver  pushing branch and opening PR')
  const pushFail = guardedPush(ctx, v)
  if (pushFail) return pushFail

  const commits = (git(['log', '--reverse', '--format=%s', `${ctx.base}..HEAD`]).stdout || '').trim().split('\n').filter(Boolean)
  const shortstat = (git(['diff', '--shortstat', `${ctx.base}...HEAD`]).stdout || '').trim()
  const body = renderBody({
    task: ctx.task, runId: ctx.runId, commits, shortstat, tt: v.tt,
    cairnBlock: renderCairnBlock({ mode: cfg.cairn?.mode, runId: ctx.runId, review: ctx.review }),
  })
  writeFileSync(paths.prBody, body)
  const pr = createPr({ ght: cfg.bins.ght, wt: ctx.wt, title: ctx.task.slice(0, 72), bodyPath: paths.prBody, base: ctx.base })
  if (pr.error) return ctx.finish('ERROR', { tt: v.tt, message: `pr create failed: ${pr.error.trim()}` })
  journal(paths, 'deliver.pr', { url: pr.url, number: pr.number })

  const wantReady = cfg.pr.readyOnGreen && !flags.draftOnly && !gateBlocked
  if (wantReady) {
    const readyErr = readyPr({ ght: cfg.bins.ght, wt: ctx.wt, number: pr.number, url: pr.url })
    if (readyErr) return ctx.finish('ERROR', { tt: v.tt, pr, message: `pr ready failed: ${readyErr.trim()}` })
  }
  const state = gateBlocked ? 'BLOCKED_CAIRN' : wantReady ? 'DELIVERED_READY' : 'DELIVERED_DRAFT'
  return ctx.finish(state, { tt: v.tt, pr, review: ctx.review, humanRequired: ctx.review?.status === 'HUMAN_REQUIRED' })
}

// ---- pe run ---------------------------------------------------------------
export async function runPipeline({ repo, task, flags, cfg, log }) {
  const runId = 'pe-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5)
  const branch = `pe/${runId}`
  const base = flags.base ?? cfg.cairn?.base ?? 'main'
  const paths = evidencePaths(cfg.evidenceDir, repo, runId)
  initEvidence(paths, runId)
  journal(paths, 'run.start', { task, repo, branch, base, mode: cfg.cairn?.mode ?? 'none' })

  log(`stage    creating worktree for ${branch}`)
  const wtr = sh(cfg.bins.wtree, ['new', branch, '-m', `pe: ${task}`], { cwd: repo })
  if (wtr.status !== 0 || !wtr.stdout.trim()) {
    journal(paths, 'stage.failed', { stderr: wtr.stderr })
    return {
      state: 'ERROR', runId, task, branch, paths, totals: { turns: 0, tokens: 0 },
      durationS: 0, message: `wtree new failed: ${(wtr.stderr || '').trim()}`,
    }
  }
  const wt = wtr.stdout.trim()
  writeWorktreeSettings(wt, cfg.bins.git)
  journal(paths, 'stage.done', { worktree: wt })

  const ctx = makeCtx({ repo, cfg, flags, log, runId, task, branch, base, paths, wt })
  return delegateThenDeliver(ctx, buildPrompt({ task, cairn: cfg.cairn }), 'initial')
}

// ---- pe revise ------------------------------------------------------------
// After human review: fetch the PR feedback, re-delegate in the preserved
// worktree, push the same branch (updating the PR). Cairn is not re-run:
// the sealed record documents the diff the human reviewed.
export async function runRevise({ repo, runId, verdict, flags, cfg, log }) {
  if (!verdict.pr) throw new UsageError(`pe: run '${runId}' has no PR to revise (state: ${verdict.state})`)
  const ctx = continuationCtx({ repo, cfg, flags, log, runId, verdict })

  log('revise   fetching PR review feedback')
  const number = prNumber(verdict.pr)
  const r = sh(cfg.bins.ght, ['pr', 'view', String(number ?? verdict.pr), '--json', 'reviews,comments', '--ght-json'], { cwd: ctx.wt })
  if (r.status !== 0) throw new Error(`could not fetch PR feedback: ${(r.stderr || '').trim()}`)
  let data = {}
  try { data = JSON.parse(r.stdout) } catch { /* handled below */ }
  // ght's pruning may have collapsed author objects to plain login strings.
  const authorOf = (a) => (typeof a === 'string' ? a : a?.login) ?? 'reviewer'
  const feedback = [
    ...(data.reviews ?? []).filter((x) => x.body?.trim())
      .map((x) => `${authorOf(x.author)} (${x.state ?? 'REVIEW'}): ${x.body}`),
    ...(data.comments ?? []).filter((x) => x.body?.trim())
      .map((x) => `${authorOf(x.author)}: ${x.body}`),
  ]
  if (!feedback.length) throw new UsageError(`pe: no review feedback found on ${verdict.pr}`)
  journal(ctx.paths, 'revise.start', { pr: verdict.pr, feedback: feedback.length })

  const { fail, v } = await verifyLoop(ctx, revisePrompt(ctx.task, feedback), 'revise', { cairn: false })
  if (fail) return fail
  if (!v.ok) return ctx.finish('FAILED_TESTS', { tt: v.tt, message: v.message })
  const pushFail = guardedPush(ctx, v)
  if (pushFail) return pushFail
  journal(ctx.paths, 'revise.pushed', {})

  if (cfg.cairn) {
    log('to teach Cairn from this correction (you confirm; the agent never can):')
    log(`  ${cfg.cairn.bin} --repo ${repo} remember "<the confirmed rule>" --scope "<path glob>" --ref ${verdict.pr}`)
  }
  return ctx.finish('REVISED', { tt: v.tt, pr: { url: verdict.pr, number } })
}

// ---- pe resume ------------------------------------------------------------
// Continue a FAILED_TESTS or ABORTED_BUDGET run in its preserved worktree,
// with the recorded failure as context. Same gates, same delivery.
export async function runResume({ repo, runId, verdict, flags, cfg, log }) {
  if (!['FAILED_TESTS', 'ABORTED_BUDGET'].includes(verdict.state)) {
    throw new UsageError(`pe: run '${runId}' is ${verdict.state}; resume only continues FAILED_TESTS or ABORTED_BUDGET runs`)
  }
  const ctx = continuationCtx({ repo, cfg, flags, log, runId, verdict })
  journal(ctx.paths, 'resume.start', { from: verdict.state })
  return delegateThenDeliver(ctx, resumePrompt(ctx.task, verdict.message), 'resume')
}

export function exitCodeFor(result) {
  switch (result.state) {
    case 'DELIVERED_READY': return result.humanRequired ? 3 : 0
    case 'DELIVERED_DRAFT':
    case 'REVISED': return 0
    case 'FAILED_TESTS':
    case 'BLOCKED_CAIRN':
    case 'BLOCKED_SECRETS':
    case 'ABORTED_BUDGET': return 1
    default: return 2
  }
}
