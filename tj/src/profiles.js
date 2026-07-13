import { basename } from 'node:path'

// A profile describes what a CLI's JSON carries that agents never read.
export const PROFILES = {
  generic: {},
  github: {
    dropKeys: new Set(['node_id', 'gravatar_id', '_links', 'performed_via_github_app']),
    urlKeep: new Set(['url', 'html_url']), // other *_url keys are dropped
    collapseEntities: true, // users→login, repos→full_name, labels→names
    verificationTrim: true, // PGP blobs → {verified, reason}
  },
  kubernetes: {
    dropKeys: new Set(['managedFields', 'selfLink']),
    annotationsDrop: ['kubectl.kubernetes.io/last-applied-configuration'],
  },
  aws: {
    dropKeys: new Set(['ResponseMetadata']),
  },
}

const COMMAND_PROFILES = { gh: 'github', kubectl: 'kubernetes', oc: 'kubernetes', aws: 'aws' }

export function profileNameFor(command) {
  // Strip the directory and any executable extension so gh / gh.exe /
  // /usr/bin/kubectl / kubectl.cmd all resolve to their profile.
  const name = basename(command ?? '').replace(/\.(exe|cmd|bat|com|mjs|cjs|js|ps1)$/i, '')
  return COMMAND_PROFILES[name] ?? 'generic'
}

const LABEL_KEYS = new Set(['id', 'node_id', 'url', 'name', 'color', 'default', 'description'])
// Untrusted JSON keys that could retarget the output object's prototype.
const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype'])

export function prune(value, profile) {
  return walk(value, profile, 0)
}

function walk(value, p, depth) {
  if (Array.isArray(value)) {
    if (p.collapseEntities && depth > 0 && value.length === 0) return ''
    const items = value.map((v) => walk(v, p, depth + 1))
    if (
      p.collapseEntities
      && items.length > 0
      && items.every((v) => typeof v === 'string')
      && value.every((v) => typeof v === 'object' && v !== null)
    ) return items.join(', ')
    return items
  }
  if (value === null || typeof value !== 'object') return value
  if (p.collapseEntities && depth > 0) {
    if (typeof value.login === 'string') return value.login
    if (typeof value.full_name === 'string') return value.full_name
    if (typeof value.name === 'string' && Object.keys(value).every((k) => LABEL_KEYS.has(k))) return value.name
  }
  const out = {}
  for (const [key, v] of Object.entries(value)) {
    if (UNSAFE_KEYS.has(key)) continue
    if (p.dropKeys?.has(key)) continue
    if (p.urlKeep && key.endsWith('_url') && !p.urlKeep.has(key)) continue
    if (p.verificationTrim && key === 'verification' && v && typeof v === 'object') {
      out[key] = { verified: v.verified, reason: v.reason }
      continue
    }
    if (p.annotationsDrop && key === 'annotations' && v && typeof v === 'object') {
      const kept = Object.fromEntries(Object.entries(v).filter(([a]) => !p.annotationsDrop.includes(a)))
      if (Object.keys(kept).length) out[key] = kept
      continue
    }
    out[key] = walk(v, p, depth + 1)
  }
  return out
}
