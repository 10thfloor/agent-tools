import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { decode } from '@toon-format/toon'
import { discoverRepos } from '../src/discover.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const BIN = join(HERE, '..', 'bin', 'fleet.js')
// The real sibling wtree — this doubles as a suite integration test.
const WT_BIN = join(HERE, '..', '..', 'wtree', 'bin', 'wtree.js')

const sh = (cmd, args, cwd) => execFileSync(cmd, args, { cwd, encoding: 'utf8' })

function makeRoot() {
  const root = mkdtempSync(join(tmpdir(), 'fleet-e2e-'))
  for (const name of ['alpha', 'beta']) {
    const repo = join(root, name)
    mkdirSync(repo)
    sh('git', ['init', '-b', 'main'], repo)
    sh('git', ['config', 'user.email', 'f@t'], repo)
    sh('git', ['config', 'user.name', 'f'], repo)
    writeFileSync(join(repo, 'a.txt'), 'hi\n')
    sh('git', ['add', '.'], repo)
    sh('git', ['commit', '-m', 'init'], repo)
  }
  // alpha gets a worktree (satellite dir) and a dirty file inside it.
  const alpha = join(root, 'alpha')
  sh('git', ['worktree', 'add', '-b', 'feat/x', join(root, 'alpha.worktrees', 'feat-x')], alpha)
  writeFileSync(join(root, 'alpha.worktrees', 'feat-x', 'wip.txt'), 'wip\n')
  mkdirSync(join(root, 'not-a-repo'))
  return root
}

function fleet(args, root) {
  return spawnSync(process.execPath, [BIN, ...args], {
    encoding: 'utf8',
    env: {
      ...process.env,
      FLEET_ROOTS: root,
      FLEET_WT: WT_BIN,
      WTREE_NO_PROC: '1',
      WTREE_GH: '/nonexistent/gh',
    },
  })
}

test('discoverRepos finds repos, skips satellites and non-repos', () => {
  const root = makeRoot()
  const repos = discoverRepos([root]).map((p) => basename(p)).sort()
  assert.deepEqual(repos, ['alpha', 'beta'])
})

test('repo rows: counts, activity, sorting (active first), TOON when piped', () => {
  const root = makeRoot()
  const r = fleet([], root)
  assert.equal(r.status, 0)
  const rows = decode(r.stdout)
  assert.equal(rows.length, 2)
  assert.equal(rows[0].repo, 'alpha') // active sorts first
  assert.equal(rows[0].active, true)
  assert.equal(rows[0].worktrees, 2)
  assert.equal(rows[0].activeWorktrees, 1)
  assert.equal(rows[1].repo, 'beta')
  assert.equal(rows[1].active, false)
})

test('--all flattens per-worktree rows with a repo column', () => {
  const root = makeRoot()
  const rows = decode(fleet(['--all'], root).stdout)
  assert.equal(rows.length, 3)
  const featRow = rows.find((r) => r.branch === 'feat/x')
  assert.equal(featRow.repo, 'alpha')
  assert.equal(featRow.status, 'active')
  assert.match(featRow.activity, /dirty:1/)
})

test('--json and positional roots work; empty root exits 1', () => {
  const root = makeRoot()
  const viaArg = spawnSync(process.execPath, [BIN, root, '--json'], {
    encoding: 'utf8',
    env: { ...process.env, FLEET_WT: WT_BIN, WTREE_NO_PROC: '1', WTREE_GH: '/nonexistent/gh' },
  })
  assert.equal(JSON.parse(viaArg.stdout).length, 2)
  const empty = fleet([], mkdtempSync(join(tmpdir(), 'fleet-empty-')))
  assert.equal(empty.status, 1)
  assert.match(empty.stderr, /no git repositories found/)
})

test('with no roots and no FLEET_ROOTS, scans the current directory', () => {
  const root = makeRoot()
  const r = spawnSync(process.execPath, [BIN, '--json'], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, FLEET_WT: WT_BIN, WTREE_NO_PROC: '1', WTREE_GH: '/nonexistent/gh', FLEET_ROOTS: '' },
  })
  assert.equal(r.status, 0)
  assert.equal(JSON.parse(r.stdout).length, 2) // alpha + beta under cwd
})

test('git-only fallback when wt is unavailable', () => {
  const root = makeRoot()
  const r = spawnSync(process.execPath, [BIN], {
    encoding: 'utf8',
    env: { ...process.env, FLEET_ROOTS: root, FLEET_WT: '/nonexistent/wtree' },
  })
  assert.equal(r.status, 0)
  const rows = decode(r.stdout)
  assert.equal(rows.length, 2)
  assert.equal(rows.every((x) => x.worktrees === 1), true) // fallback sees main only
})
