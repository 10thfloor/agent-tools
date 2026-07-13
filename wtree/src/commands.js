import { mkdirSync, realpathSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { git, tryGit } from './run.js'
import { listWorktrees, worktreesDir, slug, findWorktree, worktreeAt, nextGenericBranch, getNote, setNote } from './worktrees.js'
import { workStatus, openPrsByBranch, agentCwds, deriveActivity, prTitle, EMPTY_WORK } from './signals.js'
import { copyIncluded } from './include.js'
import { toRows, toToon, toJson, toTable } from './format.js'

const log = (s) => process.stderr.write(s + '\n')
const out = (s) => process.stdout.write(s + '\n')

export function gatherEntries(cwd, env = process.env) {
  const items = listWorktrees(cwd)
  const mainBranch = items[0]?.branch
  const prMap = openPrsByBranch(items[0].path, env)
  const cwds = agentCwds(env)
  return items.map((wt) => {
    const work = wt.prunable ? EMPTY_WORK : workStatus(wt, mainBranch)
    const pr = wt.branch && prMap ? prMap.get(wt.branch) : undefined
    const note = wt.branch ? getNote(cwd, wt.branch) : ''
    return { wt, work, pr, note, activity: deriveActivity(wt, work, pr, cwds) }
  })
}

export function cmdList(cwd, flags, env = process.env) {
  const rows = toRows(gatherEntries(cwd, env))
  const format = flags.table ? 'table'
    : flags.json ? 'json'
    : flags.toon ? 'toon'
    : process.stdout.isTTY ? 'table' : 'toon'
  out(format === 'table' ? toTable(rows) : format === 'json' ? toJson(rows) : toToon(rows))
  return 0
}

export function cmdNew(cwd, branch, flags, env = process.env) {
  const items = listWorktrees(cwd)
  if (flags.pr) {
    if (branch) {
      log('wtree: use either a branch name or --pr, not both')
      return 2
    }
    if (!/^[0-9]+$/.test(String(flags.pr))) {
      log(`wtree: --pr must be a number, got '${flags.pr}'`)
      return 2
    }
    branch = `pr-${flags.pr}`
  } else if (!branch) {
    branch = nextGenericBranch(cwd)
    log(`• no branch name given — using '${branch}' (add intent with -m "...")`)
  }
  const existing = items.find((w) => w.branch === branch)
  if (existing) {
    if (flags.note) setNote(cwd, branch, flags.note)
    log(`✓ worktree for '${branch}' already exists — reusing${flags.note ? ' (note updated)' : ''}`)
    out(existing.path)
    return 0
  }
  // Forward slashes throughout: git reports worktree paths with '/' (even on
  // Windows), so normalizing here keeps `wtree new` output identical to what
  // `wtree list`/`path` show, and the path still works with cd / git / fs.
  const dest = join(worktreesDir(items[0].path), slug(branch)).replace(/\\/g, '/')
  mkdirSync(dirname(dest), { recursive: true })
  let how
  if (tryGit(['show-ref', '--verify', '--quiet', `refs/heads/${branch}`], { cwd }) !== null) {
    git(['worktree', 'add', dest, branch], { cwd })
    how = `existing local branch '${branch}'`
  } else if (flags.pr) {
    // refs/pull/N/head exists for every GitHub PR, fork PRs included.
    git(['fetch', 'origin', `pull/${flags.pr}/head:${branch}`], { cwd })
    git(['worktree', 'add', dest, branch], { cwd })
    how = `PR #${flags.pr}`
  } else if (tryGit(['show-ref', '--verify', '--quiet', `refs/remotes/origin/${branch}`], { cwd }) !== null) {
    git(['worktree', 'add', '--track', '-b', branch, dest, `origin/${branch}`], { cwd })
    how = `tracking origin/${branch}`
  } else {
    const from = flags.from || 'HEAD'
    // A ref can't start with '-'; reject so --from can't smuggle a git option.
    if (from.startsWith('-')) {
      log(`wtree: invalid --from ref '${from}'`)
      return 2
    }
    git(['worktree', 'add', '-b', branch, dest, from], { cwd })
    how = `new branch from ${from}`
  }
  let note = flags.note
  if (!note && flags.pr) {
    const title = prTitle(cwd, flags.pr, env)
    if (title) note = `PR #${flags.pr}: ${title}`
  }
  if (note) setNote(cwd, branch, note)
  const { copied, skipped } = copyIncluded(items[0].path, dest)
  if (copied) log(`• copied ${copied} item(s) from .worktreeinclude`)
  if (skipped) log(`⚠ skipped ${skipped} .worktreeinclude entr(y/ies) that escaped the repo`)
  log(`✓ worktree ready (${how})${note ? ` — "${note}"` : ''}`)
  out(dest)
  return 0
}

export function cmdNote(cwd, args) {
  const items = listWorktrees(cwd)
  let ref
  let text
  if (args.length >= 2) {
    ref = args[0]
    text = args.slice(1).join(' ')
  } else if (args.length === 1) {
    // DWIM: one arg is a branch ref if it matches a worktree, else it's the
    // note text for the worktree you're standing in.
    if (findWorktree(items, args[0])) ref = args[0]
    else text = args[0]
  }
  const wt = ref ? findWorktree(items, ref) : worktreeAt(items, realpathSync(cwd))
  if (!wt) {
    log(ref ? `wtree: no worktree matches '${ref}'` : 'wtree: not inside a worktree — wtree note <branch> <text>')
    return 1
  }
  if (!wt.branch) {
    log('wtree: detached worktrees cannot hold a note (no branch)')
    return 1
  }
  if (text === undefined) {
    out(getNote(cwd, wt.branch))
    return 0
  }
  setNote(cwd, wt.branch, text)
  log(`✓ note set on '${wt.branch}': ${text}`)
  return 0
}

export function cmdRm(cwd, ref, flags) {
  if (!ref) {
    log('wtree: branch or path required — wtree rm <branch>')
    return 2
  }
  const items = listWorktrees(cwd)
  const wt = findWorktree(items, ref)
  if (!wt) {
    log(`wtree: no worktree matches '${ref}'`)
    return 1
  }
  if (wt.isMain) {
    log('wtree: refusing to remove the main worktree')
    return 1
  }
  return removeOne(cwd, wt, flags)
}

function removeOne(cwd, wt, flags) {
  if (wt.prunable) {
    git(['worktree', 'prune'], { cwd })
    log(`✓ pruned stale worktree ${wt.path}`)
  } else {
    const work = workStatus(wt)
    if (work.dirty > 0 && !flags.force) {
      log(`wtree: '${wt.branch ?? wt.path}' has ${work.dirty} uncommitted change(s) — commit first, or wtree rm --force`)
      return 1
    }
    git(['worktree', 'remove', ...(flags.force ? ['--force'] : []), wt.path], { cwd })
    log(`✓ removed worktree ${wt.path}`)
  }
  if (wt.branch) {
    if (tryGit(['branch', '-d', wt.branch], { cwd }) !== null) {
      log(`✓ deleted branch '${wt.branch}' (was merged)`)
    } else if (flags.force && tryGit(['branch', '-D', wt.branch], { cwd }) !== null) {
      log(`✓ force-deleted branch '${wt.branch}'`)
    } else {
      log(`• kept branch '${wt.branch}' (unmerged work — \`git branch -D ${wt.branch}\` to discard)`)
    }
  }
  return 0
}

export function cmdClean(cwd, flags, env = process.env) {
  const candidates = gatherEntries(cwd, env).filter((e) => !e.wt.isMain && !e.activity.active)
  if (!candidates.length) {
    log('✓ nothing to clean — every worktree is active (or main)')
    return 0
  }
  for (const e of candidates) log(`  ○ ${e.wt.branch ?? '(detached)'}  ${e.wt.path}`)
  if (!flags.yes) {
    log(`${candidates.length} idle worktree(s) would be removed — rerun with --yes to confirm`)
    return 0
  }
  let code = 0
  for (const e of candidates) code = removeOne(cwd, e.wt, {}) || code
  return code
}

export function cmdPath(cwd, ref) {
  const wt = ref && findWorktree(listWorktrees(cwd), ref)
  if (!wt) {
    log(`wtree: no worktree matches '${ref ?? ''}'`)
    return 1
  }
  out(wt.path)
  return 0
}
