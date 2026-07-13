# wtree: friendly git worktrees, per project

Git worktrees let agents and humans work on parallel branches without
stashing. But the raw UX makes you invent paths, memorize
`worktree add/remove/prune`, and guess which worktrees are still in use.
`wtree` hides all of that. Run it inside any repo; it manages that project's
worktrees in one predictable place: `<repo-parent>/<repo>.worktrees/<branch>`.

```
$ wtree new -m "spike: faster auth flow"   # no name needed, wtree picks one
• no branch name given, using 'wtree-1' (add intent with -m "...")
✓ worktree ready (new branch from HEAD): "spike: faster auth flow"
/home/you/code/myapp.worktrees/wtree-1

$ wtree                         # on a terminal: activity-aware table
  BRANCH             WORK                              ACTIVITY        PR    PATH
● main (main)        at: fix login redirect            dirty:12 agent        ~/code/myapp
● wtree-1               spike: faster auth flow           dirty:3 pr:#41  #41   ~/code/myapp.worktrees/wtree-1
○ spike/old-idea     2 commits, last: try cache layer  —                     ~/code/myapp.worktrees/spike-old-idea

$ wtree clean --yes             # remove everything idle, keep everything active
```

**active** = uncommitted changes, unpushed commits, an open PR, an
agent/process working inside it (`claude`/`node`/`bun`/`python` detected via
`lsof`), or git-locked. **idle** = none of those: safe to clean.

## Install

```sh
cd wtree && npm install && npm link
```

Requires Node >= 22 and git. Optional: `gh` (authenticated) for the PR
column and PR-title notes, `lsof` for agent detection; both degrade
silently when missing.

Works on Linux, macOS, and Windows. The command is `wtree` (not `wt`)
because `wt.exe` is Windows Terminal. Agent detection needs `lsof`
(macOS/Linux); on Windows that one signal is absent, everything else works.

## Commands

| Command | What it does |
|---|---|
| `wtree` / `wtree list` | list worktrees with work summary, activity, PR, path |
| `wtree new [branch] [-m <note>] [--from <ref>] [--pr <n>]` | create or reuse a worktree (idempotent). No branch name? `wtree` generates one (`wtree-1`, `wtree-2`, …). Uses the local branch if it exists, else tracks `origin/<branch>`, else branches from `--from`/HEAD. Prints the path on stdout |
| `wtree note [branch] [text]` | show or set a worktree's one-line note (from inside a worktree, the branch is optional) |
| `wtree rm <branch\|path> [--force]` | remove a worktree; refuses dirty ones without `--force`; deletes the branch if merged, keeps it with a note otherwise |
| `wtree clean [--yes]` | dry-run list of idle worktrees; `--yes` removes them |
| `wtree path <branch>` | print a worktree's path |

Guardrails: the main worktree can never be removed; dirty work is never
deleted without `--force`; unmerged branches survive removal by default.

## Generic names, tracked work

Branch naming is optional: worktrees can have generic names because the
**WORK** column always tells you what's happening in each one:

- your stored note wins: `wtree new -m "spike: streaming parser"` or
  `wtree note "landed the parser, fixing tests"` (notes live in git's native
  `branch.<name>.description`; no sidecar files, they travel with the repo)
- otherwise a one-liner is **generated live from git state**: `editing src,
  test (3 files +42/-7)` while you work, `2 commits, last: fix tokens` once
  committed, `no work yet` when fresh, `stale (directory missing)` when
  prunable. Generated summaries are never stale. They describe the worktree
  as it is right now.

## PR checkouts and gitignored files

`wtree new --pr 1234` reviews a pull request in its own worktree: it fetches
GitHub's `pull/1234/head` ref (works for fork PRs too, no `gh` needed) into
a `pr-1234` branch, and, when `gh` is available, auto-sets the note from
the PR title (`PR #1234: Fix crash on resume`).

A `.worktreeinclude` file in the repo root (gitignore-style patterns; same
convention Claude Code uses) lists gitignored files to copy into every new
worktree: `.env`, local certs, untracked config. Existing files are never
overwritten; negation patterns aren't supported.

## Output contract (agents first)

- `wtree list`: human table on a TTY, **TOON when piped**, so agents get the
  cheap format automatically. `--table`, `--toon`, `--json` override.
- stdout carries machine-usable data only (paths, listings); all friendly
  messages go to stderr. That's what makes this work:

```sh
cd "$(wtree new feat/x)"           # bash/zsh: create-or-reuse, then jump in
wtc() { cd "$(wtree new "$1")"; }  # handy bash/zsh helper
```

PowerShell:

```powershell
Set-Location (wtree new feat/x)
function wtc { Set-Location (wtree new $args[0]) }
```

Piped list output (what an agent sees):

```
[2]{branch,status,activity,dirty,ahead,behind,pr,main,head,path}:
  main,active,"dirty:12 agent",12,0,0,"",true,8e5671d,/home/you/code/myapp
  feat/x,idle,"",0,0,0,"",false,8e5671d,/home/you/code/myapp.worktrees/feat-x
```

## Pointing your agent at it

Add to `CLAUDE.md` / `AGENTS.md`:

```markdown
## Worktrees
Use `wtree` to manage git worktrees: `wtree new -m "<one-line intent>"` prints the
path of a fresh worktree (create-or-reuse; branch name optional), `wtree note
"<update>"` records progress, `wtree rm <branch>` removes one safely, `wtree`
lists all with a work summary and activity. List output is TOON:
`[N]{fields}:` header, one comma-separated row per worktree. Never work
directly on main; take a worktree.
```

## Env

`WTREE_GH`: alternate `gh` binary (tests stub PR data with it).
`WTREE_NO_PROC=1`: skip process detection (faster, e.g. in CI).

## Development

```sh
npm test   # 30 tests, unit + end-to-end against real temp git repos
```
