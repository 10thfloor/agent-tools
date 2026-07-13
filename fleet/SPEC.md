# Spec: fleet — cross-project overview of repos, worktrees, and agents

## Objective

`wtree` answers "what's happening in this repo"; `fleet` lifts that one level:
scan your project roots and show every repo with its worktrees, dirty
state, open PRs, work summaries, and which ones have a live agent — one
table for the whole fleet. Data comes from `wtree list --json` per repo
(suite dogfooding; JSON not TOON so parsing never depends on the upstream
TOON decoder), with a git-only fallback when `wtree` is unavailable.

### Assumptions (autonomous session)

1. Default root is the current directory, scanned one level deep for repos
   (a dir with `.git`); override with positional roots or `FLEET_ROOTS`
   (colon-separated). Hidden dirs, `node_modules`, and `*.worktrees`
   satellites are skipped; repos discovered via a linked worktree are
   grouped under their main worktree.
2. Repos are gathered concurrently (each `wtree list` may hit gh for PRs).
3. `FLEET_WT` overrides the `wtree` binary (tests point it at the sibling
   package — a real suite-integration test).

## CLI Contract

- `fleet [roots...]` — one row per repo: branch, main work summary, dirty
  count, worktrees (active/total), PRs, agents, path. Active repos sort
  first. Table on TTY, TOON piped, `--json` for scripts.
- `fleet --all` — flattened per-worktree rows across all repos (each wtree row
  plus a `repo` column).
- Repos where `wtree` fails fall back to a git-only row (branch + dirty).
- Exit 0 unless discovery finds no repos (exit 1, friendly note).

## Structure & Testing

```
fleet/src/discover.js  → root scanning, worktree-satellite grouping
fleet/src/gather.js    → concurrent wtree list --json per repo + fallback
fleet/src/cli.js       → flags, rendering (table/TOON/JSON)
fleet/test/            → e2e over a temp root with real git repos + real
                         sibling wtree binary via FLEET_WT
```

## Success Criteria

`npm test` passes; a temp root with one dirty multi-worktree repo and one
clean repo yields correct rows and sorting; `--all` flattens; satellites
are grouped not duplicated; live run on a directory of repos works.
