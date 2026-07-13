import { spawnSync } from 'node:child_process'
import { tryGit } from './run.js'

export const EMPTY_WORK = { dirty: 0, ahead: 0, behind: 0, files: [], shortstat: '', commitsAhead: 0, lastSubject: '' }

export function workStatus(wt, mainBranch) {
  const porcelain = tryGit(['-C', wt.path, 'status', '--porcelain']) ?? ''
  const lines = porcelain.split('\n').filter(Boolean)
  const files = lines.map((l) => l.slice(3))
  let ahead = 0
  let behind = 0
  const lr = tryGit(['-C', wt.path, 'rev-list', '--left-right', '--count', '@{upstream}...HEAD'])
  if (lr) {
    const parts = lr.trim().split(/\s+/).map(Number)
    behind = parts[0] || 0
    ahead = parts[1] || 0
  }
  let shortstat = ''
  if (lines.length) {
    const ss = tryGit(['-C', wt.path, 'diff', 'HEAD', '--shortstat']) ?? ''
    const ins = ss.match(/(\d+) insertion/)?.[1]
    const del = ss.match(/(\d+) deletion/)?.[1]
    shortstat = ins || del ? `+${ins ?? 0}/-${del ?? 0}` : ''
  }
  let commitsAhead = 0
  let lastSubject = ''
  if (wt.isMain || !mainBranch || wt.branch === mainBranch) {
    lastSubject = (tryGit(['-C', wt.path, 'log', '-1', '--format=%s']) ?? '').trim()
  } else {
    const subjects = (tryGit(['-C', wt.path, 'log', '--format=%s', `${mainBranch}..HEAD`]) ?? '')
      .split('\n').filter(Boolean)
    commitsAhead = subjects.length
    lastSubject = subjects[0] ?? ''
  }
  return { dirty: lines.length, ahead, behind, files, shortstat, commitsAhead, lastSubject }
}

// Generated one-liner describing the work in a worktree, derived live from
// git state. A stored note (wt new -m / wt note) takes precedence upstream.
export function autoSummary(wt, work) {
  if (wt.prunable) return 'stale — directory missing'
  if (work.dirty > 0) {
    const stat = work.shortstat ? ` ${work.shortstat}` : ''
    return `editing ${topDirs(work.files)} (${work.dirty} file${work.dirty === 1 ? '' : 's'}${stat})`
  }
  if (wt.isMain) return work.lastSubject ? `at: ${work.lastSubject}` : ''
  if (work.commitsAhead > 0) {
    return `${work.commitsAhead} commit${work.commitsAhead === 1 ? '' : 's'}, last: ${work.lastSubject}`
  }
  return 'no work yet'
}

function topDirs(files) {
  const counts = new Map()
  for (const f of files) {
    const dir = f.includes('/') ? f.slice(0, f.indexOf('/')) : '.'
    counts.set(dir, (counts.get(dir) ?? 0) + 1)
  }
  return [...counts].sort((a, b) => b[1] - a[1]).slice(0, 2).map(([d]) => d).join(', ')
}

// Open PRs keyed by head branch, via gh. null = unavailable (no gh, no
// GitHub remote, not authenticated) — callers degrade silently.
export function openPrsByBranch(cwd, env = process.env) {
  const gh = env.WT_GH || 'gh'
  const r = spawnSync(gh, ['pr', 'list', '--state', 'open', '--json', 'number,isDraft,headRefName,url', '--limit', '200'], {
    encoding: 'utf8',
    cwd,
    timeout: 8000,
  })
  if (r.error || r.status !== 0) return null
  try {
    return new Map(JSON.parse(r.stdout).map((p) => [p.headRefName, p]))
  } catch {
    return null
  }
}

// PR title lookup for --pr note auto-fill. null = gh unavailable.
export function prTitle(cwd, number, env = process.env) {
  const gh = env.WT_GH || 'gh'
  const r = spawnSync(gh, ['pr', 'view', String(number), '--json', 'title'], { encoding: 'utf8', cwd, timeout: 8000 })
  if (r.error || r.status !== 0) return null
  try {
    return JSON.parse(r.stdout).title ?? null
  } catch {
    return null
  }
}

// cwds of processes that look like an agent or dev tooling (claude, node,
// bun, python). Best-effort: lsof missing or slow → empty list.
export function agentCwds(env = process.env) {
  if (env.WT_NO_PROC === '1') return []
  const r = spawnSync('lsof', ['-a', '-d', 'cwd', '-c', 'claude', '-c', 'node', '-c', 'bun', '-c', 'python', '-F', 'n'], {
    encoding: 'utf8',
    timeout: 4000,
  })
  if (r.error || typeof r.stdout !== 'string') return []
  return r.stdout.split('\n').filter((l) => l[0] === 'n').map((l) => l.slice(1))
}

export function deriveActivity(wt, work, pr, cwds) {
  const reasons = []
  if (work.dirty > 0) reasons.push(`dirty:${work.dirty}`)
  if (work.ahead > 0) reasons.push(`unpushed:${work.ahead}`)
  if (pr) reasons.push(`pr:#${pr.number}${pr.isDraft ? '(draft)' : ''}`)
  if (cwds.some((c) => c === wt.path || c.startsWith(wt.path + '/'))) reasons.push('agent')
  if (wt.locked) reasons.push('locked')
  return { active: reasons.length > 0, reasons }
}
