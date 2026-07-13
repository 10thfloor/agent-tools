# Spec: tt — test-output condenser for coding agents

## Objective

Test output is the most re-read text in any agent loop, and almost all of it
is passing noise. `tt` wraps the project's test command: on a TTY it streams
output through unchanged (humans keep their runner UX); when piped (the
agent case) it emits only what matters — a summary line and one structured
row per failure — as TOON. Full output is always cached, so `tt --tt-full`
retrieves it and `tt --tt-last` re-condenses without re-running.

### Assumptions (autonomous session)

1. Failure extraction is heuristic over text (markers like `✖`, `FAIL`,
   `●`, pytest underscores) with per-runner summary-count parsers for
   node:test, vitest/jest, and pytest. Structured reporters per runner can
   come later; heuristics cover the 95% case runner-agnostically.
2. stdout and stderr are interleaved by arrival order (runners write
   everything to one stream in practice).
3. Cache lives in `~/.cache/tt/<cwd-hash>.*` (override: `TT_CACHE_DIR`).

## CLI Contract

- `tt` — runs the detected test command (package.json `scripts.test` →
  `npm test --silent`; pytest.ini/pyproject → `pytest`; Cargo.toml →
  `cargo test`; go.mod → `go test ./...`; else a friendly error).
- `tt <any command...>` — condense that command instead.
- Child's exit code is always propagated. TTY = passthrough + cache;
  piped = condensed TOON (`--tt-json` for JSON, `--tt-raw` to disable).
- `--tt-last` re-condenses the cached run; `--tt-full` prints it raw.
- `--tt-max=<n>` caps failure rows (default 40; a note reports overflow).
- stderr footer reports the token reduction (chars/4 estimate, like ght).

## Structure & Testing

```
tt/src/condense.js   → ANSI stripping, failure-block extraction, summaries
tt/src/runner.js     → default-command detection, child spawn with tee
tt/src/cli.js        → flags, cache, dispatch
tt/test/             → unit (fixture outputs per runner) + e2e (real
                       node --test project in a temp dir)
```

## Boundaries

Always: propagate exit codes; never condense on a TTY; cap block sizes.
Never: mutate the project under test; require a specific runner.

## Success Criteria

`npm test` passes; a real failing `node --test` project piped through `tt`
yields TOON with correct counts and the failing test name, at a large token
reduction; `--tt-last`/`--tt-full` work from cache.
