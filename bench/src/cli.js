import { writeFileSync } from 'node:fs'
import { loadConfig, writeTemplate } from './config.js'
import { runScenario, aggregate } from './run.js'
import { toToon, toJson, toTable, toMarkdown } from './report.js'

export const USAGE = `bench: token A/B benchmarks on your own workloads

Usage:
  bench init [--force]         write a bench.json template (edit OWNER/REPO)
  bench [run] [file]           run scenarios (default file: ./bench.json)

Each scenario in bench.json pairs a baseline command with a candidate
(usually its wrapped form), both as argv ARRAYS (no shell). bench runs both,
counts real tokens on each stdout, and reports per-scenario + total savings.

Flags:
  --min-saved=<pct>   exit 1 if total savings fall below this (CI gate)
  --enc=o200k|cl100k  tokenizer (default o200k_base)
  --json | --toon | --table    output format (default: table on TTY, TOON piped)
  --md=<path>         also write a Markdown report
  --help
`

export function parseArgs(argv) {
  const pos = []
  const flags = { enc: 'o200k' }
  for (const a of argv) {
    if (a === '--help' || a === '-h') flags.help = true
    else if (a === '--force') flags.force = true
    else if (a === '--json') flags.json = true
    else if (a === '--toon') flags.toon = true
    else if (a === '--table') flags.table = true
    else if (a.startsWith('--min-saved=')) flags.minSaved = Number(a.slice('--min-saved='.length))
    else if (a.startsWith('--enc=')) flags.enc = a.slice('--enc='.length)
    else if (a.startsWith('--md=')) flags.md = a.slice('--md='.length)
    else if (a.startsWith('-') && a !== '-') throw new Error(`bench: unknown flag ${a}`)
    else pos.push(a)
  }
  if (flags.minSaved != null && !Number.isFinite(flags.minSaved)) throw new Error('bench: --min-saved needs a number')
  if (!['o200k', 'cl100k'].includes(flags.enc)) throw new Error(`bench: unknown encoding "${flags.enc}"`)
  return { pos, flags }
}

async function loadCounter(enc) {
  const mod = enc === 'cl100k'
    ? await import('gpt-tokenizer/encoding/cl100k_base')
    : await import('gpt-tokenizer/encoding/o200k_base')
  return (text) => mod.encode(text).length
}

export async function runBench(argv) {
  let parsed
  try {
    parsed = parseArgs(argv)
  } catch (err) {
    process.stderr.write(err.message + '\n\n' + USAGE)
    return 2
  }
  const { pos, flags } = parsed
  if (flags.help) {
    process.stdout.write(USAGE)
    return 0
  }

  const cmd = pos[0] === 'run' ? pos.slice(1) : pos[0] === 'init' ? null : pos
  if (pos[0] === 'init') {
    try {
      writeTemplate('bench.json', flags.force)
    } catch (err) {
      process.stderr.write(err.message + '\n')
      return 2
    }
    process.stderr.write('bench: wrote bench.json; edit OWNER/REPO, then run `bench`\n')
    return 0
  }

  const file = (cmd && cmd[0]) || 'bench.json'
  let scenarios
  try {
    scenarios = loadConfig(file)
  } catch (err) {
    process.stderr.write(err.message + '\n')
    return 2
  }

  const count = await loadCounter(flags.enc)
  const results = scenarios.map((s) => runScenario(s, count))
  const agg = aggregate(results)
  const encName = flags.enc === 'cl100k' ? 'cl100k_base' : 'o200k_base'

  const format = flags.table ? 'table' : flags.json ? 'json' : flags.toon ? 'toon' : process.stdout.isTTY ? 'table' : 'toon'
  if (format === 'json') process.stdout.write(toJson(results, agg) + '\n')
  else if (format === 'toon') process.stdout.write(toToon(results, agg) + '\n')
  else process.stdout.write(toTable(results, agg) + '\n')

  if (flags.md) {
    writeFileSync(flags.md, toMarkdown(results, agg, encName))
    process.stderr.write(`bench: wrote ${flags.md}\n`)
  }

  const gateMiss = flags.minSaved != null && agg.savedPct < flags.minSaved
  process.stderr.write(`bench: ${agg.savedPct}% saved across ${agg.measured} scenario(s) (${encName})`
    + `${agg.failed ? `, ${agg.failed} failed` : ''}`
    + `${gateMiss ? `; BELOW --min-saved=${flags.minSaved}%` : ''}\n`)

  if (agg.failed > 0 || gateMiss) return 1
  return 0
}
