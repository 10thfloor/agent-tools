const ANSI = /\x1b\[[0-9;]*m/g

export const stripAnsi = (s) => s.replace(ANSI, '')

// Lines that open a failure block, one per failing test. Deliberately NOT
// per-file badge lines (`FAIL <file>` in jest, `FAILED <id>` short-summary in
// pytest); those duplicate the real per-test blocks and inflate the count.
const MARKERS = [
  /^\s*✖ /, // node:test spec
  /^\s*[✗×] /, // vitest (✗ older, × v1+)
  /^\s*● /, // jest
  /^--- FAIL/, // go
  /^_{5,}.+_{5,}$/, // pytest section header
  /^---- .+ ----$/, // cargo failure detail (---- tests::name stdout ----)
  /^not ok /, // TAP
]
// Lines that clearly end a failure block (start of passing noise).
const NOISE = [/^\s*✔/, /^\s*✓/, /^ok /, /^PASS[ :]/, /^\s*ℹ /]

function collectBlocks(text, maxLines) {
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
      cur = { head: line.trim(), lines: [] }
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
    if (cur.lines.length < maxLines) cur.lines.push(line.trimEnd())
  }
  flush()
  return blocks
}

export function extractFailures(text, { maxBlocks = 40, maxLines = 8 } = {}) {
  const blocks = collectBlocks(text, maxLines)
  const truncated = Math.max(0, blocks.length - maxBlocks)
  return {
    truncated,
    failures: blocks.slice(0, maxBlocks).map((b, i) => ({
      n: i + 1,
      head: b.head,
      detail: b.lines.map((l) => l.trim()).join(' | ').slice(0, 500),
    })),
  }
}

// Failure #n's complete block (uncapped detail) for the --tt-fail drill-down.
export function fullFailure(text, n) {
  const block = collectBlocks(text, 400)[n - 1]
  return block ? [block.head, ...block.lines].join('\n') : null
}

const num = (s, re) => Number(s.match(re)?.[1] ?? 0)

// Per-runner total parsers; null when no known summary format is present.
// Each tolerates an all-failing run (a missing pass or fail count is 0).
export function extractSummary(text) {
  const t = stripAnsi(text)
  // node:test, both the spec reporter (`ℹ pass N`, TTY default) and TAP reporter
  // (`# pass N`, the piped default) share these counts.
  const nodeFail = t.match(/^[ℹ#] fail (\d+)$/m)
  const nodePass = t.match(/^[ℹ#] pass (\d+)$/m)
  if (nodeFail || nodePass) {
    return { runner: 'node:test', failed: Number(nodeFail?.[1] ?? 0), passed: Number(nodePass?.[1] ?? 0) }
  }
  // vitest / jest: "Tests  N failed | M passed (T)"; either count may be
  // absent on an all-passing or all-failing run.
  const vitLine = t.match(/^\s*Tests:?\s+(.+)$/m)
  if (vitLine && /\d+ (?:failed|passed)/.test(vitLine[1])) {
    return { runner: 'vitest/jest', failed: num(vitLine[1], /(\d+) failed/), passed: num(vitLine[1], /(\d+) passed/) }
  }
  // cargo: "test result: FAILED. N passed; M failed; ..."
  const cargo = t.match(/test result: \w+\. (\d+) passed; (\d+) failed/)
  if (cargo) return { runner: 'cargo', failed: Number(cargo[2]), passed: Number(cargo[1]) }
  // pytest: "== N failed, M passed in X.Xs =="; either count optional.
  const pyLine = t.split('\n').find((l) => / in [\d.]+s/.test(l) && /\d+ (?:passed|failed)/.test(l))
  if (pyLine) return { runner: 'pytest', failed: num(pyLine, /(\d+) failed/), passed: num(pyLine, /(\d+) passed/) }
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
