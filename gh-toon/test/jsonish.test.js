import test from 'node:test'
import assert from 'node:assert/strict'
import { parseJsonValues, mergeValues } from '../src/jsonish.js'

test('single object', () => {
  assert.deepEqual(parseJsonValues('{"a":1}'), [{ a: 1 }])
})

test('single array with surrounding whitespace', () => {
  assert.deepEqual(parseJsonValues('\n [1,2,3] \n'), [[1, 2, 3]])
})

test('concatenated arrays (gh api --paginate)', () => {
  assert.deepEqual(parseJsonValues('[1,2][3][]'), [[1, 2], [3], []])
})

test('NDJSON objects', () => {
  assert.deepEqual(parseJsonValues('{"a":1}\n{"a":2}\n'), [{ a: 1 }, { a: 2 }])
})

test('braces inside strings do not confuse the scanner', () => {
  assert.deepEqual(parseJsonValues('{"a":"}{\\"["}{"b":1}'), [{ a: '}{"[' }, { b: 1 }])
})

test('non-JSON text returns null', () => {
  assert.equal(parseJsonValues('Showing 3 of 3 pull requests\n'), null)
  assert.equal(parseJsonValues(''), null)
  assert.equal(parseJsonValues('"just a string"'), null)
  assert.equal(parseJsonValues('42'), null)
})

test('truncated JSON returns null', () => {
  assert.equal(parseJsonValues('{"a": [1, 2'), null)
})

test('JSON followed by garbage returns null', () => {
  assert.equal(parseJsonValues('{"a":1} trailing text'), null)
})

test('mergeValues flattens uniform arrays, keeps mixed values as list', () => {
  assert.deepEqual(mergeValues([[1], [2, 3]]), [1, 2, 3])
  assert.deepEqual(mergeValues([{ a: 1 }]), { a: 1 })
  assert.deepEqual(mergeValues([{ a: 1 }, [2]]), [{ a: 1 }, [2]])
})
