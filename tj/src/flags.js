import { PROFILES } from './profiles.js'

export const DELIMITERS = { comma: ',', tab: '\t', pipe: '|' }

export const USAGE = `tj — run any CLI, re-emit its JSON output as TOON for token efficiency

Usage: tj <command> [args...]

Prune profiles (auto-detected from the command name, --tj-profile overrides):
  gh → github        kubectl/oc → kubernetes        aws → aws
  anything else → generic (TOON encoding only, no pruning)

Flags consumed by tj (never forwarded):
  --tj-raw               pure passthrough
  --tj-no-prune          TOON but full JSON shapes
  --tj-json              pruned minified JSON instead of TOON
  --tj-profile=<name>    generic | github | kubernetes | aws
  --tj-delimiter=<d>     comma (default) | tab | pipe
  --tj-no-stats          no tokens-saved footer on stderr
  --tj-help              this help

Environment: TJ_RAW=1, TJ_PRUNE=0, TJ_STATS=0, TJ_PROFILE, TJ_DELIMITER
`

export class UsageError extends Error {}

export function parseArgs(argv, env = process.env) {
  const cmd = []
  const opts = {
    raw: env.TJ_RAW === '1',
    prune: env.TJ_PRUNE !== '0',
    stats: env.TJ_STATS !== '0',
    delimiter: env.TJ_DELIMITER || 'comma',
    profile: env.TJ_PROFILE || null,
    format: 'toon',
    help: false,
  }
  for (const arg of argv) {
    if (arg === '--tj-raw') opts.raw = true
    else if (arg === '--tj-no-prune') opts.prune = false
    else if (arg === '--tj-json') opts.format = 'json'
    else if (arg === '--tj-no-stats') opts.stats = false
    else if (arg === '--tj-help') opts.help = true
    else if (arg.startsWith('--tj-profile=')) opts.profile = arg.slice('--tj-profile='.length)
    else if (arg.startsWith('--tj-delimiter=')) opts.delimiter = arg.slice('--tj-delimiter='.length)
    else if (arg.startsWith('--tj-')) throw new UsageError(`tj: unknown flag ${arg}`)
    else cmd.push(arg)
  }
  if (!(Object.hasOwn(DELIMITERS, opts.delimiter))) throw new UsageError(`tj: invalid delimiter "${opts.delimiter}"`)
  if (opts.profile && !(Object.hasOwn(PROFILES, opts.profile))) {
    throw new UsageError(`tj: unknown profile "${opts.profile}" (${Object.keys(PROFILES).join(', ')})`)
  }
  return { cmd, opts }
}
