# Spec: bench — token A/B benchmarks on your own workloads

## Objective

The suite's README numbers are our benchmarks on our data. `bench` lets any
user prove (or disprove) the savings on *their* repos and commands: define
scenarios pairing a **baseline** command with a **candidate** (usually the
wrapped version), run both back-to-back, count real tokenizer tokens on each
stdout, and report per-scenario + aggregate savings. A `--min-saved` gate
turns it into a CI check — "the wrappers keep earning their keep."

### Assumptions (session decisions, flagged)

1. Token benchmarking, not wall-clock (durations shown as a courtesy
   column; use hyperfine for timing rigor).
2. Scenario commands are **argv arrays** in `bench.json` — never shell
   strings — preserving the suite's no-shell posture (SECURITY.md).
3. Live commands may be nondeterministic between the two runs; documented,
   accepted (runs are back-to-back; direction of drift is unbiased).
4. gpt-tokenizer o200k_base default, `--enc=cl100k` alternative — same
   proxies as tok/ght's benchmark; Claude's tokenizer is not public.

## CLI Contract

- `bench init [--force]` — writes a `bench.json` template (suite-flavored
  examples with OWNER/REPO placeholders); refuses to overwrite without
  `--force`.
- `bench [run] [file]` — default file `./bench.json`. Each scenario:
  `{ name, baseline: [argv...], candidate: [argv...], ignoreExit? }`.
  A non-zero exit fails the scenario (excluded from aggregate, reported,
  overall exit 1) unless `ignoreExit: true` (e.g. a red test suite where
  output size is still the comparison).
- Output: table on TTY, TOON when piped, `--json`; `--md=<path>` also
  writes a Markdown report. stderr carries the one-line aggregate footer.
- `--min-saved=<pct>` — exit 1 if aggregate savings fall below the
  threshold (CI gate). `--enc=o200k|cl100k`.
- Exit: 0 ok, 1 scenario failure or gate miss, 2 usage/config error.

## Structure & Testing

```
bench/src/config.js  → load/validate/template (argv arrays enforced)
bench/src/run.js     → spawn via prepSpawn, token counts, savings math
bench/src/report.js  → table / TOON / JSON / Markdown renderers
bench/src/cli.js     → flags + dispatch;  src/spawn.js → shared helper copy
bench/test/          → unit (validation, math) + e2e over .mjs fake commands
```

## Boundaries

Always: no shell; stdout data-only; exit codes honest. Never: execute
anything not listed in the user's own bench.json (pass-through executor —
SECURITY.md applies).

## Success Criteria

`npm test` green on the 3-OS matrix; live demo shows real gh-vs-ght savings
on a public repo; `--min-saved` gates exit codes; `bench init` template runs
after only OWNER/REPO substitution.
