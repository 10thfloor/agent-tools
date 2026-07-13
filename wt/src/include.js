import { cpSync, existsSync, globSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

// Claude Code-compatible .worktreeinclude: gitignore-style glob patterns of
// (typically gitignored) files to copy into a fresh worktree — .env files,
// local secrets, etc. Subset: comments and globs, no negation (!). Existing
// files are never overwritten.
export function copyIncluded(mainPath, destPath) {
  const file = join(mainPath, '.worktreeinclude')
  if (!existsSync(file)) return 0
  const patterns = readFileSync(file, 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#') && !l.startsWith('!'))
    .map((l) => l.replace(/\/+$/, ''))
  if (!patterns.length) return 0
  let copied = 0
  for (const rel of new Set(globSync(patterns, { cwd: mainPath }))) {
    if (rel === '.git' || rel.startsWith('.git/')) continue
    const to = join(destPath, rel)
    if (existsSync(to)) continue
    cpSync(join(mainPath, rel), to, { recursive: true, force: false, errorOnExist: false })
    copied++
  }
  return copied
}
