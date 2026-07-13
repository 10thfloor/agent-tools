// "5k" → 5000, "1.5k" → 1500, "2m" → 2000000, "800" → 800; null if invalid.
export function parseBudget(s) {
  const m = /^(\d+(?:\.\d+)?)([km]?)$/i.exec(String(s).trim())
  if (!m) return null
  const mult = { '': 1, k: 1000, m: 1000000 }[m[2].toLowerCase()]
  return Math.round(Number(m[1]) * mult)
}

export function buildRow(name, text, countTokens, max) {
  const tokens = countTokens(text)
  return {
    name,
    tokens,
    bytes: Buffer.byteLength(text),
    lines: text === '' ? 0 : text.split('\n').length,
    ...(max != null ? { over: tokens > max } : {}),
  }
}

export function isBinary(buf) {
  return buf.includes(0)
}
