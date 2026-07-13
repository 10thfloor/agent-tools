import { spawnSync } from 'node:child_process'

export function git(args, opts = {}) {
  const r = spawnSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...opts })
  if (r.error) throw r.error
  if (r.status !== 0) {
    const err = new Error((r.stderr || `git ${args.join(' ')} failed`).trim())
    err.exitCode = r.status
    throw err
  }
  return r.stdout
}

export function tryGit(args, opts) {
  try {
    return git(args, opts)
  } catch {
    return null
  }
}
