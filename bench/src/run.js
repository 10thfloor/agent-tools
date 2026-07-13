import { spawnSync } from 'node:child_process'
import { prepSpawn } from './spawn.js'

function runCommand(argvArr, ignoreExit) {
  const t0 = performance.now()
  const r = spawnSync(...prepSpawn(argvArr[0], argvArr.slice(1), { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 }))
  const ms = Math.round(performance.now() - t0)
  if (r.error) return { ok: false, error: r.error.message, ms }
  if (r.status !== 0 && !ignoreExit) return { ok: false, error: `exit ${r.status}`, ms }
  return { ok: true, text: r.stdout ?? '', ms }
}

export function runScenario(scenario, count) {
  const base = runCommand(scenario.baseline, scenario.ignoreExit)
  const cand = runCommand(scenario.candidate, scenario.ignoreExit)
  if (!base.ok || !cand.ok) {
    return {
      name: scenario.name,
      ok: false,
      error: [!base.ok && `baseline: ${base.error}`, !cand.ok && `candidate: ${cand.error}`].filter(Boolean).join('; '),
    }
  }
  const baselineTokens = count(base.text)
  const candidateTokens = count(cand.text)
  return {
    name: scenario.name,
    ok: true,
    baselineTokens,
    candidateTokens,
    savedPct: savedPct(baselineTokens, candidateTokens),
    baselineMs: base.ms,
    candidateMs: cand.ms,
  }
}

export const savedPct = (base, cand) => (base > 0 ? Math.round(1000 * (1 - cand / base)) / 10 : 0)

export function aggregate(results) {
  const ok = results.filter((r) => r.ok)
  const baselineTokens = ok.reduce((a, r) => a + r.baselineTokens, 0)
  const candidateTokens = ok.reduce((a, r) => a + r.candidateTokens, 0)
  return {
    scenarios: results.length,
    measured: ok.length,
    failed: results.length - ok.length,
    baselineTokens,
    candidateTokens,
    savedPct: savedPct(baselineTokens, candidateTokens),
  }
}
