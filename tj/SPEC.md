# Spec: tj (TOON-ify any JSON-speaking CLI for coding agents)

## Objective

`ght` proved the pattern for `gh`; `tj` generalizes it: `tj <command...>`
runs any CLI, and when stdout is JSON it re-emits it as comma-delimited TOON
after applying a per-CLI **prune profile** (auto-detected from the command's
basename). Everything else (exit codes, stderr, non-JSON, binary) passes
through untouched. Same stats footer, same flag conventions as ght/tt.

### Assumptions (autonomous session)

1. Profiles ship for the noisiest agent-facing CLIs: `github` (gh, full
   parity with ght's prune + entity collapsing), `kubernetes` (kubectl/oc,
   drops `managedFields`, `selfLink`, the last-applied-configuration
   annotation), `aws` (drops `ResponseMetadata`), and `generic` (TOON only,
   no pruning). Detection by command basename; `--tj-profile=` overrides.
2. ght remains the daily driver for gh (it has the richer treatment);
   tj's github profile matches its rules so either works.

## CLI Contract

- `tj <command> [args...]`: flags starting `--tj-` are consumed anywhere,
  never forwarded: `--tj-raw`, `--tj-no-prune` (TOON but full shapes),
  `--tj-json` (pruned minified JSON), `--tj-profile=<name>`,
  `--tj-delimiter=comma|tab|pipe`, `--tj-no-stats`, `--tj-help`.
- Conversion only when the whole stdout parses as JSON (single value,
  concatenated values, NDJSON) and the child exited 0.
- Env: `TJ_PROFILE`, `TJ_PRUNE=0`, `TJ_STATS=0`, `TJ_DELIMITER`, `TJ_RAW=1`.
- stderr footer: `tj: ~N tokens (raw: ~M, X% saved)` (chars/4 estimate).

## Structure & Testing

```
tj/src/flags.js     → --tj-* parsing, env, usage
tj/src/jsonish.js   → tolerant JSON parsing (ported from ght)
tj/src/profiles.js  → profile table + profile-driven prune walk
tj/src/convert.js   → parse → prune(profile) → TOON/JSON
tj/src/cli.js       → spawn, passthrough rules, stats footer
tj/test/            → unit (profiles, parsing) + e2e via fake gh/kubectl
                      binaries on disk (basename detection is real)
```

## Boundaries

Always: byte-for-byte passthrough for non-JSON/error/binary output; silent
generic profile for unknown commands. Never: mutate anything; tj only
reshapes output.

## Success Criteria

`npm test` passes; fake kubectl payload loses `managedFields` and converts
to TOON; github profile matches ght behavior; unknown commands get
TOON-only; exit codes propagate.
