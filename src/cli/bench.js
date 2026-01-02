/**
 * SIMD Benchmark and Analysis Module
 * 
 * Builds variant matrix (scalar/autovec/explicit-*), runs SIMD detection,
 * and executes benchmarks with comprehensive reporting.
 */

import { execSync, spawn } from 'node:child_process'
import { readFileSync, writeFileSync, mkdirSync, existsSync, copyFileSync, rmSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { createHash } from 'node:crypto'
import { performance } from 'node:perf_hooks'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const SIMD_DETECT_PATH = join(__dirname, '../../bench/simd-detect/target/release/simd-detect')

/**
 * Default benchmark configuration
 */
const DEFAULT_BENCH_CONFIG = {
  warmupRuns: 10,
  samples: 60,
  outputDir: 'bench_out',
  dataSizes: [1024, 16384, 65536, 262144, 1048576], // 1KB, 16KB, 64KB, 256KB, 1MB
}

/**
 * Build a single variant
 */
function buildVariant({ crateDir, targetDir, wasmFileStem, variant, release }) {
  const { name, rustflags, features } = variant
  
  console.log(`  Building ${name}...`)
  
  const args = ['build', '--target', 'wasm32-unknown-unknown']
  if (release) args.push('--release')
  if (features && features.length > 0) {
    args.push('--features', features.join(','))
  }
  
  const env = { ...process.env, RUSTFLAGS: rustflags }
  if (targetDir) env.CARGO_TARGET_DIR = targetDir
  
  try {
    execSync(`cargo ${args.join(' ')}`, {
      cwd: crateDir,
      env,
      stdio: 'pipe',
    })
  } catch (err) {
    console.error(`Failed to build ${name}:`, err.message)
    throw err
  }
  
  const profile = release ? 'release' : 'debug'
  return join(targetDir, 'wasm32-unknown-unknown', profile, `${wasmFileStem}.wasm`)
}

/**
 * Run simd-detect on a WASM file
 */
function runSimdDetect(wasmPath, variantName) {
  if (!existsSync(SIMD_DETECT_PATH)) {
    console.warn('simd-detect not found, skipping SIMD analysis')
    return null
  }
  
  try {
    const output = execSync(`"${SIMD_DETECT_PATH}" "${wasmPath}" --variant ${variantName}`, {
      encoding: 'utf-8',
      maxBuffer: 10 * 1024 * 1024,
    })
    return JSON.parse(output)
  } catch (err) {
    console.warn(`simd-detect failed: ${err.message}`)
    return null
  }
}

/**
 * Generate variant configurations from simd config
 */
function generateVariants(simdConfig) {
  const variants = []
  const features = simdConfig?.features || {}
  const featureNames = Object.keys(features)
  
  // Scalar: no SIMD
  variants.push({
    name: 'scalar',
    description: 'Scalar baseline (no SIMD)',
    rustflags: '-C opt-level=3',
    features: [],
    simd: false,
  })
  
  // Autovec: +simd128 but no explicit features
  variants.push({
    name: 'autovec',
    description: 'LLVM autovectorization (+simd128)',
    rustflags: '-C opt-level=3 -C target-feature=+simd128',
    features: [],
    simd: true,
  })
  
  // Individual explicit features
  for (const [featureName, featureConfig] of Object.entries(features)) {
    const displayName = featureConfig.name || featureName
    // Use display name for variant name if available, otherwise simplify feature name
    const variantName = displayName.startsWith('explicit-') 
      ? displayName 
      : `explicit-${displayName}`
    variants.push({
      name: variantName,
      description: `Explicit SIMD: ${displayName}`,
      rustflags: '-C opt-level=3 -C target-feature=+simd128',
      features: [featureName],
      simd: true,
    })
  }
  
  // All explicit features combined
  if (featureNames.length > 0) {
    const allFeature = simdConfig.allFeature || 'explicit-simd'
    variants.push({
      name: 'explicit-all',
      description: 'All explicit SIMD features',
      rustflags: '-C opt-level=3 -C target-feature=+simd128',
      features: [allFeature],
      simd: true,
    })
  }
  
  return variants
}

/**
 * Compute SIMD provenance (compiler vs explicit)
 */
function computeProvenance(simdReports) {
  const provenance = { summary: {} }
  
  const scalar = simdReports['scalar']
  const autovec = simdReports['autovec']
  
  if (!scalar || !autovec) return provenance
  
  for (const [name, report] of Object.entries(simdReports)) {
    if (name === 'scalar' || name === 'autovec') continue
    
    provenance.summary[name] = {
      total_scalar: scalar.total_simd_ops,
      total_autovec: autovec.total_simd_ops,
      total_explicit: report.total_simd_ops,
      compiler_added: autovec.total_simd_ops - scalar.total_simd_ops,
      explicit_added: report.total_simd_ops - autovec.total_simd_ops,
    }
  }
  
  return provenance
}

/**
 * Load a WASM module and get its exports
 */
async function loadWasmModule(wasmPath) {
  const wasmBytes = readFileSync(wasmPath)
  const module = await WebAssembly.compile(wasmBytes)
  const instance = await WebAssembly.instantiate(module, {})
  return instance.exports
}

/**
 * Statistics helpers
 */
function computeStats(times) {
  const sorted = [...times].sort((a, b) => a - b)
  const len = sorted.length
  const sum = sorted.reduce((a, b) => a + b, 0)
  const mean = sum / len
  const median = len % 2 === 0 
    ? (sorted[len/2 - 1] + sorted[len/2]) / 2 
    : sorted[Math.floor(len/2)]
  const p5 = sorted[Math.floor(len * 0.05)]
  const p95 = sorted[Math.floor(len * 0.95)]
  const variance = sorted.reduce((acc, t) => acc + (t - mean) ** 2, 0) / len
  const stddev = Math.sqrt(variance)
  
  return { mean, median, min: sorted[0], max: sorted[len-1], p5, p95, stddev }
}

/**
 * Generate valid base64 test data
 */
function generateTestData(size, forDecode = false, urlSafe = false) {
  if (!forDecode) {
    // For encode: random bytes
    const data = new Uint8Array(size)
    for (let i = 0; i < size; i++) {
      data[i] = Math.floor(Math.random() * 256)
    }
    return data
  }
  
  // For decode: valid base64 string (without padding for simplicity)
  // Make size a multiple of 4
  const alignedSize = Math.floor(size / 4) * 4
  // Use URL-safe or standard alphabet based on function
  const chars = urlSafe
    ? 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'
    : 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
  const data = new Uint8Array(alignedSize)
  for (let i = 0; i < alignedSize; i++) {
    data[i] = chars.charCodeAt(Math.floor(Math.random() * 64))
  }
  return data
}

/**
 * High-resolution timing using hrtime
 */
function hrtimeMs() {
  const [sec, nsec] = process.hrtime()
  return sec * 1000 + nsec / 1e6
}

/**
 * Run benchmarks on all variants
 */
async function runBenchmarks({ distDir, manifest, exports, benchConfig }) {
  if (!exports || exports.length === 0) {
    console.log('\n  No exports defined, skipping performance benchmarks')
    return null
  }
  
  const { warmupRuns, samples, dataSizes } = benchConfig
  const results = {}
  
  console.log('\nRunning performance benchmarks...')
  
  for (const variant of manifest.variants) {
    const wasmPath = join(distDir, variant.path)
    
    try {
      const wasm = await loadWasmModule(wasmPath)
      
      // Check for alloc_bytes/free_bytes
      if (!wasm.alloc_bytes || !wasm.free_bytes) {
        console.log(`  ${variant.name}: missing alloc/free, skipping`)
        continue
      }
      
      results[variant.name] = { functions: {} }
      
      for (const exp of exports) {
        const fn = wasm[exp.abi]
        if (!fn) continue
        
        results[variant.name].functions[exp.name] = { sizes: {} }
        
        // Test all configured sizes to show scaling
        const testSizes = dataSizes
        
        for (const size of testSizes) {
          // Generate appropriate test data
          const isDecoder = exp.name.toLowerCase().includes('decode')
          const isUrlSafe = exp.name.toLowerCase().includes('url')
          const testData = generateTestData(size, isDecoder, isUrlSafe)
          const actualInputSize = testData.length
          
          // Calculate output size
          let outSize
          if (exp.outSize) {
            const len = actualInputSize
            outSize = eval(exp.outSize)
          } else {
            outSize = actualInputSize * 2
          }
          
          // Allocate buffers
          const inPtr = wasm.alloc_bytes(actualInputSize)
          const outPtr = wasm.alloc_bytes(outSize)
          
          // Copy input data
          let mem = new Uint8Array(wasm.memory.buffer)
          mem.set(testData, inPtr)
          
          // Warmup and verify function works
          let workingResult = -1
          for (let i = 0; i < warmupRuns; i++) {
            mem = new Uint8Array(wasm.memory.buffer)
            workingResult = fn(inPtr, actualInputSize, outPtr, outSize)
          }
          
          // Skip if function returns error
          if (workingResult < 0) {
            wasm.free_bytes(inPtr, actualInputSize)
            wasm.free_bytes(outPtr, outSize)
            continue
          }
          
          // Benchmark - batched iterations for timing accuracy
          const batchSize = Math.max(10, Math.floor(1000000 / actualInputSize))
          const times = []
          
          for (let i = 0; i < samples; i++) {
            mem = new Uint8Array(wasm.memory.buffer)
            const start = hrtimeMs()
            for (let j = 0; j < batchSize; j++) {
              fn(inPtr, actualInputSize, outPtr, outSize)
            }
            const end = hrtimeMs()
            times.push((end - start) / batchSize)
          }
          
          // Free buffers
          wasm.free_bytes(inPtr, actualInputSize)
          wasm.free_bytes(outPtr, outSize)
          
          const stats = computeStats(times)
          // Convert ms to seconds, size to MB
          const throughputMBps = stats.median > 0.0001 
            ? (actualInputSize / (1024 * 1024)) / (stats.median / 1000)
            : 0
          
          results[variant.name].functions[exp.name].sizes[size] = {
            ...stats,
            throughputMBps,
            samples,
            batchSize,
            actualInputSize,
          }
        }
      }
      
      // Compute overall average throughput for the variant (largest size only for accuracy)
      const funcResults = Object.values(results[variant.name].functions)
      if (funcResults.length > 0) {
        let totalThroughput = 0
        let count = 0
        for (const f of funcResults) {
          const sizes = Object.keys(f.sizes).map(Number).sort((a, b) => b - a)
          if (sizes.length > 0) {
            totalThroughput += f.sizes[sizes[0]].throughputMBps
            count++
          }
        }
        results[variant.name].avgThroughputMBps = count > 0 ? totalThroughput / count : 0
      }
      
      console.log(`  ✓ ${variant.name}: ${results[variant.name].avgThroughputMBps?.toFixed(1) || '?'} MB/s avg`)
      
    } catch (err) {
      console.log(`  ✗ ${variant.name}: ${err.message}`)
    }
  }
  
  // Compute speedups relative to scalar (per function, per size)
  const scalarResult = results['scalar']
  if (scalarResult && scalarResult.functions) {
    for (const [variantName, variantResult] of Object.entries(results)) {
      if (variantName === 'scalar' || !variantResult.functions) continue
      
      variantResult.speedups = {}
      
      for (const [fnName, fnResult] of Object.entries(variantResult.functions)) {
        const scalarFn = scalarResult.functions[fnName]
        if (!scalarFn) continue
        
        variantResult.speedups[fnName] = {}
        
        for (const [size, stats] of Object.entries(fnResult.sizes)) {
          const scalarStats = scalarFn.sizes[size]
          if (scalarStats && scalarStats.throughputMBps > 0) {
            variantResult.speedups[fnName][size] = stats.throughputMBps / scalarStats.throughputMBps
          }
        }
      }
      
      // Overall speedup (avg of largest size across all functions)
      if (scalarResult.avgThroughputMBps > 0) {
        variantResult.speedupVsScalar = variantResult.avgThroughputMBps / scalarResult.avgThroughputMBps
      }
    }
  }
  
  // Compute size-based summary (average speedup across all functions at each size)
  const sizeSummary = {}
  const sizes = new Set()
  
  for (const result of Object.values(results)) {
    if (!result.functions) continue
    for (const fnResult of Object.values(result.functions)) {
      for (const size of Object.keys(fnResult.sizes)) {
        sizes.add(parseInt(size))
      }
    }
  }
  
  for (const size of [...sizes].sort((a, b) => a - b)) {
    sizeSummary[size] = {}
    
    for (const [variantName, variantResult] of Object.entries(results)) {
      if (variantName === 'scalar' || !variantResult.speedups) continue
      
      let totalSpeedup = 0
      let count = 0
      
      for (const fnSpeedups of Object.values(variantResult.speedups)) {
        if (fnSpeedups[size]) {
          totalSpeedup += fnSpeedups[size]
          count++
        }
      }
      
      if (count > 0) {
        sizeSummary[size][variantName] = totalSpeedup / count
      }
    }
  }
  
  return { results, sizeSummary }
}

/**
 * Build all variants and run SIMD analysis
 */
export function buildVariantsAndAnalyze({ cfg, outputDir }) {
  const simdConfig = cfg.simd || {}
  const variants = generateVariants(simdConfig)
  
  console.log(`\nBuilding ${variants.length} WASM variants...`)
  
  // Get target directory
  let targetDir
  try {
    const raw = execSync('cargo metadata --format-version 1 --no-deps', {
      cwd: cfg.crateDir,
      stdio: ['ignore', 'pipe', 'inherit'],
    }).toString()
    const meta = JSON.parse(raw)
    targetDir = meta?.target_directory || join(cfg.crateDir, 'target')
  } catch {
    targetDir = join(cfg.crateDir, 'target')
  }
  
  // Create output directories
  const distDir = join(outputDir, 'dist')
  const simdOutDir = join(outputDir, 'simd_out')
  mkdirSync(distDir, { recursive: true })
  mkdirSync(simdOutDir, { recursive: true })
  
  const manifest = {
    generated: new Date().toISOString(),
    crate: cfg.crateName,
    variants: [],
  }
  
  const simdReports = {}
  
  for (const variant of variants) {
    try {
      // Build
      const srcWasm = buildVariant({
        crateDir: cfg.crateDir,
        targetDir,
        wasmFileStem: cfg.wasmFileStem,
        variant,
        release: cfg.release,
      })
      
      // Copy to dist
      const destWasm = join(distDir, `${variant.name}.wasm`)
      copyFileSync(srcWasm, destWasm)
      
      // Compute hash and size
      const wasmData = readFileSync(destWasm)
      const hash = createHash('sha256').update(wasmData).digest('hex').slice(0, 16)
      
      manifest.variants.push({
        name: variant.name,
        description: variant.description,
        path: `${variant.name}.wasm`,
        hash,
        size: wasmData.length,
        features: variant.features,
        simd: variant.simd,
      })
      
      console.log(`    ✓ ${variant.name} (${wasmData.length} bytes)`)
      
      // Run SIMD analysis
      const simdReport = runSimdDetect(destWasm, variant.name)
      if (simdReport) {
        simdReports[variant.name] = simdReport
        writeFileSync(
          join(simdOutDir, `${variant.name}.json`),
          JSON.stringify(simdReport, null, 2)
        )
        console.log(`      SIMD: ${simdReport.total_simd_ops} ops (${(simdReport.overall_simd_density * 100).toFixed(1)}%)`)
      }
    } catch (err) {
      console.error(`    ✗ ${variant.name}: ${err.message}`)
    }
  }
  
  // Write manifest
  writeFileSync(join(distDir, 'manifest.json'), JSON.stringify(manifest, null, 2))
  
  // Compute provenance
  const provenance = computeProvenance(simdReports)
  
  return { manifest, simdReports, provenance, distDir, simdOutDir }
}

/**
 * Format size for display
 */
function formatSize(bytes) {
  if (bytes >= 1048576) return `${(bytes / 1048576).toFixed(0)} MB`
  return `${(bytes / 1024).toFixed(0)} KB`
}

/**
 * Generate Markdown report
 */
function generateMarkdownReport(results) {
  const { manifest, simdReports, provenance, benchResults, sizeSummary } = results
  const variants = manifest.variants
  
  let md = `# SIMD Analysis Report

**Crate:** ${manifest.crate}  
**Generated:** ${results.generated}

## Build Variants

| Variant | Description | Features | Size |
|---------|-------------|----------|------|
${variants.map(v => `| ${v.name} | ${v.description} | ${v.features.length ? v.features.join(', ') : 'none'} | ${formatSize(v.size)} |`).join('\n')}

## SIMD Instruction Analysis

| Variant | Total Ops | SIMD Ops | Density | Size |
|---------|-----------|----------|---------|------|
${Object.entries(simdReports).map(([name, s]) => 
  `| ${name} | ${s.total_ops} | ${s.total_simd_ops} | ${(s.overall_simd_density * 100).toFixed(1)}% | ${formatSize(s.wasm_size)} |`
).join('\n')}

## SIMD Provenance

| Variant | Scalar | Autovec | Explicit | Compiler Added | Explicit Added |
|---------|--------|---------|----------|----------------|----------------|
${Object.entries(provenance.summary).map(([name, p]) =>
  `| ${name} | ${p.total_scalar} | ${p.total_autovec} | ${p.total_explicit} | +${p.compiler_added} | +${p.explicit_added} |`
).join('\n')}
`

  if (benchResults && Object.keys(benchResults).length > 0) {
    md += `
## Performance Summary

| Variant | Throughput | Speedup vs Scalar |
|---------|------------|-------------------|
${Object.entries(benchResults).map(([name, r]) => {
  const speedup = r.speedupVsScalar ? `${r.speedupVsScalar.toFixed(2)}x` : '1.00x (baseline)'
  return `| ${name} | ${r.avgThroughputMBps?.toFixed(1) || '?'} MB/s | ${speedup} |`
}).join('\n')}
`

    if (sizeSummary && Object.keys(sizeSummary).length > 0) {
      const sizes = Object.keys(sizeSummary).map(Number).sort((a, b) => a - b)
      const variantNames = Object.keys(sizeSummary[sizes[0]] || {})
      
      md += `
## Speedup by Data Size

Shows how SIMD benefits scale with input size.

| Variant | ${sizes.map(s => formatSize(s)).join(' | ')} |
|---------|${sizes.map(() => '------').join('|')}|
| scalar | ${sizes.map(() => '1.00x').join(' | ')} |
${variantNames.map(name => {
  const speedups = sizes.map(size => {
    const s = sizeSummary[size]?.[name]
    return s ? `${s.toFixed(1)}x` : '-'
  }).join(' | ')
  return `| ${name} | ${speedups} |`
}).join('\n')}
`
    }
  }
  
  return md
}

/**
 * Generate HTML report
 */
function generateHtmlReport(results) {
  const { manifest, simdReports, provenance, benchResults, sizeSummary } = results
  const variants = manifest.variants
  
  const simdTable = Object.keys(simdReports).length > 0 ? `
    <h3>SIMD Instruction Analysis</h3>
    <table>
      <thead>
        <tr><th>Variant</th><th>Total Ops</th><th>SIMD Ops</th><th>Density</th><th>Size</th></tr>
      </thead>
      <tbody>
        ${variants.map(v => {
          const s = simdReports[v.name]
          if (!s) return ''
          return `<tr>
            <td class="variant">${v.name}</td>
            <td>${s.total_ops}</td>
            <td>${s.total_simd_ops}</td>
            <td>${(s.overall_simd_density * 100).toFixed(1)}%</td>
            <td>${(s.wasm_size / 1024).toFixed(1)} KB</td>
          </tr>`
        }).join('')}
      </tbody>
    </table>` : ''
  
  const provenanceTable = Object.keys(provenance.summary).length > 0 ? `
    <h3>SIMD Provenance</h3>
    <table>
      <thead>
        <tr><th>Variant</th><th>Scalar</th><th>Autovec</th><th>Explicit</th><th>Compiler +</th><th>Explicit +</th></tr>
      </thead>
      <tbody>
        ${Object.entries(provenance.summary).map(([name, p]) => `
          <tr>
            <td class="variant">${name}</td>
            <td>${p.total_scalar}</td>
            <td>${p.total_autovec}</td>
            <td>${p.total_explicit}</td>
            <td class="compiler">${p.compiler_added}</td>
            <td class="explicit">${p.explicit_added}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>` : ''
  
  // Speedup by size table
  const sizes = sizeSummary ? Object.keys(sizeSummary).map(Number).sort((a, b) => a - b) : []
  const variantNames = sizes.length > 0 ? Object.keys(sizeSummary[sizes[0]] || {}) : []
  
  const speedupBySize = sizeSummary && sizes.length > 0 ? `
    <h3>Speedup by Data Size</h3>
    <p class="note">Shows how SIMD benefits scale with input size</p>
    <table>
      <thead>
        <tr>
          <th>Variant</th>
          ${sizes.map(s => `<th>${formatSize(s)}</th>`).join('')}
        </tr>
      </thead>
      <tbody>
        <tr>
          <td class="variant">scalar</td>
          ${sizes.map(() => `<td class="baseline">1.00x</td>`).join('')}
        </tr>
        ${variantNames.map(name => `
          <tr>
            <td class="variant">${name}</td>
            ${sizes.map(size => {
              const speedup = sizeSummary[size]?.[name]
              const cls = speedup > 5 ? 'speedup-high' : speedup > 1.5 ? 'speedup' : ''
              return `<td class="${cls}">${speedup ? speedup.toFixed(1) + 'x' : '-'}</td>`
            }).join('')}
          </tr>
        `).join('')}
      </tbody>
    </table>` : ''
  
  const benchTable = benchResults && Object.keys(benchResults).length > 0 ? `
    <h3>Performance Summary (Largest Size)</h3>
    <table>
      <thead>
        <tr><th>Variant</th><th>Avg Throughput</th><th>Speedup vs Scalar</th></tr>
      </thead>
      <tbody>
        ${Object.entries(benchResults).map(([name, r]) => `
          <tr>
            <td class="variant">${name}</td>
            <td>${r.avgThroughputMBps?.toFixed(1) || '?'} MB/s</td>
            <td class="${r.speedupVsScalar > 1.1 ? 'speedup' : ''}">${r.speedupVsScalar ? r.speedupVsScalar.toFixed(2) + 'x' : '1.00x (baseline)'}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
    
    ${speedupBySize}
    
    <details>
      <summary>Detailed Results by Function & Size</summary>
      ${Object.entries(benchResults).map(([variantName, variantResult]) => {
        if (!variantResult.functions) return ''
        return Object.entries(variantResult.functions).map(([fnName, fnResult]) => `
          <h4>${variantName} → ${fnName}</h4>
          <table>
            <thead>
              <tr><th>Size</th><th>Median</th><th>Throughput</th><th>Speedup</th></tr>
            </thead>
            <tbody>
              ${Object.entries(fnResult.sizes).map(([size, stats]) => {
                const speedup = variantResult.speedups?.[fnName]?.[size]
                return `
                  <tr>
                    <td>${formatSize(parseInt(size))}</td>
                    <td>${stats.median.toFixed(3)} ms</td>
                    <td>${stats.throughputMBps.toFixed(1)} MB/s</td>
                    <td class="${speedup > 1.5 ? 'speedup' : ''}">${speedup ? speedup.toFixed(2) + 'x' : '1.00x'}</td>
                  </tr>
                `
              }).join('')}
            </tbody>
          </table>
        `).join('')
      }).join('')}
    </details>` : ''
  
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>SIMD Analysis Report</title>
  <style>
    :root { --bg: #0a0a0a; --surface: #141414; --border: #2a2a2a; --text: #e8e8e8; --dim: #777; --accent: #ff6b35; --green: #4ade80; --purple: #c084fc; --orange: #fb923c; }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'SF Mono', monospace; background: var(--bg); color: var(--text); padding: 2rem; line-height: 1.6; }
    h1 { color: var(--accent); margin-bottom: 0.5rem; }
    h2 { margin: 2rem 0 1rem; border-bottom: 1px solid var(--border); padding-bottom: 0.5rem; }
    h3 { color: var(--accent); margin: 1.5rem 0 0.75rem; font-size: 1rem; }
    table { width: 100%; border-collapse: collapse; background: var(--surface); border-radius: 8px; overflow: hidden; font-size: 0.85rem; margin-bottom: 1rem; }
    th, td { padding: 0.6rem 0.75rem; text-align: left; border-bottom: 1px solid var(--border); }
    th { background: rgba(255,107,53,0.1); color: var(--accent); font-size: 0.75rem; text-transform: uppercase; }
    .variant { font-weight: 500; }
    .compiler { color: var(--orange); }
    .explicit { color: var(--purple); }
    .speedup { color: var(--green); }
    .speedup-high { color: var(--green); font-weight: bold; background: rgba(74,222,128,0.1); }
    .baseline { color: var(--dim); }
    .note { color: var(--dim); font-size: 0.75rem; margin-bottom: 0.5rem; }
    h4 { color: var(--dim); margin: 1rem 0 0.5rem; font-size: 0.85rem; }
    pre { background: var(--surface); padding: 1rem; border-radius: 8px; overflow-x: auto; font-size: 0.75rem; color: var(--dim); }
    .subtitle { color: var(--dim); font-size: 0.85rem; margin-bottom: 2rem; }
    details { margin-top: 1.5rem; }
    summary { cursor: pointer; color: var(--accent); font-weight: 500; margin-bottom: 1rem; }
    summary:hover { text-decoration: underline; }
  </style>
</head>
<body>
  <h1>SIMD Analysis Report</h1>
  <p class="subtitle">Crate: ${manifest.crate} • Generated: ${results.generated}</p>
  
  <h2>Variants</h2>
  <table>
    <thead><tr><th>Name</th><th>Description</th><th>Features</th><th>Size</th></tr></thead>
    <tbody>
      ${variants.map(v => `<tr>
        <td class="variant">${v.name}</td>
        <td>${v.description}</td>
        <td>${v.features.length ? v.features.join(', ') : 'none'}</td>
        <td>${(v.size / 1024).toFixed(1)} KB</td>
      </tr>`).join('')}
    </tbody>
  </table>
  
  <h2>SIMD Analysis</h2>
  ${simdTable}
  ${provenanceTable}
  
  ${benchTable}
</body>
</html>`
}

/**
 * Main bench command entry point
 */
export async function runBench(cfg, cliOpts = {}) {
  const benchConfig = {
    ...DEFAULT_BENCH_CONFIG,
    ...(cfg.bench || {}),
  }
  
  const outputDir = join(cfg.crateDir, benchConfig.outputDir)
  
  // Clean if requested
  if (cliOpts.clean && existsSync(outputDir)) {
    rmSync(outputDir, { recursive: true })
  }
  mkdirSync(outputDir, { recursive: true })
  
  console.log('SIMD Variant Build & Analysis')
  console.log('═'.repeat(50))
  
  // Build variants and analyze
  const { manifest, simdReports, provenance, distDir, simdOutDir } = 
    buildVariantsAndAnalyze({ cfg, outputDir })
  
  // Run performance benchmarks
  const benchData = await runBenchmarks({
    distDir,
    manifest,
    exports: cfg.exports,
    benchConfig,
  })
  
  const benchResults = benchData?.results || null
  const sizeSummary = benchData?.sizeSummary || null
  
  // Generate report
  const results = {
    generated: new Date().toISOString(),
    manifest,
    simdReports,
    provenance,
    benchResults,
    sizeSummary,
  }
  
  // Write JSON report
  const jsonPath = join(outputDir, 'report.json')
  writeFileSync(jsonPath, JSON.stringify(results, null, 2))
  
  // Write HTML report
  const htmlPath = join(outputDir, 'report.html')
  writeFileSync(htmlPath, generateHtmlReport(results))
  
  // Write Markdown report
  const mdPath = join(outputDir, 'report.md')
  writeFileSync(mdPath, generateMarkdownReport(results))
  
  console.log('\n' + '═'.repeat(50))
  console.log('Summary')
  console.log('═'.repeat(50))
  
  console.log('\nSIMD Analysis:')
  for (const [name, report] of Object.entries(simdReports)) {
    console.log(`  ${name}: ${report.total_simd_ops} SIMD ops`)
  }
  
  if (Object.keys(provenance.summary).length > 0) {
    console.log('\nProvenance:')
    for (const [name, p] of Object.entries(provenance.summary)) {
      console.log(`  ${name}: +${p.compiler_added} compiler, +${p.explicit_added} explicit`)
    }
  }
  
  if (benchResults) {
    console.log('\nPerformance (largest size):')
    for (const [name, result] of Object.entries(benchResults)) {
      const speedup = result.speedupVsScalar 
        ? ` (${result.speedupVsScalar.toFixed(2)}x vs scalar)`
        : ' (baseline)'
      console.log(`  ${name}: ${result.avgThroughputMBps?.toFixed(1) || '?'} MB/s${speedup}`)
    }
    
    if (sizeSummary && Object.keys(sizeSummary).length > 0) {
      console.log('\nSpeedup by data size:')
      const sizes = Object.keys(sizeSummary).map(Number).sort((a, b) => a - b)
      const variants = Object.keys(sizeSummary[sizes[0]] || {})
      
      // Header
      const sizeLabels = sizes.map(s => s >= 1048576 ? `${(s/1048576).toFixed(0)}MB` : `${(s/1024).toFixed(0)}KB`)
      console.log(`  ${'Variant'.padEnd(20)} ${sizeLabels.map(l => l.padStart(8)).join(' ')}`)
      
      // Rows
      for (const variant of variants) {
        const speedups = sizes.map(size => {
          const s = sizeSummary[size]?.[variant]
          return s ? `${s.toFixed(1)}x`.padStart(8) : '    -   '
        }).join(' ')
        console.log(`  ${variant.padEnd(20)} ${speedups}`)
      }
    }
  }
  
  console.log(`\nReports written to: ${outputDir}`)
  console.log(`  - ${jsonPath}`)
  console.log(`  - ${htmlPath}`)
  console.log(`  - ${mdPath}`)
}
