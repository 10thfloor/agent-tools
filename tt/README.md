# tt — test-output condenser for coding agents

Test output is the most re-read text in any agent loop, and almost all of it
is passing noise. `tt` runs your test command: on a terminal the output
streams through untouched; when piped (the agent case) it becomes a TOON
summary plus one row per failure.

```
$ tt            # detects npm test / pytest / cargo test / go test
summary:
  command: npm test --silent
  exit: 1
  failed: 1
  passed: 37
  runner: "node:test"
failures[1]{n,head,detail}:
  1,✖ rejects empty input (2.1ms),AssertionError ... expected [] to have length 1 | at test/parse.test.js:14
tt: ~68 tokens (full run: ~4,213, 98% smaller) — tt --tt-full for everything
```

Every run is cached, so nothing is lost by condensing:

- `tt --tt-last` — re-condense the previous run without re-running
- `tt --tt-full` — print the previous run's complete output
- `tt <any command...>` — condense something other than the default runner
- `--tt-raw` (no condensing), `--tt-json`, `--tt-max=<n>` (row cap, 40)

The child's exit code always propagates, so `tt && deploy` semantics hold.
Failure extraction is heuristic (markers for node:test, vitest, jest,
pytest, go, cargo, TAP) with per-runner total parsing — unknown runners fall
back to counting failure blocks. Env: `TT_CACHE_DIR`.

## Agent snippet (CLAUDE.md / AGENTS.md)

```markdown
## Tests
Run tests with `tt` (wraps the project's test command). Piped output is a
TOON summary with one row per failure; use `tt --tt-full` only when the
condensed detail is insufficient, and `tt --tt-last` to re-read the previous
run without re-running.
```
