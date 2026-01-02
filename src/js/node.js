import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { setInstance } from './core.js'
import { instantiateWithBackend } from './util.js'

const simdPath = fileURLToPath(new URL('./wasm/mod.simd.wasm', import.meta.url))
const basePath = fileURLToPath(new URL('./wasm/mod.base.wasm', import.meta.url))

async function getSimdBytes() {
  return readFile(simdPath)
}

async function getBaseBytes() {
  return readFile(basePath)
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
