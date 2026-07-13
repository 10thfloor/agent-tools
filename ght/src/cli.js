import { spawnSync } from 'node:child_process'
import { parseArgs, UsageError, USAGE } from './flags.js'
import { convert } from './convert.js'
import { prepSpawn } from './spawn.js'

const MAX_BUFFER = 256 * 1024 * 1024

export function runGht(argv, env = process.env) {
  let parsed
  try {
    parsed = parseArgs(argv, env)
  } catch (err) {
    if (err instanceof UsageError) {
      process.stderr.write(err.message + '\n\n' + USAGE)
      return 2
    }
    throw err
  }
  const { opts, gh } = parsed
  if (opts.help) {
    process.stdout.write(USAGE)
    return 0
  }
  const ghPath = env.GHT_GH_PATH || 'gh'

  if (opts.raw) {
    const r = spawnSync(...prepSpawn(ghPath, gh, { stdio: 'inherit' }))
    if (r.error) return reportSpawnError(ghPath, r.error)
    return r.status ?? 1
  }

  const r = spawnSync(...prepSpawn(ghPath, gh, {
    stdio: ['inherit', 'pipe', 'inherit'],
    maxBuffer: MAX_BUFFER,
  }))
  if (r.error) return reportSpawnError(ghPath, r.error)

  const out = r.stdout ?? Buffer.alloc(0)
  // Binary output (e.g. gh release download to stdout) passes through as-is.
  if (out.includes(0)) {
    process.stdout.write(out)
    return r.status ?? 0
  }
  const text = out.toString('utf8')
  // Only successful JSON output is converted; error output stays verbatim.
  if (r.status !== 0) {
    process.stdout.write(text)
    return r.status ?? 1
  }
  const converted = safeConvert(text, opts)
  process.stdout.write(converted ?? text)
  if (converted != null && opts.stats) writeStats(text, converted)
  return 0
}

// Fast chars/4 estimate (hence the ~): a real tokenizer would add startup
// latency to every call. BENCHMARK.md has exact, tokenizer-measured numbers.
function writeStats(rawText, converted) {
  const est = (s) => Math.round(s.length / 4)
  const rawTokens = est(rawText)
  const outTokens = est(converted)
  const saved = rawTokens > 0 ? Math.round(100 * (1 - outTokens / rawTokens)) : 0
  process.stderr.write(
    `ght: ~${outTokens.toLocaleString('en-US')} tokens (raw gh: ~${rawTokens.toLocaleString('en-US')}, ${saved}% saved)\n`,
  )
}

function safeConvert(text, opts) {
  try {
    const c = convert(text, opts)
    return c == null ? null : c + '\n'
  } catch {
    return null
  }
}

function reportSpawnError(ghPath, error) {
  process.stderr.write(`ght: failed to run ${ghPath}: ${error.message}\n`)
  return 1
}
