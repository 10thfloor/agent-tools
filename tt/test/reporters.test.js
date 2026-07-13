import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { reporterKind, reporterArgs, parseReport } from '../src/reporters.js'

function dirWithScript(script) {
  const dir = mkdtempSync(join(tmpdir(), 'tt-rep-'))
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ scripts: { test: script } }))
  return dir
}

test('reporterKind detects vitest/jest in the test script only', () => {
  assert.equal(reporterKind(dirWithScript('vitest run')), 'vitest')
  assert.equal(reporterKind(dirWithScript('jest --coverage')), 'jest')
  assert.equal(reporterKind(dirWithScript('node --test test/*.test.js')), null)
  assert.equal(reporterKind(mkdtempSync(join(tmpdir(), 'tt-rep-empty-'))), null)
})

test('reporterArgs keep the human reporter and write a side file', () => {
  assert.deepEqual(reporterArgs('vitest', '/x/r.json'), ['--', '--reporter=default', '--reporter=json', '--outputFile=/x/r.json'])
  assert.deepEqual(reporterArgs('jest', '/x/r.json'), ['--', '--json', '--outputFile=/x/r.json'])
})

test('parseReport extracts exact counts and failure rows from the jest schema', () => {
  const path = join(mkdtempSync(join(tmpdir(), 'tt-rep-')), 'r.json')
  writeFileSync(path, JSON.stringify({
    numTotalTests: 5,
    numPassedTests: 3,
    numFailedTests: 2,
    testResults: [{
      name: '/proj/src/a.test.ts',
      assertionResults: [
        { status: 'failed', fullName: 'parses empty input', failureMessages: ['AssertionError: expected [] to have length 1\n    at src/a.test.ts:14:3'] },
        { status: 'passed', fullName: 'ok case' },
        { status: 'failed', fullName: 'handles nulls', failureMessages: ['TypeError: boom'] },
      ],
    }],
  }))
  const rep = parseReport(path)
  assert.equal(rep.failed, 2)
  assert.equal(rep.passed, 3)
  assert.equal(rep.failures.length, 2)
  assert.equal(rep.failures[0].head, '✖ parses empty input')
  assert.match(rep.failures[0].message, /a\.test\.ts:14/)
})

test('parseReport rejects missing or non-report JSON', () => {
  assert.equal(parseReport('/nonexistent/r.json'), null)
  const path = join(mkdtempSync(join(tmpdir(), 'tt-rep-')), 'bad.json')
  writeFileSync(path, '{"hello":"world"}')
  assert.equal(parseReport(path), null)
})
