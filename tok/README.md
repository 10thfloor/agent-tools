# tok: token counter and budget linter for agent-facing text

Agent-facing text silently bloats: CLAUDE.md grows, diffs get pasted,
nobody notices until context windows hurt. `tok` counts **real tokenizer
tokens** (gpt-tokenizer o200k_base by default, `--enc=cl100k` for the GPT-4
family) for files, command output, or stdin.

```
$ tok CLAUDE.md AGENTS.md
INPUT      TOKENS   BYTES  LINES
CLAUDE.md   4,213  16,882    213
AGENTS.md   1,102   4,410     61
total       5,315

$ tok --max=5k CLAUDE.md      # exit 1 when over, a CI/pre-commit gate
CLAUDE.md   4,213  ...  ok

$ tok -- git diff             # how expensive is this diff to paste?
$ pbpaste | tok               # or anything on stdin
```

`--max` accepts `800`, `5k`, `1.5k`, `2m` and applies **per input** (the
total is still reported); any input over budget exits 1. Directories and
binary files are skipped with a stderr note. Table on a TTY, TOON when
piped, `--json` for scripts.

Suggested guardrail in a pre-commit hook or CI:

```sh
tok --max=5k CLAUDE.md AGENTS.md || echo "agent docs over token budget"
```

## Lossless packing (`--pack`)

`tok --pack` re-encodes **one JSON input** (file, stdin, or `-- command`)
as TOON (losslessly, with the round-trip verified on every invocation)
and reports real measured savings on stderr:

```
$ gh run list --json databaseId,status,conclusion,... | tok --pack
[20]{conclusion,createdAt,databaseId,displayTitle,event,headBranch,status,workflowName}:
  success,"2026-07-13T18:41:21Z",29275459595,Triage Scheduled Tasks,schedule,trunk,completed,…
tok: 1,414 → 985 tokens (30% saved, o200k_base); round-trip: verified
```

Honesty built in: lossless packing wins on **arrays of uniform records**
(typically 20–40%) and can go *negative* on deep non-uniform objects. The
footer tells you either way (a raw GitHub repo object measured −6%). When
lossy is acceptable, `ght`/`tj`'s pruning saves far more. And prose can't
be losslessly token-compressed at all (byte compressors + base64 cost
*more* tokens and models can't read them), so `--pack` refuses non-JSON
rather than pretending.

Round-trip fine print: verification is skipped (with a stderr warning) for
payloads that hit `@toon-format/toon` 2.3.0's decoder bug with
markdown-link strings; the encoding itself is spec-correct. A genuine
mismatch refuses to emit.
