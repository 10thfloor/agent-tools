const ANSI = /\x1b\[[0-9;]*m/g

export const stripAnsi = (s) => s.replace(ANSI, '')

// Lines that open a failure block across common runners.
const MARKERS = [
  /^\s*✖ /, // node:test
  /^\s*✗ /, // vitest
  /^\s*● /, // jest
  /^--- FAIL/, // go
  /^FAILED[ :]/, // pytest short summary
  /^FAIL[ :]/, // vitest/jest file line, cargo
  /^_{5,}.+_{5,}$/, // pytest section header
  /^not ok /, // TAP
]
// Lines that clearly end a failure block (start of passing noise).
const NOISE = [/^\s*✔/, /^\s*✓/, /^ok /, /^PASS[ :]/, /^\s*ℹ /]

export function extractFailures(text, { maxBlocks = 40, maxLines = 8 } = {}) {
  const lines = stripAnsi(text).split('\n')
  const blocks = []
  let cur = null
  let blanks = 0
  const flush = () => {
    if (cur) blocks.push(cur)
    cur = null
    blanks = 0
  }
  for (const line of lines) {
    if (MARKERS.some((m) => m.test(line))) {
      flush()
      cur = { head: line.trim(), detail: [] }
      continue
    }
    if (!cur) continue
    if (NOISE.some((m) => m.test(line))) {
      flush()
      continue
    }
    if (line.trim() === '') {
      blanks++
      if (blanks >= 2) flush()
      continue
    }
    blanks = 0
    if (cur.detail.length < maxLines) cur.detail.push(line.trim())
  }
  flush()
  const truncated = Math.max(0, blocks.length - maxBlocks)
  return {
    truncated,
    failures: blocks.slice(0, maxBlocks).map((b, i) => ({
      n: i + 1,
      head: b.head,
      detail: b.detail.join(' | ').slice(0, 500),
    })),
  }
}

// Per-runner total parsers; null when no known summary format is present.
export function extractSummary(text) {
  const t = stripAnsi(text)
  const nodeFail = t.match(/^ℹ fail (\d+)$/m)
  const nodePass = t.match(/^ℹ pass (\d+)$/m)
  if (nodeFail || nodePass) {
    return { runner: 'node:test', failed: Number(nodeFail?.[1] ?? 0), passed: Number(nodePass?.[1] ?? 0) }
  }
  const vit = t.match(/Tests[: ]+\s*(?:(\d+) failed[ ,|]+)?(?:(\d+) skipped[ ,|]+)?(\d+) passed/)
  if (vit) return { runner: 'vitest/jest', failed: Number(vit[1] ?? 0), passed: Number(vit[3]) }
  const py = t.match(/(?:(\d+) failed, )?(\d+) passed(?:,[^=]*)? in [\d.]+s/)
  if (py) return { runner: 'pytest', failed: Number(py[1] ?? 0), passed: Number(py[2]) }
  return null
}

export function condense(text, exitCode, command, opts = {}) {
  const { failures, truncated } = extractFailures(text, opts)
  const summary = extractSummary(text)
  return {
    summary: {
      command,
      exit: exitCode,
      failed: summary?.failed ?? failures.length,
      passed: summary?.passed ?? '',
      runner: summary?.runner ?? 'unknown',
      ...(truncated ? { truncatedFailures: truncated } : {}),
    },
    failures,
  }
}
