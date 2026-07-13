import { spawnSync } from 'node:child_process'

export function git(args, opts = {}) {
  const r = spawnSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...opts })
  if (r.error) throw r.error
  if (r.status !== 0) {
    const err = new Error((r.stderr || `git ${args.join(' ')} failed`).trim())
    err.exitCode = r.status
    throw err
  }
  // Normalize CRLF → LF: git plumbing can emit \r on Windows, which would
  // otherwise leave a trailing \r on parsed branch names, paths, and subjects.
  return (r.stdout ?? '').replace(/\r\n/g, '\n')
}

export function tryGit(args, opts) {
  try {
    return git(args, opts)
  } catch {
    return null
  }
}
