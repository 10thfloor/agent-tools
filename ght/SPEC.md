# Spec: ght — token-efficient `gh` wrapper for coding agents

## Objective

Coding agents call the GitHub CLI (`gh`) constantly, and the JSON it prints is
token-expensive: pretty-printed bodies from `gh api`, dozens of hypermedia
`*_url` fields per object, repeated keys in every array element. `ght` is a
drop-in wrapper: it runs `gh` with the exact arguments given, and when the
output is JSON it re-emits it as [TOON](https://github.com/toon-format/toon)
(Token-Oriented Object Notation) after pruning API noise fields. Everything
else (exit codes, stderr, non-JSON output, binary output) passes through
untouched.

Success = a benchmark over representative real `gh` calls showing a large
(target: >50% aggregate) token reduction versus what an agent sees today,
measured with real tokenizers, with no loss of the data agents actually use.

### Assumptions (autonomous session — flagging instead of asking)

1. Wrapper is a Node.js CLI (`ght`) in the agent-tools suite (the `ght/`
   package); not published to npm as part of this task.
2. The official `@toon-format/toon` encoder is used rather than a hand-rolled
   one (spec compliance > zero-dependency purity).
3. Default behavior may prune GitHub hypermedia noise (`node_id`,
   `gravatar_id`, `_links`, `*_url` except `url`/`html_url`, PGP verification
   blobs) and collapse embedded entities (users → login, repos → full_name,
   labels → joined names) because agents essentially never use those fields
   and collapsing keeps TOON rows tabular; `--ght-no-prune` restores full
   data. (Benchmarking showed TOON alone *loses* to gh's already-minified
   JSON on non-uniform GitHub payloads; compaction is what makes TOON win.)
4. Token counts are measured with `gpt-tokenizer` (o200k_base primary,
   cl100k_base secondary). Claude's tokenizer is not public; these are the
   standard proxies and the reduction is structural, not tokenizer-specific.
5. Benchmark uses live read-only queries against public repos (`cli/cli`)
   via the user's authenticated `gh`, and saves the payloads as fixtures so
   the benchmark is reproducible offline.

## Tech Stack

Node >= 18, ESM. Dependencies: `@toon-format/toon` ^2.3.0 (runtime),
`gpt-tokenizer` ^3.4.0 (bench only). Tests: `node:test` (no framework).

## Commands

```
Install: npm install            (in ght/)
Test:    npm test               (node --test test/)
Bench:   npm run bench          (live capture + report; writes BENCHMARK.md)
         npm run bench:offline  (recompute from saved fixtures)
Run:     ./bin/ght.js <any gh args>
```

## Project Structure

```
ght/
  bin/ght.js        → executable entry point
  src/flags.js      → --ght-* flag parsing, env overrides, usage text
  src/jsonish.js    → tolerant JSON parsing (single value, concatenated
                      values from `gh api --paginate`, NDJSON)
  src/prune.js      → GitHub API noise-field pruning
  src/convert.js    → parse → prune → TOON/JSON encode
  src/cli.js        → spawn gh, passthrough rules, exit codes
  test/             → unit + integration tests (fake gh via GHT_GH_PATH)
  bench/run.mjs     → benchmark harness
  bench/fixtures/   → captured real gh outputs (reproducibility)
  BENCHMARK.md      → generated results
```

## CLI Contract

- `ght <args...>` runs `gh <args...>`. stdin and stderr are inherited; the
  exit code is `gh`'s exit code.
- stdout is converted to TOON only when the *entire* stdout parses as JSON
  (one value, several concatenated values, or NDJSON) **and** `gh` exited 0.
  Otherwise stdout passes through byte-for-byte.
- Multiple top-level arrays (paginated pages) are merged into one array.
- Flags consumed by ght (never forwarded): `--ght-raw` (pure passthrough),
  `--ght-no-prune`, `--ght-json` (prune + minified JSON instead of TOON),
  `--ght-delimiter=comma|tab|pipe` (comma default — benchmarked cheaper than
  tab on real payloads), `--ght-no-stats`, `--ght-help`.
- After each conversion a one-line tokens-saved footer is written to stderr
  (chars/4 estimate, marked `~`; stdout stays clean TOON). Off via
  `--ght-no-stats` / `GHT_STATS=0`; never printed on passthrough.
- Env: `GHT_RAW=1`, `GHT_PRUNE=0`, `GHT_STATS=0`, `GHT_DELIMITER`,
  `GHT_GH_PATH`.

## Code Style

Small pure modules, no classes, no abstractions beyond one function per
concern. Example:

```js
export function mergeValues(values) {
  if (values.length === 1) return values[0]
  return values.every(Array.isArray) ? values.flat() : values
}
```

## Testing Strategy

- Unit: jsonish parsing edge cases, prune rules, convert round-trip
  (TOON `decode(encode(x))` deep-equals `x` when pruning is off).
- Integration: run `bin/ght.js` against a fake `gh` (`GHT_GH_PATH`) covering
  conversion, passthrough of non-JSON, exit-code propagation, `--ght-raw`.
- Bench doubles as an end-to-end test against the real `gh`.

## Boundaries

- Always: preserve exit codes and stderr; never transform non-JSON or error
  output; keep fixtures read-only public data.
- Ask first: publishing to npm, adding more dependencies, committing.
- Never: mutate anything on GitHub (benchmark is read-only), touch other
  directories in this repo, store tokens/secrets anywhere.

## Success Criteria

1. `npm test` passes.
2. `ght` on real `gh` commands emits valid TOON and preserves exit codes.
3. TOON output round-trips losslessly (no-prune mode) via `decode()`.
4. BENCHMARK.md shows aggregate token reduction, per-scenario breakdown,
   with >=50% aggregate savings vs. raw `gh` output in default mode across
   both tokenizers.

## Open Questions

None blocking; assumptions above stand in for user answers.
