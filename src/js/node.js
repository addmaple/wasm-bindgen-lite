import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { setInstance } from './core.js'
import { instantiateWithFallback } from './util.js'

const simdPath = fileURLToPath(new URL('./wasm/mod.simd.wasm', import.meta.url))
const basePath = fileURLToPath(new URL('./wasm/mod.base.wasm', import.meta.url))

let _ready = null

export function init(imports = {}) {
  return (_ready ??= (async () => {
    const [simdBytes, baseBytes] = await Promise.all([
      readFile(simdPath),
      readFile(basePath),
    ])
    const { instance } = await instantiateWithFallback(
      simdBytes,
      baseBytes,
      imports
    )
    setInstance(instance)
  })())
}

export * from './core.js'
