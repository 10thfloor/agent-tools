import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { sh } from './exec.js'

// Environment preflight: every dependency pe drives, probed the way pe
// drives it. Any 'fail' row means the next `pe run` would end in ERROR.
export function runDoctor({ repo, cfg }) {
  const rows = []
  const check = (name, fn) => {
    try {
      rows.push({ check: name, status: 'ok', detail: fn() ?? '' })
    } catch (e) {
      rows.push({ check: name, status: 'fail', detail: e.message })
    }
  }
  const probe = (bin, args) => {
    const r = sh(bin, args, { cwd: repo })
    if (r.error) throw new Error(r.error.message)
    if (r.status !== 0) throw new Error((r.stderr || '').trim().split('\n')[0] || `exited ${r.status}`)
    return (r.stdout || '').trim().split('\n')[0].slice(0, 60)
  }

  check('node >= 22', () => {
    if (Number(process.versions.node.split('.')[0]) < 22) throw new Error(`running ${process.version}`)
    return process.version
  })
  check('git', () => probe(cfg.bins.git, ['--version']))
  check('claude', () => probe(cfg.bins.claude, ['--version']))
  check('wtree', () => {
    probe(cfg.bins.wtree, ['--help'])
    return 'on PATH'
  })
  check('tt', () => {
    probe(cfg.bins.tt, ['--tt-help'])
    return 'on PATH'
  })
  check('ght', () => {
    probe(cfg.bins.ght, ['--ght-help'])
    return 'on PATH'
  })
  check('git repo', () => {
    probe(cfg.bins.git, ['-C', repo, 'rev-parse', '--git-dir'])
    return repo
  })
  check('origin remote', () => probe(cfg.bins.git, ['-C', repo, 'remote', 'get-url', 'origin']))
  check('gh auth', () => {
    probe(cfg.bins.ght, ['auth', 'status'])
    return 'authenticated'
  })
  if (cfg.cairn) {
    check(`cairn (${cfg.cairn.mode})`, () => {
      probe(cfg.cairn.bin, ['capabilities', '--format', 'json'])
      return 'responds'
    })
  }
  check('evidence dir writable', () => {
    mkdirSync(cfg.evidenceDir, { recursive: true })
    const probeFile = join(cfg.evidenceDir, `.pe-doctor-${process.pid}`)
    writeFileSync(probeFile, 'ok')
    rmSync(probeFile)
    return cfg.evidenceDir
  })
  return rows
}
