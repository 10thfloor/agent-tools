import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, chmodSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const BIN = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'ght.js')

function fakeGh(script) {
  const dir = mkdtempSync(join(tmpdir(), 'ght-test-'))
  const path = join(dir, 'gh')
  writeFileSync(path, `#!/bin/sh\n${script}\n`)
  chmodSync(path, 0o755)
  return path
}

function runGht(args, ghScript, env = {}) {
  return spawnSync(process.execPath, [BIN, ...args], {
    encoding: 'utf8',
    env: { ...process.env, GHT_GH_PATH: fakeGh(ghScript), ...env },
  })
}

test('JSON stdout is converted to pruned TOON', () => {
  const r = runGht(['api', 'x'], `echo '{"full_name":"o/r","node_id":"MDEw","html_url":"https://github.com/o/r"}'`)
  assert.equal(r.status, 0)
  assert.match(r.stdout, /full_name: o\/r/)
  assert.match(r.stdout, /html_url: "?https:\/\/github.com\/o\/r"?/)
  assert.doesNotMatch(r.stdout, /node_id/)
})

test('non-JSON stdout passes through byte-for-byte', () => {
  const r = runGht(['pr', 'list'], `printf 'Showing 2 of 2 pull requests\\n'`)
  assert.equal(r.status, 0)
  assert.equal(r.stdout, 'Showing 2 of 2 pull requests\n')
})

test('non-zero exit code propagates and output is not transformed', () => {
  const r = runGht(['api', 'missing'], `echo '{"message":"Not Found"}'; exit 4`)
  assert.equal(r.status, 4)
  assert.equal(r.stdout, '{"message":"Not Found"}\n')
})

test('stderr passes through', () => {
  const r = runGht(['x'], `echo 'a warning' >&2; echo '{"a":1}'`)
  assert.equal(r.status, 0)
  assert.match(r.stderr, /a warning/)
  assert.match(r.stdout, /a: 1/)
})

test('--ght-raw skips conversion entirely', () => {
  const r = runGht(['api', 'x', '--ght-raw'], `echo '{"node_id":"kept"}'`)
  assert.equal(r.status, 0)
  assert.equal(r.stdout, '{"node_id":"kept"}\n')
})

test('--ght-* flags are not forwarded to gh', () => {
  const r = runGht(['api', 'x', '--ght-no-prune'], `echo "[\\"$@\\"]" | tr -d '\\n'; echo ''`)
  assert.equal(r.status, 0)
  assert.doesNotMatch(r.stdout, /ght-no-prune/)
  assert.match(r.stdout, /api x/)
})

test('unknown --ght flag is a usage error', () => {
  const r = runGht(['--ght-bogus'], `echo '{}'`)
  assert.equal(r.status, 2)
  assert.match(r.stderr, /unknown flag/)
})

test('--ght-help prints usage without running gh', () => {
  const r = runGht(['--ght-help'], `echo 'should not run'; exit 9`)
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
  const r = runGht(['api', 'x'], `echo '{"a":1,"node_id":"XXXXXXXXXXXXXXXX"}'`)
  assert.equal(r.status, 0)
  assert.match(r.stderr, /ght: ~\d[\d,]* tokens \(raw gh: ~[\d,]+, -?\d+% saved\)/)
  assert.doesNotMatch(r.stdout, /tokens/)
})

test('no footer on passthrough output', () => {
  const r = runGht(['pr', 'list'], `printf 'no results\\n'`)
  assert.equal(r.stderr, '')
})

test('--ght-no-stats and GHT_STATS=0 suppress the footer', () => {
  const flag = runGht(['api', 'x', '--ght-no-stats'], `echo '{"a":1}'`)
  assert.equal(flag.stderr, '')
  const env = runGht(['api', 'x'], `echo '{"a":1}'`, { GHT_STATS: '0' })
  assert.equal(env.stderr, '')
})

test('GHT_PRUNE=0 env disables pruning', () => {
  const r = runGht(['api', 'x'], `echo '{"node_id":"kept"}'`, { GHT_PRUNE: '0' })
  assert.equal(r.status, 0)
  assert.match(r.stdout, /node_id: kept/)
})
