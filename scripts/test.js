import assert from 'node:assert'
import { init as initNode, process as processNode } from '../dist/node.js'
import {
  init as initInline,
  process as processInline,
} from '../dist/node-inline.js'

async function testNode() {
  console.log('Testing Node external loader...')
  await initNode()

  const input = new Uint8Array([1, 2, 3])
  const output = processNode(input)

  console.log('Input:', input)
  console.log('Output:', output)

  assert.deepStrictEqual(Array.from(output), [2, 3, 4])
  console.log('Node external loader test passed!')
}

async function testInline() {
  console.log('\nTesting Node inline loader...')
  // Note: /inline exports are mapped in package.json to ./dist/node-inline.js for Node
  await initInline()

  const input = new Uint8Array([10, 20, 30])
  const output = processInline(input)

  console.log('Input:', input)
  console.log('Output:', output)

  assert.deepStrictEqual(Array.from(output), [11, 21, 31])
  console.log('Node inline loader test passed!')
}

async function runTests() {
  try {
    await testNode()
    await testInline()
    console.log('\nAll JS tests passed!')
  } catch (e) {
    console.error('JS tests failed:', e)
    process.exit(1)
  }
}

runTests()
