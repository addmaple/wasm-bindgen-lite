import { execSync } from 'node:child_process'
import { copyFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

function exec(cmd, options = {}) {
  try {
    execSync(cmd, { stdio: 'inherit', ...options })
  } catch {
    console.error(`\nError: Command failed: ${cmd}`)
    process.exit(1)
  }
}

function runCargoBuild({ crateDir, release, simd }) {
  const args = ['build', '--target', 'wasm32-unknown-unknown']
  if (release) args.push('--release')

  const env = { ...process.env }
  if (simd) {
    const base = process.env.RUSTFLAGS || ''
    const extra = '-C target-feature=+simd128'
    env.RUSTFLAGS = [base, extra].filter(Boolean).join(' ').trim()
  }

  exec(`cargo ${args.join(' ')}`, {
    cwd: crateDir,
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
  exec(args.join(' '))
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

  const paths = { baselinePath: null, simdPath: null, wasmOutDir }

  const build = (isSimd, suffix) => {
    const label = isSimd ? 'SIMD' : 'baseline'
    console.log(`Building ${label} wasm...`)

    runCargoBuild({ crateDir, release, simd: isSimd })

    const built = wasmPath({ crateDir, release, wasmFileStem })
    const dest = join(wasmOutDir, `${artifactBaseName}.${suffix}.wasm`)

    copyFileSync(built, dest)
    maybeRunWasmOpt(dest, wasmOpt)
    return dest
  }

  if (targets.baseline) paths.baselinePath = build(false, 'base')
  if (targets.simd) paths.simdPath = build(true, 'simd')

  return paths
}
