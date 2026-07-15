import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { evidencePaths, repoSlug } from './evidence.js'

const readJson = (path) => {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return null
  }
}

// Run ids are 'pe-' + base36 millis + 3 random chars; decode the mint time.
const runIdTime = (runId) => {
  const ts = parseInt(runId.slice(3, -3), 36)
  return Number.isFinite(ts) && ts > 0 ? new Date(ts).toISOString().slice(0, 16) : ''
}

// Recorded runs for a repo, newest first (the base36 timestamp makes the
// lexicographic sort chronological). `limit` bounds the file reads to the
// newest N; `journal: false` skips the per-run event-log parse for callers
// that only need verdicts (status).
export function readRuns(evidenceDir, repo, { limit = Infinity, journal = true } = {}) {
  const root = join(evidenceDir, repoSlug(repo))
  if (!existsSync(root)) return []
  return readdirSync(root)
    .filter((name) => name.startsWith('pe-'))
    .sort()
    .reverse()
    .slice(0, limit)
    .map((runId) => {
      const paths = evidencePaths(evidenceDir, repo, runId)
      const run = {
        runId,
        paths,
        createdAt: runIdTime(runId),
        verdict: readJson(paths.verdict),
        outcome: readJson(paths.outcome),
        sealed: existsSync(paths.sealed),
        delegations: 0,
      }
      if (journal && existsSync(paths.journal)) {
        run.delegations = readFileSync(paths.journal, 'utf8').split('\n')
          .filter((l) => l.includes('"event":"delegate.done"')).length
      }
      return run
    })
}
