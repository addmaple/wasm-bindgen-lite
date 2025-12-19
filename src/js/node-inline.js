import { wasmBytes as simdBytes } from './wasm-inline/mod.simd.wasm.js'
import { wasmBytes as baseBytes } from './wasm-inline/mod.base.wasm.js'
import { setInstance } from './core.js'
import { instantiateWithFallback } from './util.js'

let _ready = null

export function init(imports = {}) {
  return (_ready ??= (async () => {
    const { instance } = await instantiateWithFallback(
      simdBytes,
      baseBytes,
      imports
    )
    setInstance(instance)
  })())
}

export * from './core.js'
