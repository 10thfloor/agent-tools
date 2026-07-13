#!/usr/bin/env node
import { runWtree } from '../src/cli.js'

process.exitCode = runWtree(process.argv.slice(2))
