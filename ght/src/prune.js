// GitHub payloads carry structure agents pay for but essentially never read.
// Default (opt out with --ght-no-prune):
//   - drop hypermedia noise: node_id, gravatar_id, _links,
//     performed_via_github_app, and any *_url key except url / html_url
//   - collapse embedded entities (never the root value): objects with a
//     `login` become the login, objects with a `full_name` become the
//     full_name, label-shaped objects become the label name
//   - arrays whose elements all collapsed to strings join into one
//     comma-separated string, and empty arrays below the root become "",
//     so TOON can keep rows tabular
//   - commit `verification` keeps only {verified, reason} (drops PGP blobs)
// Guard against special keys in untrusted JSON reshaping the output object's
// prototype chain (assigning `out.__proto__ = {...}` retargets the prototype).
const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype'])
const DROP_KEYS = new Set(['node_id', 'gravatar_id', '_links', 'performed_via_github_app'])
const KEEP_URL_KEYS = new Set(['url', 'html_url'])
const LABEL_KEYS = new Set(['id', 'node_id', 'url', 'name', 'color', 'default', 'description'])

export function prune(value) {
  return walk(value, 0)
}

function walk(value, depth) {
  if (Array.isArray(value)) {
    if (value.length === 0) return depth > 0 ? '' : value
    const items = value.map((v) => walk(v, depth + 1))
    const allEntities = items.every((v) => typeof v === 'string')
      && value.every((v) => typeof v === 'object' && v !== null)
    return allEntities ? items.join(', ') : items
  }
  if (value === null || typeof value !== 'object') return value
  if (depth > 0) {
    if (typeof value.login === 'string') return value.login
    if (typeof value.full_name === 'string') return value.full_name
    if (isLabelShape(value)) return value.name
  }
  const out = {}
  for (const [key, v] of Object.entries(value)) {
    if (UNSAFE_KEYS.has(key)) continue
    if (DROP_KEYS.has(key)) continue
    if (key.endsWith('_url') && !KEEP_URL_KEYS.has(key)) continue
    if (key === 'verification' && v && typeof v === 'object') {
      out[key] = { verified: v.verified, reason: v.reason }
      continue
    }
    out[key] = walk(v, depth + 1)
  }
  return out
}

function isLabelShape(value) {
  return typeof value.name === 'string' && Object.keys(value).every((k) => LABEL_KEYS.has(k))
}
