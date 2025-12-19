import { process } from '../wasm-dist/browser.js'

const statusEl = document.querySelector('#status')
const workerStatusEl = document.querySelector('#worker-status')

async function runMainThread() {
  statusEl.textContent = 'Processing in main thread...'
  const input = new Uint8Array([4, 5, 6])
  const output = await process(input)
  statusEl.textContent = `Input: ${input.join(', ')} → Output: ${output.join(', ')}`
}

async function runWorker() {
  workerStatusEl.textContent = 'Spawning worker...'

  // Use Vite's worker import syntax
  const worker = new Worker(new URL('./worker.js', import.meta.url), {
    type: 'module',
  })

  worker.onmessage = (e) => {
    const { output, error } = e.data
    if (error) {
      workerStatusEl.textContent = `Error: ${error}`
    } else {
      workerStatusEl.textContent = `Output from worker: ${output.join(', ')}`
    }
  }

  const input = new Uint8Array([10, 20, 30])
  worker.postMessage({ input })
}

runMainThread().catch((err) => {
  console.error(err)
  statusEl.textContent = `Main thread error: ${err.message}`
})

runWorker().catch((err) => {
  console.error(err)
  workerStatusEl.textContent = `Worker error: ${err.message}`
})
