import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { decode } from '@toon-format/toon'

const BIN = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'tt.js')

function makeProject() {
  const dir = mkdtempSync(join(tmpdir(), 'tt-e2e-'))
  const proj = join(dir, 'proj')
  mkdirSync(join(proj, 'test'), { recursive: true })
  writeFileSync(join(proj, 'package.json'), JSON.stringify({ name: 'p', type: 'module', scripts: { test: 'node --test test/*.test.js' } }))
  writeFileSync(join(proj, 'test', 'm.test.js'), `import test from 'node:test'
import assert from 'node:assert/strict'
test('passes', () => assert.equal(1, 1))
test('fails hard', () => assert.equal(2, 3))
`)
  return { proj, cache: join(dir, 'cache') }
}

function tt(args, cwd, cache) {
  return spawnSync(process.execPath, [BIN, ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, TT_CACHE_DIR: cache },
  })
}

test('piped tt condenses a failing run to TOON and keeps the exit code', () => {
  const { proj, cache } = makeProject()
  const r = tt(['node', '--test', 'test/m.test.js'], proj, cache)
  assert.notEqual(r.status, 0)
  const report = decode(r.stdout)
  assert.equal(report.summary.failed, 1)
  assert.equal(report.summary.passed, 1)
  assert.equal(report.summary.runner, 'node:test')
  assert.match(report.failures[0].head, /fails hard/)
  assert.match(r.stderr, /% smaller/)
})

test('--tt-last re-condenses from cache; --tt-full returns raw output', () => {
  const { proj, cache } = makeProject()
  tt(['node', '--test', 'test/m.test.js'], proj, cache)
  const last = tt(['--tt-last'], proj, cache)
  assert.equal(last.status, 0)
  assert.equal(decode(last.stdout).summary.failed, 1)
  const full = tt(['--tt-full'], proj, cache)
  assert.match(full.stdout, /✖ fails hard|not ok/)
})

test('default command detection uses package.json scripts.test', () => {
  const { proj, cache } = makeProject()
  const r = tt([], proj, cache)
  assert.notEqual(r.status, 0)
  assert.equal(decode(r.stdout).summary.failed, 1)
})

test('passing command yields zero failures and exit 0', () => {
  const { proj, cache } = makeProject()
  const r = tt(['node', '-e', 'console.log("all fine")'], proj, cache)
  assert.equal(r.status, 0)
  assert.equal(decode(r.stdout).summary.failed, 0)
})

test('--tt-raw passes output through untouched', () => {
  const { proj, cache } = makeProject()
  const r = tt(['--tt-raw', 'node', '-e', 'console.log("raw text")'], proj, cache)
  assert.equal(r.status, 0)
  assert.equal(r.stdout, 'raw text\n')
})

test('missing command in an empty dir is a friendly error', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tt-empty-'))
  const r = tt([], dir, join(dir, 'cache'))
  assert.equal(r.status, 2)
  assert.match(r.stderr, /no test command detected/)
})
