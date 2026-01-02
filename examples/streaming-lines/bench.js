import { createReadStream, writeFileSync, existsSync } from 'node:fs'
import { Readable } from 'node:stream'
import { performance } from 'node:perf_hooks'
import { init, createTransformStream } from './dist/node.js'

const FILE_PATH = './large_bench.txt'
const SIZE_MB = 20
const ITERATIONS = 5

/**
 * Generates a large test file if it doesn't already exist.
 * This ensures the benchmark can be run immediately after cloning without committing large files.
 */
function ensureBenchFile() {
  if (existsSync(FILE_PATH)) return

  console.log(
    `Generating ${SIZE_MB}MB test file (${SIZE_MB} lines, each ~1MB)...`
  )
  const base = 'A'.repeat(1024 * 1024 - 1) + '\n'
  const lineCount = Math.floor((SIZE_MB * 1024 * 1024) / base.length)
  const data = base.repeat(lineCount)
  writeFileSync(FILE_PATH, data)
}

/**
 * Benchmark using the WASM-accelerated line splitter.
 */
async function runWasmBench() {
  const input = Readable.toWeb(createReadStream(FILE_PATH))
  const wasmSplit = createTransformStream('splitLines')

  let lineCount = 0
  const sink = new WritableStream({
    write() {
      lineCount++
    },
  })

  const t0 = performance.now()
  await input.pipeThrough(wasmSplit).pipeTo(sink)
  return { time: performance.now() - t0, lines: lineCount }
}

/**
 * Benchmark using a naive JavaScript implementation of a line splitter.
 */
async function runJsBench() {
  const input = Readable.toWeb(createReadStream(FILE_PATH))

  let buffer = new Uint8Array(0)
  let lineCount = 0

  const jsSplit = new TransformStream({
    transform(chunk, controller) {
      const combined = new Uint8Array(buffer.length + chunk.length)
      combined.set(buffer, 0)
      combined.set(chunk, buffer.length)

      let start = 0
      for (let i = 0; i < combined.length; i += 1) {
        if (combined[i] === 10) {
          // '\n'
          controller.enqueue(combined.subarray(start, i))
          start = i + 1
        }
      }
      buffer = combined.slice(start)
    },
    flush(controller) {
      if (buffer.length) controller.enqueue(buffer)
    },
  })

  const sink = new WritableStream({
    write() {
      lineCount++
    },
  })

  const t0 = performance.now()
  await input.pipeThrough(jsSplit).pipeTo(sink)
  return { time: performance.now() - t0, lines: lineCount }
}

const avg = (arr) => arr.reduce((a, b) => a + b.time, 0) / arr.length

async function benchmarkBackend(backend) {
  // Re-initialize with the specified backend
  await init({}, { backend })

  console.log(`\nBenchmarking Wasm ${backend.toUpperCase()} (${ITERATIONS} runs)...`)
  const results = []
  for (let i = 0; i < ITERATIONS; i++) {
    results.push(await runWasmBench())
  }
  return avg(results)
}

async function main() {
  const compareBackends = process.argv.includes('--compare-backends')

  ensureBenchFile()

  if (compareBackends) {
    // Compare SIMD vs baseline backends
    console.log('=== SIMD vs Baseline Comparison ===')

    // Warmup with auto
    await init({}, { backend: 'auto' })
    await runWasmBench()

    const simdAvg = await benchmarkBackend('simd')
    const baseAvg = await benchmarkBackend('base')

    console.log('\n--- Backend Comparison Results ---')
    console.log(`File Size:       ${SIZE_MB} MB`)
    console.log(`Iterations:      ${ITERATIONS}`)
    console.log(`SIMD Avg Time:   ${simdAvg.toFixed(2)} ms`)
    console.log(`Base Avg Time:   ${baseAvg.toFixed(2)} ms`)
    console.log(`SIMD Speedup:    ${(baseAvg / simdAvg).toFixed(2)}x over baseline`)
    console.log('----------------------------------\n')
  } else {
    // Standard benchmark: JS vs WASM (auto)
    await init()

    console.log('Warmup...')
    await runJsBench()
    await runWasmBench()

    console.log(`Benchmarking JS native split (${ITERATIONS} runs)...`)
    const jsResults = []
    for (let i = 0; i < ITERATIONS; i++) {
      jsResults.push(await runJsBench())
    }

    console.log(`Benchmarking Wasm (auto) split (${ITERATIONS} runs)...`)
    const wasmResults = []
    for (let i = 0; i < ITERATIONS; i++) {
      wasmResults.push(await runWasmBench())
    }

    const jsAvg = avg(jsResults)
    const wasmAvg = avg(wasmResults)

    console.log('\n--- Benchmark Results ---')
    console.log(`File Size:      ${SIZE_MB} MB`)
    console.log(`Iterations:     ${ITERATIONS}`)
    console.log(`JS Avg Time:    ${jsAvg.toFixed(2)} ms`)
    console.log(`Wasm Avg Time:  ${wasmAvg.toFixed(2)} ms`)
    console.log(`Speedup:        ${(jsAvg / wasmAvg).toFixed(2)}x`)
    console.log('-------------------------\n')

    console.log('Tip: Run with --compare-backends to compare SIMD vs baseline')
  }
}

main().catch(console.error)
