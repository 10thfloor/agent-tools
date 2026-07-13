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
      cur = { path: val, head: null, branch: null, detached: false, bare: false, locked: false, prunable: false, isMain: false }
    } else if (!cur) {
      continue
    } else if (key === 'HEAD') cur.head = val
    else if (key === 'branch') cur.branch = val.replace(/^refs\/heads\//, '')
    else if (key === 'detached') cur.detached = true
    else if (key === 'bare') cur.bare = true
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

// Accept a branch name, a full path, or a path basename.
export function findWorktree(items, ref) {
  return (
    items.find((w) => w.branch === ref)
    || items.find((w) => w.path === ref)
    || items.find((w) => basename(w.path) === ref)
  )
}

// The worktree containing a directory (longest path wins — worktrees can be
// nested inside the main one, e.g. .claude/worktrees/*).
export function worktreeAt(items, dir) {
  return items
    .filter((w) => dir === w.path || dir.startsWith(w.path + '/'))
    .sort((a, b) => b.path.length - a.path.length)[0]
}

// Generic names for wt new without a branch: wt-1, wt-2, ...
export function nextGenericBranch(cwd) {
  const out = tryGit(['branch', '--list', 'wt-*', '--format=%(refname:short)'], { cwd }) ?? ''
  const used = new Set(out.split('\n').filter(Boolean))
  let n = 1
  while (used.has(`wt-${n}`)) n++
  return `wt-${n}`
}

// One-line intent notes, stored in git's native per-branch description.
export function getNote(cwd, branch) {
  const v = tryGit(['config', '--get', `branch.${branch}.description`], { cwd })
  return v ? v.trim().split('\n')[0] : ''
}

export function setNote(cwd, branch, text) {
  git(['config', `branch.${branch}.description`, text], { cwd })
}
