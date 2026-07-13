// Tolerant parsing of gh stdout: a single JSON value, several concatenated
// top-level values (`gh api --paginate` emits pages back-to-back), or NDJSON.
// Returns an array of parsed values, or null if the text is not pure JSON.
export function parseJsonValues(text) {
  const s = text.trim()
  if (!s || (s[0] !== '{' && s[0] !== '[')) return null
  const values = []
  let i = 0
  while (i < s.length) {
    const end = scanValue(s, i)
    if (end === -1) return null
    try {
      values.push(JSON.parse(s.slice(i, end)))
    } catch {
      return null
    }
    i = end
    while (i < s.length && /\s/.test(s[i])) i++
  }
  return values
}

// Find the end index (exclusive) of one balanced {...} or [...] value.
function scanValue(s, start) {
  if (s[start] !== '{' && s[start] !== '[') return -1
  let depth = 0
  let inString = false
  let escaped = false
  for (let i = start; i < s.length; i++) {
    const c = s[i]
    if (inString) {
      if (escaped) escaped = false
      else if (c === '\\') escaped = true
      else if (c === '"') inString = false
      continue
    }
    if (c === '"') inString = true
    else if (c === '{' || c === '[') depth++
    else if (c === '}' || c === ']') {
      depth--
      if (depth === 0) return i + 1
    }
  }
  return -1
}

// Paginated pages of the same endpoint merge into one array; anything else
// heterogeneous stays a list of values.
export function mergeValues(values) {
  if (values.length === 1) return values[0]
  return values.every(Array.isArray) ? values.flat() : values
}
