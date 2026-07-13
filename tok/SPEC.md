# Spec: tok — token counter and budget linter for agent-facing text

## Objective

Agent-facing text (CLAUDE.md, AGENTS.md, prompts, diffs, command output)
silently bloats, and nobody notices until context windows hurt. `tok`
counts real tokens (gpt-tokenizer, o200k_base default) for files, command
output, or stdin — and gates budgets: `tok --max 5k CLAUDE.md` exits 1 when
over, so it works as a pre-commit/CI check.

### Assumptions (autonomous session)

1. o200k_base is the counting default (same proxy the ght benchmark used;
   Claude's tokenizer isn't public); `--enc=cl100k` for the GPT-4 family.
2. `--max` applies per input, not to the total (budget-linting docs is
   per-file); the total is still reported.
3. Directories and binary inputs are skipped with a stderr note.

## CLI Contract

- `tok <file...>` — per-file rows + total. Table on TTY, TOON piped,
  `--json` for scripts.
- `tok -- <command...>` — count the command's stdout (e.g. `tok -- git diff`).
- `... | tok` — count stdin when no files/command given.
- `--max=<n|Nk|Nm>` — mark rows over budget; exit 1 if any input is over.
- `--pack` — losslessly re-encode exactly one JSON input as TOON on stdout;
  stderr reports measured before/after tokens and a round-trip check
  (verified / skipped for the known upstream decoder bug with markdown-link
  strings / hard-refuse on genuine mismatch). Non-JSON is refused: prose
  has no lossless token compression.
- `--enc=o200k|cl100k`, `--json|--toon|--table`, `--help`.
- Exit: 0 within budget, 1 over, 2 usage.

## Structure & Testing

```
tok/src/count.js  → budget parsing, input classification, row building
tok/src/cli.js    → flags, input modes, rendering
tok/test/         → unit (budget parsing) + e2e (files, stdin, -- command,
                    over-budget exit, binary/dir skips)
```

## Success Criteria

`npm test` passes; counts are real tokenizer counts; `--max` gates exit
codes; all three input modes work; house-style output contract holds.
