import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { encode } from '@toon-format/toon'
import { condense, fullFailure } from './condense.js'
import { defaultCommand, run } from './runner.js'
import { reporterKind, reporterArgs, parseReport } from './reporters.js'

export const USAGE = `tt — run tests without flooding agent context; details on demand

Usage:
  tt                      run the project's test command (npm test / pytest /
                          cargo test / go test); piped output is the verdict:
                          summary + one row per failure + exit code
  tt <command...>         wrap any command instead
  tt --tt-last            replay the previous verdict (no re-run)
  tt --tt-fail=<n>        print failure #n's complete block from the cache
  tt --tt-full            print the previous run's full output

Flags: --tt-raw (no condensing), --tt-json (JSON instead of TOON),
       --tt-max=<n> (failure row cap, default 40), --tt-help
Env:   TT_CACHE_DIR (cache location, default ~/.cache/tt)

vitest/jest (via the default npm test script) emit their native JSON report
for exact counts; other runners use tuned heuristics. TTY streams through
unchanged. Exit code is always the child's.
`

export function parseArgs(argv) {
  const cmd = []
  const flags = { max: 40 }
  for (const a of argv) {
    if (a === '--tt-raw') flags.raw = true
    else if (a === '--tt-json') flags.json = true
    else if (a === '--tt-last') flags.last = true
    else if (a === '--tt-full') flags.full = true
    else if (a === '--tt-help') flags.help = true
    else if (a.startsWith('--tt-max=')) flags.max = Number(a.slice('--tt-max='.length)) || 40
    else if (a.startsWith('--tt-fail=')) {
      flags.fail = Number(a.slice('--tt-fail='.length))
      if (!Number.isInteger(flags.fail) || flags.fail < 1) throw new Error('tt: --tt-fail needs a positive integer')
    } else if (a.startsWith('--tt-')) throw new Error(`tt: unknown flag ${a}`)
    else cmd.push(a)
  }
  return { cmd, flags }
}

function cachePaths(cwd, env) {
  const dir = env.TT_CACHE_DIR || join(homedir(), '.cache', 'tt')
  const key = createHash('sha256').update(realpathSync(cwd)).digest('hex').slice(0, 16)
  return { log: join(dir, `${key}.log`), meta: join(dir, `${key}.json`), report: join(dir, `${key}.report.json`), dir }
}

const est = (s) => Math.round(s.length / 4)

function emitVerdict(verdict, rawText, flags) {
  const out = flags.json ? JSON.stringify(verdict) : encode(verdict, { delimiter: ',' })
  process.stdout.write(out + '\n')
  const saved = est(rawText) > 0 ? Math.round(100 * (1 - est(out) / est(rawText))) : 0
  process.stderr.write(`tt: ~${est(out).toLocaleString('en-US')} tokens (full run: ~${est(rawText).toLocaleString('en-US')}, ${saved}% smaller) — tt --tt-fail=<n> or --tt-full for detail\n`)
}

// Exact verdict from a vitest/jest JSON report.
function reportVerdict(rep, exit, command, kind, max) {
  const failures = rep.failures.slice(0, max).map((f, i) => ({
    n: i + 1,
    head: f.head,
    detail: (f.message.split('\n').map((s) => s.trim()).filter(Boolean).join(' | ') + (f.file ? ` | ${f.file}` : '')).slice(0, 500),
  }))
  return {
    summary: {
      command: command.join(' '),
      exit,
      failed: rep.failed,
      passed: rep.passed,
      runner: `${kind} (json report)`,
      ...(rep.failures.length > max ? { truncatedFailures: rep.failures.length - max } : {}),
    },
    failures,
  }
}

export async function runTt(argv, env = process.env) {
  let parsed
  try {
    parsed = parseArgs(argv)
  } catch (err) {
    process.stderr.write(err.message + '\n\n' + USAGE)
    return 2
  }
  const { cmd, flags } = parsed
  if (flags.help) {
    process.stdout.write(USAGE)
    return 0
  }
  const cwd = process.cwd()
  const cache = cachePaths(cwd, env)

  if (flags.last || flags.full || flags.fail != null) {
    if (!existsSync(cache.log)) {
      process.stderr.write('tt: no cached run for this directory yet\n')
      return 1
    }
    const text = readFileSync(cache.log, 'utf8')
    if (flags.full) {
      process.stdout.write(text)
      return 0
    }
    if (flags.fail != null) {
      const block = fullFailure(text, flags.fail)
      if (!block) {
        process.stderr.write(`tt: no failure #${flags.fail} in the cached run\n`)
        return 1
      }
      process.stdout.write(block + '\n')
      return 0
    }
    const meta = existsSync(cache.meta) ? JSON.parse(readFileSync(cache.meta, 'utf8')) : {}
    const verdict = meta.verdict ?? condense(text, meta.exit ?? 0, meta.command ?? '', { maxBlocks: flags.max })
    emitVerdict(verdict, text, flags)
    return 0
  }

  const userCmd = cmd.length ? cmd : null
  const command = userCmd ?? defaultCommand(cwd)
  if (!command) {
    process.stderr.write('tt: no test command detected — run tt <command...>\n')
    return 2
  }
  // Exact reporters only for the default script (never rewrite user commands).
  const kind = userCmd ? null : reporterKind(cwd)
  mkdirSync(cache.dir, { recursive: true })
  rmSync(cache.report, { force: true })
  const fullCmd = kind ? [...command, ...reporterArgs(kind, cache.report)] : command
  const tty = process.stdout.isTTY === true
  const { text, code } = await run(fullCmd, { echo: tty || flags.raw })
  const rep = kind ? parseReport(cache.report) : null
  const verdict = rep
    ? reportVerdict(rep, code, command, kind, flags.max)
    : condense(text, code, command.join(' '), { maxBlocks: flags.max })
  writeFileSync(cache.log, text)
  writeFileSync(cache.meta, JSON.stringify({ command: command.join(' '), exit: code, when: new Date().toISOString(), verdict }))
  if (tty || flags.raw) {
    process.stderr.write('tt: cached — tt --tt-last re-reads the verdict without re-running\n')
    return code
  }
  emitVerdict(verdict, text, flags)
  return code
}
