import { encode } from '@toon-format/toon'
import { parseJsonValues, mergeValues } from './jsonish.js'
import { PROFILES, prune } from './profiles.js'
import { DELIMITERS } from './flags.js'

// Converted text (no trailing newline), or null → pass through untouched.
export function convert(text, opts, profileName) {
  const values = parseJsonValues(text)
  if (!values) return null
  let data = mergeValues(values)
  if (opts.prune) data = prune(data, PROFILES[profileName] ?? PROFILES.generic)
  if (opts.format === 'json') return JSON.stringify(data)
  return encode(data, { delimiter: DELIMITERS[opts.delimiter] ?? ',' })
}
