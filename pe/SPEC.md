# Spec: pe (principal-engineer harness wrapping Claude Code)

## Objective

A one-shot delivery machine for a repo's day-to-day engineering: `pe run
"<task>"` stages an isolated worktree, delegates implementation to a headless
Claude Code session, independently verifies the result, and delivers a pull
request, with every workflow rule enforced by the harness in code, never by
prompt. The model does the engineering; the harness owns the worktree, the
gates, the PR, and the evidence.

pe is also the instrument for the Cairn pilot: each run records a sealed,
content-addressed Cairn review (shadow mode) captured pre-human-review, so the
human reviewer stays blind while the pilot accumulates Track A (agent
usability) and Track B (attention comparison) evidence.

Success = a fresh checkout of any enrolled repo, one command, and a
ready-for-review PR whose tests the harness itself re-ran, with pilot evidence
sealed on disk, or an honest terminal state explaining why not.

## Decisions (settled in design review; not assumptions)

1. **Staged delivery.** v1 is the one-shot headless runner. A parallel
   supervisor (`pe status`, queue) and interactive mode (`pe shell`) come
   later, built on the same primitives; nothing in v1 may preclude them.
2. **Autonomy envelope.** Without asking: create worktrees/branches, commit
   locally, push its branch, open a draft PR, mark it ready-for-review.
   Never: merge, touch main, admit Cairn memory.
3. **Repo-agnostic.** `--repo <path>`, default cwd. Pilot repo chosen later.
4. **Intake.** One-shot CLI argument. No backlog file, no issue integration in v1.
5. **Pilot blindness.** Cairn runs in `shadow` mode by default: results are
   sealed, never shown in the verdict, never affect PR state or exit codes.
   `gate` mode (post-pilot) makes Cairn a real gate.

## Assumptions (autonomous decisions, flagged not asked)

1. New `pe/` package in the agent-tools suite: Node >= 22, ESM, `node:test`,
   runtime dependency only `@toon-format/toon`. Not published to npm.
2. Drives the `claude` CLI headless (`claude -p --output-format stream-json`),
   not the Agent SDK: reuses the user's real Claude Code (skills, MCP,
   config) so the pilot measures the agent actually in use.
3. Sibling tools (`wtree`, `tt`, `ght`) are invoked as CLIs found on PATH,
   overridable via env (`PE_WTREE`, `PE_TT`, `PE_GHT`, `PE_CLAUDE`,
   `PE_CAIRN`), the suite's fake-binary testing pattern.
4. Cairn is optional. No `cairn` config → the Cairn stage is skipped and the
   PR carries no gate block (degrade silently, suite principle).
5. The generated `.claude/` directory in the worktree is kept out of the diff
   via `.git/info/exclude` (repo-local ignore, never committed).

## Pipeline

`pe run` executes five stages; each failure maps to a terminal state below.

1. **Stage** (harness). Resolve repo and config; `wtree new -m "<task>"` →
   worktree. Write the PE system-prompt file, `.claude/settings.local.json`
   (PreToolUse hook, permission mode), and `.git/info/exclude` entry.
2. **Delegate** (model). Spawn `claude -p "<brief>" --output-format
   stream-json --max-turns <n>` with cwd = worktree. The brief: the task, the
   PE role, commit expectations, and, when Cairn is configured, exactly this
   discovery line, with no interpretation rubric (pilot Track A): "A review
   gate executable exists at `<path>`. Inspect its machine contract and run
   its review against your branch before finishing; interpret and act on the
   result." Transcript streams to the evidence journal as it happens.
3. **Verify** (harness; never trusts the transcript). Requires: non-empty
   diff vs base; clean, committed tree; `tt` green (harness re-runs it). On
   tt failure: one remediation round (re-delegate with the condensed failure
   rows), then terminal. When Cairn is configured, run `cairn review
   <branch> --base <base> --format json` and record the full envelope:
   sealed in shadow mode, acted on in gate mode.
4. **Deliver** (harness). Push the branch; `ght pr create --draft` with the
   generated description (task, change summary, tt verdict, Cairn gate
   block); flip to ready-for-review when policy allows (shadow mode: tt green
   and `pr.readyOnGreen`; gate mode: additionally Cairn PASS/HUMAN_REQUIRED).
5. **Report** (harness). TOON verdict on stdout (piped) or human summary
   (TTY); `wtree note` set to the terminal state; evidence dir finalized.

## Cairn contract

- **shadow (pilot default):** the review result is written only to the
  evidence dir. The PR description carries a sealed block: bundle hash,
  `snapshot: pre-human-review`, capture timestamp, and the sentence "sealed
  for pilot blindness; unseal after review". No status, findings, route, or
  exit-code signal anywhere the reviewer can see. The inner agent's own Cairn
  usage (Track A) lands in the sealed session evidence.
- **gate (post-pilot):** PASS → ready (exit 0); HUMAN_REQUIRED → ready,
  attention flagged in the description (exit 3); BLOCKED → one remediation
  round, then stays draft with the cited memory (exit 1). Findings and
  citations are printed in the gate block. Every block ends with
  "merge_authorized: false. This gate routes reviewer attention; it never
  authorizes merge."
- **`pe unseal <run-id> --outcome strong|partial [--findings <n>]
  [--changes-requested]`:** prints the sealed result, records the unseal
  timestamp, and logs the observed human outcome next to it: the Track B
  pairing. Refuses to run twice for the same run.
- **Role separation:** memory admission (`remember`, `confirm`, `capture`,
  `labs`) is human-only and hook-blocked for the agent. The learning loop is:
  your PR correction → you admit it to Cairn → the next `pe run` retrieves
  and cites it.

## CLI contract

```
pe run [--repo <path>] [--base <ref>] [--draft-only] [--max-turns <n>] "<task>"
pe report [run-id]        verdict + artifact paths of the last/named run
pe unseal <run-id> [...]  pilot: reveal sealed Cairn result, log human outcome
```

- stdout is data only: the verdict (TOON when piped, `{run, task, branch,
  worktree, pr, state, tt{failed,passed}, cairn{recorded,evidence}, turns,
  tokens, durationS}`) and nothing else. Progress, stage narration, and
  hints go to stderr.
- Exit codes, shadow mode: 0 delivered (ready or draft-only), 1 failed
  gates / aborted, 2 usage or environment error. Gate mode: 0 / 1 / 3
  mirroring `cairn review --gate`, 2 usage.
- TTY: live stage progress on stderr, human verdict table at the end.

## Config

`pe.json` at the repo root (all keys optional):

```json
{
  "cairn": { "bin": "/path/to/cairn", "mode": "shadow", "base": "main" },
  "budgets": { "maxTurns": 50, "timeoutMin": 30 },
  "retries": { "verify": 1 },
  "pr": { "readyOnGreen": true },
  "evidence": { "dir": "~/.pe/evidence" }
}
```

Evidence lives outside the repo (default `~/.pe/evidence/<repo-slug>/<run-id>/`)
and is never committed: `journal.jsonl` (incremental; crash-safe),
`transcript.jsonl`, `sealed/cairn.json`, `outcome.json`, `verdict.json`.

## Policy enforcement

- **In-loop:** the PreToolUse hook (dependency-free Node script shipped in
  `pe/hooks/`) blocks, with a reason the agent sees: any `git push`; any PR
  create/ready/merge (`gh`, `ght`); `cairn remember|confirm|capture|labs`;
  `wtree rm|clean`; writes under the evidence dir. Delivery belongs to the
  harness; the agent implements, tests, and commits, nothing else.
- **Post-hoc:** stage-3 verification (diff non-empty, tree clean, tt green)
  plus `--max-turns` and a wall-clock timeout that kills the child and
  terminates as ABORTED_BUDGET. Token usage is tallied from stream events and
  reported, not enforced, in v1.

## Terminal states

| State | Meaning | Exit |
|---|---|---|
| DELIVERED_READY | PR open and ready for review | 0 (gate mode: 3 when HUMAN_REQUIRED) |
| DELIVERED_DRAFT | PR open as draft (`--draft-only` or `readyOnGreen: false`) | 0 |
| FAILED_TESTS | tt still red after the remediation round; no PR | 1 |
| BLOCKED_CAIRN | gate mode only: BLOCKED after remediation; draft PR | 1 |
| ABORTED_BUDGET | turn/time budget exhausted | 1 |
| ERROR | usage or environment failure | 2 |

Failed worktrees are preserved (never auto-cleaned) with `wtree note` set to
`pe: <STATE> (<detail>)` so `wtree` and `fleet` display run state ambiently.

## Project structure

```
pe/
  bin/pe.js           entry point
  src/cli.js          arg parsing, command dispatch, usage
  src/config.js       pe.json + env resolution, defaults
  src/run.js          the five-stage state machine
  src/claude.js       headless spawn, stream-json parsing, budgets
  src/settings.js     generated system prompt + .claude settings + exclude
  src/cairn.js        review invocation, envelope parsing, seal/unseal
  src/deliver.js      push, PR create/ready, description rendering
  src/evidence.js     journal, transcript, sealed artifacts, outcome log
  src/spawn.js        shared cross-platform spawn prep (copied suite module)
  hooks/pretooluse.js the in-loop policy hook (no dependencies)
  test/               unit + e2e (fake claude/gh/cairn via PE_* env)
```

## Testing strategy

- Unit: config resolution, hook allow/block decisions (tool-call JSON in →
  verdict out), PR-body rendering (sealed vs gate), stream-json parsing,
  state-machine transitions, verdict encoding.
- e2e: the real pipeline against a scratch git repo with fake binaries: a
  fake `claude` (.mjs emitting stream-json while making real edits and
  commits in the worktree), fake `gh`, fake `cairn` emitting the versioned
  envelope. Cover: happy path to DELIVERED_READY; tt failure + remediation;
  budget abort; shadow-mode leak test (verdict, PR body, and exit code carry
  no Cairn semantics); gate-mode state mapping; unseal once-only.
- Everything offline; CI on Linux, macOS, Windows like the rest of the suite.

## Boundaries

- Always: preserve the enrolled repo's review and merge policy; keep
  evidence out of the repo; keep stdout data-only.
- Ask first: merging anything, gate mode as default, new dependencies,
  issue/backlog intake.
- Never: work on main, merge PRs, admit Cairn memory from the agent or
  harness, expose sealed results outside `pe unseal`, store secrets in
  evidence.

## Success criteria

1. `npm test` passes (all platforms in CI).
2. Live acceptance: `pe run` on a scratch repo delivers a ready PR whose
   description carries the sealed gate block; `pe unseal` reveals the result
   exactly once and records the outcome.
3. Shadow-mode leak test proves reviewer blindness mechanically.
4. A Cairn Track A scorecard can be filled from the evidence dir alone.

## Out of scope (v1)

Supervisor mode, `pe shell`, `--issue` intake, run resume, merge-on-green,
token-budget enforcement, provider cost telemetry.
