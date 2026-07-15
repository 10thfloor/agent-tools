import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { sh } from './exec.js'

const HOOK = join(dirname(fileURLToPath(import.meta.url)), '..', 'hooks', 'pretooluse.js')

// The delegated session runs unattended inside a disposable worktree; the
// PreToolUse hook (not permissions) is the policy boundary.
export function writeWorktreeSettings(wt, git) {
  const dir = join(wt, '.claude')
  mkdirSync(dir, { recursive: true })
  const settings = {
    permissions: { defaultMode: 'bypassPermissions' },
    hooks: {
      PreToolUse: [{
        matcher: 'Bash|Write|Edit|MultiEdit|NotebookEdit',
        hooks: [{ type: 'command', command: `"${process.execPath}" "${HOOK}"` }],
      }],
    },
  }
  writeFileSync(join(dir, 'settings.local.json'), JSON.stringify(settings, null, 2))
  excludeLocally(wt, git)
}

// Repo-local ignore (common git dir info/exclude): keeps the generated
// .claude/ out of the diff without committing anything.
function excludeLocally(wt, git) {
  const pattern = '.claude/'
  const r = sh(git, ['-C', wt, 'rev-parse', '--git-common-dir'])
  if (r.status !== 0) return
  let common = r.stdout.trim()
  if (!isAbsolute(common)) common = join(wt, common)
  const exclude = join(common, 'info', 'exclude')
  const current = existsSync(exclude) ? readFileSync(exclude, 'utf8') : ''
  if (!current.split('\n').includes(pattern)) {
    mkdirSync(join(common, 'info'), { recursive: true })
    appendFileSync(exclude, (current.endsWith('\n') || !current ? '' : '\n') + pattern + '\n')
  }
}

export function buildPrompt({ task, cairn }) {
  const lines = [
    'You are the principal engineer for this repository. Deliver the task',
    'completely: implement it, make the tests pass, and commit your work.',
    '',
    `TASK: ${task}`,
    '',
    'Rules:',
    '- Work only inside this worktree, on the current branch.',
    '- Run the test suite with `tt` and make it green before finishing.',
    '- Commit everything with clear messages. Do not push and do not open',
    '  pull requests; delivery is handled outside this session.',
  ]
  if (cairn) {
    lines.push(
      `- A review gate executable exists at ${cairn.bin}. Inspect its machine`,
      '  contract and run its review against your branch before finishing;',
      '  interpret and act on the result.',
    )
  }
  return lines.join('\n') + '\n'
}

const RULES = 'The same rules apply: no pushing, no pull requests; delivery is handled outside this session.'

export function remediationPrompt(reason, detail) {
  return [
    'The harness verified your previous attempt and it is not deliverable yet.',
    `Problem: ${reason}`,
    detail ? `Evidence:\n${detail}` : '',
    `Fix it and commit. ${RULES}`,
  ].filter(Boolean).join('\n') + '\n'
}

export function revisePrompt(task, feedback) {
  return [
    'The human reviewer examined your delivered pull request and left feedback.',
    'Address every point, keep the tests green, and commit your work.',
    '',
    `ORIGINAL TASK: ${task}`,
    '',
    'REVIEW FEEDBACK:',
    ...feedback.map((f) => `- ${f}`),
    '',
    RULES,
  ].join('\n') + '\n'
}

export function resumePrompt(task, message) {
  return [
    'You are resuming an interrupted delivery in this worktree. A previous',
    'session did not finish; pick up where it left off.',
    '',
    `ORIGINAL TASK: ${task}`,
    '',
    `WHERE IT STOPPED:\n${message || 'the session ran out of budget.'}`,
    '',
    `Make the tests green with \`tt\` and commit everything. ${RULES}`,
  ].join('\n') + '\n'
}
