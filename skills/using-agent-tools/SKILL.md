---
name: using-agent-tools
description: Use when about to run gh, a test suite (npm test / pytest / cargo test / go test), git worktree commands, kubectl/aws or any other JSON-emitting CLI, when starting parallel or experimental work in a repo, when asked what's in progress across repos/worktrees/agents, before pasting a large file or diff into context, or when asked to measure/prove token savings. Local suite - ght, tt, wtree, tj, fleet, tok, bench.
---

# Using agent-tools

Local CLIs (on PATH) that cut token cost and hide git/CLI complexity.
One shared contract: **piped output is TOON** (`key: value` lines; arrays as
a `name[N]{fields}:` header plus one comma-separated row per item);
**stdout is data only**: footers and hints go to stderr, never parse them;
**exit codes pass through**, so `&&` chains behave.

## Swap table

| Instead of | Run | Why |
|---|---|---|
| `gh <anything>` | `ght <same args>` | ~62% fewer tokens: GitHub noise pruned, users→login, repos→full_name, labels→names |
| `npm test` / `pytest` / `cargo test` / `go test` | `tt` | summary + one row per failure; `tt <cmd...>` wraps any command |
| `git worktree ...` | `wtree new -m "intent"` / `wtree rm <branch>` / `wtree` | one command each; stdout is the path: `cd "$(wtree new x)"` |
| `kubectl -o json` / `aws` / any JSON CLI | `tj <cmd...>` | prune profile auto-detected from the command name |
| scanning repos for status | `fleet` | every repo: worktrees, PRs, work summaries, live agents |
| pasting big files/diffs | `tok <file>` or `tok -- git diff` first | real tokenizer counts; `--max=5k` exits 1 when over |
| proving the savings on this repo | `bench init` then `bench` | A/B baseline vs wrapped command in bench.json; `--min-saved=N` gates CI |

## Escape hatches (when full fidelity matters)

- Byte-exact raw output: `--ght-raw` / `--tj-raw` / `tt --tt-raw`
- Full JSON shapes, still TOON: `--ght-no-prune` / `--tj-no-prune`
- JSON for programmatic parsing: `--ght-json` / `--tj-json` /
  `wtree list --json` / `tok --json`. Never feed TOON to jq
- Full test log after a condensed run: `tt --tt-full` (cached);
  `tt --tt-last` re-reads the previous run without re-running

## Worktree habits

Don't work directly on main: `cd "$(wtree new -m "<one-line intent>")"`
(branch name optional: wtree generates wtree-1, wtree-2, …). Record progress with
`wtree note "<update>"`. `wtree clean --yes` removes only idle worktrees;
`wtree rm` refuses dirty work without `--force`.

## Common mistakes

- Parsing the stderr footer (`ght: ~70 tokens ...`) as data: stdout only.
- Reaching for `tt --tt-full` by default. Condensed rows carry file:line
  and the assertion; fetch the full log only when that's insufficient.
- Treating pruned fields (`node_id`, `*_url`) as missing data. Pruning is
  intentional; add `--ght-no-prune` instead of falling back to raw `gh`.
- Running `gh` directly because a flag looks ght-specific: ght forwards
  every argument except `--ght-*`.

Per-tool details: each tool's `README.md`.
