export const DELIMITERS = { comma: ',', tab: '\t', pipe: '|' }

export const USAGE = `ght — gh wrapper that re-emits JSON output as TOON for token efficiency

Usage: ght <any gh arguments>

Flags consumed by ght (never forwarded to gh):
  --ght-raw              pure passthrough, no capture or conversion
  --ght-no-prune         full fidelity: no noise-field pruning, no entity
                         collapsing (users→login, repos→full_name, labels→names)
  --ght-json             prune + minified JSON instead of TOON
  --ght-delimiter=<d>    comma (default) | tab | pipe
  --ght-no-stats         no tokens-saved footer on stderr after conversions
  --ght-help             show this help

Environment: GHT_RAW=1, GHT_PRUNE=0, GHT_STATS=0, GHT_DELIMITER, GHT_GH_PATH
`

export class UsageError extends Error {}

export function parseArgs(argv, env = process.env) {
  const gh = []
  const opts = {
    raw: env.GHT_RAW === '1',
    prune: env.GHT_PRUNE !== '0',
    delimiter: env.GHT_DELIMITER || 'comma',
    format: 'toon',
    stats: env.GHT_STATS !== '0',
    help: false,
  }
  for (const arg of argv) {
    if (arg === '--ght-raw') opts.raw = true
    else if (arg === '--ght-no-prune') opts.prune = false
    else if (arg === '--ght-json') opts.format = 'json'
    else if (arg === '--ght-no-stats') opts.stats = false
    else if (arg === '--ght-help') opts.help = true
    else if (arg.startsWith('--ght-delimiter=')) opts.delimiter = arg.slice('--ght-delimiter='.length)
    else if (arg.startsWith('--ght-')) throw new UsageError(`ght: unknown flag ${arg}`)
    else gh.push(arg)
  }
  if (!(Object.hasOwn(DELIMITERS, opts.delimiter))) {
    throw new UsageError(`ght: invalid delimiter "${opts.delimiter}" (tab, comma, pipe)`)
  }
  return { opts, gh }
}
