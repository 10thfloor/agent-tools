import { execFile, spawnSync } from 'node:child_process'
import { basename } from 'node:path'
import { promisify } from 'node:util'
import { discoverRepos, groupByMainRoot } from './discover.js'

const execFileP = promisify(execFile)

async function wtRows(main, env) {
  const wtBin = env.FLEET_WT || 'wt'
  try {
    const { stdout } = await execFileP(wtBin, ['list', '--json'], {
      cwd: main,
      env,
      timeout: 30000,
      maxBuffer: 64 * 1024 * 1024,
    })
    const rows = JSON.parse(stdout)
    return Array.isArray(rows) && rows.length ? rows : null
  } catch {
    return null
  }
}

// git-only fallback when wt is unavailable in this environment.
function gitRow(main) {
  const branch = spawnSync('git', ['-C', main, 'branch', '--show-current'], { encoding: 'utf8' }).stdout?.trim() || '(detached)'
  const porcelain = spawnSync('git', ['-C', main, 'status', '--porcelain'], { encoding: 'utf8' }).stdout ?? ''
  const dirty = porcelain.split('\n').filter(Boolean).length
  return { branch, status: dirty > 0 ? 'active' : 'idle', activity: dirty ? `dirty:${dirty}` : '', work: '', dirty, pr: '', main: true, path: main }
}

export async function gatherFleet(roots, env = process.env) {
  const mains = groupByMainRoot(discoverRepos(roots))
  const repos = await Promise.all(mains.map(async (main) => {
    const rows = (await wtRows(main, env)) ?? [gitRow(main)]
    const mainRow = rows.find((r) => r.main) ?? rows[0]
    const active = rows.filter((r) => r.status === 'active')
    return {
      repo: basename(main),
      branch: mainRow.branch,
      active: active.length > 0,
      work: mainRow.work ?? '',
      dirty: mainRow.dirty ?? 0,
      worktrees: rows.length,
      activeWorktrees: active.length,
      prs: rows.filter((r) => r.pr !== '' && r.pr != null).length,
      agents: rows.filter((r) => /\bagent\b/.test(r.activity ?? '')).length,
      path: main,
      rows,
    }
  }))
  return repos.sort((a, b) => (a.active === b.active ? a.repo.localeCompare(b.repo) : a.active ? -1 : 1))
}
