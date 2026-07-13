#!/usr/bin/env node
import { runTj } from '../src/cli.js'

process.exitCode = runTj(process.argv.slice(2))
