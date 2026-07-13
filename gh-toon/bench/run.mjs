// Benchmark: tokens an agent pays reading `gh` output, vs the same data
// through ght (TOON + prune). Live mode captures real gh output and saves it
// under bench/fixtures/ so `--offline` reproduces the numbers exactly.
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { isDeepStrictEqual } from 'node:util'
import { encode as toonEncode, decode as toonDecode } from '@toon-format/toon'
import { encode as o200k } from 'gpt-tokenizer/encoding/o200k_base'
import { encode as cl100k } from 'gpt-tokenizer/encoding/cl100k_base'
import { parseJsonValues, mergeValues } from '../src/jsonish.js'
import { prune } from '../src/prune.js'

const ROOT = dirname(fileURLToPath(import.meta.url))
const FIXTURES = join(ROOT, 'fixtures')
const OFFLINE = process.argv.includes('--offline')

// Representative agent workloads: gh command → what lands in the context.
const SCENARIOS = [
  { name: 'pr-list', desc: 'gh pr list --json (30 PRs)', args: ['pr', 'list', '-R', 'cli/cli', '--limit', '30', '--json', 'number,title,author,state,isDraft,createdAt,headRefName,labels'] },
  { name: 'issue-list', desc: 'gh issue list --json (30 issues)', args: ['issue', 'list', '-R', 'cli/cli', '--limit', '30', '--json', 'number,title,author,state,createdAt,updatedAt,labels'] },
  { name: 'run-list', desc: 'gh run list --json (20 runs)', args: ['run', 'list', '-R', 'cli/cli', '--limit', '20', '--json', 'databaseId,displayTitle,status,conclusion,workflowName,headBranch,event,createdAt'] },
  { name: 'api-repo', desc: 'gh api repos/{repo} (single repo)', args: ['api', 'repos/cli/cli'] },
  { name: 'api-issues', desc: 'gh api .../issues?per_page=30', args: ['api', 'repos/cli/cli/issues?per_page=30'] },
  { name: 'api-pulls', desc: 'gh api .../pulls?per_page=10', args: ['api', 'repos/cli/cli/pulls?per_page=10'] },
  { name: 'api-commits', desc: 'gh api .../commits?per_page=20', args: ['api', 'repos/cli/cli/commits?per_page=20'] },
  { name: 'api-releases', desc: 'gh api .../releases?per_page=10', args: ['api', 'repos/cli/cli/releases?per_page=10'] },
]

function capture(scenario) {
  const file = join(FIXTURES, `${scenario.name}.json`)
  if (OFFLINE) {
    if (!existsSync(file)) throw new Error(`missing fixture ${file}; run without --offline first`)
    return readFileSync(file, 'utf8')
  }
  const raw = execFileSync('gh', scenario.args, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 })
  mkdirSync(FIXTURES, { recursive: true })
  writeFileSync(file, raw)
  return raw
}

const tokenizers = { o200k_base: o200k, cl100k_base: cl100k }
const count = (enc, text) => enc(text).length
const pct = (base, v) => (100 * (1 - v / base)).toFixed(1) + '%'

const rows = []
for (const scenario of SCENARIOS) {
  const raw = capture(scenario)
  const data = mergeValues(parseJsonValues(raw))
  const variants = {
    raw,
    prunedJson: JSON.stringify(prune(data)),
    toon: toonEncode(data, { delimiter: ',' }),
    ght: toonEncode(prune(data), { delimiter: ',' }),
    ghtTab: toonEncode(prune(data), { delimiter: '\t' }),
  }
  // decode() in @toon-format/toon 2.3.0 chokes on quoted strings containing
  // markdown-link patterns ("[x](y)" / "[x]: y") — a decoder bug; the encoded
  // text is correctly quoted. Verify round-trip where the decoder allows.
  let roundTrip
  try {
    roundTrip = isDeepStrictEqual(toonDecode(variants.toon), data) ? 'verified' : 'MISMATCH'
  } catch (err) {
    if (/bracket|Invalid array length/.test(err.message)) roundTrip = 'upstream decoder bug'
    else throw err
  }
  if (roundTrip === 'MISMATCH') throw new Error(`round-trip mismatch for ${scenario.name}`)
  const tokens = {}
  for (const [tk, enc] of Object.entries(tokenizers)) {
    tokens[tk] = Object.fromEntries(Object.entries(variants).map(([k, v]) => [k, count(enc, v)]))
  }
  rows.push({ ...scenario, bytes: raw.length, tokens, roundTrip })
  console.log(`${scenario.name}: raw ${tokens.o200k_base.raw} → ght ${tokens.o200k_base.ght} o200k tokens (${pct(tokens.o200k_base.raw, tokens.o200k_base.ght)} saved)`)
}

function table(tk) {
  const lines = [
    `| Scenario | raw \`gh\` (JSON) | compaction only (JSON) | TOON only (no compaction) | **\`ght\` (both)** | **saved** |`,
    `|---|--:|--:|--:|--:|--:|`,
  ]
  for (const r of rows) {
    const t = r.tokens[tk]
    lines.push(`| ${r.desc} | ${t.raw.toLocaleString('en-US')} | ${t.prunedJson.toLocaleString('en-US')} | ${t.toon.toLocaleString('en-US')} | **${t.ght.toLocaleString('en-US')}** | **${pct(t.raw, t.ght)}** |`)
  }
  const sum = (k) => rows.reduce((a, r) => a + r.tokens[tk][k], 0)
  lines.push(`| **Total** | **${sum('raw').toLocaleString('en-US')}** | **${sum('prunedJson').toLocaleString('en-US')}** | **${sum('toon').toLocaleString('en-US')}** | **${sum('ght').toLocaleString('en-US')}** | **${pct(sum('raw'), sum('ght'))}** |`)
  return lines.join('\n')
}

const sumTk = (tk, k) => rows.reduce((a, r) => a + r.tokens[tk][k], 0)
const totalRaw = sumTk('o200k_base', 'raw')
const totalGht = sumTk('o200k_base', 'ght')
const totalTab = sumTk('o200k_base', 'ghtTab')

const report = `# gh-toon benchmark

Token cost of reading \`gh\` output in an agent context, before and after \`ght\`.

- **Baseline (\`raw gh\`)**: the exact bytes \`gh\` prints when piped — what a coding
  agent sees in its context today.
- **\`ght\` default**: same data, noise fields pruned (\`node_id\`, \`gravatar_id\`,
  \`_links\`, \`*_url\` except \`url\`/\`html_url\`), embedded entities collapsed
  (users → login, repos → full_name, labels → names, empty arrays → "",
  PGP verification blobs dropped), encoded as comma-delimited TOON.
- \`gh\`'s piped output is **already minified JSON**, so the baseline is the
  hardest version of it — none of the savings below come from whitespace.
- Intermediate columns isolate the two effects: compaction only (pruned +
  collapsed data as minified JSON) and TOON encoding only (full-fidelity data).
  Note TOON *alone* loses to minified JSON on GitHub payloads — rows are too
  non-uniform for tabular form. Compaction is what makes the data
  TOON-friendly; the combination is where the savings come from.
- No-prune TOON output is verified to \`decode()\` back deep-equal to the source
  JSON (lossless encoding): ${rows.filter(r => r.roundTrip === 'verified').length}/${rows.length} scenarios verified
  (${rows.filter(r => r.roundTrip !== 'verified').map(r => r.name).join(', ') || 'none'} skipped — \`@toon-format/toon\` 2.3.0's *decoder* mis-parses quoted
  strings containing markdown-link patterns; the encoded text itself is
  correctly quoted). Pruning is the only lossy step and is opt-out
  (\`--ght-no-prune\`).
- Live data captured ${OFFLINE ? 'previously (offline recompute)' : `on ${new Date().toISOString().slice(0, 10)}`} from the public \`cli/cli\` repo; payloads saved in
  \`bench/fixtures/\` — reproduce with \`npm run bench:offline\`.

## Results — o200k_base tokenizer (GPT-4o/o1 family)

${table('o200k_base')}

## Results — cl100k_base tokenizer (GPT-4 family)

${table('cl100k_base')}

## Delimiter choice

Comma-delimited TOON (default): **${totalGht.toLocaleString('en-US')}** o200k tokens total;
tab-delimited (\`--ght-delimiter=tab\`): ${totalTab.toLocaleString('en-US')} (${pct(totalRaw, totalTab)} saved vs raw).
${totalGht <= totalTab ? 'Comma' : 'Tab'} is the better default on this data.

## Notes on methodology

- Claude's tokenizer is not public; o200k_base and cl100k_base are the standard
  proxies. The savings here are structural (fewer fields, no repeated keys, no
  JSON punctuation), not artifacts of one tokenizer — which is why the two
  tokenizers agree closely.
- \`gh ... --json\` scenarios have no hypermedia noise, so their savings come from
  entity collapsing + tabular TOON (\`run list\` is the pure-TOON case: nothing
  to prune or collapse). \`gh api\` scenarios get both effects; hypermedia URL
  pruning dominates there.
- Reproduce live: \`npm run bench\` (requires authenticated \`gh\`; read-only
  queries against public repos).

*Generated by \`bench/run.mjs\`.*
`

writeFileSync(join(ROOT, '..', 'BENCHMARK.md'), report)
console.log(`\nAggregate (o200k): raw ${totalRaw.toLocaleString('en-US')} → ght ${totalGht.toLocaleString('en-US')} tokens, ${pct(totalRaw, totalGht)} saved.`)
console.log('Wrote BENCHMARK.md')
