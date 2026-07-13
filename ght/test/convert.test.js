import test from 'node:test'
import assert from 'node:assert/strict'
import { decode } from '@toon-format/toon'
import { convert } from '../src/convert.js'

const opts = (over = {}) => ({ prune: true, delimiter: 'tab', format: 'toon', ...over })

test('non-JSON returns null (passthrough)', () => {
  assert.equal(convert('no pull requests found\n', opts()), null)
})

test('TOON output round-trips losslessly with prune off', () => {
  const data = {
    name: 'cli',
    topics: ['cli', 'github'],
    prs: [
      { number: 1, title: 'fix: a, b', draft: false },
      { number: 2, title: 'feat: c\td', draft: true },
    ],
  }
  const out = convert(JSON.stringify(data), opts({ prune: false }))
  assert.deepEqual(decode(out), data)
})

test('prune is applied before encoding', () => {
  const out = convert('{"a":1,"node_id":"X","events_url":"y"}', opts())
  assert.equal(out.includes('node_id'), false)
  assert.equal(out.includes('events_url'), false)
  assert.deepEqual(decode(out), { a: 1 })
})

test('paginated arrays merge into one table', () => {
  const out = convert('[{"n":1},{"n":2}][{"n":3}]', opts())
  assert.deepEqual(decode(out), [{ n: 1 }, { n: 2 }, { n: 3 }])
})

test('--ght-json yields minified pruned JSON', () => {
  const out = convert('{\n  "a": 1,\n  "node_id": "X"\n}', opts({ format: 'json' }))
  assert.equal(out, '{"a":1}')
})

test('comma delimiter honored', () => {
  const out = convert('[{"a":1,"b":2},{"a":3,"b":4}]', opts({ delimiter: 'comma' }))
  assert.deepEqual(decode(out), [{ a: 1, b: 2 }, { a: 3, b: 4 }])
  assert.match(out, /\{a,b\}/)
})
