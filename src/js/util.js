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
