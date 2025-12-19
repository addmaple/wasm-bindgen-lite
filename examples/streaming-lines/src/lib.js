import { createTransformStream } from './core.js'
export * from './core.js'

const decoder = new TextDecoder()

/**
 * High-level helper to create a line-splitting text stream.
 * Uses wasm for fast splitting and returns a stream of strings.
 */
export function createLineStream() {
  const wasmSplit = createTransformStream('splitLines')
  const toStrings = new TransformStream({
    transform(chunk, controller) {
      controller.enqueue(decoder.decode(chunk))
    },
  })

  return {
    writable: wasmSplit.writable,
    readable: wasmSplit.readable.pipeThrough(toStrings),
  }
}
