import { spawnSync } from 'node:child_process'
import { prepSpawn } from './spawn.js'

// The suite's spawn wrapper, once: cross-platform prep + utf8 capture.
export const sh = (bin, args, opts = {}) =>
  spawnSync(...prepSpawn(bin, args, { encoding: 'utf8', ...opts }))
