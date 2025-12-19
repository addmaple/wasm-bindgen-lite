import { createReadStream } from 'node:fs'
import { Readable } from 'node:stream'
import { createLineStream } from './dist/node.js'

// Node Readable -> Web Readable
const input = Readable.toWeb(
  createReadStream(new URL('./sample.txt', import.meta.url))
)

async function run() {
  console.log('Streaming lines from sample.txt...')
  const lineStream = createLineStream()
  const reader = input.pipeThrough(lineStream).getReader()

  let count = 0
  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    console.log(`Line ${++count}:`, JSON.stringify(value))
  }
  console.log(`✓ Successfully processed ${count} lines`)
}

run().catch((err) => {
  console.error(err)
  process.exitCode = 1
})
