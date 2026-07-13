# agent-tools

Small CLIs that make coding-agent workflows cheaper and calmer. Each tool is
self-contained (own `package.json`, own tests); this repo is the suite.

| Tool | Command | One-liner |
|---|---|---|
| [ght](ght/) | `ght` | Same `gh` commands, a third of the tokens — GitHub's JSON noise pruned, TOON out (**62% benchmarked**, [proof](ght/BENCHMARK.md)) |
| [wt](wt/) | `wt` | Parallel work minus the ceremony — guarded one-command worktrees that know what's active, and why |
| [tt](tt/) | `tt` | Runs your tests without flooding agent context — a ~40-token verdict by default, every detail on demand from one cached run |
| [tj](tj/) | `tj` | Any JSON-speaking CLI in TOON — profiles strip what agents never read (kubectl, aws, gh, …) |
| [fleet](fleet/) | `fleet` | Your whole workspace at a glance — every repo's worktrees, PRs, and live agents in one table |
| [tok](tok/) | `tok` | Know the token cost before you paste — real tokenizer counts, a CI-ready budget gate, and verified-lossless JSON→TOON packing |

## Examples & benchmarks

Numbers below are live measurements counted with `tok` (o200k_base) on
2026-07-13, except ght's, which come from its committed formal benchmark.
The stderr footers the tools print are quick `~` estimates; these are real
tokenizer counts.

### ght

```
$ ght pr list -R cli/cli --limit 2 --json number,title,author,state
[2]{author,number,state,title}:
  arran4,13850,OPEN,"Added txtar to an output format of `readdir --output`…"
  Sovereign-maxeffort,13844,OPEN,perf(status): replace O(n) ShouldExclude…
```

**Benchmark:** 273,627 → 103,514 tokens across 8 real workloads
(`pr list`, `issue list`, `api .../pulls`, releases, commits, …) —
**62.2% saved**, o200k and cl100k tokenizers agreeing.
Methodology + per-scenario table: [ght/BENCHMARK.md](ght/BENCHMARK.md).

### wt

```
$ cd "$(wt new -m "spike: faster auth")"     # create-or-reuse; stdout is the path
$ wt
  BRANCH        WORK                                 ACTIVITY        PR
● main (main)   editing public, src (12 files ...)   dirty:12 agent
● wt-1          spike: faster auth                   dirty:2
$ wt new --pr 1234                           # review a PR in its own worktree
$ wt clean --yes                             # sweep everything idle
```

**Benchmark:** one command replaces the `worktree add`/`remove`/`prune` +
branch bookkeeping, with guardrails (never main, never dirty work). Piped
list is TOON: 122 vs 144 JSON tokens even on a tiny 2-worktree repo — the
gap grows with rows; the real win is the activity intelligence.

### tt

Fronts your real test runner and manages what reaches agent context:
verdict by default, any depth of detail on demand — all from one cached
run, never a re-execution.

```
$ tt              # runs npm test / pytest / cargo test / go test
summary:
  command: npm test --silent
  exit: 1
  failed: 1
  passed: 37
failures[1]{n,head,detail}:
  1,✖ rejects empty input (2.1ms),AssertionError … | at test/parse.test.js:14
```

**Benchmark:** the verdict for a 38-test run costs **39 tokens** (raw
output: 653 — **94% less**), and a failure can never be lost to output
truncation — the verdict is small by construction. The cache makes second
looks free: `tt --tt-last` re-reads, `tt --tt-fail=2` fetches one failure's
full stack, `tt --tt-full` replays the complete log — no re-runs. vitest
and jest verdicts are exact (native JSON report); other runners use tuned
heuristics.

### tj

```
$ tj gh api repos/cli/cli            # github profile auto-detected
$ tj kubectl get pods -o json        # kubernetes: managedFields & co. dropped
$ tj aws ec2 describe-instances      # aws: ResponseMetadata dropped
```

**Benchmark:** `gh api repos/cli/cli`: 1,630 → **385 tokens** (**76%
saved**). Unknown CLIs get TOON-only (`generic`); profiles are a few lines
in `src/profiles.js`.

### fleet

```
$ fleet
  REPO      WORK                                      WTS   PR  AG  PATH
● api       editing handlers, db (6 files +180/-40)   2●/2  #82 1   ~/code/api
● web       spike: new checkout flow                  1●/1      1   ~/code/web
○ cli-tool  at: bump deps                             1●/2          ~/code/cli-tool
$ fleet --all     # flattened per-worktree rows across every repo
```

**Benchmark:** one command replaces per-repo `cd` + `git status` +
`git worktree list` + `gh pr list` across your whole workspace; repos
gather concurrently. TOON piped: 101 vs 128 JSON tokens for two repos.

### tok

```
$ tok CLAUDE.md AGENTS.md            # real tokenizer counts + total
$ tok --max=5k CLAUDE.md             # exit 1 when over — CI/pre-commit gate
$ tok -- git diff                    # price a diff before pasting it
$ gh run list --json … | tok --pack  # lossless JSON→TOON, round-trip verified
```

**Benchmark:** tok is the measuring instrument (every number in this
section was counted with it). Its `--pack` mode reports itself honestly:
30% saved on a uniform 20-run list, −6% on a deep repo object — lossless
packing only wins on record-shaped data, and the footer says which case
you're in.

## House style

All six follow the same contract, so agents (and humans) can predict them:

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

## Security

No shell execution anywhere (argument arrays only), parsed data never
executed, and the file-copy / git-arg surfaces are containment-checked and
input-validated. Trust model, hardening, and residual assumptions:
[SECURITY.md](SECURITY.md).

## Agent skill

[skills/using-agent-tools](skills/using-agent-tools/SKILL.md) teaches Claude
Code agents to reach for the suite instead of raw `gh` / test runners /
`git worktree` / JSON CLIs (verified: baseline agents use raw commands,
skill-loaded agents switch). Install for all sessions:

```sh
ln -sfn "$(pwd)/skills/using-agent-tools" ~/.claude/skills/using-agent-tools
```
