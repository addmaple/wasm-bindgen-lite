import assert from 'node:assert'
import { process as processBytes } from './dist/node.js'

async function main() {
  const input = new Uint8Array([1, 2, 3])
  console.log('Testing node-basic with input:', input)

  const output = await processBytes(input)
  console.log('Output:', output)

  assert.deepStrictEqual(Array.from(output), [3, 4, 5])
  console.log('✓ node-basic example passed')
}

main().catch((err) => {
  console.error('Test failed:', err)
  process.exit(1)
})
