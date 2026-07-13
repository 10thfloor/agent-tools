import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { decode } from '@toon-format/toon'
import { parseBudget } from '../src/count.js'

const BIN = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'tok.js')

const tok = (args, opts = {}) => spawnSync(process.execPath, [BIN, ...args], { encoding: 'utf8', ...opts })

test('parseBudget accepts n, Nk, N.Nk, Nm', () => {
  assert.equal(parseBudget('800'), 800)
  assert.equal(parseBudget('5k'), 5000)
  assert.equal(parseBudget('1.5K'), 1500)
  assert.equal(parseBudget('2m'), 2000000)
  assert.equal(parseBudget('lots'), null)
})

test('counts files, reports totals, piped output is TOON', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tok-'))
  writeFileSync(join(dir, 'a.md'), 'hello agent world\n')
  writeFileSync(join(dir, 'b.md'), 'hello agent world\nhello agent world\n')
  const r = tok([join(dir, 'a.md'), join(dir, 'b.md')])
  assert.equal(r.status, 0)
  const report = decode(r.stdout)
  const [a, b] = report.inputs
  assert.equal(a.tokens > 0, true)
  assert.equal(b.tokens > a.tokens, true)
  assert.equal(b.bytes, 36)
  assert.equal(report.summary.total, a.tokens + b.tokens)
  assert.equal(report.summary.encoding, 'o200k_base')
})

test('--max gates the exit code per input', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tok-'))
  writeFileSync(join(dir, 'big.md'), 'word '.repeat(200))
  writeFileSync(join(dir, 'small.md'), 'ok\n')
  const r = tok(['--max=50', join(dir, 'big.md'), join(dir, 'small.md')])
  assert.equal(r.status, 1)
  const report = decode(r.stdout)
  assert.equal(report.summary.over, 1)
  assert.equal(report.inputs[0].over, true)
  assert.equal(report.inputs[1].over, false)
  assert.equal(tok(['--max=10k', join(dir, 'big.md')]).status, 0)
})

test('command mode counts stdout of -- command', () => {
  const r = tok(['--', 'node', '-e', 'console.log("five tokens maybe")'])
  assert.equal(r.status, 0)
  const report = decode(r.stdout)
  assert.equal(report.inputs[0].name.includes('node -e'), true)
  assert.equal(report.inputs[0].tokens > 0, true)
})

test('stdin mode when piped with no files', () => {
  const r = tok([], { input: 'count me please\n' })
  assert.equal(r.status, 0)
  const report = decode(r.stdout)
  assert.equal(report.inputs[0].name, '(stdin)')
  assert.equal(report.inputs[0].tokens > 0, true)
})

test('directories and binary files are skipped with notes', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tok-'))
  mkdirSync(join(dir, 'sub'))
  writeFileSync(join(dir, 'bin.dat'), Buffer.from([0, 1, 2, 3]))
  writeFileSync(join(dir, 'ok.md'), 'fine\n')
  const r = tok([join(dir, 'sub'), join(dir, 'bin.dat'), join(dir, 'ok.md')])
  assert.equal(r.status, 0)
  assert.match(r.stderr, /skipping directory/)
  assert.match(r.stderr, /skipping binary/)
  assert.equal(decode(r.stdout).inputs.length, 1)
})

test('--pack re-encodes a JSON file as TOON, losslessly', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tok-'))
  const data = { repo: 'cli/cli', users: [{ id: 1, name: 'a' }, { id: 2, name: 'b' }], topics: ['x', 'y'] }
  writeFileSync(join(dir, 'd.json'), JSON.stringify(data, null, 2))
  const r = tok(['--pack', join(dir, 'd.json')])
  assert.equal(r.status, 0)
  assert.deepEqual(decode(r.stdout), data)
  assert.match(r.stderr, /\d+ → \d+ tokens .*% saved, o200k_base\); round-trip: verified/)
})

test('--pack works on stdin and command mode', () => {
  const viaStdin = tok(['--pack'], { input: '{"a":1,"b":[2,3]}' })
  assert.deepEqual(decode(viaStdin.stdout), { a: 1, b: [2, 3] })
  const viaCmd = tok(['--pack', '--', 'node', '-e', 'console.log(JSON.stringify({ok:true}))'])
  assert.deepEqual(decode(viaCmd.stdout), { ok: true })
})

test('--pack refuses non-JSON and multiple inputs', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tok-'))
  writeFileSync(join(dir, 'a.md'), 'prose\n')
  writeFileSync(join(dir, 'b.json'), '{}')
  const prose = tok(['--pack', join(dir, 'a.md')])
  assert.equal(prose.status, 1)
  assert.match(prose.stderr, /not JSON/)
  const two = tok(['--pack', join(dir, 'a.md'), join(dir, 'b.json')])
  assert.equal(two.status, 2)
  assert.match(two.stderr, /exactly one input/)
})

test('--pack still emits when only the upstream decoder chokes (markdown links)', () => {
  const r = tok(['--pack'], { input: JSON.stringify({ body: 'see [docs](https://x.dev) for details' }) })
  assert.equal(r.status, 0)
  assert.match(r.stdout, /docs/)
  assert.match(r.stderr, /round-trip: skipped \(known upstream decoder issue\)/)
})

test('cl100k encoding selectable; bad flags exit 2', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tok-'))
  writeFileSync(join(dir, 'a.md'), 'hello\n')
  const r = tok(['--enc=cl100k', join(dir, 'a.md')])
  assert.equal(decode(r.stdout).summary.encoding, 'cl100k_base')
  assert.equal(tok(['--enc=bogus', join(dir, 'a.md')]).status, 2)
  assert.equal(tok(['--wat']).status, 2)
})
