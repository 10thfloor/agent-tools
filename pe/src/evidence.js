import { createHash } from 'node:crypto'
import { appendFileSync, mkdirSync, realpathSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'

// Evidence lives OUTSIDE the repo (pilot rule: never committed, never in the
// diff). One dir per run: journal (incremental, crash-safe), raw transcript,
// sealed Cairn result, verdict, human outcome.
export function repoSlug(repo) {
  const real = realpathSync(repo)
  return `${basename(real)}-${createHash('sha256').update(real).digest('hex').slice(0, 8)}`
}

export const latestPath = (baseDir, repo) => join(baseDir, repoSlug(repo), 'latest')

export function evidencePaths(baseDir, repo, runId) {
  const root = join(baseDir, repoSlug(repo))
  const dir = join(root, runId)
  return {
    root,
    dir,
    journal: join(dir, 'journal.jsonl'),
    transcript: join(dir, 'transcript.jsonl'),
    prompt: join(dir, 'prompt.md'),
    prBody: join(dir, 'pr-body.md'),
    sealed: join(dir, 'sealed', 'cairn.json'),
    verdict: join(dir, 'verdict.json'),
    outcome: join(dir, 'outcome.json'),
    latest: join(root, 'latest'),
  }
}

export function initEvidence(paths, runId) {
  mkdirSync(join(paths.dir, 'sealed'), { recursive: true })
  writeFileSync(paths.latest, runId + '\n')
}

export function journal(paths, event, data = {}) {
  appendFileSync(paths.journal, JSON.stringify({ t: new Date().toISOString(), event, ...data }) + '\n')
}
