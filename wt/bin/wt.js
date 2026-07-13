#!/usr/bin/env node
import { runWt } from '../src/cli.js'

process.exitCode = runWt(process.argv.slice(2))
