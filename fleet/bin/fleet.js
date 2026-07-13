#!/usr/bin/env node
import { runFleet } from '../src/cli.js'

process.exitCode = await runFleet(process.argv.slice(2))
