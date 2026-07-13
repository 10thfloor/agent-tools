import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, existsSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadConfig, writeTemplate } from '../src/config.js'
import { savedPct, aggregate } from '../src/run.js'
import { parseArgs } from '../src/cli.js'

const tmp = () => mkdtempSync(join(tmpdir(), 'bench-'))

test('savedPct: one-decimal percentage, guards divide-by-zero', () => {
  assert.equal(savedPct(1000, 250), 75)
  assert.equal(savedPct(1000, 900), 10)
  assert.equal(savedPct(100, 130), -30) // candidate bigger → negative
  assert.equal(savedPct(0, 0), 0)
})

test('aggregate: totals only measured scenarios, counts failures', () => {
  const agg = aggregate([
    { ok: true, baselineTokens: 1000, candidateTokens: 400 },
    { ok: true, baselineTokens: 1000, candidateTokens: 600 },
    { ok: false, error: 'boom' },
  ])
  assert.equal(agg.scenarios, 3)
  assert.equal(agg.measured, 2)
  assert.equal(agg.failed, 1)
  assert.equal(agg.baselineTokens, 2000)
  assert.equal(agg.candidateTokens, 1000)
  assert.equal(agg.savedPct, 50)
})

test('loadConfig: rejects shell strings and malformed scenarios', () => {
  const dir = tmp()
  const path = join(dir, 'bench.json')
  const write = (obj) => writeFileSync(path, JSON.stringify(obj))

  write({ scenarios: [{ name: 'x', baseline: 'gh pr list', candidate: ['ght', 'pr', 'list'] }] })
  assert.throws(() => loadConfig(path), /argv array of strings \(no shell strings\)/)

  write({ scenarios: [{ name: 'x', baseline: ['gh'], candidate: [] }] })
  assert.throws(() => loadConfig(path), /"candidate" must be a non-empty argv/)

  write({ scenarios: [{ baseline: ['a'], candidate: ['b'] }] })
  assert.throws(() => loadConfig(path), /needs a "name"/)

  write({ scenarios: [] })
  assert.throws(() => loadConfig(path), /non-empty "scenarios"/)

  assert.throws(() => loadConfig(join(dir, 'nope.json')), /run `bench init`/)
})

test('loadConfig: accepts valid scenarios and defaults ignoreExit', () => {
  const path = join(tmp(), 'bench.json')
  writeFileSync(path, JSON.stringify({ scenarios: [{ name: 'ok', baseline: ['gh', 'x'], candidate: ['ght', 'x'] }] }))
  assert.deepEqual(loadConfig(path), [{ name: 'ok', baseline: ['gh', 'x'], candidate: ['ght', 'x'], ignoreExit: false }])
})

test('writeTemplate: refuses to clobber without --force', () => {
  const path = join(tmp(), 'bench.json')
  writeTemplate(path, false)
  assert.equal(existsSync(path), true)
  assert.throws(() => writeTemplate(path, false), /already exists/)
  writeTemplate(path, true) // force overwrites
})

test('parseArgs: flags and validation', () => {
  assert.deepEqual(parseArgs(['run', 'x.json']).pos, ['run', 'x.json'])
  assert.equal(parseArgs(['--min-saved=50']).flags.minSaved, 50)
  assert.throws(() => parseArgs(['--min-saved=lots']), /needs a number/)
  assert.throws(() => parseArgs(['--enc=bogus']), /unknown encoding/)
  assert.throws(() => parseArgs(['--wat']), /unknown flag/)
})
