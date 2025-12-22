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

function resolveTargetDir(crateDir) {
  try {
    const raw = execSync('cargo metadata --format-version 1 --no-deps', {
      cwd: crateDir,
      stdio: ['ignore', 'pipe', 'inherit'],
    }).toString()
    const meta = JSON.parse(raw)
    if (meta?.target_directory) return meta.target_directory
  } catch {
    console.warn(
      'Warning: failed to read cargo metadata, defaulting to local target dir'
    )
  }
  return join(crateDir, 'target')
}

function runCargoBuild({ crateDir, release, simd, targetDir, features }) {
  const args = ['build', '--target', 'wasm32-unknown-unknown']
  if (release) args.push('--release')
  if (features) {
    args.push('--features', features)
  }

  const env = { ...process.env }

  if (release) {
    // Explicitly force opt-level 3 for fastest execution
    env.CARGO_PROFILE_RELEASE_OPT_LEVEL = '3'
    env.CARGO_PROFILE_RELEASE_PANIC = 'abort'
    env.CARGO_PROFILE_RELEASE_CODEGEN_UNITS = '1'
    env.CARGO_PROFILE_RELEASE_LTO = 'fat'
  }

  if (simd) {
    const base = env.RUSTFLAGS || ''
    const extra = '-C target-feature=+simd128'
    env.RUSTFLAGS = [base, extra].filter(Boolean).join(' ').trim()
  }
  if (targetDir) {
    env.CARGO_TARGET_DIR = targetDir
  }

  exec(`cargo ${args.join(' ')}`, {
    cwd: crateDir,
    env,
  })
}

function wasmPath({ targetDir, release, wasmFileStem }) {
  const profile = release ? 'release' : 'debug'
  return join(
    targetDir,
    'wasm32-unknown-unknown',
    profile,
    `${wasmFileStem}.wasm`
  )
}

function maybeRunWasmOpt(wasmFile, wasmOpt, release) {
  if (wasmOpt.mode === 'off') return
  if (wasmOpt.mode === 'auto') {
    try {
      execSync('wasm-opt --version', { stdio: 'ignore' })
    } catch {
      return
    }
  }

  const args = ['wasm-opt']

  if (release) {
    // Only strip metadata and debug info for fastest performance
    args.push('--strip-debug')
    args.push('--strip-producers')
    args.push('--strip-target-features')
    
    // We EXPLICITLY avoid -O passes here to maintain absolute fastest speed
    // unless the user provided specific args
    if (wasmOpt.args.length > 0) {
      args.push(...wasmOpt.args)
    }
  } else {
    args.push(...wasmOpt.args)
  }

  args.push(wasmFile, '-o', wasmFile)
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
  const targetDir = resolveTargetDir(crateDir)
  mkdirSync(outDir, { recursive: true })
  const wasmOutDir = join(outDir, 'wasm')
  mkdirSync(wasmOutDir, { recursive: true })

  const paths = { baselinePath: null, simdPath: null, wasmOutDir }

  const build = (isSimd, suffix) => {
    const label = isSimd ? 'SIMD' : 'baseline'
    console.log(`Building ${label} wasm...`)

    const simdFeatures = isSimd ? targets.simdFeatures : null
    const baselineFeatures = !isSimd ? targets.baselineFeatures : null
    const features = simdFeatures || baselineFeatures

    runCargoBuild({ crateDir, release, simd: isSimd, targetDir, features })

    const built = wasmPath({ targetDir, release, wasmFileStem })
    const dest = join(wasmOutDir, `${artifactBaseName}.${suffix}.wasm`)

    copyFileSync(built, dest)
    maybeRunWasmOpt(dest, wasmOpt)
    return dest
  }

  if (targets.baseline) paths.baselinePath = build(false, 'base')
  if (targets.simd) paths.simdPath = build(true, 'simd')

  return paths
}
