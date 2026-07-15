import { sh } from './exec.js'

// Fire-and-forget desktop notification on a terminal state. Degrades
// silently by contract: no notifier, no problem. PE_NOTIFY overrides the
// platform notifier (and is the testing seam); it is invoked as
//   <bin> <state> <message>
export function notify(state, message, env = process.env) {
  try {
    if (env.PE_NOTIFY) {
      sh(env.PE_NOTIFY, [state, message])
    } else if (process.platform === 'darwin') {
      sh('osascript', ['-e', `display notification ${JSON.stringify(message)} with title ${JSON.stringify(`pe: ${state}`)}`])
    } else if (process.platform === 'linux') {
      sh('notify-send', [`pe: ${state}`, message])
    }
  } catch { /* silent by contract */ }
}
