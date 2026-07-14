import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { prepSpawn } from './spawn.js'
import { sha256File } from './evidence.js'

// Run `cairn review` and seal the full envelope as pilot evidence. In shadow
// mode nothing beyond `recorded` and the evidence hash may leave this record
// until `pe unseal`.
export function reviewAndSeal({ cairn, repo, branch, sealedPath }) {
  const args = ['--repo', repo, 'review', branch, '--base', cairn.base, '--format', 'json']
  const r = spawnSync(...prepSpawn(cairn.bin, args, { encoding: 'utf8' }))
  if (r.error) return { recorded: false, error: r.error.message }
  let envelope = null
  try {
    envelope = JSON.parse(r.stdout)
  } catch { /* sealed raw below */ }
  const record = {
    captured_at: new Date().toISOString(),
    snapshot: 'pre-human-review',
    exit: r.status,
    envelope,
    raw: envelope ? undefined : r.stdout,
    stderr: r.stderr || undefined,
  }
  writeFileSync(sealedPath, JSON.stringify(record, null, 2))
  return {
    recorded: true,
    status: envelope?.data?.status ?? null,
    findings: findingLines(envelope),
    bundle: bundleRef(envelope),
    evidenceHash: sha256File(sealedPath),
    capturedAt: record.captured_at,
  }
}

function findingLines(envelope) {
  const findings = envelope?.data?.findings
  if (!Array.isArray(findings)) return []
  return findings.map((f) =>
    typeof f === 'string' ? f : f.message ?? f.title ?? f.rule ?? JSON.stringify(f).slice(0, 120))
}

function bundleRef(envelope) {
  const d = envelope?.data ?? {}
  if (typeof d.bundle === 'string') return d.bundle
  const m = JSON.stringify(d.artifacts ?? '').match(/[a-f0-9]{64}/)
  return m ? m[0] : null
}

export function unseal(paths, flags) {
  if (!existsSync(paths.sealed)) throw new Error('no sealed Cairn record for this run')
  if (existsSync(paths.outcome)) throw new Error('already unsealed; the record is final')
  const outcome = {
    unsealed_at: new Date().toISOString(),
    outcome: flags.outcome ?? null,
    findings: flags.findings ?? null,
    changes_requested: Boolean(flags.changesRequested),
  }
  writeFileSync(paths.outcome, JSON.stringify(outcome, null, 2))
  return readFileSync(paths.sealed, 'utf8')
}
