import { init, process } from '../wasm-dist/browser.js'

self.onmessage = async (e) => {
  try {
    const { input } = e.data
    const output = await process(input)
    self.postMessage({ output })
  } catch (err) {
    self.postMessage({ error: err.message })
  }
}
