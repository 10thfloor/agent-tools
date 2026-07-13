#!/usr/bin/env node
import { runTok } from '../src/cli.js'

process.exitCode = await runTok(process.argv.slice(2))
