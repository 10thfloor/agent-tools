import test from 'node:test'
import assert from 'node:assert/strict'
import { PROFILES, profileNameFor, prune } from '../src/profiles.js'
import { parseJsonValues, mergeValues } from '../src/jsonish.js'

test('profileNameFor maps command basenames, paths included', () => {
  assert.equal(profileNameFor('gh'), 'github')
  assert.equal(profileNameFor('/opt/homebrew/bin/kubectl'), 'kubernetes')
  assert.equal(profileNameFor('oc'), 'kubernetes')
  assert.equal(profileNameFor('aws'), 'aws')
  assert.equal(profileNameFor('vercel'), 'generic')
})

test('github profile: url pruning + entity collapsing (ght parity)', () => {
  const issue = {
    number: 1,
    labels_url: 'x',
    node_id: 'X',
    html_url: 'h',
    user: { login: 'octocat', id: 1 },
    labels: [{ id: 1, name: 'bug', color: 'f00' }],
    assignees: [],
    verification: { verified: true, reason: 'valid', signature: 'PGP...' },
  }
  assert.deepEqual(prune(issue, PROFILES.github), {
    number: 1,
    html_url: 'h',
    user: 'octocat',
    labels: 'bug',
    assignees: '',
    verification: { verified: true, reason: 'valid' },
  })
})

test('kubernetes profile: managedFields, selfLink, last-applied annotation dropped', () => {
  const pod = {
    metadata: {
      name: 'api-7f9',
      selfLink: '/api/v1/x',
      managedFields: [{ manager: 'kubectl', operation: 'Apply' }],
      annotations: {
        'kubectl.kubernetes.io/last-applied-configuration': '{"huge":"blob"}',
        'team': 'core',
      },
    },
    status: { phase: 'Running' },
  }
  assert.deepEqual(prune(pod, PROFILES.kubernetes), {
    metadata: { name: 'api-7f9', annotations: { team: 'core' } },
    status: { phase: 'Running' },
  })
})

test('kubernetes profile: annotations removed entirely when only noise remains', () => {
  const obj = { metadata: { annotations: { 'kubectl.kubernetes.io/last-applied-configuration': 'x' } } }
  assert.deepEqual(prune(obj, PROFILES.kubernetes), { metadata: {} })
})

test('aws profile drops ResponseMetadata only', () => {
  const resp = { Reservations: [{ InstanceId: 'i-1' }], ResponseMetadata: { RequestId: 'r' } }
  assert.deepEqual(prune(resp, PROFILES.aws), { Reservations: [{ InstanceId: 'i-1' }] })
})

test('generic profile leaves data untouched', () => {
  const data = { node_id: 'kept', managedFields: [1], user: { login: 'kept-shape' } }
  assert.deepEqual(prune(data, PROFILES.generic), data)
})

test('jsonish port: concatenated values and NDJSON still parse', () => {
  assert.deepEqual(mergeValues(parseJsonValues('[1][2,3]')), [1, 2, 3])
  assert.deepEqual(parseJsonValues('{"a":1}\n{"a":2}'), [{ a: 1 }, { a: 2 }])
  assert.equal(parseJsonValues('plain text'), null)
})
