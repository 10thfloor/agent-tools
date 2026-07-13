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
  // Pin the TAP reporter so the format is identical across Node versions
  // (Node's default flips between spec and TAP by version / TTY).
  writeFileSync(join(proj, 'package.json'), JSON.stringify({ name: 'p', type: 'module', scripts: { test: 'node --test --test-reporter=tap test/*.test.js' } }))
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
  const r = tt(['node', '--test', '--test-reporter=tap', 'test/m.test.js'], proj, cache)
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
  tt(['node', '--test', '--test-reporter=tap', 'test/m.test.js'], proj, cache)
  const last = tt(['--tt-last'], proj, cache)
  assert.equal(last.status, 0)
  assert.equal(decode(last.stdout).summary.failed, 1)
  const full = tt(['--tt-full'], proj, cache)
  assert.match(full.stdout, /✖ fails hard|not ok/)
})

test('--tt-fail prints the complete cached block for one failure', () => {
  const { proj, cache } = makeProject()
  tt(['node', '--test', '--test-reporter=tap', 'test/m.test.js'], proj, cache)
  const r = tt(['--tt-fail=1'], proj, cache)
  assert.equal(r.status, 0)
  assert.match(r.stdout, /fails hard/)
  assert.match(r.stdout, /AssertionError/)
  assert.doesNotMatch(r.stdout, / \| /) // real lines, not the condensed join
  const missing = tt(['--tt-fail=7'], proj, cache)
  assert.equal(missing.status, 1)
  assert.match(missing.stderr, /no failure #7/)
})

test('vitest-style scripts get exact counts from the native JSON report', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tt-vit-'))
  const proj = join(dir, 'proj')
  mkdirSync(proj, { recursive: true })
  // The fake runner prints no heuristic markers, so exact counts can only
  // come from the report file it writes to --outputFile.
  writeFileSync(join(proj, 'vitest-fake.mjs'), `import { writeFileSync } from 'node:fs'
const out = process.argv.find((a) => a.startsWith('--outputFile=')).slice('--outputFile='.length)
writeFileSync(out, JSON.stringify({
  numTotalTests: 5, numPassedTests: 3, numFailedTests: 2,
  testResults: [{ name: 'src/a.test.ts', assertionResults: [
    { status: 'failed', fullName: 'parses empty input', failureMessages: ['AssertionError: expected [] to have length 1\\n    at src/a.test.ts:14:3'] },
    { status: 'failed', fullName: 'handles nulls', failureMessages: ['TypeError: boom'] },
  ]}],
}))
console.log('plain human reporter text, no markers here')
process.exit(1)
`)
  writeFileSync(join(proj, 'package.json'), JSON.stringify({ name: 'v', type: 'module', scripts: { test: 'node vitest-fake.mjs' } }))
  const r = tt([], proj, join(dir, 'cache'))
  assert.equal(r.status, 1)
  const report = decode(r.stdout)
  assert.equal(report.summary.failed, 2)
  assert.equal(report.summary.passed, 3)
  assert.match(report.summary.runner, /vitest \(json report\)/)
  assert.equal(report.failures[0].head, '✖ parses empty input')
  assert.match(report.failures[0].detail, /a\.test\.ts:14/)
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

test('leading --help/-h prints usage; after a command it is forwarded', () => {
  const { proj, cache } = makeProject()
  for (const flag of ['--help', '-h']) {
    const r = tt([flag], proj, cache)
    assert.equal(r.status, 0)
    assert.match(r.stdout, /^tt: run tests/)
  }
  const fwd = tt(['node', '--help'], proj, cache)
  assert.equal(fwd.status, 0)
  assert.equal(decode(fwd.stdout).summary.command, 'node --help')
})
