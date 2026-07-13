# tt — run tests, get an agent-readable verdict

`tt` runs your test suite and returns what an agent needs to decide its
next move: the **exit code** (unchanged), a **summary**, and **one
structured row per failure** — test name, file:line, assertion. The
evaluating stays with the agent; `tt` makes it cost ~40 tokens instead of a
full runner dump.

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

## Interrogate without re-running

Every run is cached, so a different view of the results never costs
another suite execution:

- `tt --tt-last` — the verdict again, no re-run
- `tt --tt-full` — the complete raw log of the cached run
- `tt <command...>` — wrap something other than the detected runner
- `--tt-max=<n>` failure-row cap (default 40), `--tt-json`, `--tt-raw`

Exit codes always propagate, so `tt && deploy` gates correctly.

## Notes

- In a human terminal (TTY), `tt` streams output through untouched and just
  caches — a safety behavior so it's harmless interactively, not a feature.
  **tt is for agents' test loops.**
- Failure extraction is heuristic (markers for node:test, vitest, jest,
  pytest, go, cargo, TAP) plus per-runner total parsing; unknown runners
  fall back to counting failure blocks. Env: `TT_CACHE_DIR`.

## Agent snippet (CLAUDE.md / AGENTS.md)

```markdown
## Tests
Run tests with `tt`. It executes the project's test command and returns an
agent-readable verdict: summary counts, one row per failure (file:line +
assertion), and the child's exit code. `tt --tt-last` re-reads the previous
verdict without re-running; use `tt --tt-full` only when the condensed
detail is insufficient.
```
