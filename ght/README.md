# ght

A drop-in wrapper around the GitHub CLI for **coding agents**. It runs `gh`
with your exact arguments and re-emits JSON output as
[TOON](https://github.com/toon-format/toon) (Token-Oriented Object Notation)
after compacting GitHub API noise.

**Result: 62.2% fewer tokens** across representative agent workloads
(273,627 → 103,514 o200k tokens; both tokenizers tested agree). Full
per-scenario numbers and methodology: [BENCHMARK.md](BENCHMARK.md).

```
$ ght pr list -R cli/cli --limit 2 --json number,title,author,state
[2]{author,number,state,title}:
  arran4,13850,OPEN,"Added txtar to an output format of `readdir --output` intent: acts a bit like `more` but also usable in tests"
  Sovereign-maxeffort,13844,OPEN,"perf(status): replace O(n) ShouldExclude with O(1) map lookup (75x faster)"
```

Same data via plain `gh` costs 1.8× the tokens even at 2 rows (147 vs 82
o200k tokens) — the gap widens with row count as TOON amortizes the header
(2.8× at 30 rows).

## Install

```sh
cd ght
npm install
npm link        # puts `ght` on PATH; or call bin/ght.js directly
```

Or alias it in your shell rc (survives node version-manager switches,
interactive shells only):

```sh
alias ght='"/absolute/path/to/ght/bin/ght.js"'
```

Requires Node >= 18 and an installed, authenticated `gh`.

## Usage

Use `ght` exactly like `gh` — every argument is forwarded:

```sh
ght pr view 123 --json title,body,comments
ght api repos/cli/cli/issues?per_page=50
ght run list --json databaseId,status,conclusion
```

Behavior:

- stdout that parses as JSON (including `gh api --paginate` concatenated
  pages and NDJSON) is converted to TOON; paginated arrays are merged.
- Everything else passes through byte-for-byte: non-JSON output, error
  output, binary output, stderr, and the exit code.
- Interactive prompts still work (stdin/stderr are inherited).
- After each conversion, a one-line footer goes to **stderr** (stdout stays
  clean TOON): `ght: ~70 tokens (raw gh: ~150, 53% saved)`. Counts are a
  fast chars/4 estimate (hence the `~`) — loading a real tokenizer would slow
  every call; [BENCHMARK.md](BENCHMARK.md) has exact measured numbers.
  Disable with `--ght-no-stats` or `GHT_STATS=0`.

### Flags (consumed by ght, never forwarded to gh)

| Flag | Effect |
|---|---|
| `--ght-raw` | pure passthrough, no capture or conversion |
| `--ght-no-prune` | full fidelity: no field pruning or entity collapsing |
| `--ght-json` | compacted data as minified JSON instead of TOON |
| `--ght-delimiter=comma\|tab\|pipe` | TOON delimiter (comma default, benchmarked cheapest) |
| `--ght-no-stats` | suppress the tokens-saved footer |
| `--ght-help` | usage |

Env equivalents: `GHT_RAW=1`, `GHT_PRUNE=0`, `GHT_STATS=0`, `GHT_DELIMITER`,
`GHT_GH_PATH` (alternate gh binary, used by tests).

## What the default compaction does

GitHub payloads are full of structure agents pay for but never read. By
default (all opt-out via `--ght-no-prune`):

- drops `node_id`, `gravatar_id`, `_links`, `performed_via_github_app`, and
  every `*_url` field **except** `url` and `html_url`
- collapses embedded entities — never the root value: user/org objects →
  their `login`, repo objects → their `full_name`, label objects → their
  `name`
- joins arrays of collapsed entities into one comma-separated string
  (`labels: bug, help wanted`) so TOON keeps rows tabular
- trims commit `verification` to `{verified, reason}` (drops PGP blobs)

TOON encoding itself is lossless — `decode()` returns the original JSON.
The benchmark verifies this round-trip on real payloads.

## Pointing your agent at it

Add to your `CLAUDE.md` / `AGENTS.md`:

```markdown
## GitHub CLI
Use `ght` instead of `gh` (same arguments). JSON responses arrive as TOON:
`key: value` lines, 2-space indentation, arrays as `name[N]{fields}:` headers
followed by one comma-separated row per item. Embedded users/repos/labels are
collapsed to their login/full_name/name. Pass `--ght-no-prune` if you need
the full untrimmed JSON shapes, or `--ght-raw` for gh's original output.
```

## Benchmark

`npm run bench` captures live output from read-only queries against the
public `cli/cli` repo, saves fixtures under `bench/fixtures/`, counts tokens
with o200k_base and cl100k_base, and writes [BENCHMARK.md](BENCHMARK.md).
`npm run bench:offline` reproduces the report from saved fixtures.

Headline (o200k_base, live capture 2026-07-11):

| Scenario | raw `gh` | `ght` | saved |
|---|--:|--:|--:|
| `gh pr list --json` (30 PRs) | 4,530 | 1,626 | 64.1% |
| `gh issue list --json` (30 issues) | 4,680 | 1,800 | 61.5% |
| `gh run list --json` (20 runs) | 1,393 | 959 | 31.2% |
| `gh api repos/{repo}` | 1,630 | 384 | 76.4% |
| `gh api .../issues?per_page=30` | 40,267 | 27,518 | 31.7% |
| `gh api .../pulls?per_page=10` | 53,187 | 11,460 | 78.5% |
| `gh api .../commits?per_page=20` | 33,595 | 11,963 | 64.4% |
| `gh api .../releases?per_page=10` | 134,345 | 47,804 | 64.4% |
| **Total** | **273,627** | **103,514** | **62.2%** |

An honest note the benchmark makes explicit: `gh`'s piped output is already
minified, and TOON *alone* slightly loses to minified JSON on GitHub's
non-uniform payloads. The savings come from compaction making the data
tabular-friendly and TOON then encoding it without repeated keys — the two
steps are measured separately in the report.

## Known upstream issue

`@toon-format/toon` 2.3.0's **decoder** mis-parses quoted strings containing
markdown-link patterns (`[x](y)`); `ght` only encodes, and its quoting is
correct, so output is unaffected — but round-trip verification in the
benchmark skips payloads that hit the bug (4/8 scenarios verified).

## Development

```sh
npm test   # 35 tests: parsing edge cases, prune rules, TOON round-trip,
           # CLI integration against a fake gh (GHT_GH_PATH)
```
