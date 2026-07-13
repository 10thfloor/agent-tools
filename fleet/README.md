# fleet — cross-project overview of repos, worktrees, and agents

[`wt`](../wt/) answers "what's happening in this repo?"; `fleet` answers
"what's happening in *all* of them?" It scans your project roots and shows
one row per repo — work summary, worktrees (active/total), open PRs, and
how many have a **live agent** working in them right now.

```
$ fleet
  REPO         WORK                                      WTS   PR  AG  PATH
● agent-tools  editing ., fleet (8 files)                1●/1      1   ~/Documents/agent-tools
● New project  editing public, src (12 files +521/-128)  2●/2      1   ~/Documents/New project
○ old-demo     at: final tweaks                          1●/3          ~/Documents/old-demo

$ fleet --all        # flattened per-worktree rows across every repo
```

Defaults to scanning `~/Documents` one level deep; pass roots as arguments
or set `FLEET_ROOTS=path:path`. `*.worktrees` satellite dirs are skipped
(their checkouts group under the main repo), as are hidden dirs and
`node_modules`. Active repos sort first.

Per-repo data comes from `wt list --json` (suite dogfooding — notes,
generated summaries, PR detection, and agent detection all come along for
free), gathered concurrently across repos. Where `wt` isn't available it
falls back to a git-only row. Table on a TTY, TOON when piped, `--json`
for scripts. Env: `FLEET_ROOTS`, `FLEET_WT` (alternate wt binary).
