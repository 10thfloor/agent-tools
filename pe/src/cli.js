import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { encode } from '@toon-format/toon'
import { loadConfig, UsageError } from './config.js'
import { evidencePaths, latestPath } from './evidence.js'
import { runPipeline, runRevise, runResume, exitCodeFor } from './run.js'
import { unseal } from './cairn.js'
import { runDoctor } from './doctor.js'
import { scorecard } from './scorecard.js'
import { sh } from './exec.js'

export const USAGE = `pe: principal-engineer harness wrapping headless Claude Code

Usage:
  pe run [--repo <path>] [--base <ref>] [--draft-only] [--max-turns <n>] "<task>"
      stage a worktree, delegate implementation to Claude Code, verify (tt,
      clean tree), deliver a PR, seal pilot evidence. Verdict on stdout.
  pe revise [run-id] [--repo <path>]
      after human review: fetch the PR feedback, address it in the same
      worktree, push the same branch (default: the latest run)
  pe resume [run-id] [--repo <path>]
      continue a FAILED_TESTS / ABORTED_BUDGET run in its preserved
      worktree, with the recorded failure as context (default: latest)
  pe report [run-id] [--repo <path>]
      re-print a past run's verdict (default: the latest run)
  pe unseal <run-id> [--repo <path>] [--outcome strong|partial]
            [--findings <n>] [--changes-requested]
      pilot: reveal the sealed Cairn record (once) and log the human outcome
  pe doctor [--repo <path>]
      preflight every dependency (claude, wtree, tt, ght, git, gh auth,
      cairn, evidence dir); exit 1 if anything would break a run
  pe scorecard [--repo <path>]
      pilot metrics from the evidence dir: run states, remediation rate,
      spend, sealed records vs unsealed human outcomes

Exit codes: 0 delivered, 1 gates failed / aborted, 2 usage or environment
error. Gate mode mirrors cairn --gate: 3 = delivered but HUMAN_REQUIRED.

Config: pe.json at the repo root (cairn{bin,mode,base}, budgets{maxTurns,
timeoutMin}, retries{verify}, pr{readyOnGreen}, evidence{dir}).
Env: PE_CLAUDE, PE_WTREE, PE_TT, PE_GHT, PE_GIT, PE_CAIRN, PE_EVIDENCE_DIR.
`

export function parseArgv(argv) {
  const pos = []
  const flags = {}
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--help' || a === '-h') flags.help = true
    else if (a === '--draft-only') flags.draftOnly = true
    else if (a === '--changes-requested') flags.changesRequested = true
    else if (a.startsWith('--repo=')) flags.repo = a.slice(7)
    else if (a === '--repo') flags.repo = argv[++i]
    else if (a.startsWith('--base=')) flags.base = a.slice(7)
    else if (a === '--base') flags.base = argv[++i]
    else if (a.startsWith('--outcome=')) flags.outcome = a.slice(10)
    else if (a === '--outcome') flags.outcome = argv[++i]
    else if (a.startsWith('--max-turns=')) flags.maxTurns = Number(a.slice(12))
    else if (a === '--max-turns') flags.maxTurns = Number(argv[++i])
    else if (a.startsWith('--findings=')) flags.findings = Number(a.slice(11))
    else if (a === '--findings') flags.findings = Number(argv[++i])
    else if (a.startsWith('-')) throw new UsageError(`pe: unknown flag ${a}`)
    else pos.push(a)
  }
  if ((flags.maxTurns !== undefined && !Number.isInteger(flags.maxTurns))
    || (flags.findings !== undefined && !Number.isInteger(flags.findings))) {
    throw new UsageError('pe: --max-turns and --findings need integers')
  }
  if (flags.outcome && !['strong', 'partial'].includes(flags.outcome)) {
    throw new UsageError('pe: --outcome must be strong or partial')
  }
  return { pos, flags }
}

const err = (s) => process.stderr.write(s + '\n')

function emit(data) {
  if (process.stdout.isTTY) {
    const flat = (obj, prefix = '') => Object.entries(obj).flatMap(([k, v]) =>
      v && typeof v === 'object' ? flat(v, `${prefix}${k}.`) : [[`${prefix}${k}`, v]])
    const rows = flat(data)
    const w = Math.max(...rows.map(([k]) => k.length))
    for (const [k, v] of rows) process.stdout.write(`${k.padEnd(w)}  ${v ?? ''}\n`)
  } else {
    process.stdout.write(encode(data, { delimiter: ',' }) + '\n')
  }
}

function verdictOf(result) {
  return {
    run: result.runId,
    task: result.task,
    branch: result.branch,
    worktree: result.worktree ?? '',
    pr: result.pr?.url ?? '',
    state: result.state,
    base: result.base ?? '',
    tt: { failed: result.tt?.failed ?? '', passed: result.tt?.passed ?? '' },
    cairn: { recorded: Boolean(result.review?.recorded), evidence: result.review?.evidenceHash ?? '' },
    turns: result.totals.turns,
    tokens: result.totals.tokens,
    durationS: result.durationS,
    message: result.message ?? '',
  }
}

// Shared tail of every pipeline-driving command: persist the verdict, mark
// the worktree, narrate, emit, map the exit code.
function finishCommand(result, cfg, repo) {
  const verdict = verdictOf(result)
  writeFileSync(result.paths.verdict, JSON.stringify(verdict, null, 2))
  if (result.worktree) {
    sh(cfg.bins.wtree, ['note', result.branch, `pe: ${result.state}`], { cwd: repo })
  }
  err(`pe: ${result.state}${result.pr?.url ? ` ${result.pr.url}` : ''}${result.message ? ` (${result.message.split('\n')[0]})` : ''}`)
  emit(verdict)
  return exitCodeFor(result)
}

function resolveRun(cfg, repo, runId) {
  if (runId) return evidencePaths(cfg.evidenceDir, repo, runId)
  const latest = latestPath(cfg.evidenceDir, repo)
  if (!existsSync(latest)) throw new UsageError('pe: no runs recorded for this repo')
  return evidencePaths(cfg.evidenceDir, repo, readFileSync(latest, 'utf8').trim())
}

export async function runPe(argv) {
  let parsed
  try {
    parsed = parseArgv(argv)
  } catch (e) {
    err(`${e.message}\n\n${USAGE}`)
    return 2
  }
  const { pos, flags } = parsed
  if (flags.help || !pos.length) {
    process.stdout.write(USAGE)
    return flags.help ? 0 : 2
  }
  const cmd = pos[0]
  const repo = resolve(flags.repo ?? process.cwd())
  let cfg
  try {
    if (!existsSync(repo) || !statSync(repo).isDirectory()) {
      throw new UsageError(`pe: repo not found: ${repo}`)
    }
    cfg = loadConfig(repo)
  } catch (e) {
    err(e.message)
    return 2
  }

  try {
    if (cmd === 'run') {
      const task = pos.slice(1).join(' ').trim()
      if (!task) throw new UsageError('pe: a task is required: pe run "<task>"')
      const result = await runPipeline({ repo, task, flags, cfg, log: (s) => err(`pe: ${s}`) })
      return finishCommand(result, cfg, repo)
    }
    if (cmd === 'revise' || cmd === 'resume') {
      const paths = resolveRun(cfg, repo, pos[1])
      if (!existsSync(paths.verdict)) throw new UsageError(`pe: no verdict for run '${pos[1] ?? '(latest)'}'`)
      const prev = JSON.parse(readFileSync(paths.verdict, 'utf8'))
      const flow = cmd === 'revise' ? runRevise : runResume
      const result = await flow({ repo, runId: prev.run, verdict: prev, flags, cfg, log: (s) => err(`pe: ${s}`) })
      return finishCommand(result, cfg, repo)
    }
    if (cmd === 'report') {
      const paths = resolveRun(cfg, repo, pos[1])
      if (!existsSync(paths.verdict)) throw new UsageError(`pe: no verdict for run '${pos[1] ?? '(latest)'}'`)
      emit(JSON.parse(readFileSync(paths.verdict, 'utf8')))
      return 0
    }
    if (cmd === 'unseal') {
      if (!pos[1]) throw new UsageError('pe: run id required: pe unseal <run-id>')
      const paths = resolveRun(cfg, repo, pos[1])
      const sealed = unseal(paths, flags)
      process.stdout.write(sealed + '\n')
      err(`pe: unsealed ${pos[1]}; outcome logged to ${paths.outcome}`)
      return 0
    }
    if (cmd === 'scorecard') {
      emit(scorecard(cfg.evidenceDir, repo))
      return 0
    }
    if (cmd === 'doctor') {
      const rows = runDoctor({ repo, cfg })
      if (process.stdout.isTTY) {
        for (const r of rows) {
          process.stdout.write(`${r.status === 'ok' ? '✓' : '✗'} ${r.check.padEnd(24)} ${r.detail}\n`)
        }
      } else {
        process.stdout.write(encode(rows, { delimiter: ',' }) + '\n')
      }
      const failed = rows.filter((r) => r.status === 'fail').length
      err(failed ? `pe: ${failed} check(s) failed` : 'pe: environment ready')
      return failed ? 1 : 0
    }
    throw new UsageError(`pe: unknown command '${cmd}'`)
  } catch (e) {
    if (e instanceof UsageError) {
      err(`${e.message}\n\n${USAGE}`)
      return 2
    }
    err(`pe: ${e.message}`)
    return 1
  }
}
