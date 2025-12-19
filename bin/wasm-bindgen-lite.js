#!/usr/bin/env node
import { runBuild, runClean, printHelp } from '../src/cli/index.js'

function parseArgs(raw) {
  const [command, ...rest] = raw
  const opts = {}
  const unknown = []

  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i]
    switch (arg) {
      case '--crate':
        opts.crate = rest[++i]
        break
      case '--out':
        opts.out = rest[++i]
        break
      case '--config':
        opts.configPath = rest[++i]
        break
      case '--release':
        opts.release = true
        break
      case '--debug':
        opts.release = false
        break
      case '--inline':
        opts.inline = true
        break
      case '--no-inline':
        opts.inline = false
        break
      case '--simd':
        opts.simd = true
        break
      case '--no-simd':
        opts.simd = false
        break
      case '--wasm-opt':
        opts.wasmOptMode = 'on'
        break
      case '--no-wasm-opt':
        opts.wasmOptMode = 'off'
        break
      case '--wasm-opt-args':
        opts.wasmOptArgs = (rest[++i] || '').split(' ').filter(Boolean)
        break
      case '--help':
      case '-h':
        opts.help = true
        break
      default:
        if (arg.startsWith('-')) {
          unknown.push(arg)
        } else {
          unknown.push(arg)
        }
        break
    }
  }

  return { command, opts, unknown }
}

async function main() {
  const { command, opts, unknown } = parseArgs(process.argv.slice(2))

  if (opts.help || !command || command === 'help') {
    printHelp()
    return
  }

  if (unknown.length) {
    console.warn(`Ignoring unknown arguments: ${unknown.join(', ')}`)
  }

  if (command === 'build') {
    await runBuild(opts)
    return
  }

  if (command === 'clean') {
    await runClean(opts)
    return
  }

  console.error(`Unknown command: ${command}`)
  printHelp()
  process.exitCode = 1
}

main().catch((err) => {
  console.error(err?.stack || err)
  process.exitCode = 1
})
