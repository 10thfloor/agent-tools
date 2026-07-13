import { existsSync, readFileSync, writeFileSync } from 'node:fs'

// Commands are argv arrays, never shell strings — the suite spawns without a
// shell (see SECURITY.md) and bench keeps that contract.
export const TEMPLATE = {
  $doc: 'bench — token A/B benchmarks. Commands are argv arrays (no shell). Replace OWNER/REPO, then run: bench',
  scenarios: [
    {
      name: 'gh vs ght: pr list',
      baseline: ['gh', 'pr', 'list', '-R', 'OWNER/REPO', '--limit', '20', '--json', 'number,title,author,state'],
      candidate: ['ght', 'pr', 'list', '-R', 'OWNER/REPO', '--limit', '20', '--json', 'number,title,author,state'],
    },
    {
      name: 'gh vs ght: repo object',
      baseline: ['gh', 'api', 'repos/OWNER/REPO'],
      candidate: ['ght', 'api', 'repos/OWNER/REPO'],
    },
    {
      name: 'raw test run vs tt verdict',
      baseline: ['npm', 'test', '--silent'],
      candidate: ['tt'],
      ignoreExit: true,
    },
  ],
}

export function writeTemplate(path, force) {
  if (existsSync(path) && !force) {
    throw new Error(`bench: ${path} already exists — use --force to overwrite`)
  }
  writeFileSync(path, JSON.stringify(TEMPLATE, null, 2) + '\n')
}

const isArgv = (v) => Array.isArray(v) && v.length > 0 && v.every((x) => typeof x === 'string' && x.length > 0)

export function loadConfig(path) {
  if (!existsSync(path)) {
    throw new Error(`bench: no ${path} — run \`bench init\` to create one`)
  }
  let data
  try {
    data = JSON.parse(readFileSync(path, 'utf8'))
  } catch (err) {
    throw new Error(`bench: ${path} is not valid JSON (${err.message})`)
  }
  const scenarios = data?.scenarios
  if (!Array.isArray(scenarios) || scenarios.length === 0) {
    throw new Error(`bench: ${path} needs a non-empty "scenarios" array`)
  }
  return scenarios.map((s, i) => {
    const where = `scenario ${i + 1}${s?.name ? ` ("${s.name}")` : ''}`
    if (typeof s?.name !== 'string' || !s.name) throw new Error(`bench: ${where} needs a "name"`)
    for (const key of ['baseline', 'candidate']) {
      if (!isArgv(s[key])) {
        throw new Error(`bench: ${where} "${key}" must be a non-empty argv array of strings (no shell strings)`)
      }
    }
    return { name: s.name, baseline: s.baseline, candidate: s.candidate, ignoreExit: s.ignoreExit === true }
  })
}
