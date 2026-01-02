#!/usr/bin/env node

/**
 * Node benchmark runner for WASM variants
 * 
 * Loads each variant, runs benchmarks, and outputs:
 * - bench_out/report.json
 * - bench_out/report.html
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { performance } from 'node:perf_hooks'
import { createHash } from 'node:crypto'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const DIST_DIR = join(__dirname, 'dist')
const OUT_DIR = join(__dirname, 'bench_out')

// Benchmark configuration
const CONFIG = {
  warmupRuns: 5,
  samples: 60,
  itersPerSample: 1000, // iterations inside WASM per sample
  benchmarks: [
    {
      name: 'dot',
      description: 'Dot product of two f32 vectors',
      lengths: [1024, 4096, 16384, 65536],
      setup: (len, malloc, memory) => {
        const bytesA = len * 4
        const bytesB = len * 4
        const ptrA = malloc(bytesA)
        const ptrB = malloc(bytesB)
        
        // Fill with random data
        const viewA = new Float32Array(memory.buffer, ptrA, len)
        const viewB = new Float32Array(memory.buffer, ptrB, len)
        for (let i = 0; i < len; i++) {
          viewA[i] = Math.random()
          viewB[i] = Math.random()
        }
        
        return { ptrA, ptrB, len, bytesA, bytesB }
      },
      run: (exports, params, iters) => exports.bench_dot(params.ptrA, params.ptrB, params.len, iters),
      cleanup: (free, params) => {
        free(params.ptrA, params.bytesA)
        free(params.ptrB, params.bytesB)
      },
    },
    {
      name: 'sum',
      description: 'Sum of f32 vector',
      lengths: [1024, 4096, 16384, 65536],
      setup: (len, malloc, memory) => {
        const bytes = len * 4
        const ptr = malloc(bytes)
        const view = new Float32Array(memory.buffer, ptr, len)
        for (let i = 0; i < len; i++) {
          view[i] = Math.random()
        }
        return { ptr, len, bytes }
      },
      run: (exports, params, iters) => exports.bench_sum(params.ptr, params.len, iters),
      cleanup: (free, params) => free(params.ptr, params.bytes),
    },
    {
      name: 'saxpy',
      description: 'SAXPY: y = a*x + y',
      lengths: [1024, 4096, 16384, 65536],
      setup: (len, malloc, memory) => {
        const bytes = len * 4
        const ptrX = malloc(bytes)
        const ptrY = malloc(bytes)
        
        const viewX = new Float32Array(memory.buffer, ptrX, len)
        const viewY = new Float32Array(memory.buffer, ptrY, len)
        for (let i = 0; i < len; i++) {
          viewX[i] = Math.random()
          viewY[i] = Math.random()
        }
        
        return { ptrX, ptrY, len, bytes, alpha: 2.5 }
      },
      run: (exports, params, iters) => exports.bench_saxpy(params.alpha, params.ptrX, params.ptrY, params.len, iters),
      cleanup: (free, params) => {
        free(params.ptrX, params.bytes)
        free(params.ptrY, params.bytes)
      },
    },
    {
      name: 'matmul',
      description: 'Matrix multiply C = A * B (n x n)',
      lengths: [32, 64, 128], // Matrix dimension (n)
      setup: (n, malloc, memory) => {
        const len = n * n
        const bytes = len * 4
        const ptrA = malloc(bytes)
        const ptrB = malloc(bytes)
        const ptrC = malloc(bytes)
        
        const viewA = new Float32Array(memory.buffer, ptrA, len)
        const viewB = new Float32Array(memory.buffer, ptrB, len)
        for (let i = 0; i < len; i++) {
          viewA[i] = Math.random()
          viewB[i] = Math.random()
        }
        
        return { ptrA, ptrB, ptrC, n, bytes }
      },
      run: (exports, params, iters) => exports.bench_matmul(params.ptrA, params.ptrB, params.ptrC, params.n, iters),
      cleanup: (free, params) => {
        free(params.ptrA, params.bytes)
        free(params.ptrB, params.bytes)
        free(params.ptrC, params.bytes)
      },
    },
  ],
}

// Statistics helpers
function median(arr) {
  const sorted = [...arr].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

function mad(arr) {
  const med = median(arr)
  const deviations = arr.map(x => Math.abs(x - med))
  return median(deviations)
}

function mean(arr) {
  return arr.reduce((a, b) => a + b, 0) / arr.length
}

function stdev(arr) {
  const m = mean(arr)
  const variance = arr.reduce((acc, x) => acc + (x - m) ** 2, 0) / arr.length
  return Math.sqrt(variance)
}

function percentile(arr, p) {
  const sorted = [...arr].sort((a, b) => a - b)
  const idx = Math.ceil((p / 100) * sorted.length) - 1
  return sorted[Math.max(0, idx)]
}

function computeStats(samples) {
  return {
    samples: samples.length,
    median_ms: median(samples),
    mad_ms: mad(samples),
    mean_ms: mean(samples),
    stdev_ms: stdev(samples),
    min_ms: Math.min(...samples),
    max_ms: Math.max(...samples),
    p95_ms: percentile(samples, 95),
    p99_ms: percentile(samples, 99),
  }
}

async function loadWasm(wasmPath) {
  const wasmBytes = await readFile(wasmPath)
  const hash = createHash('sha256').update(wasmBytes).digest('hex').slice(0, 16)
  
  const { instance } = await WebAssembly.instantiate(wasmBytes, {})
  
  return {
    exports: instance.exports,
    memory: instance.exports.memory,
    malloc: instance.exports.malloc,
    free: instance.exports.free,
    hash,
    size: wasmBytes.length,
  }
}

async function runBenchmark(wasm, bench, length, config) {
  const { exports, memory, malloc, free } = wasm
  
  // Setup
  const params = bench.setup(length, malloc, memory)
  
  // Warmup
  for (let i = 0; i < config.warmupRuns; i++) {
    bench.run(exports, params, 10)
  }
  
  // Collect samples
  const samples = []
  for (let i = 0; i < config.samples; i++) {
    const start = performance.now()
    bench.run(exports, params, config.itersPerSample)
    const elapsed = performance.now() - start
    samples.push(elapsed)
  }
  
  // Cleanup
  bench.cleanup(free, params)
  
  return {
    ...computeStats(samples),
    iters_per_sample: config.itersPerSample,
    total_ops: config.samples * config.itersPerSample,
  }
}

async function main() {
  console.log('WASM Benchmark Runner')
  console.log('=' .repeat(60))
  
  // Parse CLI args
  const args = process.argv.slice(2)
  const selectedBenches = args.filter(a => !a.startsWith('--'))
  const flags = args.filter(a => a.startsWith('--'))
  
  // Load manifest
  const manifestPath = join(DIST_DIR, 'manifest.json')
  let manifest
  try {
    manifest = JSON.parse(await readFile(manifestPath, 'utf-8'))
  } catch (err) {
    console.error('Failed to load manifest.json. Run build-variants.js first.')
    process.exit(1)
  }
  
  console.log(`Found ${manifest.variants.length} variants:`)
  manifest.variants.forEach(v => console.log(`  - ${v.name}: ${v.description}`))
  
  // Filter benchmarks if specified
  const benchmarks = selectedBenches.length > 0
    ? CONFIG.benchmarks.filter(b => selectedBenches.includes(b.name))
    : CONFIG.benchmarks
  
  console.log(`\nRunning ${benchmarks.length} benchmarks:`)
  benchmarks.forEach(b => console.log(`  - ${b.name}: ${b.description}`))
  
  // Create output directory
  await mkdir(OUT_DIR, { recursive: true })
  
  // Run benchmarks
  const results = {
    generated: new Date().toISOString(),
    config: {
      warmupRuns: CONFIG.warmupRuns,
      samples: CONFIG.samples,
      itersPerSample: CONFIG.itersPerSample,
    },
    variants: {},
    benchmarks: {},
  }
  
  for (const variant of manifest.variants) {
    console.log(`\n${'─'.repeat(60)}`)
    console.log(`Loading variant: ${variant.name}`)
    
    const wasmPath = join(DIST_DIR, variant.path)
    const wasm = await loadWasm(wasmPath)
    
    results.variants[variant.name] = {
      ...variant,
      hash: wasm.hash,
      size: wasm.size,
    }
    
    for (const bench of benchmarks) {
      if (!results.benchmarks[bench.name]) {
        results.benchmarks[bench.name] = {
          description: bench.description,
          results: {},
        }
      }
      
      if (!results.benchmarks[bench.name].results[variant.name]) {
        results.benchmarks[bench.name].results[variant.name] = {}
      }
      
      for (const length of bench.lengths) {
        process.stdout.write(`  ${bench.name}[${length}]... `)
        
        const benchResult = await runBenchmark(wasm, bench, length, CONFIG)
        results.benchmarks[bench.name].results[variant.name][length] = benchResult
        
        console.log(`${benchResult.median_ms.toFixed(3)}ms (±${benchResult.mad_ms.toFixed(3)})`)
      }
    }
  }
  
  // Compute speedups relative to scalar
  const scalarName = 'scalar'
  if (results.variants[scalarName]) {
    for (const [benchName, benchData] of Object.entries(results.benchmarks)) {
      const scalarResults = benchData.results[scalarName]
      if (!scalarResults) continue
      
      for (const [variantName, variantResults] of Object.entries(benchData.results)) {
        for (const [length, data] of Object.entries(variantResults)) {
          const scalarMedian = scalarResults[length]?.median_ms
          if (scalarMedian && data.median_ms > 0) {
            data.speedup_vs_scalar = scalarMedian / data.median_ms
          }
        }
      }
    }
  }
  
  // Write JSON report
  const jsonPath = join(OUT_DIR, 'report.json')
  await writeFile(jsonPath, JSON.stringify(results, null, 2))
  console.log(`\nWrote ${jsonPath}`)
  
  // Generate HTML report
  const htmlReport = generateHtmlReport(results)
  const htmlPath = join(OUT_DIR, 'report.html')
  await writeFile(htmlPath, htmlReport)
  console.log(`Wrote ${htmlPath}`)
  
  console.log('\nBenchmark complete!')
}

function generateHtmlReport(results) {
  const variantNames = Object.keys(results.variants)
  const benchNames = Object.keys(results.benchmarks)
  
  // Build tables
  const tables = benchNames.map(benchName => {
    const bench = results.benchmarks[benchName]
    const lengths = Object.keys(bench.results[variantNames[0]] || {})
    
    let tableHtml = `
      <h3>${benchName}</h3>
      <p class="description">${bench.description}</p>
      <table>
        <thead>
          <tr>
            <th>Variant</th>
            ${lengths.map(l => `<th>${l}</th>`).join('')}
          </tr>
        </thead>
        <tbody>`
    
    for (const variant of variantNames) {
      const variantData = bench.results[variant] || {}
      tableHtml += `
          <tr>
            <td class="variant-name">${variant}</td>
            ${lengths.map(l => {
              const data = variantData[l]
              if (!data) return '<td>-</td>'
              const speedup = data.speedup_vs_scalar
              const speedupStr = speedup ? ` (${speedup.toFixed(2)}x)` : ''
              const cls = speedup && speedup > 1.1 ? 'faster' : speedup && speedup < 0.9 ? 'slower' : ''
              return `<td class="${cls}">${data.median_ms.toFixed(3)}ms${speedupStr}</td>`
            }).join('')}
          </tr>`
    }
    
    tableHtml += `
        </tbody>
      </table>`
    
    return tableHtml
  }).join('\n')
  
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>WASM Benchmark Report</title>
  <style>
    :root {
      --bg: #0d1117;
      --surface: #161b22;
      --border: #30363d;
      --text: #c9d1d9;
      --text-dim: #8b949e;
      --accent: #58a6ff;
      --faster: #3fb950;
      --slower: #f85149;
    }
    
    * { box-sizing: border-box; }
    
    body {
      font-family: 'JetBrains Mono', 'Fira Code', monospace;
      background: var(--bg);
      color: var(--text);
      margin: 0;
      padding: 2rem;
      line-height: 1.6;
    }
    
    h1, h2, h3 {
      color: var(--accent);
      font-weight: 500;
    }
    
    h1 {
      font-size: 1.8rem;
      border-bottom: 1px solid var(--border);
      padding-bottom: 1rem;
    }
    
    h2 { font-size: 1.4rem; margin-top: 2rem; }
    h3 { font-size: 1.1rem; margin-top: 1.5rem; color: var(--text); }
    
    .description {
      color: var(--text-dim);
      font-size: 0.9rem;
      margin: 0.5rem 0 1rem;
    }
    
    .meta {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 1rem 1.5rem;
      margin-bottom: 2rem;
      font-size: 0.85rem;
    }
    
    .meta strong { color: var(--accent); }
    
    table {
      width: 100%;
      border-collapse: collapse;
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 6px;
      overflow: hidden;
      font-size: 0.85rem;
    }
    
    th, td {
      padding: 0.75rem 1rem;
      text-align: left;
      border-bottom: 1px solid var(--border);
    }
    
    th {
      background: rgba(88, 166, 255, 0.1);
      color: var(--accent);
      font-weight: 500;
    }
    
    tr:last-child td { border-bottom: none; }
    tr:hover { background: rgba(255, 255, 255, 0.02); }
    
    .variant-name { font-weight: 500; }
    
    .faster { color: var(--faster); }
    .slower { color: var(--slower); }
    
    .variants-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
      gap: 1rem;
      margin: 1rem 0;
    }
    
    .variant-card {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 1rem;
    }
    
    .variant-card h4 {
      margin: 0 0 0.5rem;
      color: var(--accent);
      font-size: 1rem;
    }
    
    .variant-card p {
      margin: 0.25rem 0;
      font-size: 0.8rem;
      color: var(--text-dim);
    }
    
    details {
      margin-top: 2rem;
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 6px;
    }
    
    summary {
      padding: 1rem;
      cursor: pointer;
      color: var(--accent);
    }
    
    pre {
      margin: 0;
      padding: 1rem;
      overflow-x: auto;
      font-size: 0.75rem;
      color: var(--text-dim);
    }
  </style>
</head>
<body>
  <h1>WASM Benchmark Report</h1>
  
  <div class="meta">
    <strong>Generated:</strong> ${results.generated}<br>
    <strong>Config:</strong> ${results.config.samples} samples × ${results.config.itersPerSample} iters, ${results.config.warmupRuns} warmup
  </div>
  
  <h2>Variants</h2>
  <div class="variants-grid">
    ${variantNames.map(name => {
      const v = results.variants[name]
      return `
        <div class="variant-card">
          <h4>${name}</h4>
          <p>${v.description}</p>
          <p><strong>Size:</strong> ${(v.size / 1024).toFixed(1)} KB</p>
          <p><strong>Hash:</strong> ${v.hash}</p>
          <p><strong>Features:</strong> ${v.features.length ? v.features.join(', ') : 'none'}</p>
        </div>`
    }).join('')}
  </div>
  
  <h2>Results</h2>
  ${tables}
  
  <details>
    <summary>Raw JSON</summary>
    <pre>${JSON.stringify(results, null, 2)}</pre>
  </details>
</body>
</html>`
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
