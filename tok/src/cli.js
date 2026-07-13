import { spawnSync } from 'node:child_process'
import { readFileSync, statSync } from 'node:fs'
import { encode as toonEncode } from '@toon-format/toon'
import { parseBudget, buildRow, isBinary } from './count.js'

export const USAGE = `tok — token counter and budget linter for agent-facing text

Usage:
  tok <file...>            count tokens per file (+ total)
  tok -- <command...>      count a command's stdout, e.g. tok -- git diff
  ... | tok                count stdin

Flags: --max=<n|Nk|Nm> (exit 1 if any input exceeds it), --enc=o200k|cl100k,
       --json | --toon | --table, --help
Counts use gpt-tokenizer (o200k_base default) — the same proxy the gh-toon
benchmark used; Claude's tokenizer is not public.
`

export function parseArgs(argv) {
  const files = []
  const flags = { enc: 'o200k' }
  let command = null
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--') {
      command = argv.slice(i + 1)
      break
    }
    if (a === '--json') flags.json = true
    else if (a === '--toon') flags.toon = true
    else if (a === '--table') flags.table = true
    else if (a === '--help' || a === '-h') flags.help = true
    else if (a === '--max') flags.max = argv[++i]
    else if (a.startsWith('--max=')) flags.max = a.slice('--max='.length)
    else if (a.startsWith('--enc=')) flags.enc = a.slice('--enc='.length)
    else if (a.startsWith('-') && a !== '-') throw new Error(`tok: unknown flag ${a}`)
    else files.push(a)
  }
  if (flags.max != null) {
    const parsed = parseBudget(flags.max)
    if (parsed == null) throw new Error(`tok: invalid --max "${flags.max}" (use 800, 5k, 1.5k, 2m)`)
    flags.max = parsed
  } else {
    flags.max = null
  }
  if (!['o200k', 'cl100k'].includes(flags.enc)) throw new Error(`tok: unknown encoding "${flags.enc}"`)
  return { files, command, flags }
}

async function loadCounter(enc) {
  const mod = enc === 'cl100k'
    ? await import('gpt-tokenizer/encoding/cl100k_base')
    : await import('gpt-tokenizer/encoding/o200k_base')
  return (text) => mod.encode(text).length
}

export async function runTok(argv) {
  let parsed
  try {
    parsed = parseArgs(argv)
  } catch (err) {
    process.stderr.write(err.message + '\n\n' + USAGE)
    return 2
  }
  const { files, command, flags } = parsed
  if (flags.help) {
    process.stdout.write(USAGE)
    return 0
  }

  const inputs = []
  if (command && command.length) {
    const r = spawnSync(command[0], command.slice(1), { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 })
    if (r.error) {
      process.stderr.write(`tok: failed to run ${command[0]}: ${r.error.message}\n`)
      return 1
    }
    inputs.push({ name: command.join(' '), text: r.stdout ?? '' })
  } else if (files.length) {
    for (const f of files) {
      try {
        if (statSync(f).isDirectory()) {
          process.stderr.write(`tok: skipping directory ${f}\n`)
          continue
        }
        const buf = readFileSync(f)
        if (isBinary(buf)) {
          process.stderr.write(`tok: skipping binary file ${f}\n`)
          continue
        }
        inputs.push({ name: f, text: buf.toString('utf8') })
      } catch (err) {
        process.stderr.write(`tok: ${f}: ${err.message}\n`)
        return 2
      }
    }
  } else if (!process.stdin.isTTY) {
    inputs.push({ name: '(stdin)', text: readFileSync(0, 'utf8') })
  } else {
    process.stderr.write('tok: nothing to count\n\n' + USAGE)
    return 2
  }
  if (!inputs.length) {
    process.stderr.write('tok: nothing to count\n')
    return 2
  }

  const count = await loadCounter(flags.enc)
  const rows = inputs.map((i) => buildRow(i.name, i.text, count, flags.max))
  const total = rows.reduce((a, r) => a + r.tokens, 0)
  const overCount = rows.filter((r) => r.over).length
  const report = {
    summary: { total, encoding: flags.enc === 'cl100k' ? 'cl100k_base' : 'o200k_base', ...(flags.max != null ? { max: flags.max, over: overCount } : {}) },
    inputs: rows,
  }

  const format = flags.table ? 'table' : flags.json ? 'json' : flags.toon ? 'toon' : process.stdout.isTTY ? 'table' : 'toon'
  if (format === 'json') process.stdout.write(JSON.stringify(report) + '\n')
  else if (format === 'toon') process.stdout.write(toonEncode(report, { delimiter: ',' }) + '\n')
  else process.stdout.write(renderTable(rows, report.summary) + '\n')
  return overCount > 0 ? 1 : 0
}

function renderTable(rows, summary) {
  const fmt = (n) => n.toLocaleString('en-US')
  const nw = Math.max(5, ...rows.map((r) => r.name.length))
  const tw = Math.max(6, ...rows.map((r) => fmt(r.tokens).length))
  const lines = [`${'INPUT'.padEnd(nw)}  ${'TOKENS'.padStart(tw)}  ${'BYTES'.padStart(9)}  LINES${summary.max != null ? '  BUDGET' : ''}`]
  for (const r of rows) {
    const budget = summary.max != null ? (r.over ? `  OVER (max ${fmt(summary.max)})` : '  ok') : ''
    lines.push(`${r.name.padEnd(nw)}  ${fmt(r.tokens).padStart(tw)}  ${fmt(r.bytes).padStart(9)}  ${String(r.lines).padStart(5)}${budget}`)
  }
  if (rows.length > 1) lines.push(`${'total'.padEnd(nw)}  ${fmt(summary.total).padStart(tw)}`)
  return lines.join('\n')
}
