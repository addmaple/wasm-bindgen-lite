import { performance } from 'node:perf_hooks'
import { init, sumF32 } from './dist/node.js'

function makeData(len) {
  const arr = new Float32Array(len)
  for (let i = 0; i < len; i += 1) {
    arr[i] = Math.random()
  }
  return arr
}

function sumJs(arr) {
  let s = 0
  for (let i = 0; i < arr.length; i += 1) s += arr[i]
  return s
}

async function main() {
  const N = 100_000
  const RUNS = 50
  const data = makeData(N)

  // warmup
  sumJs(data)
  await sumF32(data)

  const jsTimes = []
  const wasmTimes = []

  for (let i = 0; i < RUNS; i += 1) {
    const t0 = performance.now()
    sumJs(data)
    jsTimes.push(performance.now() - t0)

    const t1 = performance.now()
    await sumF32(data)
    wasmTimes.push(performance.now() - t1)
  }

  const avg = (arr) => arr.reduce((a, b) => a + b, 0) / arr.length

  console.log('\nResults (Average over iterations):')
  console.log({
    array_len: N,
    runs: RUNS,
    js_avg_ms: avg(jsTimes).toFixed(4),
    wasm_avg_ms: avg(wasmTimes).toFixed(4),
    speedup: (avg(jsTimes) / avg(wasmTimes)).toFixed(2) + 'x',
  })
}

main().catch((err) => {
  console.error(err)
  process.exitCode = 1
})
