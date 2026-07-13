#!/usr/bin/env node
import { runFleet } from '../src/cli.js'

try {
  process.exitCode = await runFleet(process.argv.slice(2))
} catch (err) {
  process.stderr.write(`fleet: ${err?.stack || err?.message || err}\n`)
  process.exitCode = 1
}
