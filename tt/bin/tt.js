#!/usr/bin/env node
import { runTt } from '../src/cli.js'

process.exitCode = await runTt(process.argv.slice(2))
