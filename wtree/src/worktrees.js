import { basename, dirname, join } from 'node:path'
import { git, tryGit } from './run.js'

// Parse `git worktree list --porcelain`: blank-line-separated blocks of
// `worktree <path>` / `HEAD <sha>` / `branch refs/heads/x` / flag lines.
export function parseWorktreeList(text) {
  const items = []
  let cur = null
  for (const line of text.split('\n')) {
    if (!line.trim()) {
      if (cur) items.push(cur)
      cur = null
      continue
    }
    const sp = line.indexOf(' ')
    const key = sp === -1 ? line : line.slice(0, sp)
    const val = sp === -1 ? '' : line.slice(sp + 1)
    if (key === 'worktree') {
      cur = { path: val, head: null, branch: null, detached: false, locked: false, prunable: false, isMain: false }
    } else if (!cur) {
      continue
    } else if (key === 'HEAD') cur.head = val
    else if (key === 'branch') cur.branch = val.replace(/^refs\/heads\//, '')
    else if (key === 'detached') cur.detached = true
    else if (key === 'locked') cur.locked = true
    else if (key === 'prunable') cur.prunable = true
  }
  if (cur) items.push(cur)
  if (items.length) items[0].isMain = true // git lists the main worktree first
  return items
}

export function listWorktrees(cwd) {
  return parseWorktreeList(git(['worktree', 'list', '--porcelain'], { cwd }))
}

// Worktrees for repo /x/proj live in /x/proj.worktrees/<branch-slug>.
export function worktreesDir(mainPath) {
  return join(dirname(mainPath), `${basename(mainPath)}.worktrees`)
}

export function slug(branch) {
  return branch.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '')
}

// Accept a branch name, a full path (separator/case-tolerant), or a path
// basename, so `rm`/`path`/`note` by native Windows path also resolve.
export function findWorktree(items, ref) {
  return (
    items.find((w) => w.branch === ref)
    || items.find((w) => samePathBase(w.path) === samePathBase(ref))
    || items.find((w) => basename(w.path) === basename(ref))
  )
}

// Compare filesystem paths tolerantly: git emits '/' while Node gives '\\' on
// Windows, where the filesystem is also case-insensitive.
export function samePathBase(p) {
  const s = p.replace(/\\/g, '/')
  return process.platform === 'win32' ? s.toLowerCase() : s
}

export function pathWithin(parent, child) {
  const p = samePathBase(parent)
  const c = samePathBase(child)
  return c === p || c.startsWith(p + '/')
}

// The worktree containing a directory (longest path wins, since worktrees can be
// nested inside the main one, e.g. .claude/worktrees/*).
export function worktreeAt(items, dir) {
  return items
    .filter((w) => pathWithin(w.path, dir))
    .sort((a, b) => b.path.length - a.path.length)[0]
}

// Generic names for wtree new without a branch: wtree-1, wtree-2, ...
export function nextGenericBranch(cwd) {
  const out = tryGit(['branch', '--list', 'wtree-*', '--format=%(refname:short)'], { cwd }) ?? ''
  const used = new Set(out.split('\n').filter(Boolean))
  let n = 1
  while (used.has(`wtree-${n}`)) n++
  return `wtree-${n}`
}

// One-line intent notes, stored in git's native per-branch description.
export function getNote(cwd, branch) {
  const v = tryGit(['config', '--get', `branch.${branch}.description`], { cwd })
  return v ? v.trim().split('\n')[0] : ''
}

export function setNote(cwd, branch, text) {
  git(['config', `branch.${branch}.description`, text], { cwd })
}
