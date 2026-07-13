import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// vitest and jest can emit an exact machine report alongside their human
// output. tt uses it (instead of heuristics) when the default `npm test`
// script clearly runs one of them; explicit user commands are never
// modified.
export function reporterKind(cwd) {
  try {
    const pkg = JSON.parse(readFileSync(join(cwd, 'package.json'), 'utf8'))
    const script = pkg.scripts?.test ?? ''
    // npm appends our reporter flags to the END of the whole script line, so
    // they'd land on the wrong command in a compound script (`vitest && tsc`).
    // Bail to heuristics unless the runner is the single, last command.
    if (/[&|;]/.test(script)) return null
    if (/\bvitest\b/.test(script)) return 'vitest'
    if (/\bjest\b/.test(script)) return 'jest'
  } catch {
    /* no package.json / unparseable → heuristics */
  }
  return null
}

// Keep the human reporter (for the cached full log) and write the JSON
// report to a side file.
export function reporterArgs(kind, reportPath) {
  if (kind === 'vitest') return ['--', '--reporter=default', '--reporter=json', `--outputFile=${reportPath}`]
  if (kind === 'jest') return ['--', '--json', `--outputFile=${reportPath}`]
  return []
}

// Both runners emit the jest JSON schema. null → caller falls back to
// heuristics.
export function parseReport(path) {
  let data
  try {
    data = JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return null
  }
  if (typeof data.numTotalTests !== 'number') return null
  const failures = []
  for (const file of data.testResults ?? []) {
    const fileName = file.name ?? file.testFilePath ?? ''
    for (const t of file.assertionResults ?? []) {
      if (t.status !== 'failed') continue
      failures.push({
        head: `✖ ${t.fullName ?? t.title ?? '(unnamed test)'}`,
        file: fileName,
        message: (t.failureMessages ?? []).join('\n'),
      })
    }
  }
  return {
    failed: data.numFailedTests ?? failures.length,
    passed: data.numPassedTests ?? 0,
    failures,
  }
}
