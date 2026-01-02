#!/usr/bin/env node

/**
 * Full Benchmark + SIMD Analysis Pipeline
 * 
 * 1. Build all WASM variants
 * 2. Run SIMD detector on each variant
 * 3. Run benchmarks
 * 4. Merge reports into final HTML
 */

import { spawn } from 'node:child_process'
import { readFile, mkdir, readdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const BENCH_ROOT = dirname(__dirname)
const DIST_DIR = join(BENCH_ROOT, 'dist')
const SIMD_OUT = join(BENCH_ROOT, 'simd_out')
const SIMD_DETECT = join(BENCH_ROOT, 'simd-detect')

function run(cmd, args, options = {}) {
  return new Promise((resolve, reject) => {
    console.log(`\n> ${cmd} ${args.join(' ')}`)
    const proc = spawn(cmd, args, {
      stdio: 'inherit',
      shell: true,
      cwd: BENCH_ROOT,
      ...options,
    })
    proc.on('close', code => {
      if (code === 0) resolve()
      else reject(new Error(`Command failed with code ${code}`))
    })
    proc.on('error', reject)
  })
}

async function main() {
  const args = process.argv.slice(2)
  const skipBuild = args.includes('--skip-build')
  const skipSimd = args.includes('--skip-simd')
  const skipBench = args.includes('--skip-bench')
  
  console.log('═'.repeat(60))
  console.log(' WASM SIMD Benchmark Pipeline')
  console.log('═'.repeat(60))
  
  // Step 1: Build WASM variants
  if (!skipBuild) {
    console.log('\n[1/4] Building WASM variants...')
    await run('node', ['scripts/build-variants.js'])
  } else {
    console.log('\n[1/4] Skipping build (--skip-build)')
  }
  
  // Check that variants were built
  if (!existsSync(join(DIST_DIR, 'manifest.json'))) {
    console.error('Error: No manifest.json found. Run build first.')
    process.exit(1)
  }
  
  // Step 2: Build and run SIMD detector
  if (!skipSimd) {
    console.log('\n[2/4] Running SIMD detector...')
    
    // Build the detector if needed
    const detectorBinary = join(SIMD_DETECT, 'target/release/simd-detect')
    if (!existsSync(detectorBinary)) {
      console.log('Building simd-detect...')
      await run('cargo', ['build', '--release', '--manifest-path', join(SIMD_DETECT, 'Cargo.toml')])
    }
    
    // Create simd_out directory
    await mkdir(SIMD_OUT, { recursive: true })
    
    // Load manifest and run detector on each variant
    const manifest = JSON.parse(await readFile(join(DIST_DIR, 'manifest.json'), 'utf-8'))
    
    for (const variant of manifest.variants) {
      const wasmPath = join(DIST_DIR, variant.path)
      const outputPath = join(SIMD_OUT, `${variant.name}.json`)
      
      console.log(`  Analyzing ${variant.name}...`)
      await run(detectorBinary, [
        wasmPath,
        '--variant', variant.name,
        '--output', outputPath,
      ])
    }
  } else {
    console.log('\n[2/4] Skipping SIMD detection (--skip-simd)')
  }
  
  // Step 3: Run benchmarks
  if (!skipBench) {
    console.log('\n[3/4] Running benchmarks...')
    await run('node', ['bench.mjs'])
  } else {
    console.log('\n[3/4] Skipping benchmarks (--skip-bench)')
  }
  
  // Step 4: Merge reports
  console.log('\n[4/4] Merging reports...')
  await run('node', ['scripts/merge-reports.mjs'])
  
  console.log('\n' + '═'.repeat(60))
  console.log(' Pipeline complete!')
  console.log('═'.repeat(60))
  console.log('\nOutputs:')
  console.log(`  - ${join(BENCH_ROOT, 'bench_out/report.json')}`)
  console.log(`  - ${join(BENCH_ROOT, 'bench_out/report.html')}`)
  console.log(`  - ${join(BENCH_ROOT, 'bench_out/final_report.json')}`)
  console.log(`  - ${join(BENCH_ROOT, 'bench_out/final_report.html')}`)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
