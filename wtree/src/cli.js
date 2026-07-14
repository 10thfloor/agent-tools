import { cmdList, cmdNew, cmdRm, cmdClean, cmdPath, cmdNote } from './commands.js'
import { shellInit } from './shellinit.js'

export const USAGE = `wtree: friendly git worktrees, per project

Usage:
  wtree [list] [--toon|--json|--table]     list worktrees + activity (default)
  wtree new [branch] [-m <note>] [--from <ref>] [--pr <number>]
                                           create or reuse a worktree; prints its
                                           path. No branch? names it wtree-1, wtree-2…
                                           --pr N checks out GitHub PR #N (note
                                           auto-set from the PR title via gh)
  wtree cd [branch]                        jump to a worktree (no branch: back to
                                           the main worktree); needs the shell hook
  wtree note [branch] [text]               show or set a worktree's one-line note
  wtree rm <branch|path> [--force]         remove a worktree (+ branch if merged)
  wtree clean [--yes]                      remove every idle worktree
  wtree path [branch]                      print a worktree's path (no branch: the
                                           main worktree)
  wtree shell-init <shell>                 print the shell hook that makes new/cd
                                           change directory (bash|zsh|fish|powershell)

Worktrees live in <repo-parent>/<repo>.worktrees/<branch>.
A .worktreeinclude file (gitignore-style patterns, Claude Code-compatible)
copies matching gitignored files (.env, secrets/) into new worktrees.
active = uncommitted changes, unpushed commits, open PR, an agent/process
working inside it, or git-locked. idle = none of those.
WORK column = your note (wtree new -m / wtree note), else a summary generated
from git state ("editing src, test (3 files +42/-7)", "2 commits, last: …").
List format: table on a terminal, TOON when piped (agents), --json for scripts.
Auto-cd: add  eval "$(wtree shell-init zsh)"  to your shell rc; then
wtree new / wtree cd land you in the worktree directly.

Env: WTREE_GH (gh binary for PR lookup), WTREE_NO_PROC=1 (skip process detection)
`

class UsageError extends Error {}

const BOOL_FLAGS = {
  toon: 'toon', json: 'json', table: 'table',
  force: 'force', f: 'force', yes: 'yes', y: 'yes', help: 'help', h: 'help',
}
const VALUE_FLAGS = { from: 'from', note: 'note', m: 'note', pr: 'pr' }

export function parseArgv(argv) {
  const pos = []
  const flags = {}
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (!a.startsWith('-') || a === '-') { pos.push(a); continue }
    const body = a.startsWith('--') ? a.slice(2) : a.slice(1)
    const eq = body.indexOf('=')
    const name = eq === -1 ? body : body.slice(0, eq)
    const short = !a.startsWith('--')
    if (VALUE_FLAGS[name] && (!short || body.length === 1)) {
      if (eq === -1) {
        if (i + 1 >= argv.length) throw new UsageError(`flag ${a} requires a value`)
        flags[VALUE_FLAGS[name]] = argv[++i]
      } else {
        flags[VALUE_FLAGS[name]] = body.slice(eq + 1)
      }
    } else if (BOOL_FLAGS[name] && eq === -1 && (!short || body.length === 1)) {
      flags[BOOL_FLAGS[name]] = true
    } else {
      throw new UsageError(`unknown flag ${a}`)
    }
  }
  return { pos, flags }
}

export function runWtree(argv, env = process.env) {
  let parsed
  try {
    parsed = parseArgv(argv)
  } catch (err) {
    process.stderr.write(`wtree: ${err.message}\n\n${USAGE}`)
    return 2
  }
  const { pos, flags } = parsed
  if (flags.help) {
    process.stdout.write(USAGE)
    return 0
  }
  const cmd = pos[0] ?? 'list'
  const cwd = process.cwd()
  try {
    switch (cmd) {
      case 'list': case 'ls': return cmdList(cwd, flags, env)
      case 'new': case 'add': return cmdNew(cwd, pos[1], flags, env)
      case 'rm': case 'remove': return cmdRm(cwd, pos[1], flags)
      case 'clean': return cmdClean(cwd, flags, env)
      case 'note': return cmdNote(cwd, pos.slice(1))
      case 'path': return cmdPath(cwd, pos[1])
      case 'shell-init':
        try {
          process.stdout.write(shellInit(pos[1]))
          return 0
        } catch (err) {
          process.stderr.write(`wtree: ${err.message}\n`)
          return 2
        }
      case 'cd':
        // Reached only without the hook: a child process can't cd its parent.
        process.stderr.write('wtree: cd needs the shell hook. Add to your shell rc:\n'
          + '  eval "$(wtree shell-init zsh)"   # or bash | fish | powershell\n'
          + `then restart the shell. (Without it: cd "$(wtree path ${pos[1] ?? '<branch>'})")\n`)
        return 1
      default:
        process.stderr.write(`wtree: unknown command '${cmd}'\n\n${USAGE}`)
        return 2
    }
  } catch (err) {
    const msg = /not a git repository/i.test(err.message) ? 'not inside a git repository'
      : /invalid reference: HEAD|does not have any commits/i.test(err.message)
        ? 'this repository has no commits yet; make an initial commit first'
        : err.message
    process.stderr.write(`wtree: ${msg}\n`)
    return 1
  }
}
