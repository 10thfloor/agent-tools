import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

// Repos = the root itself (if a repo) plus its immediate children.
// *.worktrees satellites are skipped: their checkouts group under the main
// repo via mainRootOf anyway.
export function discoverRepos(roots) {
  const found = new Set()
  for (const root of roots) {
    if (existsSync(join(root, '.git'))) found.add(root)
    let entries = []
    try {
      entries = readdirSync(root, { withFileTypes: true })
    } catch {
      continue
    }
    for (const e of entries) {
      if (!e.isDirectory()) continue
      if (e.name.startsWith('.') || e.name === 'node_modules' || e.name.endsWith('.worktrees')) continue
      const dir = join(root, e.name)
      if (existsSync(join(dir, '.git'))) found.add(dir)
    }
  }
  return [...found]
}

export function mainRootOf(dir) {
  const r = spawnSync('git', ['-C', dir, 'worktree', 'list', '--porcelain'], { encoding: 'utf8', timeout: 10000 })
  if (r.status !== 0 || !r.stdout) return null
  const m = r.stdout.match(/^worktree (.+)$/m)
  return m ? m[1] : null
}

// Unique main-repo paths for a set of discovered dirs.
export function groupByMainRoot(dirs) {
  const mains = new Set()
  for (const dir of dirs) mains.add(mainRootOf(dir) ?? dir)
  return [...mains]
}
