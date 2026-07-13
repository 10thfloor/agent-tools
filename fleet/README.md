# fleet: cross-project overview of repos, worktrees, and agents

[`wtree`](../wtree/) answers "what's happening in this repo?"; `fleet` answers
"what's happening in *all* of them?" It scans your project roots and shows
one row per repo: work summary, worktrees (active/total), open PRs, and
how many have a **live agent** working in them right now.

```
$ fleet
  REPO      WORK                                      WTS   PR  AG  PATH
● api       editing handlers, db (6 files +180/-40)   2●/2  #82 1   ~/code/api
● web       spike: new checkout flow                  1●/1      1   ~/code/web
○ cli-tool  at: bump deps                             1●/3          ~/code/cli-tool

$ fleet --all        # flattened per-worktree rows across every repo
```

Defaults to scanning the current directory one level deep (run it where your
repos live); pass roots as arguments or set `FLEET_ROOTS` (delimited by `:`,
or `;` on Windows). `*.worktrees` satellite dirs are skipped
(their checkouts group under the main repo), as are hidden dirs and
`node_modules`. Active repos sort first.

Per-repo data comes from `wtree list --json` (suite dogfooding: notes,
generated summaries, PR detection, and agent detection all come along for
free), gathered concurrently across repos. Where `wtree` isn't available it
falls back to a git-only row. Table on a TTY, TOON when piped, `--json`
for scripts. Env: `FLEET_ROOTS`, `FLEET_WT` (alternate wtree binary).
