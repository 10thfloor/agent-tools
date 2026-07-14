import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { decode } from '@toon-format/toon'

const BIN = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'wtree.js')

function sh(cmd, args, cwd) {
  return execFileSync(cmd, args, { cwd, encoding: 'utf8' })
}

function makeRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'wt-e2e-'))
  const repo = join(dir, 'proj')
  mkdirSync(repo)
  sh('git', ['init', '-b', 'main'], repo)
  sh('git', ['config', 'user.email', 'wt@test'], repo)
  sh('git', ['config', 'user.name', 'wt test'], repo)
  writeFileSync(join(repo, 'a.txt'), 'hello\n')
  sh('git', ['add', '.'], repo)
  sh('git', ['commit', '-m', 'init'], repo)
  return repo
}

function wt(args, cwd, env = {}) {
  return spawnSync(process.execPath, [BIN, ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, WTREE_NO_PROC: '1', WTREE_GH: '/nonexistent/gh', ...env },
  })
}

// Cross-platform fake `gh`: a .mjs the tool runs via node (prepSpawn handles
// running a .mjs on every OS: no shebang / chmod / /bin/sh). `body` is JS
// with `args` (process.argv.slice(2)) and `out()`.
function fakeGh(body) {
  const dir = mkdtempSync(join(tmpdir(), 'wt-gh-'))
  const path = join(dir, 'gh.mjs')
  writeFileSync(path, `const args = process.argv.slice(2)\nconst out = (s) => process.stdout.write(s)\n${body}\n`)
  return path
}

test('new creates a worktree, prints only its path on stdout, and is idempotent', () => {
  const repo = makeRepo()
  const r = wt(['new', 'feat/x'], repo)
  assert.equal(r.status, 0)
  const path = r.stdout.trim()
  // wtree emits forward-slash paths on every OS (git style); compare literally.
  assert.equal(path.endsWith('proj.worktrees/feat-x'), true)
  assert.equal(existsSync(join(path, 'a.txt')), true)
  assert.match(r.stderr, /worktree ready/)

  const again = wt(['new', 'feat/x'], repo)
  assert.equal(again.status, 0)
  assert.equal(again.stdout.trim(), path)
  assert.match(again.stderr, /reusing/)
})

test('list emits TOON by default when piped, table with --table, JSON with --json', () => {
  const repo = makeRepo()
  wt(['new', 'feat/y'], repo)
  const piped = wt(['list'], repo)
  assert.equal(piped.status, 0)
  const rows = decode(piped.stdout)
  assert.equal(rows.length, 2)
  assert.equal(rows[0].branch, 'main')
  assert.equal(rows[0].main, true)
  assert.equal(rows[1].branch, 'feat/y')
  assert.equal(rows[1].status, 'idle')

  const table = wt(['list', '--table'], repo)
  assert.match(table.stdout, /BRANCH\s+WORK\s+ACTIVITY\s+PR\s+PATH/)
  assert.match(table.stdout, /feat\/y/)

  const json = JSON.parse(wt(['list', '--json'], repo).stdout)
  assert.equal(json[1].path.endsWith('feat-y'), true)
})

test('dirty worktrees are active; rm refuses without --force, removes with it', () => {
  const repo = makeRepo()
  const path = wt(['new', 'feat/z'], repo).stdout.trim()
  writeFileSync(join(path, 'wip.txt'), 'wip\n')

  const rows = decode(wt(['list'], repo).stdout)
  const row = rows.find((r) => r.branch === 'feat/z')
  assert.equal(row.status, 'active')
  assert.equal(row.dirty, 1)
  assert.match(row.activity, /dirty:1/)

  const refuse = wt(['rm', 'feat/z'], repo)
  assert.equal(refuse.status, 1)
  assert.match(refuse.stderr, /uncommitted change/)
  assert.equal(existsSync(path), true)

  const force = wt(['rm', 'feat/z', '--force'], repo)
  assert.equal(force.status, 0)
  assert.equal(existsSync(path), false)
  assert.match(force.stderr, /deleted branch 'feat\/z'/)
})

test('rm deletes merged branches, keeps unmerged ones with a note', () => {
  const repo = makeRepo()
  wt(['new', 'feat/merged'], repo)
  const r = wt(['rm', 'feat/merged'], repo)
  assert.equal(r.status, 0)
  assert.match(r.stderr, /deleted branch 'feat\/merged'/)

  const p2 = wt(['new', 'feat/unmerged'], repo).stdout.trim()
  writeFileSync(join(p2, 'b.txt'), 'work\n')
  sh('git', ['add', '.'], p2)
  sh('git', ['commit', '-m', 'work'], p2)
  const r2 = wt(['rm', 'feat/unmerged'], repo)
  assert.equal(r2.status, 0)
  assert.match(r2.stderr, /kept branch 'feat\/unmerged'/)
  assert.equal(existsSync(p2), false)
})

test('rm refuses the main worktree', () => {
  const repo = makeRepo()
  const r = wt(['rm', 'main'], repo)
  assert.equal(r.status, 1)
  assert.match(r.stderr, /refusing to remove the main worktree/)
})

test('clean is a dry run without --yes, removes idle worktrees with it', () => {
  const repo = makeRepo()
  const idle = wt(['new', 'feat/idle'], repo).stdout.trim()
  const busy = wt(['new', 'feat/busy'], repo).stdout.trim()
  writeFileSync(join(busy, 'wip.txt'), 'wip\n')

  const dry = wt(['clean'], repo)
  assert.equal(dry.status, 0)
  assert.match(dry.stderr, /feat\/idle/)
  assert.doesNotMatch(dry.stderr, /feat\/busy/)
  assert.match(dry.stderr, /rerun with --yes/)
  assert.equal(existsSync(idle), true)

  const real = wt(['clean', '--yes'], repo)
  assert.equal(real.status, 0)
  assert.equal(existsSync(idle), false)
  assert.equal(existsSync(busy), true)
})

test('open PRs mark a worktree active (stubbed gh)', () => {
  const repo = makeRepo()
  wt(['new', 'feat/pr'], repo)
  const fake = fakeGh(`out('[{"number":41,"isDraft":false,"headRefName":"feat/pr","url":"u"}]\\n')`)

  const rows = decode(wt(['list'], repo, { WTREE_GH: fake }).stdout)
  const row = rows.find((r) => r.branch === 'feat/pr')
  assert.equal(row.status, 'active')
  assert.equal(row.pr, 41)
  assert.match(row.activity, /pr:#41/)

  const clean = wt(['clean', '--yes'], repo, { WTREE_GH: fake })
  assert.equal(clean.status, 0)
  assert.match(clean.stderr, /nothing to clean/)
})

test('new without a branch generates wtree-1, wtree-2, …', () => {
  const repo = makeRepo()
  const first = wt(['new'], repo)
  assert.equal(first.status, 0)
  assert.equal(first.stdout.trim().endsWith('wtree-1'), true)
  assert.match(first.stderr, /using 'wtree-1'/)
  const second = wt(['new'], repo)
  assert.equal(second.stdout.trim().endsWith('wtree-2'), true)
})

test('notes: -m stores intent, list shows it, wt note reads and updates it', () => {
  const repo = makeRepo()
  wt(['new', 'feat/auth', '-m', 'spike: new auth flow'], repo)
  let rows = decode(wt(['list'], repo).stdout)
  assert.equal(rows.find((r) => r.branch === 'feat/auth').work, 'spike: new auth flow')

  const show = wt(['note', 'feat/auth'], repo)
  assert.equal(show.stdout.trim(), 'spike: new auth flow')

  const set = wt(['note', 'feat/auth', 'auth flow works, cleaning up'], repo)
  assert.equal(set.status, 0)
  rows = decode(wt(['list'], repo).stdout)
  assert.equal(rows.find((r) => r.branch === 'feat/auth').work, 'auth flow works, cleaning up')
})

test('work column falls back to generated summaries from git state', () => {
  const repo = makeRepo()
  const path = wt(['new', 'feat/gen'], repo).stdout.trim()

  let row = decode(wt(['list'], repo).stdout).find((r) => r.branch === 'feat/gen')
  assert.equal(row.work, 'no work yet')

  mkdirSync(join(path, 'src'))
  writeFileSync(join(path, 'src', 'gen.js'), 'x\n')
  row = decode(wt(['list'], repo).stdout).find((r) => r.branch === 'feat/gen')
  assert.equal(row.work, 'editing src (1 file)')

  sh('git', ['add', '.'], path)
  sh('git', ['commit', '-m', 'add generator'], path)
  row = decode(wt(['list'], repo).stdout).find((r) => r.branch === 'feat/gen')
  assert.equal(row.work, '1 commit, last: add generator')

  const main = decode(wt(['list'], repo).stdout).find((r) => r.main)
  assert.equal(main.work, 'at: init')
})

test('path prints the worktree path; unknown refs fail', () => {
  const repo = makeRepo()
  const created = wt(['new', 'feat/p'], repo).stdout.trim()
  const r = wt(['path', 'feat/p'], repo)
  assert.equal(r.status, 0)
  assert.equal(r.stdout.trim(), created)
  assert.equal(wt(['path', 'nope'], repo).status, 1)
})

test('.worktreeinclude copies gitignored files into new worktrees', () => {
  const repo = makeRepo()
  writeFileSync(join(repo, '.gitignore'), '.env\nsecrets/\n')
  writeFileSync(join(repo, '.env'), 'KEY=1\n')
  mkdirSync(join(repo, 'secrets'))
  writeFileSync(join(repo, 'secrets', 'k.txt'), 's\n')
  writeFileSync(join(repo, '.worktreeinclude'), '# local config\n.env\nsecrets/\n')
  sh('git', ['add', '.'], repo)
  sh('git', ['commit', '-m', 'ignore rules'], repo)

  const r = wt(['new', 'feat/inc'], repo)
  assert.equal(r.status, 0)
  const dest = r.stdout.trim()
  assert.match(r.stderr, /copied 2 item\(s\) from \.worktreeinclude/)
  assert.equal(readFileSync(join(dest, '.env'), 'utf8'), 'KEY=1\n')
  assert.equal(readFileSync(join(dest, 'secrets', 'k.txt'), 'utf8'), 's\n')
})

test('.worktreeinclude cannot escape the repo (path traversal)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'wt-esc-'))
  const repo = join(dir, 'proj')
  mkdirSync(repo)
  sh('git', ['init', '-b', 'main'], repo)
  sh('git', ['config', 'user.email', 'wt@test'], repo)
  sh('git', ['config', 'user.name', 'wt test'], repo)
  // A secret in a sibling directory, outside the repo.
  writeFileSync(join(dir, 'secret.txt'), 'TOP SECRET\n')
  writeFileSync(join(repo, 'a.txt'), 'hi\n')
  writeFileSync(join(repo, '.worktreeinclude'), '../secret.txt\n')
  sh('git', ['add', '.'], repo)
  sh('git', ['commit', '-m', 'init'], repo)

  const r = wt(['new', 'feat/evil'], repo)
  assert.equal(r.status, 0)
  const worktreeDir = r.stdout.trim()
  // The escaping entry is skipped and never lands anywhere near the worktree.
  assert.match(r.stderr, /skipped 1 .*escaped the repo/)
  assert.equal(existsSync(join(worktreeDir, 'secret.txt')), false)
  assert.equal(existsSync(join(worktreeDir, '..', 'secret.txt')), false)
})

test('--pr and --from reject option-injection values', () => {
  const repo = makeRepo()
  const badPr = wt(['new', '--pr', '--upload-pack=touch /tmp/pwned'], repo)
  assert.equal(badPr.status, 2)
  assert.match(badPr.stderr, /--pr must be a number/)
  const badFrom = wt(['new', 'feat/x', '--from', '--evil'], repo)
  assert.equal(badFrom.status, 2)
  assert.match(badFrom.stderr, /invalid --from ref/)
})

test('--pr fetches pull/N/head into a pr-N worktree, note from gh title', () => {
  const repo = makeRepo()
  const originDir = join(dirname(repo), 'origin.git')
  sh('git', ['clone', '--bare', repo, originDir], dirname(repo))
  sh('git', ['remote', 'add', 'origin', originDir], repo)
  // Simulate GitHub's PR ref namespace in the bare origin.
  sh('git', ['update-ref', 'refs/pull/7/head', 'HEAD'], originDir)
  const fake = fakeGh(`if (args.includes('view')) out('{"title":"Fix crash"}\\n'); else out('[]\\n')`)

  const r = wt(['new', '--pr', '7'], repo, { WTREE_GH: fake })
  assert.equal(r.status, 0)
  assert.match(r.stderr, /worktree ready \(PR #7\)/)
  assert.equal(r.stdout.trim().endsWith('pr-7'), true)
  assert.equal(wt(['note', 'pr-7'], repo).stdout.trim(), 'PR #7: Fix crash')

  const both = wt(['new', 'x', '--pr', '7'], repo)
  assert.equal(both.status, 2)
})

test('friendly error in a repo with no commits', () => {
  const repo = join(mkdtempSync(join(tmpdir(), 'wt-unborn-')), 'proj')
  mkdirSync(repo)
  sh('git', ['init', '-b', 'main'], repo)
  const r = wt(['new', 'feat/x'], repo)
  assert.equal(r.status, 1)
  assert.match(r.stderr, /no commits yet/)
})

test('friendly error outside a git repository', () => {
  const dir = mkdtempSync(join(tmpdir(), 'wt-nogit-'))
  const r = wt(['list'], dir)
  assert.equal(r.status, 1)
  assert.match(r.stderr, /not inside a git repository/)
})

test('new from origin branch sets up tracking', () => {
  const repo = makeRepo()
  // A second repo acts as "origin" with a branch the local repo doesn't have.
  const originDir = join(dirname(repo), 'origin.git')
  sh('git', ['clone', '--bare', repo, originDir], dirname(repo))
  sh('git', ['remote', 'add', 'origin', originDir], repo)
  sh('git', ['branch', 'feat/remote'], repo)
  sh('git', ['push', 'origin', 'feat/remote'], repo)
  sh('git', ['branch', '-D', 'feat/remote'], repo)
  sh('git', ['fetch', 'origin'], repo)

  const r = wt(['new', 'feat/remote'], repo)
  assert.equal(r.status, 0)
  assert.match(r.stderr, /tracking origin\/feat\/remote/)
  const upstream = sh('git', ['-C', r.stdout.trim(), 'rev-parse', '--abbrev-ref', '@{upstream}']).trim()
  assert.equal(upstream, 'origin/feat/remote')
})

test('shell-init prints the hook per shell; no shell is a usage error', () => {
  const repo = makeRepo()
  const zsh = wt(['shell-init', 'zsh'], repo)
  assert.equal(zsh.status, 0)
  assert.match(zsh.stdout, /wtree\(\) \{/)
  assert.match(zsh.stdout, /command wtree/)
  assert.match(wt(['shell-init', 'fish'], repo).stdout, /function wtree/)
  assert.match(wt(['shell-init', 'powershell'], repo).stdout, /Set-Location/)
  const bad = wt(['shell-init'], repo)
  assert.equal(bad.status, 2)
  assert.match(bad.stderr, /bash \| zsh \| fish \| powershell/)
})

test('cd without the hook explains shell-init; path with no branch prints main', () => {
  const repo = makeRepo()
  const r = wt(['cd', 'feat/x'], repo)
  assert.equal(r.status, 1)
  assert.match(r.stderr, /shell-init/)
  const p = wt(['path'], repo)
  assert.equal(p.status, 0)
  assert.equal(p.stdout.trim().endsWith('proj'), true)
})

const HAS_BASH = process.platform !== 'win32'
  && spawnSync('bash', ['--version'], { encoding: 'utf8' }).status === 0

test('the bash hook makes wtree new / wtree cd change directory', { skip: !HAS_BASH }, () => {
  const repo = makeRepo()
  // A `wtree` on PATH for `command wtree` inside the hook.
  const bindir = mkdtempSync(join(tmpdir(), 'wt-hookbin-'))
  writeFileSync(join(bindir, 'wtree'), `#!/bin/sh\nexec "${process.execPath}" "${BIN}" "$@"\n`, { mode: 0o755 })
  // The hook cds AND prints the path, so the hookless agent form
  // cd "$(wtree new x)" keeps working even with the hook loaded.
  const script = 'eval "$(wtree shell-init bash)" && wtree new feat/hook >/dev/null && pwd'
    + ' && wtree cd >/dev/null && pwd'
    + ' && cd "$(wtree new feat/hook2)" && pwd'
  const r = spawnSync('bash', ['-c', script], {
    cwd: repo,
    encoding: 'utf8',
    env: { ...process.env, PATH: `${bindir}:${process.env.PATH}`, WTREE_NO_PROC: '1', WTREE_GH: '/nonexistent/gh' },
  })
  assert.equal(r.status, 0, r.stderr)
  const [inWorktree, backInMain, viaSubst] = r.stdout.trim().split('\n')
  assert.equal(inWorktree.endsWith('proj.worktrees/feat-hook'), true)
  assert.equal(backInMain.endsWith('proj'), true)
  assert.equal(viaSubst.endsWith('proj.worktrees/feat-hook2'), true)
})
