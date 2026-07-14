#!/usr/bin/env node
// PreToolUse policy hook for pe-delegated sessions. Reads the tool-call JSON
// on stdin; exit 2 blocks the call (stderr reason is shown to the agent).
// Policy: the agent implements, tests, and commits. Delivery (push, PRs),
// Cairn memory admission, worktree removal, and the pilot evidence dir are
// harness- or human-owned.

import { resolve, sep } from 'node:path'

const RULES = [
  [/\bgit\b[^;|&\n]*\bpush\b/, 'pushing is harness-owned; commit locally and finish'],
  [/\b(gh|ght)\s+pr\s+(create|ready|merge|close)\b/, 'pull requests are harness-owned'],
  [/\bcairn\b(?:\s+\S+)*?\s+(remember|confirm|capture|labs)\b/, 'Cairn memory admission is human-only'],
  [/\bwtree\s+(rm|remove|clean)\b/, 'worktree lifecycle is harness-owned'],
]

function pathWithin(parent, child) {
  const p = resolve(parent) + sep
  return resolve(child).startsWith(p)
}

const chunks = []
process.stdin.on('data', (c) => chunks.push(c))
process.stdin.on('end', () => {
  let input
  try {
    input = JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    process.exit(0)
  }
  const name = input.tool_name ?? ''
  const evidence = process.env.PE_EVIDENCE_DIR ?? ''
  const deny = (why) => {
    process.stderr.write(`pe policy: ${why}\n`)
    process.exit(2)
  }

  if (/^(Write|Edit|MultiEdit|NotebookEdit)$/.test(name)) {
    const target = input.tool_input?.file_path ?? input.tool_input?.notebook_path ?? ''
    if (evidence && target && pathWithin(evidence, target)) {
      deny('the pilot evidence directory is read-only for the agent')
    }
    process.exit(0)
  }
  if (name !== 'Bash') process.exit(0)

  const cmd = String(input.tool_input?.command ?? '')
  for (const [re, why] of RULES) {
    if (re.test(cmd)) deny(why)
  }
  if (evidence && cmd.includes(evidence) && /(>>?|\brm\b|\bmv\b|\bcp\b|\btee\b)/.test(cmd)) {
    deny('the pilot evidence directory is read-only for the agent')
  }
  process.exit(0)
})
