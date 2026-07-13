import { encode } from '@toon-format/toon'
import { gatherFleet } from './gather.js'

export const USAGE = `fleet — cross-project overview of repos, worktrees, and agents

Usage:
  fleet [roots...]        one row per repo (default root: current directory,
                          or FLEET_ROOTS=path:path)
  fleet --all             flattened per-worktree rows across all repos

Flags: --json | --toon | --table, --help
Env:   FLEET_ROOTS, FLEET_WT (wt binary; wt powers per-repo data)

active = any worktree with uncommitted changes, unpushed commits, an open
PR, a live agent, or a git lock. Table on a terminal, TOON when piped.
`

export function parseArgs(argv) {
  const roots = []
  const flags = {}
  for (const a of argv) {
    if (a === '--all') flags.all = true
    else if (a === '--json') flags.json = true
    else if (a === '--toon') flags.toon = true
    else if (a === '--table') flags.table = true
    else if (a === '--help' || a === '-h') flags.help = true
    else if (a.startsWith('-')) throw new Error(`fleet: unknown flag ${a}`)
    else roots.push(a)
  }
  return { roots, flags }
}

export async function runFleet(argv, env = process.env) {
  let parsed
  try {
    parsed = parseArgs(argv)
  } catch (err) {
    process.stderr.write(err.message + '\n\n' + USAGE)
    return 2
  }
  const { roots, flags } = parsed
  if (flags.help) {
    process.stdout.write(USAGE)
    return 0
  }
  const scanRoots = roots.length ? roots : (env.FLEET_ROOTS ? env.FLEET_ROOTS.split(':').filter(Boolean) : [process.cwd()])
  const repos = await gatherFleet(scanRoots, env)
  if (!repos.length) {
    process.stderr.write(`fleet: no git repositories found under ${scanRoots.join(', ')}\n`)
    return 1
  }

  const data = flags.all
    ? repos.flatMap((r) => r.rows.map((row) => ({ repo: r.repo, ...row })))
    : repos.map(({ rows, ...repo }) => repo)
  const format = flags.table ? 'table' : flags.json ? 'json' : flags.toon ? 'toon' : process.stdout.isTTY ? 'table' : 'toon'
  if (format === 'json') process.stdout.write(JSON.stringify(data) + '\n')
  else if (format === 'toon') process.stdout.write(encode(data, { delimiter: ',' }) + '\n')
  else process.stdout.write(flags.all ? allTable(data) : repoTable(data))
  return 0
}

const tilde = (p) => (p.startsWith(homedir()) ? '~' + p.slice(homedir().length) : p)
const trunc = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s)
const color = () => process.stdout.isTTY === true

function repoTable(repos) {
  const c = (code, s) => (color() ? `\x1b[${code}m${s}\x1b[0m` : s)
  const cells = repos.map((r) => ({
    active: r.active,
    repo: r.repo,
    work: trunc(r.work || '—', 40),
    wts: `${r.activeWorktrees}●/${r.worktrees}`,
    prs: String(r.prs || ''),
    agents: String(r.agents || ''),
    path: tilde(r.path),
  }))
  const w = (k, min) => Math.max(min, ...cells.map((x) => x[k].length))
  const rw = w('repo', 4)
  const ww = w('work', 4)
  const tw = w('wts', 3)
  const lines = [c('2', `  ${'REPO'.padEnd(rw)}  ${'WORK'.padEnd(ww)}  ${'WTS'.padEnd(tw)}  PR  AG  PATH`)]
  for (const x of cells) {
    const body = `${x.repo.padEnd(rw)}  ${x.work.padEnd(ww)}  ${x.wts.padEnd(tw)}  ${x.prs.padEnd(2)}  ${x.agents.padEnd(2)}  ${x.path}`
    lines.push(x.active ? `${c('32', '●')} ${body}` : c('2', `○ ${body}`))
  }
  return lines.join('\n') + '\n'
}

function allTable(rows) {
  const c = (code, s) => (color() ? `\x1b[${code}m${s}\x1b[0m` : s)
  const cells = rows.map((r) => ({
    active: r.status === 'active',
    repo: r.repo,
    branch: (r.branch ?? '') + (r.main ? ' (main)' : ''),
    work: trunc(r.work || '—', 36),
    activity: r.activity || '—',
    path: tilde(r.path),
  }))
  const w = (k, min) => Math.max(min, ...cells.map((x) => x[k].length))
  const rw = w('repo', 4)
  const bw = w('branch', 6)
  const ww = w('work', 4)
  const aw = w('activity', 8)
  const lines = [c('2', `  ${'REPO'.padEnd(rw)}  ${'BRANCH'.padEnd(bw)}  ${'WORK'.padEnd(ww)}  ${'ACTIVITY'.padEnd(aw)}  PATH`)]
  for (const x of cells) {
    const body = `${x.repo.padEnd(rw)}  ${x.branch.padEnd(bw)}  ${x.work.padEnd(ww)}  ${x.activity.padEnd(aw)}  ${x.path}`
    lines.push(x.active ? `${c('32', '●')} ${body}` : c('2', `○ ${body}`))
  }
  return lines.join('\n') + '\n'
}
