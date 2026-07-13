# Security notes

These are local developer CLIs. They run child processes (git, gh, test
runners, arbitrary commands you name) and read/write files in your
workspace. This page states the trust model, what's been hardened, and the
assumptions that remain your responsibility.

## Design properties

- **No shell.** Every child process is spawned with an argument array
  (`spawnSync`/`spawn`/`execFile`), never a shell string and never
  `shell: true`. Shell metacharacters in data are not interpreted.
- **stdout is data-only.** Tools never `eval` or execute anything derived
  from the JSON/text they parse; parsed data only ever reaches the TOON
  encoder.
- **Bounded parsing.** The JSON scanner is linear (no regexes with
  catastrophic backtracking); child output is capped by `maxBuffer`.

## Hardened (audited 2026-07-13)

- **`.worktreeinclude` path traversal (wt).** A repo-controlled
  `.worktreeinclude` could name `../../.ssh/id_rsa` or absolute paths and
  copy secrets into the new worktree (a git tree a later `git add -A` could
  exfiltrate). Both the source (under the repo) and destination (under the
  worktree) are now containment-checked; escaping entries are skipped with a
  warning. Symlinks are copied verbatim, not dereferenced.
- **Option injection via `--from` / `--pr` (wt).** `--pr` must be numeric;
  `--from` refs starting with `-` are rejected, so neither can smuggle a
  git option into `worktree add` / `fetch`. (Branch names arriving via the
  CLI are already rejected if they start with `-`, and names from git are
  valid refnames.)
- **Prototype-key handling (ght, tj).** `__proto__` / `constructor` /
  `prototype` keys in untrusted JSON are dropped during pruning. (Assignment
  was to fresh local objects, so global prototype pollution was never
  reachable — this is defense-in-depth and correctness.)

## Your responsibility (by design)

- **Pass-through executors.** `tj <command…>`, `tok -- <command…>`, and
  `tt <command…>` run exactly the command you give them. They add no shell,
  but they run what you name — treat them like `time` or `xargs`.
- **git in untrusted repos.** `wt` and `fleet` run read-only git commands
  (`status`, `log`, `worktree list`, `config --get`) in the repos they
  operate on; `fleet` does so across every repo under its scan roots. Git
  reads repo-local config, which can invoke programs (e.g.
  `core.fsmonitor`). This is the standard "don't run git in a repo you
  don't trust" assumption — the same as running `git status` yourself.
  Point `fleet` at roots holding repos you trust.
- **Environment.** `GHT_GH_PATH`, `WT_GH`, `FLEET_WT`, `TT_CACHE_DIR` and
  friends select binaries/paths for testing. Anyone who can set your
  environment can already run code as you; these are not a new boundary.
- **Caches.** `tt` caches full test output under `~/.cache/tt`
  (`TT_CACHE_DIR`). If your test output contains secrets, so will the cache.

## Reporting

Private repo — raise findings directly with the maintainer.
