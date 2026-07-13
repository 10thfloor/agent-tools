import { spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

export function defaultCommand(cwd) {
  const pkg = join(cwd, 'package.json')
  if (existsSync(pkg)) {
    try {
      if (JSON.parse(readFileSync(pkg, 'utf8')).scripts?.test) return ['npm', 'test', '--silent']
    } catch {
      /* fall through */
    }
  }
  if (['pytest.ini', 'pyproject.toml', 'setup.cfg'].some((f) => existsSync(join(cwd, f)))) return ['pytest']
  if (existsSync(join(cwd, 'Cargo.toml'))) return ['cargo', 'test']
  if (existsSync(join(cwd, 'go.mod'))) return ['go', 'test', './...']
  return null
}

// Run the child, capturing stdout+stderr interleaved by arrival; echo them
// through live when requested (TTY mode).
export function run(cmd, { echo }) {
  return new Promise((resolve) => {
    // tt's child is always a fresh top-level run; NODE_TEST_CONTEXT would
    // make a nested `node --test` behave as a runner-internal child process.
    const env = { ...process.env }
    delete env.NODE_TEST_CONTEXT
    const child = spawn(cmd[0], cmd.slice(1), { stdio: ['inherit', 'pipe', 'pipe'], env })
    let text = ''
    child.stdout.on('data', (d) => {
      text += d
      if (echo) process.stdout.write(d)
    })
    child.stderr.on('data', (d) => {
      text += d
      if (echo) process.stderr.write(d)
    })
    child.on('error', (err) => resolve({ text: `tt: failed to run ${cmd[0]}: ${err.message}\n`, code: 127 }))
    child.on('close', (code) => resolve({ text, code: code ?? 1 }))
  })
}
