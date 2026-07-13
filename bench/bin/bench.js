#!/usr/bin/env node
import { runBench } from '../src/cli.js'

try {
  process.exitCode = await runBench(process.argv.slice(2))
} catch (err) {
  process.stderr.write(`bench: ${err?.stack || err?.message || err}\n`)
  process.exitCode = 1
}
