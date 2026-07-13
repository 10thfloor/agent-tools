# tok — token counter and budget linter for agent-facing text

Agent-facing text silently bloats — CLAUDE.md grows, diffs get pasted,
nobody notices until context windows hurt. `tok` counts **real tokenizer
tokens** (gpt-tokenizer o200k_base by default, `--enc=cl100k` for the GPT-4
family) for files, command output, or stdin.

```
$ tok CLAUDE.md AGENTS.md
INPUT      TOKENS   BYTES  LINES
CLAUDE.md   4,213  16,882    213
AGENTS.md   1,102   4,410     61
total       5,315

$ tok --max=5k CLAUDE.md      # exit 1 when over — works as a CI/pre-commit gate
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
