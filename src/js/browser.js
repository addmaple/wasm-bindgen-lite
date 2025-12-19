import { setInstance } from './core.js'
import { instantiateWithFallback } from './util.js'

const simdUrl = new URL('./wasm/mod.simd.wasm', import.meta.url)
const baseUrl = new URL('./wasm/mod.base.wasm', import.meta.url)

let _ready = null

export function init(imports = {}) {
  return (_ready ??= (async () => {
    const [simdRes, baseRes] = await Promise.all([
      fetch(simdUrl),
      fetch(baseUrl),
    ])

    const [simdBytes, baseBytes] = await Promise.all([
      simdRes.arrayBuffer(),
      baseRes.arrayBuffer(),
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
