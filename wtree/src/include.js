import { cpSync, existsSync, globSync, readFileSync } from 'node:fs'
import { join, resolve, sep } from 'node:path'

// Claude Code-compatible .worktreeinclude: gitignore-style glob patterns of
// (typically gitignored) files to copy into a fresh worktree — .env files,
// local secrets, etc. Subset: comments and globs, no negation (!). Existing
// files are never overwritten.
//
// Security: .worktreeinclude is repo-controlled, so a hostile one could try
// to escape the repo (`../../.ssh/id_rsa`, absolute paths) and pull secrets
// into the worktree — a git tree a later `git add -A` might exfiltrate. Both
// the source (under mainPath) and the destination (under destPath) are
// containment-checked; escaping entries are skipped.
export function copyIncluded(mainPath, destPath) {
  const file = join(mainPath, '.worktreeinclude')
  if (!existsSync(file)) return { copied: 0, skipped: 0 }
  const root = resolve(mainPath)
  const dest = resolve(destPath)
  const patterns = readFileSync(file, 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#') && !l.startsWith('!'))
    .map((l) => l.replace(/\/+$/, ''))
  if (!patterns.length) return { copied: 0, skipped: 0 }
  let copied = 0
  let skipped = 0
  const within = (parent, p) => p === parent || p.startsWith(parent + sep)
  for (const rel of new Set(globSync(patterns, { cwd: mainPath }))) {
    if (rel === '.git' || rel.startsWith('.git' + sep) || rel.startsWith('.git/')) continue
    const from = resolve(root, rel)
    const to = resolve(dest, rel)
    // Reject anything that resolves outside the repo or outside the worktree.
    if (!within(root, from) || !within(dest, to)) {
      skipped++
      continue
    }
    if (existsSync(to)) continue
    cpSync(from, to, { recursive: true, force: false, errorOnExist: false, dereference: false })
    copied++
  }
  return { copied, skipped }
}
