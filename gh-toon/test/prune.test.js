import test from 'node:test'
import assert from 'node:assert/strict'
import { prune } from '../src/prune.js'

test('drops hypermedia noise, keeps url and html_url', () => {
  const issue = {
    number: 42,
    url: 'https://api.github.com/repos/o/r/issues/42',
    html_url: 'https://github.com/o/r/issues/42',
    labels_url: 'https://api.github.com/repos/o/r/issues/42/labels{/name}',
    comments_url: 'https://api.github.com/repos/o/r/issues/42/comments',
    node_id: 'I_kwDO',
    _links: { self: 'x' },
    performed_via_github_app: null,
  }
  assert.deepEqual(prune(issue), {
    number: 42,
    url: 'https://api.github.com/repos/o/r/issues/42',
    html_url: 'https://github.com/o/r/issues/42',
  })
})

test('embedded user objects collapse to login, repos to full_name', () => {
  const pr = {
    number: 1,
    user: { login: 'octocat', id: 1, type: 'User', site_admin: false },
    head: { ref: 'feat', repo: { id: 9, full_name: 'octocat/fork', private: false } },
  }
  assert.deepEqual(prune(pr), {
    number: 1,
    user: 'octocat',
    head: { ref: 'feat', repo: 'octocat/fork' },
  })
})

test('root value is never collapsed', () => {
  const repo = { full_name: 'cli/cli', stargazers_count: 5, owner: { login: 'cli', id: 1 } }
  assert.deepEqual(prune(repo), { full_name: 'cli/cli', stargazers_count: 5, owner: 'cli' })
  const user = { login: 'octocat', followers: 3 }
  assert.deepEqual(prune(user), { login: 'octocat', followers: 3 })
})

test('label arrays join into one string, keeping rows tabular', () => {
  const issue = {
    labels: [
      { id: 1, name: 'bug', color: 'ee0701', description: null },
      { id: 2, name: 'help wanted', color: '159818', description: 'x' },
    ],
    assignees: [{ login: 'a', id: 1 }, { login: 'b', id: 2 }],
  }
  assert.deepEqual(prune(issue), { labels: 'bug, help wanted', assignees: 'a, b' })
})

test('primitive string arrays stay arrays', () => {
  assert.deepEqual(prune({ topics: ['cli', 'github'] }), { topics: ['cli', 'github'] })
})

test('empty arrays become empty string below the root, stay arrays at root', () => {
  assert.deepEqual(prune({ labels: [] }), { labels: '' })
  assert.deepEqual(prune([]), [])
})

test('mixed arrays stay arrays', () => {
  assert.deepEqual(prune({ x: [{ login: 'a' }, { other: 1 }] }), { x: ['a', { other: 1 }] })
})

test('commit verification keeps only verified and reason', () => {
  const commit = {
    verification: { verified: true, reason: 'valid', signature: '-----BEGIN PGP...', payload: 'tree...' },
  }
  assert.deepEqual(prune(commit), { verification: { verified: true, reason: 'valid' } })
})

test('recurses into arrays and leaves primitives alone', () => {
  assert.deepEqual(prune([{ a: 1, b_url: 'x' }, 'str', null, 7]), [{ a: 1 }, 'str', null, 7])
})

test('camelCase gh --json fields are untouched', () => {
  const pr = { number: 1, headRefName: 'feat', isDraft: false, createdAt: '2026-01-01T00:00:00Z' }
  assert.deepEqual(prune(pr), pr)
})
