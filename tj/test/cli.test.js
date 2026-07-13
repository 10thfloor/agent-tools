import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { decode } from '@toon-format/toon'

const BIN = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'tj.js')

// A cross-platform fake CLI: a `<name>.mjs` the tool runs via node (prepSpawn
// handles that on every OS). The .mjs extension is stripped by profileNameFor,
// so basename-based profile detection still works. `body` is JS with `args`
// and `out()`.
function fakeCli(name, body) {
  const dir = mkdtempSync(join(tmpdir(), 'tj-fake-'))
  const path = join(dir, `${name}.mjs`)
  writeFileSync(path, `const args = process.argv.slice(2)\nconst out = (s) => process.stdout.write(s)\n${body}\n`)
  return path
}

function tj(args, env = {}) {
  return spawnSync(process.execPath, [BIN, ...args], { encoding: 'utf8', env: { ...process.env, ...env } })
}

const POD_JSON = `{"items":[{"metadata":{"name":"api-1","managedFields":[{"m":1}],"annotations":{"kubectl.kubernetes.io/last-applied-configuration":"BLOB","team":"core"}},"status":{"phase":"Running"}}]}`

test('kubectl basename triggers kubernetes profile', () => {
  const kubectl = fakeCli('kubectl', `out(${JSON.stringify(POD_JSON + '\n')})`)
  const r = tj([kubectl, 'get', 'pods', '-o', 'json'])
  assert.equal(r.status, 0)
  assert.doesNotMatch(r.stdout, /managedFields|BLOB/)
  assert.match(r.stdout, /api-1/)
  assert.match(r.stderr, /profile: kubernetes/)
  const data = decode(r.stdout)
  assert.equal(data.items[0].metadata.annotations.team, 'core')
})

test('gh basename triggers github profile with entity collapse', () => {
  const gh = fakeCli('gh', `out('[{"number":5,"user":{"login":"octo","id":1},"node_id":"X","html_url":"h"}]\\n')`)
  const r = tj([gh, 'api', 'repos/o/r/issues'])
  assert.equal(r.status, 0)
  const rows = decode(r.stdout)
  assert.deepEqual(rows, [{ number: 5, user: 'octo', html_url: 'h' }])
})

test('unknown command falls back to generic (no pruning), --tj-profile overrides', () => {
  const mystery = fakeCli('mystery', `out('{"node_id":"kept"}\\n')`)
  const generic = tj([mystery])
  assert.match(generic.stdout, /node_id: kept/)
  const forced = tj(['--tj-profile=github', mystery])
  assert.equal(forced.stdout.trim(), '')
})

test('non-JSON output passes through byte-for-byte', () => {
  const plain = fakeCli('plain', `out('just some text\\n')`)
  const r = tj([plain])
  assert.equal(r.stdout, 'just some text\n')
  assert.equal(r.stderr, '')
})

test('non-zero exit: output untransformed, code propagated', () => {
  const bad = fakeCli('bad', `out('{"message":"boom"}\\n'); process.exit(3)`)
  const r = tj([bad])
  assert.equal(r.status, 3)
  assert.equal(r.stdout, '{"message":"boom"}\n')
})

test('--tj-raw and --tj-json modes', () => {
  const gh = fakeCli('gh', `out('{"node_id":"raw-kept"}\\n')`)
  assert.match(tj([gh, '--tj-raw']).stdout, /"node_id":"raw-kept"/)
  const j = tj([gh, '--tj-json', 'x'])
  assert.equal(j.stdout.trim(), '{}')
})

test('TJ_STATS=0 suppresses the footer; usage errors exit 2', () => {
  const gh = fakeCli('gh', `out('{"a":1}\\n')`)
  assert.equal(tj([gh], { TJ_STATS: '0' }).stderr, '')
  assert.equal(tj(['--tj-bogus']).status, 2)
  assert.equal(tj([]).status, 2)
})
