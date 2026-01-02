#!/usr/bin/env node

/**
 * Build script for producing multiple WASM variants:
 * - scalar: no SIMD, baseline
 * - autovec: +simd128 enabled, but no explicit SIMD features (compiler autovectorization)
 * - explicit-*: +simd128 with specific explicit SIMD features enabled
 * 
 * Outputs to bench/dist/ with a manifest.json
 */

import { spawn } from 'node:child_process'
import { mkdir, writeFile, copyFile, rm, readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const BENCH_ROOT = dirname(__dirname)
const CRATE_DIR = join(BENCH_ROOT, 'bench-kernels')
const DIST_DIR = join(BENCH_ROOT, 'dist')
const TARGET_DIR = join(CRATE_DIR, 'target')

// Build variant configurations
const VARIANTS = [
  {
    name: 'scalar',
    description: 'Scalar baseline (no SIMD)',
    rustflags: '-C opt-level=3',
    features: [],
    simd: false,
  },
  {
    name: 'autovec',
    description: 'LLVM autovectorization (+simd128, no explicit features)',
    rustflags: '-C opt-level=3 -C target-feature=+simd128',
    features: [],
    simd: true,
  },
  {
    name: 'explicit-dot',
    description: 'Explicit SIMD for dot product only',
    rustflags: '-C opt-level=3 -C target-feature=+simd128',
    features: ['explicit-simd-dot'],
    simd: true,
  },
  {
    name: 'explicit-sum',
    description: 'Explicit SIMD for sum only',
    rustflags: '-C opt-level=3 -C target-feature=+simd128',
    features: ['explicit-simd-sum'],
    simd: true,
  },
  {
    name: 'explicit-saxpy',
    description: 'Explicit SIMD for SAXPY only',
    rustflags: '-C opt-level=3 -C target-feature=+simd128',
    features: ['explicit-simd-saxpy'],
    simd: true,
  },
  {
    name: 'explicit-matmul',
    description: 'Explicit SIMD for matmul only',
    rustflags: '-C opt-level=3 -C target-feature=+simd128',
    features: ['explicit-simd-matmul'],
    simd: true,
  },
  {
    name: 'explicit-all',
    description: 'All explicit SIMD features enabled',
    rustflags: '-C opt-level=3 -C target-feature=+simd128',
    features: ['explicit-simd'],
    simd: true,
  },
]

function runCommand(cmd, args, options = {}) {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, {
      stdio: 'inherit',
      shell: true,
      ...options,
    })
    proc.on('close', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`Command failed with code ${code}: ${cmd} ${args.join(' ')}`))
    })
    proc.on('error', reject)
  })
}

async function computeHash(filePath) {
  const data = await readFile(filePath)
  return createHash('sha256').update(data).digest('hex').slice(0, 16)
}

async function buildVariant(variant) {
  console.log(`\n${'='.repeat(60)}`)
  console.log(`Building variant: ${variant.name}`)
  console.log(`Description: ${variant.description}`)
  console.log(`${'='.repeat(60)}`)

  const env = {
    ...process.env,
    RUSTFLAGS: variant.rustflags,
  }

  // Build cargo command
  const args = [
    'build',
    '--release',
    '--target', 'wasm32-unknown-unknown',
    '--manifest-path', join(CRATE_DIR, 'Cargo.toml'),
  ]

  if (variant.features.length > 0) {
    args.push('--features', variant.features.join(','))
  }

  // Run cargo build
  await runCommand('cargo', args, { env })

  // Copy wasm to dist
  const srcWasm = join(TARGET_DIR, 'wasm32-unknown-unknown', 'release', 'bench_kernels.wasm')
  const destWasm = join(DIST_DIR, `${variant.name}.wasm`)
  await copyFile(srcWasm, destWasm)

  // Compute hash
  const hash = await computeHash(destWasm)
  const stat = await readFile(destWasm)

  return {
    name: variant.name,
    description: variant.description,
    path: `${variant.name}.wasm`,
    hash,
    size: stat.length,
    features: variant.features,
    simd: variant.simd,
  }
}

async function main() {
  const startTime = Date.now()

  // Parse CLI args
  const args = process.argv.slice(2)
  const selectedVariants = args.length > 0
    ? VARIANTS.filter(v => args.includes(v.name))
    : VARIANTS

  if (selectedVariants.length === 0) {
    console.error('No matching variants found. Available:', VARIANTS.map(v => v.name).join(', '))
    process.exit(1)
  }

  console.log('Building WASM variants:')
  selectedVariants.forEach(v => console.log(`  - ${v.name}: ${v.description}`))

  // Clean and create dist directory
  if (existsSync(DIST_DIR)) {
    await rm(DIST_DIR, { recursive: true })
  }
  await mkdir(DIST_DIR, { recursive: true })

  // Build all variants
  const manifest = {
    generated: new Date().toISOString(),
    variants: [],
  }

  for (const variant of selectedVariants) {
    try {
      const info = await buildVariant(variant)
      manifest.variants.push(info)
      console.log(`✓ Built ${variant.name} (${info.size} bytes, hash: ${info.hash})`)
    } catch (err) {
      console.error(`✗ Failed to build ${variant.name}:`, err.message)
      process.exit(1)
    }
  }

  // Write manifest
  const manifestPath = join(DIST_DIR, 'manifest.json')
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2))
  console.log(`\nWrote manifest to ${manifestPath}`)

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)
  console.log(`\nBuild complete in ${elapsed}s`)
  console.log(`Output: ${DIST_DIR}`)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
