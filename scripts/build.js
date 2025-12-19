import { execSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const DIST = join(ROOT, 'dist')
const SRC_JS = join(ROOT, 'src/js')

function run(cmd, env = {}) {
  console.log(`> ${cmd}`)
  execSync(cmd, { stdio: 'inherit', env: { ...process.env, ...env } })
}

// 1. Ensure target directory exists
mkdirSync(join(DIST, 'wasm'), { recursive: true })
mkdirSync(join(DIST, 'wasm-inline'), { recursive: true })

// 2. Build WASM (Baseline)
console.log('Building baseline WASM...')
run('cargo build --target wasm32-unknown-unknown --release')
const baselineWasm = join(
  ROOT,
  'target/wasm32-unknown-unknown/release/wasm_bindgen_lite.wasm'
)

// 3. Build WASM (SIMD)
console.log('Building SIMD WASM...')
run('cargo build --target wasm32-unknown-unknown --release', {
  RUSTFLAGS: '-C target-feature=+simd128',
})
const simdWasm = join(
  ROOT,
  'target/wasm32-unknown-unknown/release/wasm_bindgen_lite.wasm'
)
// Note: Since we are building the same crate, we need to move the baseline first or build into different targets.
// Actually, cargo build will overwrite. Let's build baseline, move it, then build SIMD.

// Let's redo step 2 and 3 properly
console.log('Building baseline WASM...')
run('cargo build --target wasm32-unknown-unknown --release')
copyFileSync(baselineWasm, join(DIST, 'wasm/mod.base.wasm'))

console.log('Building SIMD WASM...')
run('cargo build --target wasm32-unknown-unknown --release', {
  RUSTFLAGS: '-C target-feature=+simd128',
})
copyFileSync(simdWasm, join(DIST, 'wasm/mod.simd.wasm'))

// 4. Optimize (Optional - check for wasm-opt)
try {
  run('wasm-opt --version')
  console.log('Optimizing WASM...')
  run(
    `wasm-opt -Oz ${join(DIST, 'wasm/mod.base.wasm')} -o ${join(DIST, 'wasm/mod.base.wasm')}`
  )
  run(
    `wasm-opt -Oz ${join(DIST, 'wasm/mod.simd.wasm')} -o ${join(DIST, 'wasm/mod.simd.wasm')}`
  )
} catch (e) {
  console.warn('wasm-opt not found, skipping optimization.')
}

// 5. Generate inline JS modules
function generateInline(name, wasmPath) {
  const bytes = readFileSync(wasmPath)
  const content = `// auto-generated\nexport const wasmBytes = new Uint8Array([${bytes.join(',')}]);\n`
  writeFileSync(join(DIST, `wasm-inline/mod.${name}.wasm.js`), content)
}

console.log('Generating inline WASM modules...')
generateInline('base', join(DIST, 'wasm/mod.base.wasm'))
generateInline('simd', join(DIST, 'wasm/mod.simd.wasm'))

// 6. Copy JS files
console.log('Copying JS loaders...')
const jsFiles = [
  'core.js',
  'util.js',
  'browser.js',
  'node.js',
  'browser-inline.js',
  'node-inline.js',
]

for (const f of jsFiles) {
  copyFileSync(join(SRC_JS, f), join(DIST, f))
}

console.log('Build complete!')
