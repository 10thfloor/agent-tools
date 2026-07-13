# Spec: wtree (friendly git worktrees, per project)

## Objective

Git worktrees are powerful (agents and humans working on parallel branches
without stashing) but the raw UX is hostile: you must invent paths, remember
`worktree add/remove/prune` incantations, and nothing tells you which
worktrees are actually in use. `wtree` is a per-project CLI: run it inside any
repo and it manages that repo's worktrees in one predictable place, with
one-command create/remove and an activity-aware list that separates
**active** worktrees (uncommitted changes, unpushed commits, open PR, an
agent/process working in it, or git-locked) from **idle** ones (none of
those). Output is agent-first: human table on a TTY, TOON when piped.

### Assumptions (autonomous session, flagging instead of asking)

1. "Per project" = the tool lives in the agent-tools suite (the `wtree/`
   package) **and** operates on whatever repo you run it in;
   worktrees are stored per project at `<repo-parent>/<repo>.worktrees/<branch>`.
2. "Agent is working on them" is detected heuristically: a `claude` / `node`
   / `bun` / `python` process whose cwd is inside the worktree (via `lsof`,
   best-effort, 4s timeout, skippable with `WTREE_NO_PROC=1`).
3. "Active PR" uses `gh pr list` when `gh` is installed/authenticated and the
   repo has a GitHub remote; otherwise the PR column is silently empty.
4. "Apply TOON if applicable" = `wtree list` emits TOON when stdout is not a
   TTY (the agent case), matching the ght convention; `--table`,
   `--toon`, `--json` override.
5. Removing a worktree also deletes its branch when fully merged (`-d`);
   unmerged branches are kept with a note unless `--force`.

## Tech Stack

Node >= 22 (fs.globSync for .worktreeinclude), ESM. Dependency:
`@toon-format/toon` ^2.3.0. Tests: `node:test` with real `git` repos in
temp dirs.

## Commands

```
Install: npm install && npm link      (in wtree/)
Test:    npm test                     (node --test test/*.test.js)
Run:     wtree / wtree new <branch> / wtree rm <branch> / wtree clean / wtree path <branch>
```

## CLI Contract

- `wtree` / `wtree list`: every worktree with branch, activity reasons
  (`dirty:N`, `unpushed:N`, `pr:#N`, `agent`, `locked`), PR number, path.
  Format: table on TTY, TOON piped, `--json` for scripts.
- `wtree new [branch] [-m <note>] [--from <ref>]` (one command, idempotent):
  reuses the worktree if it exists, else uses the local branch, else tracks
  `origin/<branch>`, else creates a branch from `--from`/HEAD. Branch name
  optional. Generic names `wtree-1`, `wtree-2`, … are generated. `-m` stores a
  one-line intent note in `branch.<name>.description`. **stdout is the
  worktree path only** (so `cd "$(wtree new x)"` works); friendly summary goes
  to stderr.
- `wtree note [branch] [text]`: show or set the note; inside a worktree the
  branch is inferred (deepest containing worktree wins).
- `wtree new --pr <n>`: fetches `pull/<n>/head` from origin (fork PRs work,
  gh not required) into branch `pr-<n>`; note auto-set from the PR title
  via gh when available. Mutually exclusive with a branch argument.
- `.worktreeinclude` (Claude Code-compatible; glob subset, no negation):
  matching gitignored files are copied into freshly created worktrees,
  never overwriting.
- The list's `work` column = stored note, else a summary generated live from
  git state (dirty dirs + diffstat / commits ahead of main + last subject /
  "no work yet").
- `wtree rm <branch|path> [--force]`: refuses to remove the main worktree;
  refuses dirty worktrees without `--force`; prunes; deletes merged branch.
- `wtree clean [--yes]`: plans removal of all idle worktrees; executes only
  with `--yes`.
- `wtree path <branch>`: prints the path (exit 1 if absent). Shell helper:
  `wtc() { cd "$(wtree new "$1")"; }`.
- Errors are one friendly line on stderr, exit 1; usage errors exit 2.
- Env: `WTREE_GH` (alternate gh binary; tests stub it), `WTREE_NO_PROC=1`.

## Project Structure

```
wtree/
  bin/wtree.js         → entry point
  src/run.js        → git exec helpers
  src/worktrees.js  → porcelain parsing, paths, slug, lookup
  src/signals.js    → dirty/ahead, PR map via gh, agent-process cwds, activity
  src/format.js     → table / TOON / JSON renderers
  src/commands.js   → list, new, rm, clean, path
  src/cli.js        → argv parsing + dispatch
  test/             → unit + end-to-end against real temp git repos
```

## Code Style

Same as ght: small pure modules, no classes, stderr for humans, stdout
for machines.

## Testing Strategy

- Unit: porcelain parser (main/detached/locked/prunable), slug, activity
  derivation for each signal.
- E2E: temp git repos; create → list (TOON default when piped) → dirty →
  rm refusal → rm --force → clean dry-run/--yes; PR stub via fake `WTREE_GH`.

## Boundaries

- Always: never touch the main worktree; never remove dirty work without
  `--force`; degrade gracefully when `gh`/`lsof` are unavailable.
- Ask first: publishing to npm, new dependencies, committing.
- Never: mutate anything on GitHub; delete branches with unmerged work
  without `--force`.

## Success Criteria

1. `npm test` passes (unit + E2E on real git).
2. Live demo on an actual repo: create, list active/idle correctly, remove.
3. Piped `wtree list` emits valid TOON; TTY shows the table.
4. `cd "$(wtree new x)"` works (stdout purity).
