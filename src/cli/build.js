import { execSync } from 'node:child_process'
import { copyFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

function runCargoBuild({ crateDir, release, simd }) {
  const args = ['build', '--target', 'wasm32-unknown-unknown']
  if (release) args.push('--release')

  const env = { ...process.env }
  if (simd) {
    const base = process.env.RUSTFLAGS || ''
    const extra = '-C target-feature=+simd128'
    env.RUSTFLAGS = [base, extra].filter(Boolean).join(' ').trim()
  }

  execSync(`cargo ${args.join(' ')}`, {
    cwd: crateDir,
    stdio: 'inherit',
    env,
  })
}

function wasmPath({ crateDir, release, wasmFileStem }) {
  const profile = release ? 'release' : 'debug'
  return join(
    crateDir,
    'target',
    'wasm32-unknown-unknown',
    profile,
    `${wasmFileStem}.wasm`
  )
}

function maybeRunWasmOpt(wasmFile, wasmOpt) {
  if (wasmOpt.mode === 'off') return
  if (wasmOpt.mode === 'auto') {
    try {
      execSync('wasm-opt --version', { stdio: 'ignore' })
    } catch {
      return
    }
  }

  const args = ['wasm-opt', ...wasmOpt.args, wasmFile, '-o', wasmFile]
  execSync(args.join(' '), { stdio: 'inherit' })
}

export function buildArtifacts({
  crateDir,
  wasmFileStem,
  artifactBaseName,
  outDir,
  targets,
  release,
  wasmOpt,
}) {
  mkdirSync(outDir, { recursive: true })
  const wasmOutDir = join(outDir, 'wasm')
  mkdirSync(wasmOutDir, { recursive: true })

  let baselinePath = null
  let simdPath = null

  if (targets.baseline) {
    console.log('Building baseline wasm...')
    runCargoBuild({ crateDir, release, simd: false })
    const built = wasmPath({ crateDir, release, wasmFileStem })
    baselinePath = join(wasmOutDir, `${artifactBaseName}.base.wasm`)
    copyFileSync(built, baselinePath)
    maybeRunWasmOpt(baselinePath, wasmOpt)
  }

  if (targets.simd) {
    console.log('Building SIMD wasm...')
    runCargoBuild({ crateDir, release, simd: true })
    const built = wasmPath({ crateDir, release, wasmFileStem })
    simdPath = join(wasmOutDir, `${artifactBaseName}.simd.wasm`)
    copyFileSync(built, simdPath)
    maybeRunWasmOpt(simdPath, wasmOpt)
  }

  return { baselinePath, simdPath, wasmOutDir }
}
