import assert from 'node:assert'
import { init, getLines } from './dist/node.js'

async function main() {
  await init()

  const text = 'line1\nline2\r\nline3\rlast'
  const encoder = new TextEncoder()
  const input = encoder.encode(text)

  console.log('Testing with text:', JSON.stringify(text))
  const lines = await getLines(input)
  console.log('Result:', lines)

  assert.deepStrictEqual(lines, ['line1', 'line2', 'line3', 'last'])
  console.log('✓ offset-split test passed')
}

main().catch((err) => {
  console.error('Test failed:', err)
  process.exit(1)
})
