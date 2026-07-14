import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { sh } from './exec.js'

// Run `cairn review` and seal the full envelope as pilot evidence. Blindness
// is structural: in shadow mode the returned view simply lacks status,
// findings, and bundle, so no downstream surface CAN leak them; only the
// sealed file (and `pe unseal`) has them.
export function reviewAndSeal({ cairn, repo, branch, base, sealedPath }) {
  const r = sh(cairn.bin, ['--repo', repo, 'review', branch, '--base', base, '--format', 'json'])
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
  const json = JSON.stringify(record, null, 2)
  writeFileSync(sealedPath, json)
  const view = {
    recorded: true,
    evidenceHash: 'sha256:' + createHash('sha256').update(json).digest('hex'),
    capturedAt: record.captured_at,
  }
  if (cairn.mode !== 'gate') return view
  return {
    ...view,
    status: envelope?.data?.status ?? null,
    findings: findingLines(envelope),
    bundle: bundleRef(envelope),
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
