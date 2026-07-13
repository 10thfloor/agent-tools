import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { encode } from '@toon-format/toon'
import { condense } from './condense.js'
import { defaultCommand, run } from './runner.js'

export const USAGE = `tt — run the tests, get an agent-readable verdict

Usage:
  tt                      run the project's test command (npm test / pytest /
                          cargo test / go test); piped output is the verdict:
                          summary + one row per failure + exit code
  tt <command...>         condense any command's output instead
  tt --tt-last            re-condense the previous run (no re-run)
  tt --tt-full            print the previous run's full output

Flags: --tt-raw (no condensing), --tt-json (JSON instead of TOON),
       --tt-max=<n> (failure row cap, default 40), --tt-help
Env:   TT_CACHE_DIR (cache location, default ~/.cache/tt)

TTY = full output streams through (and is cached); piped = summary + one row
per failure as TOON. Exit code is always the child's.
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
    else if (a.startsWith('--tt-')) throw new Error(`tt: unknown flag ${a}`)
    else cmd.push(a)
  }
  return { cmd, flags }
}

function cachePaths(cwd, env) {
  const dir = env.TT_CACHE_DIR || join(homedir(), '.cache', 'tt')
  const key = createHash('sha256').update(realpathSync(cwd)).digest('hex').slice(0, 16)
  return { log: join(dir, `${key}.log`), meta: join(dir, `${key}.json`), dir }
}

const est = (s) => Math.round(s.length / 4)

function emitCondensed(text, code, command, flags) {
  const report = condense(text, code, command, { maxBlocks: flags.max })
  const out = flags.json ? JSON.stringify(report) : encode(report, { delimiter: ',' })
  process.stdout.write(out + '\n')
  const saved = est(text) > 0 ? Math.round(100 * (1 - est(out) / est(text))) : 0
  process.stderr.write(`tt: ~${est(out).toLocaleString('en-US')} tokens (full run: ~${est(text).toLocaleString('en-US')}, ${saved}% smaller) — tt --tt-full for everything\n`)
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

  if (flags.last || flags.full) {
    if (!existsSync(cache.log)) {
      process.stderr.write('tt: no cached run for this directory yet\n')
      return 1
    }
    const text = readFileSync(cache.log, 'utf8')
    if (flags.full) {
      process.stdout.write(text)
      return 0
    }
    const meta = existsSync(cache.meta) ? JSON.parse(readFileSync(cache.meta, 'utf8')) : {}
    emitCondensed(text, meta.exit ?? 0, meta.command ?? '', flags)
    return 0
  }

  const command = cmd.length ? cmd : defaultCommand(cwd)
  if (!command) {
    process.stderr.write('tt: no test command detected — run tt <command...>\n')
    return 2
  }
  const tty = process.stdout.isTTY === true
  const { text, code } = await run(command, { echo: tty || flags.raw })
  mkdirSync(cache.dir, { recursive: true })
  writeFileSync(cache.log, text)
  writeFileSync(cache.meta, JSON.stringify({ command: command.join(' '), exit: code, when: new Date().toISOString() }))
  if (tty || flags.raw) {
    process.stderr.write('tt: cached — tt --tt-last re-condenses without re-running\n')
    return code
  }
  emitCondensed(text, code, command.join(' '), flags)
  return code
}
