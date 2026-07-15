// Pre-push gate: scan the branch diff's ADDED lines for credential shapes.
// Conservative and fail-closed, like the rest of the policy; matches are
// masked so the report itself never carries the secret.
const PATTERNS = [
  ['aws access key', /\bAKIA[0-9A-Z]{16}\b/],
  ['github token', /\bgh[pousr]_[A-Za-z0-9]{36,}\b/],
  ['slack token', /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/],
  ['private key block', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ['secret assignment', /(?:api[_-]?key|secret|token|password|passwd)["']?\s*[:=]\s*["'][^"']{12,}["']/i],
]

export function scanDiff(patch) {
  const findings = []
  let file = ''
  for (const line of patch.split('\n')) {
    if (line.startsWith('+++ b/')) {
      file = line.slice(6)
      continue
    }
    if (!line.startsWith('+') || line.startsWith('+++')) continue
    for (const [kind, re] of PATTERNS) {
      const m = line.match(re)
      if (m) findings.push({ file, kind, sample: mask(m[0]) })
    }
  }
  return findings
}

const mask = (s) => (s.length <= 8 ? '****' : `${s.slice(0, 4)}…${s.slice(-2)} (${s.length} chars)`)
