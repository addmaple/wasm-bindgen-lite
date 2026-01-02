import { setInstance } from './core.js'
import { instantiateWithBackend } from './util.js'

const simdUrl = new URL('./wasm/mod.simd.wasm', import.meta.url)
const baseUrl = new URL('./wasm/mod.base.wasm', import.meta.url)

async function getSimdBytes() {
  const res = await fetch(simdUrl)
  return res.arrayBuffer()
}

async function getBaseBytes() {
  const res = await fetch(baseUrl)
  return res.arrayBuffer()
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
