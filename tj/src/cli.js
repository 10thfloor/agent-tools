import { spawnSync } from 'node:child_process'
import { parseArgs, UsageError, USAGE } from './flags.js'
import { profileNameFor } from './profiles.js'
import { convert } from './convert.js'

const MAX_BUFFER = 256 * 1024 * 1024
const est = (s) => Math.round(s.length / 4)

export function runTj(argv, env = process.env) {
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
  const { cmd, opts } = parsed
  if (opts.help) {
    process.stdout.write(USAGE)
    return 0
  }
  if (!cmd.length) {
    process.stderr.write('tj: command required\n\n' + USAGE)
    return 2
  }

  if (opts.raw) {
    const r = spawnSync(cmd[0], cmd.slice(1), { stdio: 'inherit' })
    if (r.error) return reportSpawnError(cmd[0], r.error)
    return r.status ?? 1
  }

  const r = spawnSync(cmd[0], cmd.slice(1), { stdio: ['inherit', 'pipe', 'inherit'], maxBuffer: MAX_BUFFER })
  if (r.error) return reportSpawnError(cmd[0], r.error)

  const out = r.stdout ?? Buffer.alloc(0)
  if (out.includes(0)) {
    process.stdout.write(out)
    return r.status ?? 0
  }
  const text = out.toString('utf8')
  if (r.status !== 0) {
    process.stdout.write(text)
    return r.status ?? 1
  }
  const profileName = opts.profile ?? profileNameFor(cmd[0])
  let converted = null
  try {
    const c = convert(text, opts, profileName)
    converted = c == null ? null : c + '\n'
  } catch {
    converted = null
  }
  process.stdout.write(converted ?? text)
  if (converted != null && opts.stats) {
    const saved = est(text) > 0 ? Math.round(100 * (1 - est(converted) / est(text))) : 0
    process.stderr.write(`tj: ~${est(converted).toLocaleString('en-US')} tokens (raw: ~${est(text).toLocaleString('en-US')}, ${saved}% saved, profile: ${profileName})\n`)
  }
  return 0
}

function reportSpawnError(cmd, error) {
  process.stderr.write(`tj: failed to run ${cmd}: ${error.message}\n`)
  return 1
}
