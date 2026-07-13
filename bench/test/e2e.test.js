import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { decode } from '@toon-format/toon'

const BIN = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'bench.js')

// A fake command: a .mjs (prepSpawn runs it via node on any OS) that prints
// `reps` copies of a line, then exits `code`.
function fakeCmd(dir, name, reps, code = 0) {
  const path = join(dir, `${name}.mjs`)
  writeFileSync(path, `for (let i = 0; i < ${reps}; i++) process.stdout.write('lorem ipsum dolor sit amet ' + i + '\\n')\nprocess.exit(${code})\n`)
  return [path] // argv array of one element; prepSpawn → [node, [path]]
}

function bench(args, cwd) {
  return spawnSync(process.execPath, [BIN, ...args], { cwd, encoding: 'utf8' })
}

test('init writes a template, refuses to clobber without --force', () => {
  const dir = mkdtempSync(join(tmpdir(), 'bench-init-'))
  const r = bench(['init'], dir)
  assert.equal(r.status, 0)
  assert.equal(existsSync(join(dir, 'bench.json')), true)
  assert.match(JSON.parse(readFileSync(join(dir, 'bench.json'), 'utf8')).scenarios[0].candidate[0], /ght/)
  assert.equal(bench(['init'], dir).status, 2) // exists → refuse
  assert.equal(bench(['init', '--force'], dir).status, 0)
})

test('measures savings: big baseline vs small candidate, TOON when piped', () => {
  const dir = mkdtempSync(join(tmpdir(), 'bench-e2e-'))
  const scenarios = [{ name: 'shrink', baseline: fakeCmd(dir, 'big', 40), candidate: fakeCmd(dir, 'small', 4) }]
  writeFileSync(join(dir, 'bench.json'), JSON.stringify({ scenarios }))
  const r = bench([], dir)
  assert.equal(r.status, 0)
  const out = decode(r.stdout)
  assert.equal(out.scenarios[0].ok, true)
  assert.equal(out.summary.baselineTokens > out.summary.candidateTokens, true)
  assert.equal(out.summary.savedPct > 50, true)
  assert.match(r.stderr, /% saved across 1 scenario/)
})

test('--min-saved gate fails when savings fall short', () => {
  const dir = mkdtempSync(join(tmpdir(), 'bench-e2e-'))
  const scenarios = [{ name: 'tiny', baseline: fakeCmd(dir, 'b', 10), candidate: fakeCmd(dir, 'c', 9) }]
  writeFileSync(join(dir, 'bench.json'), JSON.stringify({ scenarios }))
  const r = bench(['--min-saved=90'], dir)
  assert.equal(r.status, 1)
  assert.match(r.stderr, /BELOW --min-saved=90/)
})

test('a non-zero exit fails the scenario unless ignoreExit is set', () => {
  const dir = mkdtempSync(join(tmpdir(), 'bench-e2e-'))
  const strict = [{ name: 'red', baseline: fakeCmd(dir, 'ok', 20), candidate: fakeCmd(dir, 'bad', 3, 1) }]
  writeFileSync(join(dir, 'bench.json'), JSON.stringify({ scenarios: strict }))
  const r1 = bench(['--json'], dir)
  assert.equal(r1.status, 1)
  assert.equal(JSON.parse(r1.stdout).scenarios[0].ok, false)
  assert.match(JSON.parse(r1.stdout).scenarios[0].error, /candidate: exit 1/)

  const lenient = [{ name: 'red-ok', baseline: fakeCmd(dir, 'ok2', 20), candidate: fakeCmd(dir, 'bad2', 3, 1), ignoreExit: true }]
  writeFileSync(join(dir, 'bench.json'), JSON.stringify({ scenarios: lenient }))
  const r2 = bench(['--json'], dir)
  assert.equal(r2.status, 0)
  assert.equal(JSON.parse(r2.stdout).scenarios[0].ok, true)
})

test('--md writes a Markdown report', () => {
  const dir = mkdtempSync(join(tmpdir(), 'bench-e2e-'))
  const scenarios = [{ name: 'doc', baseline: fakeCmd(dir, 'b', 30), candidate: fakeCmd(dir, 'c', 5) }]
  writeFileSync(join(dir, 'bench.json'), JSON.stringify({ scenarios }))
  const r = bench(['--md=report.md'], dir)
  assert.equal(r.status, 0)
  const md = readFileSync(join(dir, 'report.md'), 'utf8')
  assert.match(md, /# bench results/)
  assert.match(md, /\| doc \|/)
  assert.match(md, /\*\*Total\*\*/)
})

test('missing bench.json is a friendly config error', () => {
  const r = bench([], mkdtempSync(join(tmpdir(), 'bench-empty-')))
  assert.equal(r.status, 2)
  assert.match(r.stderr, /run `bench init`/)
})
