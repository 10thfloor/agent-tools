import { homedir } from 'node:os'
import { encode } from '@toon-format/toon'

import { autoSummary } from './signals.js'

export function toRows(entries) {
  return entries.map((e) => ({
    branch: e.wt.branch ?? '(detached)',
    status: e.activity.active ? 'active' : 'idle',
    activity: e.activity.reasons.join(' '),
    work: e.note || autoSummary(e.wt, e.work),
    dirty: e.work.dirty,
    ahead: e.work.ahead,
    behind: e.work.behind,
    pr: e.pr ? e.pr.number : '',
    main: e.wt.isMain,
    head: (e.wt.head || '').slice(0, 7),
    path: e.wt.path,
  }))
}

export const toToon = (rows) => encode(rows, { delimiter: ',' })
export const toJson = (rows) => JSON.stringify(rows)

export function toTable(rows, { color = process.stdout.isTTY } = {}) {
  const c = (code, s) => (color ? `\x1b[${code}m${s}\x1b[0m` : s)
  const home = homedir().replace(/\\/g, '/')
  const tilde = (p) => {
    const q = p.replace(/\\/g, '/')
    return q === home || q.startsWith(home + '/') ? '~' + q.slice(home.length) : p
  }
  const trunc = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s)
  const cells = rows.map((r) => ({
    active: r.status === 'active',
    branch: r.branch + (r.main ? ' (main)' : ''),
    work: trunc(r.work || '—', 44),
    activity: r.activity || '—',
    pr: r.pr ? `#${r.pr}` : '',
    path: tilde(r.path),
  }))
  const width = (k, min) => Math.max(min, ...cells.map((x) => x[k].length))
  const bw = width('branch', 6)
  const ww = width('work', 4)
  const aw = width('activity', 8)
  const pw = width('pr', 2)
  const lines = [c('2', `  ${'BRANCH'.padEnd(bw)}  ${'WORK'.padEnd(ww)}  ${'ACTIVITY'.padEnd(aw)}  ${'PR'.padEnd(pw)}  PATH`)]
  for (const x of cells) {
    const body = `${x.branch.padEnd(bw)}  ${x.work.padEnd(ww)}  ${x.activity.padEnd(aw)}  ${x.pr.padEnd(pw)}  ${x.path}`
    lines.push(x.active ? `${c('32', '●')} ${body}` : c('2', `○ ${body}`))
  }
  return lines.join('\n')
}
