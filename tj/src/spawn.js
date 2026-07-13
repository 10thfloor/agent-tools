import { existsSync } from 'node:fs'
import { delimiter, extname, join } from 'node:path'

// Normalize a (command, args, options) triple for cross-platform spawning
// with spawn / spawnSync / execFile. Returns [command, args, options].
//
// - A .js/.mjs/.cjs target runs under the current Node binary, with no reliance
//   on a shebang or the executable bit (neither works on Windows).
// - On Windows, .cmd/.bat shims (npm, the wtree link, most JS CLIs) cannot be
//   spawned without a shell since Node's CVE-2024-27980 fix, so those route
//   through cmd.exe with args quoted for it. Real .exe programs (git, gh,
//   cargo, go, node) still spawn directly with a literal arg array (no shell).
export function prepSpawn(cmd, args = [], opts = {}) {
  if (/\.[cm]?js$/i.test(cmd)) return [process.execPath, [cmd, ...args], opts]
  if (process.platform === 'win32' && isBatchShim(cmd)) {
    return [cmd, args.map(winQuote), { ...opts, shell: true }]
  }
  return [cmd, args, opts]
}

function isBatchShim(cmd) {
  // An explicit path or an extension decides from the name alone.
  if (cmd.includes('/') || cmd.includes('\\') || extname(cmd)) return /\.(cmd|bat)$/i.test(cmd)
  // Bare name: resolve against PATH × PATHEXT; a .cmd/.bat hit needs a shell.
  const dirs = (process.env.PATH || '').split(delimiter).filter(Boolean)
  const exts = (process.env.PATHEXT || '.COM;.EXE;.BAT;.CMD').split(';').map((e) => e.trim()).filter(Boolean)
  for (const dir of dirs) {
    for (const e of exts) {
      if (existsSync(join(dir, cmd + e))) return /\.(cmd|bat)$/i.test(e)
    }
  }
  return true // unresolved bare name: assume a shim so it at least runs
}

// Node passes shell:true args to cmd.exe unquoted; protect spaces and cmd
// metacharacters. cmd escapes an embedded double-quote by doubling it. Note:
// %VAR% / !VAR! expansion cannot be fully suppressed on a cmd line even when
// quoted; an unavoidable cmd limitation for args reaching a .cmd/.bat shim.
function winQuote(a) {
  if (a === '') return '""'
  if (!/[\s"&|<>^()%!]/.test(a)) return a
  return '"' + a.replace(/"/g, '""') + '"'
}
