# Spec: tt (agent-facing test running with progressive disclosure)

## Objective

Test output is the most re-read text in any agent loop, and almost all of
it is passing noise. `tt` fronts the project's real test runner and manages
what reaches agent context. Default tier is the verdict: exit code
(unchanged), summary counts, one structured row per failure (name,
file:line, assertion) as TOON. Deeper tiers stay accessible on demand
without re-running, from the cache of the run that already happened:
`--tt-fail=<n>` for one failure's complete block, `--tt-full` for the whole
raw log, `--tt-last` to replay the verdict. tt never evaluates anything
itself. The agent judges; tt keeps judging cheap and truncation-proof. On
a TTY it streams through unchanged (a safety behavior for humans, not the
use case).

### Assumptions (autonomous session)

1. Failure extraction is heuristic over text (markers like `✖`, `FAIL`,
   `●`, pytest underscores) with per-runner summary-count parsers for
   node:test, vitest/jest, and pytest. Structured reporters per runner can
   come later; heuristics cover the 95% case runner-agnostically.
2. stdout and stderr are interleaved by arrival order (runners write
   everything to one stream in practice).
3. Cache lives in `~/.cache/tt/<cwd-hash>.*` (override: `TT_CACHE_DIR`).

## CLI Contract

- `tt`: runs the detected test command (package.json `scripts.test` →
  `npm test --silent`; pytest.ini/pyproject → `pytest`; Cargo.toml →
  `cargo test`; go.mod → `go test ./...`; else a friendly error).
- `tt <any command...>`: condense that command instead.
- Child's exit code is always propagated. TTY = passthrough + cache;
  piped = condensed TOON (`--tt-json` for JSON, `--tt-raw` to disable).
- `--tt-last` replays the stored verdict; `--tt-fail=<n>` prints one
  failure's complete uncapped block from the cache; `--tt-full` prints the
  whole cached log.
- When the default `npm test` script matches vitest/jest, tt appends their
  native JSON-report flags (side file; human log preserved) and builds an
  exact verdict, falling back to heuristics on any parse failure. Explicit
  user commands are never rewritten.
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
