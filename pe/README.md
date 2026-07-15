# pe: principal-engineer harness wrapping headless Claude Code

Task in, reviewed PR out. `pe run "<task>"` stages an isolated worktree,
delegates implementation to a headless Claude Code session, re-verifies the
result itself, and delivers a draft-then-ready pull request. The model does
the engineering; the harness owns the workflow. Every gate is code, not
prompt.

```
$ pe run "add rate limiting to the api"
pe: stage    creating worktree for pe/mcqk3f2ab
pe: delegate initial run (max 50 turns)
pe: verify   recording Cairn review
pe: deliver  pushing branch and opening PR
pe: DELIVERED_READY https://github.com/you/repo/pull/42
run        pe-mcqk3f2ab
state      DELIVERED_READY
pr         https://github.com/you/repo/pull/42
tt.failed  0
tt.passed  38
turns      31
tokens     48210
```

Piped, the verdict is TOON (agents can chain on it); progress and hints go
to stderr, so `pe run ... | tee verdict.toon` stays clean.

While the delegated session works, its tool calls tick live on stderr
(`agent    Edit js/net.js`, `agent    Bash tt`); `--quiet` silences them.
The agent's prose streams too, except under Cairn shadow mode: the agent
runs the review gate itself and may discuss the result, so in shadow mode
narration stays in the sealed evidence and only tool calls print. Tool
results never print.

## Install

```sh
cd pe && npm install && npm link
```

Requires Node >= 22, git, and the `claude` CLI. The sibling tools `wtree`,
`tt`, and `ght` must be on PATH (npm link each; pe drives them). Optional: a
[Cairn](https://github.com/10thfloor/cairn) checkout for the review gate.

## Commands

| Command | What it does |
|---|---|
| `pe run [--repo <path>] [--base <ref>] [--draft-only] [--max-turns <n>] [--quiet] "<task>"` | the full pipeline: worktree, delegate, verify, deliver, report |
| `pe revise [run-id]` | after human review: fetch the PR feedback via `ght`, address it in the same worktree, push the same branch (updates the PR) |
| `pe resume [run-id]` | continue a `FAILED_TESTS` / `ABORTED_BUDGET` run in its preserved worktree, with the recorded failure as context |
| `pe report [run-id]` | re-print a past run's verdict and artifact paths (default: latest) |
| `pe unseal <run-id> --outcome strong\|partial [--findings <n>] [--changes-requested]` | pilot: reveal the sealed Cairn record (exactly once) and log the human outcome. `--outcome` is required; the record is final, so log what the review actually found or it reads as clean |
| `pe doctor` | preflight every dependency (claude, wtree, tt, ght, git, gh auth, cairn, evidence dir); exit 1 if anything would break a run |
| `pe scorecard` | pilot metrics from the evidence dir: run states, remediation rate, spend, sealed records vs unsealed human outcomes |
| `pe status` | the runs, newest first: state, branch, PR, live worktree, unsealed |

Exit codes: `0` delivered, `1` gates failed or run aborted, `2` usage or
environment error. In Cairn gate mode, `3` means delivered but
HUMAN_REQUIRED, mirroring `cairn review --gate`.

## The pipeline

| Stage | Owner | What happens |
|---|---|---|
| 1 stage | harness | `wtree new` creates the branch worktree; PE settings and the policy hook are generated into it |
| 2 delegate | model | headless `claude -p` implements, tests with `tt`, commits; the transcript streams to evidence as it happens |
| 3 verify | harness | re-runs `tt` itself (never trusts the transcript), requires a clean committed tree and real commits; runs `cairn review` when configured |
| 4 deliver | harness | pushes the branch, opens a draft PR via `ght`, flips it ready when policy allows |
| 5 report | harness | one verdict on stdout; evidence finalized; `wtree note` records the state |

On failing verification (red tests, uncommitted work, no commits) the harness
runs one remediation round: it re-delegates with the concrete evidence (the
failing rows, the reason), then escalates instead of looping. Failed
worktrees are preserved, never auto-cleaned; `wtree` and `fleet` show
`pe: FAILED_TESTS (...)` in the WORK column.

## Guardrails

The autonomy envelope lives in code, not in the prompt:

- A PreToolUse hook inside the delegated session blocks, with a reason the
  agent sees: any `git push`, any PR command (`gh`/`ght` create, ready,
  merge, close), Cairn memory admission (`remember`, `confirm`, `capture`,
  `labs`), worktree removal, and writes to the evidence directory.
- The harness re-verifies everything after the session ends. Delivery (push,
  PR) is performed by the harness only.
- Budgets: `--max-turns` plus a wall-clock timeout that kills the run
  (`ABORTED_BUDGET`).
- A secret scan guards every push: credential-shaped additions in the branch
  diff (AWS keys, GitHub/Slack tokens, private key blocks, secret
  assignments) stop delivery as `BLOCKED_SECRETS`, with the matches masked
  in the report. Nothing leaves the machine.
- The generated `.claude/` settings never enter the diff (repo-local git
  exclude).

The agent implements, tests, and commits. Nothing else.

## The Cairn attention gate

With a `cairn` block in `pe.json`, stage 3 records a Cairn review of the
branch. Two modes:

**shadow (pilot default).** The result is sealed: written only to the
evidence directory, absent from the verdict, the PR state, and the exit
code. The PR description carries a sealed block instead:

```markdown
## Cairn attention gate

sealed for pilot blindness; unseal after review (`pe unseal pe-mcqk3f2ab`)
evidence: sha256:9f31... · snapshot: pre-human-review · captured: 2026-07-14T21:04:11Z

merge_authorized: false. This gate routes reviewer attention; it never authorizes merge.
```

The reviewer stays blind; the evidence is content-addressed and provably
captured before review. After reviewing, `pe unseal <run-id> --outcome ...`
reveals the record exactly once and logs the observed human outcome next to
it. That pairing is the pilot's comparison data, and it is final: unseal
refuses to run twice, so record the findings count and whether changes were
requested at unseal time.

**gate (post-pilot).** The review drives delivery: PASS ships ready (exit
0); HUMAN_REQUIRED ships ready with the attention flag in the description
(exit 3); BLOCKED gets one remediation round, then stays draft with the
cited memory (exit 1). Findings and citations are printed in the gate block.

The delegated agent is told only that a review gate executable exists and
where; it must discover the machine contract itself (`cairn capabilities`)
and act on what it finds. That is the pilot's Track A experiment, and the
whole session is recorded as evidence. Memory admission is human-only in
both modes: your review corrections become Cairn memory through your own
`remember`/`confirm`, never through the agent.

`pe revise` closes the loop: after your review, it fetches the PR feedback,
re-delegates in the preserved worktree, and pushes the same branch. Cairn is
not re-run on a revision (the sealed record documents the diff you actually
reviewed), and when Cairn is configured the command ends by printing a
`cairn remember` scaffold built from the PR: you fill in the confirmed rule
and run it yourself.

## Config

`pe.json` at the repo root; all keys optional:

```json
{
  "cairn": { "bin": "/path/to/cairn", "mode": "shadow", "base": "main" },
  "budgets": { "maxTurns": 50, "timeoutMin": 30 },
  "retries": { "verify": 1 },
  "pr": { "readyOnGreen": true },
  "evidence": { "dir": "~/.pe/evidence" },
  "notify": false
}
```

`notify: true` (or `--notify` per run) fires a desktop notification on the
terminal state: macOS `osascript`, Linux `notify-send`, silent degradation
elsewhere. Runs take minutes; no need to babysit the terminal.

Env overrides (also the testing seam): `PE_CLAUDE`, `PE_WTREE`, `PE_TT`,
`PE_GHT`, `PE_GIT`, `PE_CAIRN`, `PE_EVIDENCE_DIR`, `PE_NOTIFY` (notifier
override, invoked as `<bin> <state> <message>`).

## Evidence

One directory per run, outside the repo and never committed:

```
~/.pe/evidence/<repo-slug>/<run-id>/
  journal.jsonl      stage-by-stage events (incremental, crash-safe)
  transcript.jsonl   the raw stream-json session transcript
  prompt.md          exactly what the agent was asked
  pr-body.md         the PR description as delivered
  sealed/cairn.json  the sealed review record (shadow mode)
  verdict.json       the final verdict
  outcome.json       written by pe unseal: human outcome + unseal time
```

## Terminal states

| State | Meaning | Exit |
|---|---|---|
| DELIVERED_READY | PR open and ready for review | 0 (gate mode: 3 when HUMAN_REQUIRED) |
| DELIVERED_DRAFT | PR open as draft (`--draft-only` or `readyOnGreen: false`) | 0 |
| FAILED_TESTS | verification still failing after the remediation round; no PR | 1 |
| BLOCKED_CAIRN | gate mode only: BLOCKED after remediation; draft PR | 1 |
| BLOCKED_SECRETS | credential-shaped additions in the diff; nothing pushed | 1 |
| ABORTED_BUDGET | turn or wall-clock budget exhausted | 1 |
| ERROR | usage or environment failure | 2 |

## Tests

```sh
npm test
```

The e2e suite drives the real binary against a scratch repo with a bare
origin (pushes are real) and the real sibling `wtree`; `claude`, `tt`,
`ght`, and `cairn` are scripted fakes injected via env. Coverage includes
the shadow-mode leak test (no Cairn status or finding text on any surface
the reviewer sees), remediation, budget aborts, gate-mode state mapping,
once-only unseal, and the full hook policy matrix. Everything runs offline.
