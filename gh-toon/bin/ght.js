#!/usr/bin/env node
import { runGht } from '../src/cli.js'

process.exitCode = runGht(process.argv.slice(2))
