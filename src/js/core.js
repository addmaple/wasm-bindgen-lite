let _inst = null
let _memU8 = null

function refreshViews() {
  _memU8 = new Uint8Array(_inst.exports.memory.buffer)
}

export function setInstance(instance) {
  _inst = instance
  refreshViews()
}

export function memoryU8() {
  // memory can grow, so refresh if needed:
  if (_memU8.buffer !== _inst.exports.memory.buffer) refreshViews()
  return _memU8
}

export function alloc(len) {
  return _inst.exports.alloc_bytes(len) >>> 0
}

export function free(ptr, len) {
  _inst.exports.free_bytes(ptr >>> 0, len >>> 0)
}

/**
 * Example wrapper around the raw ABI
 */
export function process(inputU8) {
  const inPtr = alloc(inputU8.length)
  memoryU8().set(inputU8, inPtr)

  const outPtr = alloc(inputU8.length)
  // No need to set outU8 yet, but memory might have grown again

  const written = _inst.exports.process_bytes(
    inPtr,
    inputU8.length,
    outPtr,
    inputU8.length
  )

  if (written < 0) {
    free(inPtr, inputU8.length)
    free(outPtr, inputU8.length)
    throw new Error(`process_bytes failed: ${written}`)
  }

  // Refresh view again because memory might have grown during alloc
  const result = memoryU8().slice(outPtr, outPtr + written)

  free(inPtr, inputU8.length)
  free(outPtr, inputU8.length)

  return result
}
