import { spawn } from 'node:child_process'
import { appendFileSync } from 'node:fs'
import { prepSpawn } from './spawn.js'

// One headless Claude Code delegation. Streams stream-json lines to the
// transcript as they arrive (crash-safe evidence), captures the final result
// event, and enforces the wall-clock budget by killing the child.
export function delegate({ bin, prompt, cwd, maxTurns, timeoutMs, transcriptPath, env, onEvent }) {
  return new Promise((resolvePromise) => {
    const args = ['-p', prompt, '--output-format', 'stream-json', '--verbose', '--max-turns', String(maxTurns)]
    const [cmd, argv, opts] = prepSpawn(bin, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] })
    let child
    try {
      child = spawn(cmd, argv, opts)
    } catch (err) {
      return resolvePromise({ code: -1, result: null, timedOut: false, stderr: String(err.message) })
    }
    let buf = ''
    let stderr = ''
    let result = null
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      child.kill('SIGKILL')
    }, timeoutMs)
    const takeLine = (line) => {
      if (!line.trim()) return
      appendFileSync(transcriptPath, line + '\n')
      try {
        const ev = JSON.parse(line)
        if (ev.type === 'result') result = ev
        if (onEvent) onEvent(ev)
      } catch { /* non-JSON line; kept in transcript anyway */ }
    }
    child.stdout.on('data', (d) => {
      buf += d
      let nl
      while ((nl = buf.indexOf('\n')) !== -1) {
        takeLine(buf.slice(0, nl))
        buf = buf.slice(nl + 1)
      }
    })
    child.stderr.on('data', (d) => { stderr += d })
    child.on('error', (err) => {
      clearTimeout(timer)
      resolvePromise({ code: -1, result: null, timedOut, stderr: stderr + String(err.message) })
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      takeLine(buf) // a final line without a trailing newline still counts
      resolvePromise({ code, result, timedOut, stderr })
    })
  })
}

export function usageOf(result) {
  const u = result?.usage ?? {}
  return {
    turns: result?.num_turns ?? 0,
    tokens: (u.input_tokens ?? 0) + (u.output_tokens ?? 0),
  }
}
