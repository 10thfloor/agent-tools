import test from 'node:test'
import assert from 'node:assert/strict'
import { stripAnsi, extractFailures, extractSummary, condense, fullFailure } from '../src/condense.js'

const NODE_OUT = `✔ adds numbers (1.2ms)
✖ subtracts numbers (3.4ms)
  AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:
  actual: 2
  expected: 3
      at TestContext.<anonymous> (file:///proj/test/math.test.js:9:10)

✔ multiplies (0.4ms)
ℹ tests 3
ℹ pass 2
ℹ fail 1
`

const VITEST_OUT = ` ✓ src/a.test.ts (3)
 ✗ src/b.test.ts > parses empty input
   AssertionError: expected [] to have a length of 1
    ❯ src/b.test.ts:14:23

 Tests  1 failed | 3 passed (4)
`

const PYTEST_OUT = `____________________ test_refund_flow ____________________
E       assert resp.status == 200
E       +  where 402 = <Response>.status
tests/test_refunds.py:31: AssertionError
=================== 1 failed, 7 passed in 0.42s ===================
`

test('stripAnsi removes color codes', () => {
  assert.equal(stripAnsi('\x1b[31mFAIL\x1b[0m ok'), 'FAIL ok')
})

test('node:test output: failure block and counts', () => {
  const { failures } = extractFailures(NODE_OUT)
  assert.equal(failures.length, 1)
  assert.match(failures[0].head, /✖ subtracts numbers/)
  assert.match(failures[0].detail, /strictly equal/)
  assert.match(failures[0].detail, /math\.test\.js:9/)
  assert.deepEqual(extractSummary(NODE_OUT), { runner: 'node:test', failed: 1, passed: 2 })
})

test('node:test TAP output (piped default): not-ok block and # counts', () => {
  const tap = `TAP version 13
ok 1 - passes
not ok 2 - subtracts numbers
  ---
  error: 'Expected values to be strictly equal:'
  code: 'ERR_ASSERTION'
  name: 'AssertionError'
  ...
1..2
# tests 2
# pass 1
# fail 1
`
  const { failures } = extractFailures(tap)
  assert.equal(failures.length, 1)
  assert.match(failures[0].head, /subtracts numbers/)
  assert.deepEqual(extractSummary(tap), { runner: 'node:test', failed: 1, passed: 1 })
})

test('vitest output: failure block and counts', () => {
  const { failures } = extractFailures(VITEST_OUT)
  assert.equal(failures.length, 1)
  assert.match(failures[0].head, /parses empty input/)
  assert.deepEqual(extractSummary(VITEST_OUT), { runner: 'vitest/jest', failed: 1, passed: 3 })
})

test('pytest output: section header block and counts', () => {
  const { failures } = extractFailures(PYTEST_OUT)
  assert.equal(failures.length, 1)
  assert.match(failures[0].head, /test_refund_flow/)
  assert.match(failures[0].detail, /assert resp.status == 200/)
  assert.deepEqual(extractSummary(PYTEST_OUT), { runner: 'pytest', failed: 1, passed: 7 })
})

test('jest: per-file FAIL badge does not double-count the per-test block', () => {
  const out = `FAIL src/math.test.js
  ● subtract › handles negatives

    expect(received).toBe(expected)

Tests:       1 failed, 2 passed, 3 total`
  const { failures } = extractFailures(out)
  assert.equal(failures.length, 1) // the ● block only, not the FAIL badge
  assert.match(failures[0].head, /handles negatives/)
  assert.deepEqual(extractSummary(out), { runner: 'vitest/jest', failed: 1, passed: 2 })
})

test('pytest: short-summary FAILED line does not double-count the section block', () => {
  const out = `____________________ test_refund ____________________
E   assert 402 == 200
tests/t.py:9: AssertionError
=========================== short test summary ===========================
FAILED tests/t.py::test_refund - assert 402 == 200
=================== 1 failed, 3 passed in 0.10s ===================`
  const { failures } = extractFailures(out)
  assert.equal(failures.length, 1)
  assert.deepEqual(extractSummary(out), { runner: 'pytest', failed: 1, passed: 3 })
})

test('cargo: result line and failure detail block are parsed', () => {
  const out = `---- tests::refund stdout ----
thread 'tests::refund' panicked at 'assertion failed'

failures:
    tests::refund

test result: FAILED. 4 passed; 1 failed; 0 ignored`
  const { failures } = extractFailures(out)
  assert.match(failures[0].head, /tests::refund/)
  assert.deepEqual(extractSummary(out), { runner: 'cargo', failed: 1, passed: 4 })
})

test('all-failing vitest/pytest summaries (zero passing) still parse', () => {
  assert.deepEqual(extractSummary('Tests  3 failed (3)'), { runner: 'vitest/jest', failed: 3, passed: 0 })
  assert.deepEqual(extractSummary('=== 2 failed in 0.3s ==='), { runner: 'pytest', failed: 2, passed: 0 })
})

test('vitest v1 × marker is recognized', () => {
  const { failures } = extractFailures('  × src/a.test.ts > breaks\n    AssertionError\n')
  assert.equal(failures.length, 1)
  assert.match(failures[0].head, /breaks/)
})

test('go output: FAIL marker captured, unknown summary falls back to block count', () => {
  const out = `--- FAIL: TestRefund (0.03s)
    refund_test.go:22: got 402, want 200
FAIL
exit status 1
`
  const report = condense(out, 1, 'go test ./...')
  assert.equal(report.summary.failed >= 1, true)
  assert.match(report.failures[0].head, /TestRefund/)
})

test('passing run condenses to zero failures', () => {
  const report = condense('✔ all good (1ms)\nℹ tests 1\nℹ pass 1\nℹ fail 0\n', 0, 'npm test')
  assert.equal(report.summary.failed, 0)
  assert.equal(report.failures.length, 0)
})

test('fullFailure returns the complete uncapped block, out-of-range is null', () => {
  const stack = Array.from({ length: 30 }, (_, i) => `      at frame${i} (file.js:${i}:1)`).join('\n')
  const out = `✖ deep failure (9ms)\n  AssertionError: nope\n${stack}\n\n✔ fine (1ms)\n`
  const block = fullFailure(out, 1)
  assert.match(block, /^✖ deep failure/)
  assert.match(block, /frame25/) // beyond the 8-line condensed cap
  assert.equal(block.includes(' | '), false) // real lines, not joined
  assert.equal(fullFailure(out, 2), null)
})

test('maxBlocks caps rows and reports truncation', () => {
  const out = Array.from({ length: 5 }, (_, i) => `✖ t${i}\n  boom\n`).join('\n')
  const report = condense(out, 1, 'x', { maxBlocks: 2 })
  assert.equal(report.failures.length, 2)
  assert.equal(report.summary.truncatedFailures, 3)
})
