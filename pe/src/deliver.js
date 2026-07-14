import { spawnSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { prepSpawn } from './spawn.js'

const run = (bin, args, opts = {}) =>
  spawnSync(...prepSpawn(bin, args, { encoding: 'utf8', ...opts }))

// Delivery is harness-owned end to end: push the branch, open a draft PR,
// flip to ready only when policy allows. The agent never touches any of it.
export function push({ git, wt, branch }) {
  const r = run(git, ['-C', wt, 'push', '-u', 'origin', branch])
  return r.status === 0 ? null : (r.stderr || `git push exited ${r.status}`)
}

export function createPr({ ght, wt, title, bodyPath, base }) {
  const r = run(ght, ['pr', 'create', '--draft', '--title', title, '--base', base, '--body-file', bodyPath], { cwd: wt })
  if (r.status !== 0) return { error: r.stderr || `pr create exited ${r.status}` }
  const url = (r.stdout.match(/https?:\/\/\S+/) ?? [''])[0]
  const number = Number((url.match(/\/pull\/(\d+)/) ?? [])[1] ?? 0) || null
  return { url: url || null, number }
}

export function readyPr({ ght, wt, number, url }) {
  const ref = number ? String(number) : url
  const r = run(ght, ['pr', 'ready', ref], { cwd: wt })
  return r.status === 0 ? null : (r.stderr || `pr ready exited ${r.status}`)
}

export function renderBody({ task, runId, commits, shortstat, tt, cairnBlock }) {
  const lines = [
    `## ${task}`,
    '',
    'Delivered by `pe` (principal-engineer harness). Run `' + runId + '`.',
    '',
    '### Changes',
    ...(commits.length ? commits.map((c) => `- ${c}`) : ['- (see diff)']),
    shortstat ? `\n${shortstat}` : '',
    '',
    '### Tests',
    `tt: ${tt.passed} passed, ${tt.failed} failed (re-run by the harness)`,
  ]
  if (cairnBlock) lines.push('', cairnBlock)
  return lines.filter((l) => l !== null).join('\n') + '\n'
}

const MERGE_NOTE = 'merge_authorized: false — this gate routes reviewer attention; it never authorizes merge.'

export function renderCairnBlock({ mode, runId, review }) {
  if (!review?.recorded) return null
  const head = '## Cairn attention gate'
  if (mode === 'shadow') {
    return [
      head,
      '',
      `sealed for pilot blindness — unseal after review (\`pe unseal ${runId}\`)`,
      `evidence: ${review.evidenceHash} · snapshot: pre-human-review · captured: ${review.capturedAt}`,
      '',
      MERGE_NOTE,
    ].join('\n')
  }
  const lines = [
    head,
    '',
    `status: ${review.status ?? 'UNKNOWN'} · evidence: ${review.evidenceHash}${review.bundle ? ` · bundle: ${review.bundle}` : ''}`,
  ]
  if (review.findings.length) {
    lines.push('findings:', ...review.findings.map((f) => `- ${f}`))
  }
  lines.push('', MERGE_NOTE)
  return lines.join('\n')
}

export function writeBody(path, body) {
  writeFileSync(path, body)
}
