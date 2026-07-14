import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { decode } from '@toon-format/toon'

const HERE = dirname(fileURLToPath(import.meta.url))
const BIN = join(HERE, '..', 'bin', 'pe.js')
const HOOK = join(HERE, '..', 'hooks', 'pretooluse.js')
// The real sibling wtree: pe's stage 1 is exercised for real, like fleet does.
const WTREE = join(HERE, '..', '..', 'wtree', 'bin', 'wtree.js')

const sh = (cmd, args, cwd) => execFileSync(cmd, args, { cwd, encoding: 'utf8' })

// One sandbox per test: a real repo with a bare origin (so pushes are real),
// fake claude/tt/ght/cairn binaries, and an isolated evidence dir. Fake
// behavior is scripted through JSON files in `state`.
function makeSandbox({ cairnMode = 'shadow', peJson = {} } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'pe-e2e-'))
  const repo = join(dir, 'proj')
  const state = join(dir, 'state')
  const evidence = join(dir, 'evidence')
  mkdirSync(repo)
  mkdirSync(state)
  sh('git', ['init', '-b', 'main'], repo)
  sh('git', ['config', 'user.email', 'pe@test'], repo)
  sh('git', ['config', 'user.name', 'pe test'], repo)
  writeFileSync(join(repo, 'a.txt'), 'hello\n')
  sh('git', ['add', '.'], repo)
  sh('git', ['commit', '-m', 'init'], repo)
  sh('git', ['init', '--bare', join(dir, 'origin.git')], dir)
  sh('git', ['remote', 'add', 'origin', join(dir, 'origin.git')], repo)
  sh('git', ['push', '-u', 'origin', 'main'], repo)

  // fake claude: reads its script from state/claude.json, acts in cwd (the
  // worktree), emits stream-json. Each call appends to state/claude.calls.
  const claude = join(state, 'claude.mjs')
  writeFileSync(claude, `
import { appendFileSync, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
const state = process.env.PE_FAKE_STATE
const args = process.argv.slice(2)
const prompt = args[args.indexOf('-p') + 1] ?? ''
appendFileSync(join(state, 'claude.calls'), JSON.stringify({ prompt, cwd: process.cwd() }) + '\\n')
const calls = readFileSync(join(state, 'claude.calls'), 'utf8').trim().split('\\n').length
const script = JSON.parse(readFileSync(join(state, 'claude.json'), 'utf8')).script
const out = (o) => process.stdout.write(JSON.stringify(o) + '\\n')
out({ type: 'system', subtype: 'init' })
const commit = (msg) => {
  execFileSync('git', ['add', '-A'], { cwd: process.cwd() })
  execFileSync('git', ['commit', '-m', msg], { cwd: process.cwd() })
}
if (script === 'sleep') {
  await new Promise((r) => setTimeout(r, 10_000))
} else if (script === 'no-commit') {
  // does nothing
} else if (script === 'fail-then-fix') {
  if (calls === 1) {
    writeFileSync('feature.txt', 'v1\\n')
    writeFileSync('BROKEN', '1\\n')
    commit('feat: attempt one')
  } else {
    rmSync('BROKEN', { force: true })
    writeFileSync('feature.txt', 'v2 fixed\\n')
    commit('fix: make tests pass')
  }
} else if (script === 'always-broken') {
  writeFileSync('BROKEN', String(calls) + '\\n')
  writeFileSync('feature.txt', 'attempt ' + calls + '\\n')
  commit('feat: attempt ' + calls)
} else {
  writeFileSync('feature.txt', 'done\\n')
  commit('feat: implement the task')
}
out({ type: 'result', subtype: 'success', num_turns: 3, usage: { input_tokens: 120, output_tokens: 45 }, duration_ms: 5 })
`)

  // fake tt: red while BROKEN exists in the worktree, green otherwise.
  const tt = join(state, 'tt.mjs')
  writeFileSync(tt, `
import { existsSync } from 'node:fs'
const broken = existsSync('BROKEN')
const verdict = broken
  ? { summary: { failed: 1, passed: 3, runner: 'fake' }, failures: [{ n: 1, head: '✗ broken thing', detail: 'expected 2, got 3' }] }
  : { summary: { failed: 0, passed: 4, runner: 'fake' }, failures: [] }
process.stdout.write(JSON.stringify(verdict) + '\\n')
process.exit(broken ? 1 : 0)
`)

  // fake ght: logs every invocation; answers pr create with a URL.
  const ght = join(state, 'ght.mjs')
  writeFileSync(ght, `
import { appendFileSync } from 'node:fs'
import { join } from 'node:path'
const args = process.argv.slice(2)
appendFileSync(join(process.env.PE_FAKE_STATE, 'ght.log'), JSON.stringify(args) + '\\n')
if (args[0] === 'pr' && args[1] === 'create') process.stdout.write('https://github.com/fake/proj/pull/7\\n')
`)

  // fake cairn: emits the envelope scripted in state/cairn.json.
  const cairn = join(state, 'cairn.mjs')
  writeFileSync(cairn, `
import { appendFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
const state = process.env.PE_FAKE_STATE
appendFileSync(join(state, 'cairn.calls'), JSON.stringify(process.argv.slice(2)) + '\\n')
const s = JSON.parse(readFileSync(join(state, 'cairn.json'), 'utf8'))
const envelope = {
  schema: 'cairn.command-result/1',
  ok: true,
  data: {
    status: s.status,
    findings: s.findings ?? [],
    bundle: 'sha256:' + 'ab'.repeat(32),
  },
}
process.stdout.write(JSON.stringify(envelope) + '\\n')
`)

  writeFileSync(join(state, 'claude.json'), JSON.stringify({ script: 'happy' }))
  writeFileSync(join(state, 'cairn.json'), JSON.stringify({ status: 'PASS' }))
  writeFileSync(join(repo, 'pe.json'), JSON.stringify({
    cairn: { bin: cairn, mode: cairnMode, base: 'main' },
    budgets: { maxTurns: 10, timeoutMin: 5 },
    ...peJson,
  }, null, 2))
  sh('git', ['add', 'pe.json'], repo)
  sh('git', ['commit', '-m', 'add pe config'], repo)
  sh('git', ['push'], repo)

  return { dir, repo, state, evidence, bins: { claude, tt, ght, cairn } }
}

function pe(args, sb, env = {}) {
  return spawnSync(process.execPath, [BIN, ...args], {
    cwd: sb.repo,
    encoding: 'utf8',
    env: {
      ...process.env,
      PE_CLAUDE: sb.bins.claude,
      PE_TT: sb.bins.tt,
      PE_GHT: sb.bins.ght,
      PE_WTREE: WTREE,
      PE_EVIDENCE_DIR: sb.evidence,
      PE_FAKE_STATE: sb.state,
      WTREE_NO_PROC: '1',
      WTREE_GH: '/nonexistent/gh',
      ...env,
    },
  })
}

const setScript = (sb, script) => writeFileSync(join(sb.state, 'claude.json'), JSON.stringify({ script }))
const setCairn = (sb, status, findings) => writeFileSync(join(sb.state, 'cairn.json'), JSON.stringify({ status, findings }))
const ghtLog = (sb) => existsSync(join(sb.state, 'ght.log'))
  ? readFileSync(join(sb.state, 'ght.log'), 'utf8').trim().split('\n').map((l) => JSON.parse(l))
  : []
const claudeCalls = (sb) => existsSync(join(sb.state, 'claude.calls'))
  ? readFileSync(join(sb.state, 'claude.calls'), 'utf8').trim().split('\n').map((l) => JSON.parse(l))
  : []

test('happy path: worktree → implement → verify → real push → ready PR', () => {
  const sb = makeSandbox()
  const r = pe(['run', 'add a friendly greeting'], sb)
  assert.equal(r.status, 0, r.stderr)

  const verdict = decode(r.stdout)
  assert.equal(verdict.state, 'DELIVERED_READY')
  assert.equal(verdict.pr, 'https://github.com/fake/proj/pull/7')
  assert.equal(verdict.tt.failed, 0)
  assert.equal(verdict.tt.passed, 4)
  assert.equal(verdict.turns, 3)
  assert.equal(verdict.tokens, 165)
  assert.match(verdict.branch, /^pe\//)

  // the branch was genuinely pushed to origin
  const branches = sh('git', ['branch', '--list', '--format=%(refname:short)'], join(sb.dir, 'origin.git'))
  assert.match(branches, /pe\//)

  // draft first, then flipped to ready
  const log = ghtLog(sb)
  assert.equal(log[0][1], 'create')
  assert.equal(log[0].includes('--draft'), true)
  assert.deepEqual(log[1].slice(0, 2), ['pr', 'ready'])

  // the delegated prompt carries the Cairn discovery line, no rubric
  const prompt = claudeCalls(sb)[0].prompt
  assert.match(prompt, /review gate executable exists at/)
  assert.doesNotMatch(prompt, /PASS|HUMAN_REQUIRED|BLOCKED/)

  // evidence: sealed record, verdict, and transcript exist outside the repo
  const runDir = join(sb.evidence, repoSlugDir(sb), verdict.run)
  assert.equal(existsSync(join(runDir, 'sealed', 'cairn.json')), true)
  assert.equal(existsSync(join(runDir, 'verdict.json')), true)
  assert.equal(existsSync(join(runDir, 'transcript.jsonl')), true)
})

// evidence root contains exactly one repo slug dir per sandbox
function repoSlugDir(sb) {
  return readdirSync(sb.evidence)[0]
}

test('shadow mode leaks nothing: BLOCKED stays sealed, PR still delivers', () => {
  const sb = makeSandbox()
  setCairn(sb, 'BLOCKED', ['Checkout must never call SAP synchronously'])
  const r = pe(['run', 'change checkout flow'], sb)
  assert.equal(r.status, 0, r.stderr)

  const verdict = decode(r.stdout)
  assert.equal(verdict.state, 'DELIVERED_READY')
  assert.equal(verdict.cairn.recorded, true)
  // no status or finding text anywhere the reviewer can see
  for (const surface of [r.stdout, r.stderr]) {
    assert.doesNotMatch(surface, /BLOCKED|SAP/)
  }
  const bodyPath = join(sb.evidence, repoSlugDir(sb), verdict.run, 'pr-body.md')
  const body = readFileSync(bodyPath, 'utf8')
  assert.doesNotMatch(body, /BLOCKED|SAP/)
  assert.match(body, /sealed for pilot blindness/)
  assert.match(body, /merge_authorized: false/)
  assert.match(body, /pe unseal/)
  // ...but the sealed record has the full envelope
  const sealed = readFileSync(join(sb.evidence, repoSlugDir(sb), verdict.run, 'sealed', 'cairn.json'), 'utf8')
  assert.match(sealed, /BLOCKED/)
  assert.match(sealed, /SAP/)
})

test('tt failure triggers one remediation with the failure evidence, then delivers', () => {
  const sb = makeSandbox()
  setScript(sb, 'fail-then-fix')
  const r = pe(['run', 'tricky feature'], sb)
  assert.equal(r.status, 0, r.stderr)
  assert.equal(decode(r.stdout).state, 'DELIVERED_READY')

  const calls = claudeCalls(sb)
  assert.equal(calls.length, 2)
  assert.match(calls[1].prompt, /tests failing/)
  assert.match(calls[1].prompt, /broken thing/)
})

test('still-red tests end as FAILED_TESTS: no PR, worktree preserved and noted', () => {
  const sb = makeSandbox()
  setScript(sb, 'always-broken')
  const r = pe(['run', 'doomed feature'], sb)
  assert.equal(r.status, 1)

  const verdict = decode(r.stdout)
  assert.equal(verdict.state, 'FAILED_TESTS')
  assert.equal(ghtLog(sb).length, 0)
  assert.equal(claudeCalls(sb).length, 2)
  assert.equal(existsSync(verdict.worktree), true)

  const rows = JSON.parse(spawnSync(process.execPath, [WTREE, 'list', '--json'], {
    cwd: sb.repo, encoding: 'utf8', env: { ...process.env, WTREE_NO_PROC: '1', WTREE_GH: '/nonexistent/gh' },
  }).stdout)
  const row = rows.find((w) => w.branch === verdict.branch)
  assert.equal(row.work, 'pe: FAILED_TESTS')
})

test('uncommitted work triggers remediation asking for a commit', () => {
  const sb = makeSandbox()
  setScript(sb, 'no-commit')
  const r = pe(['run', 'lazy feature'], sb)
  assert.equal(r.status, 1)
  assert.equal(decode(r.stdout).state, 'FAILED_TESTS')
  const calls = claudeCalls(sb)
  assert.equal(calls.length, 2)
  assert.match(calls[1].prompt, /no commits on the branch/)
})

test('wall-clock budget kills the run: ABORTED_BUDGET', () => {
  const sb = makeSandbox({ peJson: { budgets: { maxTurns: 10, timeoutMin: 0.02 } } })
  setScript(sb, 'sleep')
  const r = pe(['run', 'slow feature'], sb)
  assert.equal(r.status, 1)
  assert.equal(decode(r.stdout).state, 'ABORTED_BUDGET')
  assert.equal(ghtLog(sb).length, 0)
})

test('gate mode: persistent BLOCKED delivers a draft with findings in the body, exit 1', () => {
  const sb = makeSandbox({ cairnMode: 'gate' })
  setCairn(sb, 'BLOCKED', ['Checkout must never call SAP synchronously'])
  const r = pe(['run', 'reintroduce sync SAP call'], sb)
  assert.equal(r.status, 1)

  const verdict = decode(r.stdout)
  assert.equal(verdict.state, 'BLOCKED_CAIRN')
  // gate remediation happened (two delegations), PR stayed draft
  assert.equal(claudeCalls(sb).length, 2)
  const log = ghtLog(sb)
  assert.equal(log.length, 1)
  assert.equal(log[0][1], 'create')

  const body = readFileSync(join(sb.evidence, repoSlugDir(sb), verdict.run, 'pr-body.md'), 'utf8')
  assert.match(body, /status: BLOCKED/)
  assert.match(body, /SAP synchronously/)
  assert.match(body, /merge_authorized: false/)
})

test('gate mode: HUMAN_REQUIRED delivers ready and exits 3', () => {
  const sb = makeSandbox({ cairnMode: 'gate' })
  setCairn(sb, 'HUMAN_REQUIRED', [])
  const r = pe(['run', 'ambiguous change'], sb)
  assert.equal(r.status, 3)
  const verdict = decode(r.stdout)
  assert.equal(verdict.state, 'DELIVERED_READY')
  const body = readFileSync(join(sb.evidence, repoSlugDir(sb), verdict.run, 'pr-body.md'), 'utf8')
  assert.match(body, /status: HUMAN_REQUIRED/)
})

test('unseal reveals the record exactly once and logs the outcome', () => {
  const sb = makeSandbox()
  setCairn(sb, 'HUMAN_REQUIRED', ['a sealed finding'])
  const r = pe(['run', 'sealed change'], sb)
  const runId = decode(r.stdout).run

  const first = pe(['unseal', runId, '--outcome', 'strong', '--findings', '1'], sb)
  assert.equal(first.status, 0, first.stderr)
  assert.match(first.stdout, /HUMAN_REQUIRED/)
  assert.match(first.stdout, /a sealed finding/)

  const outcome = JSON.parse(readFileSync(join(sb.evidence, repoSlugDir(sb), runId, 'outcome.json'), 'utf8'))
  assert.equal(outcome.outcome, 'strong')
  assert.equal(outcome.findings, 1)

  const second = pe(['unseal', runId], sb)
  assert.notEqual(second.status, 0)
  assert.match(second.stderr, /already unsealed/)
})

test('report re-prints the latest verdict', () => {
  const sb = makeSandbox()
  const r = pe(['run', 'reportable feature'], sb)
  const runId = decode(r.stdout).run
  const rep = pe(['report'], sb)
  assert.equal(rep.status, 0)
  assert.equal(decode(rep.stdout).run, runId)
})

test('usage errors: no task, unknown flag, bad cairn mode', () => {
  const sb = makeSandbox()
  assert.equal(pe(['run'], sb).status, 2)
  assert.equal(pe(['run', '--bogus', 'x'], sb).status, 2)
  writeFileSync(join(sb.repo, 'pe.json'), JSON.stringify({ cairn: { bin: sb.bins.cairn, mode: 'loud' } }))
  assert.equal(pe(['run', 'x'], sb).status, 2)
  assert.match(pe(['--help'], sb).stdout, /^pe: principal-engineer/)
})

// ---- policy hook -----------------------------------------------------------

function hook(input, env = {}) {
  return spawnSync(process.execPath, [HOOK], {
    input: JSON.stringify(input),
    encoding: 'utf8',
    env: { ...process.env, ...env },
  })
}

test('hook blocks delivery, memory admission, and evidence writes; allows work', () => {
  const bash = (command) => ({ tool_name: 'Bash', tool_input: { command } })
  assert.equal(hook(bash('git push origin main')).status, 2)
  assert.equal(hook(bash('git commit -m x && git push')).status, 2)
  assert.equal(hook(bash('gh pr create --title x')).status, 2)
  assert.equal(hook(bash('ght pr ready 7')).status, 2)
  assert.equal(hook(bash('./cairn --repo . remember "rule" --ref PR-1')).status, 2)
  assert.equal(hook(bash('cairn labs list')).status, 2)
  assert.equal(hook(bash('wtree rm feat/x --force')).status, 2)
  assert.equal(hook(bash('echo hi > /tmp/pe-ev/x'), { PE_EVIDENCE_DIR: '/tmp/pe-ev' }).status, 2)

  assert.equal(hook(bash('git commit -m "feat: x"')).status, 0)
  assert.equal(hook(bash('tt')).status, 0)
  assert.equal(hook(bash('./cairn --repo . review feat/x --base main --format toon')).status, 0)
  assert.equal(hook(bash('cairn capabilities --format toon')).status, 0)

  const write = (file_path) => ({ tool_name: 'Write', tool_input: { file_path } })
  assert.equal(hook(write('/tmp/pe-ev/sealed/cairn.json'), { PE_EVIDENCE_DIR: '/tmp/pe-ev' }).status, 2)
  assert.equal(hook(write('/anywhere/else.txt'), { PE_EVIDENCE_DIR: '/tmp/pe-ev' }).status, 0)
  assert.equal(hook({ tool_name: 'Read', tool_input: {} }).status, 0)
})
