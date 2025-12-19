import { performance } from 'node:perf_hooks'
import { init, findOffsets } from './dist/node.js'

const SIZE_MB = 50

function generateData() {
  console.log(`Generating ${SIZE_MB}MB test data...`)
  const line =
    'This is a moderately long line of text that needs to be split by the wasm engine.\n'
  const lineCount = Math.floor((SIZE_MB * 1024 * 1024) / line.length)
  const data = line.repeat(lineCount)
  return new TextEncoder().encode(data)
}

function jsFindOffsets(input) {
  const offsets = []
  for (let i = 0; i < input.length; i++) {
    const b = input[i]
    if (b === 10) {
      // \n
      offsets.push(i)
    } else if (b === 13) {
      // \r
      offsets.push(i)
      if (input[i + 1] === 10) {
        i++
      }
    }
  }
  return new Uint32Array(offsets)
}

async function main() {
  await init()
  const data = generateData()

  console.log('Warmup...')
  jsFindOffsets(data)
  await findOffsets(data)

  const ITERATIONS = 5

  console.log(`Benchmarking JS native find (${ITERATIONS} runs)...`)
  const t0 = performance.now()
  for (let i = 0; i < ITERATIONS; i++) jsFindOffsets(data)
  const jsTime = (performance.now() - t0) / ITERATIONS

  console.log(`Benchmarking Wasm SIMD find (${ITERATIONS} runs)...`)
  const t1 = performance.now()
  for (let i = 0; i < ITERATIONS; i++) await findOffsets(data)
  const wasmTime = (performance.now() - t1) / ITERATIONS

  console.log('\nResults (Average over iterations):')
  console.log({
    file_size_mb: SIZE_MB,
    js_avg_ms: jsTime.toFixed(2),
    wasm_simd_avg_ms: wasmTime.toFixed(2),
    speedup: (jsTime / wasmTime).toFixed(2) + 'x',
  })
}

main().catch(console.error)
