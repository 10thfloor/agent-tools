import { encode } from '@toon-format/toon'
import { parseJsonValues, mergeValues } from './jsonish.js'
import { prune } from './prune.js'
import { DELIMITERS } from './flags.js'

// Returns the converted text (no trailing newline), or null when the input
// is not JSON and must pass through untouched.
export function convert(text, opts) {
  const values = parseJsonValues(text)
  if (!values) return null
  let data = mergeValues(values)
  if (opts.prune) data = prune(data)
  if (opts.format === 'json') return JSON.stringify(data)
  return encode(data, { delimiter: DELIMITERS[opts.delimiter] ?? ',' })
}
