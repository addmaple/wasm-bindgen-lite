export async function instantiateWithFallback(
  trySimdBytes,
  baseBytes,
  imports
) {
  try {
    const { instance } = await WebAssembly.instantiate(trySimdBytes, imports)
    return { instance, backend: 'wasm-simd' }
  } catch {
    // If SIMD fails (not supported), try baseline
    const { instance } = await WebAssembly.instantiate(baseBytes, imports)
    return { instance, backend: 'wasm' }
  }
}

export async function instantiateWithBackend({
  getSimdBytes,
  getBaseBytes,
  imports,
  backend = 'auto',
}) {
  if (backend === 'base') {
    const baseBytes = await getBaseBytes()
    const { instance } = await WebAssembly.instantiate(baseBytes, imports)
    return { instance, backend: 'wasm' }
  }

  if (backend === 'simd') {
    const simdBytes = await getSimdBytes()
    const { instance } = await WebAssembly.instantiate(simdBytes, imports)
    return { instance, backend: 'wasm-simd' }
  }

  // auto: try simd first, then fallback to baseline
  try {
    const simdBytes = await getSimdBytes()
    const { instance } = await WebAssembly.instantiate(simdBytes, imports)
    return { instance, backend: 'wasm-simd' }
  } catch {
    const baseBytes = await getBaseBytes()
    const { instance } = await WebAssembly.instantiate(baseBytes, imports)
    return { instance, backend: 'wasm' }
  }
}
