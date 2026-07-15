import { readRuns } from './runs.js'

// Pilot metrics from the evidence dir alone: run states, remediation rate,
// spend, and the sealed-record/human-outcome pairing Track B needs.
export function scorecard(evidenceDir, repo) {
  const runs = readRuns(evidenceDir, repo)
  const states = {}
  const outcomes = { strong: 0, partial: 0 }
  let tokens = 0
  let turns = 0
  let remediated = 0
  let sealed = 0
  let unsealed = 0
  let changesRequested = 0
  for (const r of runs) {
    const state = r.verdict?.state ?? 'UNKNOWN'
    states[state] = (states[state] ?? 0) + 1
    tokens += r.verdict?.tokens ?? 0
    turns += r.verdict?.turns ?? 0
    if (r.delegations > 1) remediated++
    if (r.sealed) sealed++
    if (r.outcome) {
      unsealed++
      if (Object.hasOwn(outcomes, r.outcome.outcome)) outcomes[r.outcome.outcome]++
      if (r.outcome.changes_requested) changesRequested++
    }
  }
  return {
    runs: runs.length,
    delivered: (states.DELIVERED_READY ?? 0) + (states.DELIVERED_DRAFT ?? 0) + (states.REVISED ?? 0),
    remediated,
    states,
    turns,
    tokens,
    pilot: { sealed, unsealed, awaitingUnseal: sealed - unsealed, outcomes, changesRequested },
  }
}
