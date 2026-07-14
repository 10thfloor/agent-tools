#!/usr/bin/env node
import { runPe } from '../src/cli.js'

process.exit(await runPe(process.argv.slice(2)))
