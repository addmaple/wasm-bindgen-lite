import { wasmBytes as _simdBytes } from './wasm-inline/mod.simd.wasm.js'
import { wasmBytes as _baseBytes } from './wasm-inline/mod.base.wasm.js'
import { setInstance } from './core.js'
import { instantiateWithBackend } from './util.js'

async function getSimdBytes() {
  return _simdBytes
}

async function getBaseBytes() {
  return _baseBytes
}

let _ready = null
let _backend = null

export function init(imports = {}, opts = {}) {
  const backend = opts.backend || 'auto'
  if (_ready && _backend === backend) return _ready
  _backend = backend
  return (_ready = (async () => {
    const { instance } = await instantiateWithBackend({
      getSimdBytes,
      getBaseBytes,
      imports,
      backend,
    })
    setInstance(instance)
  })())
}

export * from './core.js'
