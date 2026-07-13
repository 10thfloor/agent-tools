import test from 'node:test'
import assert from 'node:assert/strict'
import { parseWorktreeList, slug, findWorktree, worktreeAt } from '../src/worktrees.js'
import { deriveActivity, autoSummary, EMPTY_WORK } from '../src/signals.js'
import { parseArgv } from '../src/cli.js'

const PORCELAIN = `worktree /Users/x/proj
HEAD 1111111111111111111111111111111111111111
branch refs/heads/main

worktree /Users/x/proj.worktrees/feat-a
HEAD 2222222222222222222222222222222222222222
branch refs/heads/feat/a
locked agent in progress

worktree /Users/x/proj.worktrees/spike
HEAD 3333333333333333333333333333333333333333
detached

worktree /Users/x/proj.worktrees/gone
HEAD 4444444444444444444444444444444444444444
branch refs/heads/gone
prunable gitdir file points to non-existent location
`

test('parseWorktreeList: main flag, branches, locked, detached, prunable', () => {
  const items = parseWorktreeList(PORCELAIN)
  assert.equal(items.length, 4)
  assert.equal(items[0].isMain, true)
  assert.equal(items[0].branch, 'main')
  assert.equal(items[1].branch, 'feat/a')
  assert.equal(items[1].locked, true)
  assert.equal(items[1].isMain, false)
  assert.equal(items[2].detached, true)
  assert.equal(items[2].branch, null)
  assert.equal(items[3].prunable, true)
})

test('slug flattens branch names to safe directory names', () => {
  assert.equal(slug('feat/list-view'), 'feat-list-view')
  assert.equal(slug('release/v1.2.3'), 'release-v1.2.3')
  assert.equal(slug('//weird branch//'), 'weird-branch')
})

test('findWorktree matches branch, path, and basename', () => {
  const items = parseWorktreeList(PORCELAIN)
  assert.equal(findWorktree(items, 'feat/a'), items[1])
  assert.equal(findWorktree(items, '/Users/x/proj.worktrees/spike'), items[2])
  assert.equal(findWorktree(items, 'gone'), items[3])
  assert.equal(findWorktree(items, 'nope'), undefined)
})

const idleWt = { path: '/w/a', locked: false }
const cleanWork = { dirty: 0, ahead: 0, behind: 0 }

test('deriveActivity: idle when no signals', () => {
  assert.deepEqual(deriveActivity(idleWt, cleanWork, undefined, []), { active: false, reasons: [] })
})

test('deriveActivity: each signal reported', () => {
  assert.deepEqual(deriveActivity(idleWt, { dirty: 3, ahead: 2, behind: 0 }, undefined, []).reasons, ['dirty:3', 'unpushed:2'])
  assert.deepEqual(deriveActivity(idleWt, cleanWork, { number: 7, isDraft: true }, []).reasons, ['pr:#7(draft)'])
  assert.deepEqual(deriveActivity(idleWt, cleanWork, undefined, ['/w/a/sub']).reasons, ['agent'])
  assert.deepEqual(deriveActivity({ ...idleWt, locked: true }, cleanWork, undefined, []).reasons, ['locked'])
})

test('deriveActivity: sibling path prefixes do not count as agent', () => {
  assert.equal(deriveActivity(idleWt, cleanWork, undefined, ['/w/abc']).active, false)
})

test('parseArgv: commands, flags, --from forms', () => {
  assert.deepEqual(parseArgv(['new', 'x', '--from', 'main']), { pos: ['new', 'x'], flags: { from: 'main' } })
  assert.deepEqual(parseArgv(['new', 'x', '--from=main']).flags, { from: 'main' })
  assert.deepEqual(parseArgv(['rm', 'x', '-f']).flags, { force: true })
  assert.throws(() => parseArgv(['--bogus']), /unknown flag/)
})

test('parseArgv: note flag forms', () => {
  assert.deepEqual(parseArgv(['new', '-m', 'auth spike']).flags, { note: 'auth spike' })
  assert.deepEqual(parseArgv(['new', 'x', '--note=spike']).flags, { note: 'spike' })
  assert.deepEqual(parseArgv(['new', '--note', 'spike']).flags, { note: 'spike' })
})

test('parseArgv: --pr forms', () => {
  assert.deepEqual(parseArgv(['new', '--pr', '1234']).flags, { pr: '1234' })
  assert.deepEqual(parseArgv(['new', '--pr=1234']).flags, { pr: '1234' })
})

test('parseArgv: a value flag with no value is a usage error, not a dropped flag', () => {
  assert.throws(() => parseArgv(['new', '--pr']), /requires a value/)
  assert.throws(() => parseArgv(['new', 'x', '--from']), /requires a value/)
})

test('worktreeAt picks the deepest containing worktree', () => {
  const items = parseWorktreeList(PORCELAIN)
  const nested = { ...items[1], path: '/Users/x/proj/.claude/worktrees/inner' }
  const all = [...items, nested]
  assert.equal(worktreeAt(all, '/Users/x/proj/src'), items[0])
  assert.equal(worktreeAt(all, '/Users/x/proj/.claude/worktrees/inner/src'), nested)
  assert.equal(worktreeAt(all, '/elsewhere'), undefined)
})

test('autoSummary: generated one-liners per state', () => {
  const wt = { path: '/w/a', locked: false, prunable: false, isMain: false }
  assert.equal(autoSummary(wt, EMPTY_WORK), 'no work yet')
  assert.equal(
    autoSummary(wt, { ...EMPTY_WORK, dirty: 3, files: ['src/a.js', 'src/b.js', 'test/c.js'], shortstat: '+42/-7' }),
    'editing src, test (3 files +42/-7)',
  )
  assert.equal(
    autoSummary(wt, { ...EMPTY_WORK, dirty: 1, files: ['README.md'], shortstat: '' }),
    'editing . (1 file)',
  )
  assert.equal(
    autoSummary(wt, { ...EMPTY_WORK, commitsAhead: 2, lastSubject: 'fix tokens' }),
    '2 commits, last: fix tokens',
  )
  assert.equal(autoSummary({ ...wt, isMain: true }, { ...EMPTY_WORK, lastSubject: 'init' }), 'at: init')
  assert.equal(autoSummary({ ...wt, prunable: true }, EMPTY_WORK), 'stale (directory missing)')
})
