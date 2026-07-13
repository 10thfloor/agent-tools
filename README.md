# agent-tools

Small CLIs that make coding-agent workflows cheaper and calmer. Each tool is
self-contained (own `package.json`, own tests); this repo is the suite.

| Tool | Command | What it does |
|---|---|---|
| [gh-toon](gh-toon/) | `ght` | `gh` wrapper that re-emits JSON as TOON after pruning GitHub API noise — benchmarked **62% token reduction** ([benchmark](gh-toon/BENCHMARK.md)) |
| [wt](wt/) | `wt` | friendly git worktrees, per project: one-command create/remove, activity-aware list (dirty / PR / agent-detected), notes + generated work summaries |
| [tt](tt/) | `tt` | test-output condenser: failures only when piped, full stream on a TTY, cached (`--tt-last`, `--tt-full`) |
| [tj](tj/) | `tj` | TOON-ify **any** JSON-speaking CLI with per-CLI prune profiles (gh, kubectl/oc, aws, generic) |
| [fleet](fleet/) | `fleet` | cross-project overview: every repo's worktrees, PRs, work summaries, and live agents in one table (powered by `wt` per repo) |
| [tok](tok/) | `tok` | token counter + budget linter for agent-facing text — real tokenizer counts for files, command output, stdin; `--max` gates exit codes |

## House style

All four follow the same contract, so agents (and humans) can predict them:

1. **TTY → human, pipe → TOON.** Tables and streams for people; compact
   [TOON](https://github.com/toon-format/toon) for agents, automatically.
2. **stdout is data-only.** Paths, listings, converted output. All friendly
   messages, footers, and hints go to stderr — `cd "$(wt new x)"` works.
3. **One idempotent command per intent.** Re-running is always safe.
4. **Exit codes and stderr pass through** from wrapped commands, always.
5. **Degrade silently.** No `gh`? No `lsof`? Columns go empty; nothing breaks.
6. **Deterministic over LLM.** Summaries and stats are generated from real
   state (git, diffstat, token estimates), never from a model call.
7. **Tested against the real thing.** E2E suites run real `git`, real temp
   projects, real fake binaries on PATH.

## Install

```sh
cd <tool> && npm install && npm link
```

Node >= 22. Each tool's README has flags, env vars, and agent-integration
snippets for `CLAUDE.md`/`AGENTS.md`.
