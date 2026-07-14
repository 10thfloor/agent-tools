import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const DEFAULTS = {
  budgets: { maxTurns: 50, timeoutMin: 30 },
  retries: { verify: 1 },
  pr: { readyOnGreen: true },
}

// pe.json at the repo root, env overrides on top (the suite's testing seam).
export function loadConfig(repo, env = process.env) {
  const path = join(repo, 'pe.json')
  let file = {}
  if (existsSync(path)) {
    try {
      file = JSON.parse(readFileSync(path, 'utf8'))
    } catch (err) {
      throw new UsageError(`pe: invalid pe.json: ${err.message}`)
    }
  }
  const cfg = {
    cairn: file.cairn ? { mode: 'shadow', base: 'main', ...file.cairn } : null,
    budgets: { ...DEFAULTS.budgets, ...file.budgets },
    retries: { ...DEFAULTS.retries, ...file.retries },
    pr: { ...DEFAULTS.pr, ...file.pr },
    evidenceDir: env.PE_EVIDENCE_DIR || file.evidence?.dir || join(homedir(), '.pe', 'evidence'),
    bins: {
      claude: env.PE_CLAUDE || 'claude',
      wtree: env.PE_WTREE || 'wtree',
      tt: env.PE_TT || 'tt',
      ght: env.PE_GHT || 'ght',
      git: env.PE_GIT || 'git',
    },
  }
  cfg.evidenceDir = cfg.evidenceDir.replace(/^~(?=$|[\\/])/, homedir())
  if (cfg.cairn) {
    if (env.PE_CAIRN) cfg.cairn.bin = env.PE_CAIRN
    if (!cfg.cairn.bin) throw new UsageError('pe: cairn config needs a bin path')
    if (!['shadow', 'gate'].includes(cfg.cairn.mode)) {
      throw new UsageError(`pe: cairn.mode must be shadow or gate, not "${cfg.cairn.mode}"`)
    }
  }
  return cfg
}

export class UsageError extends Error {}
