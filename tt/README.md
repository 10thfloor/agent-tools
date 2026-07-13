# tt — run tests without flooding agent context

`tt` fronts your real test runner and manages what reaches the agent's
context. By default, only the **verdict** enters: counts, one structured
row per failure (test name, file:line, assertion), and the child's exit
code — ~40 tokens instead of a full runner dump. Everything else stays out
of context but never out of reach: **progressive disclosure**, three tiers
from one execution, all served from cache without re-running:

1. verdict (default) → 2. one failure's complete block (`--tt-fail=N`) →
3. the entire raw log (`--tt-full`)

The evaluating stays with the agent; `tt` decides nothing.

## The loop

Edit code → `tt` → read the verdict → fix → repeat:

```
$ tt              # auto-detects npm test / pytest / cargo test / go test
summary:
  command: npm test --silent
  exit: 1
  failed: 1
  passed: 37
  runner: "node:test"
failures[1]{n,head,detail}:
  1,✖ rejects empty input (2.1ms),AssertionError … expected [] to have length 1 | at test/parse.test.js:14
```

A passing 38-test run costs ~39 tokens (raw output: 653 — 94% less). A
failing run **always fits in context**: the output is small by
construction, so harness truncation can never eat the assertion or the
stack frame you need.

## Progressive disclosure, from one cached run

A different view of the results never costs another suite execution:

- `tt --tt-last` — the verdict again, no re-run
- `tt --tt-fail=2` — failure #2's **complete** block (full stack, uncapped)
- `tt --tt-full` — the complete raw log of the cached run
- `tt <command...>` — wrap something other than the detected runner
- `--tt-max=<n>` failure-row cap (default 40), `--tt-json`, `--tt-raw`

Exit codes always propagate, so `tt && deploy` gates correctly.

## Notes

- In a human terminal (TTY), `tt` streams output through untouched and just
  caches — a safety behavior so it's harmless interactively, not a feature.
  **tt is for agents' test loops.**
- When the default `npm test` script runs **vitest or jest**, tt asks the
  runner for its native JSON report and the verdict is exact (runner shows
  as `vitest (json report)`); explicit `tt <command...>` invocations are
  never rewritten. Everything else uses tuned heuristics (markers for
  node:test, vitest, jest, pytest, go, cargo, TAP) with block-counting as
  the last resort. Env: `TT_CACHE_DIR`.

## Agent snippet (CLAUDE.md / AGENTS.md)

```markdown
## Tests
Run tests with `tt`. It executes the project's test command and returns an
agent-readable verdict: summary counts, one row per failure (file:line +
assertion), and the child's exit code. `tt --tt-last` re-reads the previous
verdict without re-running; `tt --tt-fail=<n>` fetches one failure's full
stack from the cache; use `tt --tt-full` only when even that is
insufficient.
```
