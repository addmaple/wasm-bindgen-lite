import { findOffsets } from './core.js'
export * from './core.js'

const decoder = new TextDecoder()

/**
 * High-level helper to split a buffer into lines using wasm-found offsets.
 * Handles \n, \r, and \r\n line endings.
 *
 * @param {Uint8Array} input - The input buffer to split
 * @returns {string[]} An array of strings
 */
export async function getLines(input) {
  const offsets = await findOffsets(input)
  const lines = []
  let lastPos = 0

  for (const offset of offsets) {
    lines.push(decoder.decode(input.subarray(lastPos, offset)))

    // Skip the delimiter(s): \n (10) or \r (13)
    const isCRLF = input[offset] === 13 && input[offset + 1] === 10
    lastPos = offset + (isCRLF ? 2 : 1)
  }

  // Push the final segment if it's not empty, or if the file ended with a newline
  // we might want an empty string at the end. In this example, we only push
  // if there's remaining content.
  if (lastPos < input.length) {
    lines.push(decoder.decode(input.subarray(lastPos)))
  }

  return lines
}
