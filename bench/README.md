# bench: token A/B benchmarks on your own workloads

The suite's README numbers are *our* benchmarks on *our* data. `bench` lets
you prove the savings on **your** repos and commands: define scenarios that
pair a **baseline** command with a **candidate** (usually its wrapped form),
run both, count real tokenizer tokens on each stdout, and see per-scenario +
aggregate savings. A `--min-saved` gate turns it into a CI check.

```
$ bench init                 # writes bench.json (edit OWNER/REPO)
$ bench
  SCENARIO                        BASELINE  CANDIDATE  SAVED
● gh vs ght: pr list (20)            1,195        618  48.3%
● gh vs ght: repo object             1,630        385  76.4%
● gh vs tj: commits                 25,500      8,821  65.4%
  ─────────────────────────────────────────────────────────
  TOTAL                             28,325      9,824  65.3%
bench: 65.3% saved across 3 scenario(s) (o200k_base)
```

## bench.json

Each scenario pairs two commands as **argv arrays** (no shell strings: the
suite spawns without a shell, and bench keeps that contract):

```json
{
  "scenarios": [
    {
      "name": "gh vs ght: pr list",
      "baseline":  ["gh",  "pr", "list", "-R", "you/repo", "--json", "number,title"],
      "candidate": ["ght", "pr", "list", "-R", "you/repo", "--json", "number,title"]
    },
    {
      "name": "raw test run vs tt verdict",
      "baseline":  ["npm", "test", "--silent"],
      "candidate": ["tt"],
      "ignoreExit": true
    }
  ]
}
```

`ignoreExit: true` measures a scenario even when a command exits non-zero
(e.g. a red test suite where the output *size* is still the comparison).
Otherwise a non-zero exit fails that scenario (reported, excluded from the
total, overall exit 1).

## Flags

| Flag | Effect |
|---|---|
| `--min-saved=<pct>` | exit 1 if total savings fall below this (the CI gate) |
| `--enc=o200k\|cl100k` | tokenizer (default o200k_base) |
| `--json` / `--toon` / `--table` | output format (table on TTY, TOON piped) |
| `--md=<path>` | also write a Markdown report |

Counts use `gpt-tokenizer`, the same proxy `ght`/`tok` use; Claude's
tokenizer is not public, so these are structural comparisons, not
Claude-exact. Benchmarks run live commands twice (baseline then candidate);
for wall-clock timing rigor use hyperfine (bench is about *tokens*).

## CI gate example

```yaml
- run: bench --min-saved=40   # fail the build if the wrappers stop paying off
```

## Note

`bench` runs exactly the commands in your `bench.json`. It's a pass-through
executor, like `tj`/`tok`/`tt`. It runs what you list; see the suite's
[SECURITY.md](../SECURITY.md).
