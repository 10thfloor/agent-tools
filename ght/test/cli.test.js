import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const BIN = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'ght.js')

// Cross-platform fake `gh`: a .mjs the tool runs via node (prepSpawn handles
// the "run a .mjs" part on every OS: no shebang / chmod / /bin/sh).
// `body` is JS with `args` (process.argv.slice(2)), `out()`, and `err()`.
function fakeGh(body) {
  const dir = mkdtempSync(join(tmpdir(), 'ght-test-'))
  const path = join(dir, 'gh.mjs')
  writeFileSync(path, `const args = process.argv.slice(2)\nconst out = (s) => process.stdout.write(s)\nconst err = (s) => process.stderr.write(s)\n${body}\n`)
  return path
}

function runGht(args, ghBody, env = {}) {
  return spawnSync(process.execPath, [BIN, ...args], {
    encoding: 'utf8',
    env: { ...process.env, GHT_GH_PATH: fakeGh(ghBody), ...env },
  })
}

test('JSON stdout is converted to pruned TOON', () => {
  const r = runGht(['api', 'x'], `out('{"full_name":"o/r","node_id":"MDEw","html_url":"https://github.com/o/r"}\\n')`)
  assert.equal(r.status, 0)
  assert.match(r.stdout, /full_name: o\/r/)
  assert.match(r.stdout, /html_url: "?https:\/\/github.com\/o\/r"?/)
  assert.doesNotMatch(r.stdout, /node_id/)
})

test('non-JSON stdout passes through byte-for-byte', () => {
  const r = runGht(['pr', 'list'], `out('Showing 2 of 2 pull requests\\n')`)
  assert.equal(r.status, 0)
  assert.equal(r.stdout, 'Showing 2 of 2 pull requests\n')
})

test('non-zero exit code propagates and output is not transformed', () => {
  const r = runGht(['api', 'missing'], `out('{"message":"Not Found"}\\n'); process.exit(4)`)
  assert.equal(r.status, 4)
  assert.equal(r.stdout, '{"message":"Not Found"}\n')
})

test('stderr passes through', () => {
  const r = runGht(['x'], `err('a warning\\n'); out('{"a":1}\\n')`)
  assert.equal(r.status, 0)
  assert.match(r.stderr, /a warning/)
  assert.match(r.stdout, /a: 1/)
})

test('--ght-raw skips conversion entirely', () => {
  const r = runGht(['api', 'x', '--ght-raw'], `out('{"node_id":"kept"}\\n')`)
  assert.equal(r.status, 0)
  assert.equal(r.stdout, '{"node_id":"kept"}\n')
})

test('--ght-* flags are not forwarded to gh', () => {
  const r = runGht(['api', 'x', '--ght-no-prune'], `out('args: ' + args.join(' ') + '\\n')`)
  assert.equal(r.status, 0)
  assert.doesNotMatch(r.stdout, /ght-no-prune/)
  assert.match(r.stdout, /api x/)
})

test('unknown --ght flag is a usage error', () => {
  const r = runGht(['--ght-bogus'], `out('{}\\n')`)
  assert.equal(r.status, 2)
  assert.match(r.stderr, /unknown flag/)
})

test('--ght-help prints usage without running gh', () => {
  const r = runGht(['--ght-help'], `out('should not run\\n'); process.exit(9)`)
  assert.equal(r.status, 0)
  assert.match(r.stdout, /Usage: ght/)
})

test('missing gh binary reports a clean error', () => {
  const r = spawnSync(process.execPath, [BIN, 'api', 'x'], {
    encoding: 'utf8',
    env: { ...process.env, GHT_GH_PATH: '/nonexistent/gh-binary' },
  })
  assert.equal(r.status, 1)
  assert.match(r.stderr, /failed to run/)
})

test('conversions print a tokens-saved footer on stderr, stdout stays clean', () => {
  const r = runGht(['api', 'x'], `out('{"a":1,"node_id":"XXXXXXXXXXXXXXXX"}\\n')`)
  assert.equal(r.status, 0)
  assert.match(r.stderr, /ght: ~\d[\d,]* tokens \(raw gh: ~[\d,]+, -?\d+% saved\)/)
  assert.doesNotMatch(r.stdout, /tokens/)
})

test('no footer on passthrough output', () => {
  const r = runGht(['pr', 'list'], `out('no results\\n')`)
  assert.equal(r.stderr, '')
})

test('--ght-no-stats and GHT_STATS=0 suppress the footer', () => {
  const flag = runGht(['api', 'x', '--ght-no-stats'], `out('{"a":1}\\n')`)
  assert.equal(flag.stderr, '')
  const env = runGht(['api', 'x'], `out('{"a":1}\\n')`, { GHT_STATS: '0' })
  assert.equal(env.stderr, '')
})

test('GHT_PRUNE=0 env disables pruning', () => {
  const r = runGht(['api', 'x'], `out('{"node_id":"kept"}\\n')`, { GHT_PRUNE: '0' })
  assert.equal(r.status, 0)
  assert.match(r.stdout, /node_id: kept/)
})
