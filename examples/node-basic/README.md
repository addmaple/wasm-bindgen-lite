# node-basic example

A minimal, zero-dependency example of using `wasm-bindgen-lite` in a Node.js environment.

## Overview

This example demonstrates the core fundamentals of `wasm-bindgen-lite`:

- **Automatic WASM Loading**: Using the `autoInit: "lazy"` mode to simplify initialization.
- **Byte Processing**: Passing a `Uint8Array` to Rust and receiving a processed `Uint8Array` back.
- **Node.js Integration**: Using the generated `dist/node.js` loader.

## Structure

- `src/lib.rs`: Rust implementation of a simple byte transformation (adding 2 to each byte).
- `test.js`: Node.js script that loads the WASM and runs a functional test.
- `wasm-bindgen-lite.config.json`: Minimal configuration for the build.

## Usage

### 1. Build

Generate the WASM binaries and Node.js glue code:

```bash
npm run build:wasm
```

### 2. Run Test

Execute the functional test:

```bash
npm test
```

## API

The generated API is simple and promise-based:

```javascript
import { process } from './dist/node.js'

// Input:  [1, 2, 3]
// Output: [3, 4, 5]
const output = await process(new Uint8Array([1, 2, 3]))
```
