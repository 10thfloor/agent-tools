import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { evidencePaths, repoSlug } from './evidence.js'

// Every recorded run for a repo, newest first (run ids embed a base36
// timestamp, so the lexicographic sort is chronological).
export function readRuns(evidenceDir, repo) {
  const root = join(evidenceDir, repoSlug(repo))
  if (!existsSync(root)) return []
  return readdirSync(root)
    .filter((name) => name.startsWith('pe-'))
    .sort()
    .reverse()
    .map((runId) => {
      const paths = evidencePaths(evidenceDir, repo, runId)
      const run = { runId, paths, verdict: null, delegations: 0, sealed: existsSync(paths.sealed), outcome: null }
      if (existsSync(paths.verdict)) {
        try { run.verdict = JSON.parse(readFileSync(paths.verdict, 'utf8')) } catch { /* surfaced as verdict-less */ }
      }
      if (existsSync(paths.outcome)) {
        try { run.outcome = JSON.parse(readFileSync(paths.outcome, 'utf8')) } catch { /* ditto */ }
      }
      if (existsSync(paths.journal)) {
        run.delegations = readFileSync(paths.journal, 'utf8').split('\n')
          .filter((l) => l.includes('"event":"delegate.done"')).length
      }
      return run
    })
}
