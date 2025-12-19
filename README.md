# wasm-bindgen-lite

An ultra-minimal, high-performance CLI tool and runtime for building Rust WebAssembly packages.

`wasm-bindgen-lite` is designed for developers who want the performance of Rust WASM without the overhead and complexity of `wasm-bindgen`. It provides a thin, manual-memory-management layer that is perfect for performance-critical utilities like encoders, decoders, crypto, and data processing.

## Why "Lite"?

Traditional `wasm-bindgen` generates a lot of glue code and often hides the underlying memory management. While convenient, it can introduce overhead and make it difficult to optimize data transfers.

**`wasm-bindgen-lite` gives you:**

- **Zero-cost ABI**: Uses standard `extern "C"` functions.
- **Manual Control**: Explicit `alloc` and `free` for maximum efficiency.
- **SIMD by Default**: Built-in support for SIMD detection and fallback.
- **Tiny Runtime**: A minimal JS wrapper (usually < 2KB) that works in Node.js and browsers.
- **Modern ESM**: Pure ESM output for modern build tools and runtimes.

## Key Features

- 🚀 **SIMD Fallback**: Automatically compiles two versions of your WASM (baseline and SIMD). The runtime detects support and loads the fastest one.
- 📦 **Dual Loaders**: Supports standard `.wasm` files (best for caching) or inlined base64 (best for single-file distribution).
- 🔄 **Streaming Support**: Built-in integration with `TransformStream` for processing data chunks on the fly.
- 🛠️ **Configurable**: Simple `wasm-bindgen-lite.config.json` to define your exports and behavior.
- ⚡ **Optimized**: Integrated with `wasm-opt` for smallest possible binaries.

## Quick Start

### 1. Install

```bash
npm install -D wasm-bindgen-lite
```

### 2. Prepare your Rust code

Expose `alloc_bytes` and `free_bytes` along with your functions. No `wasm-bindgen` dependency required!

```rust
use std::alloc::{alloc, dealloc, Layout};
use std::mem;

#[no_mangle]
pub unsafe extern "C" fn alloc_bytes(len: usize) -> *mut u8 {
    let layout = Layout::from_size_align(len, mem::align_of::<u8>()).unwrap();
    alloc(layout)
}

#[no_mangle]
pub unsafe extern "C" fn free_bytes(ptr: *mut u8, len: usize) {
    let layout = Layout::from_size_align(len, mem::align_of::<u8>()).unwrap();
    dealloc(ptr, layout);
}

#[no_mangle]
pub unsafe extern "C" fn my_transform(
    in_ptr: *const u8, in_len: usize,
    out_ptr: *mut u8, _out_len: usize,
) -> isize {
    let input = std::slice::from_raw_parts(in_ptr, in_len);
    let output = std::slice::from_raw_parts_mut(out_ptr, in_len);

    for i in 0..in_len {
        output[i] = input[i].wrapping_add(1);
    }

    in_len as isize
}
```

### 3. Build

Run the CLI to compile and generate JS loaders:

```bash
rustup target add wasm32-unknown-unknown
npx wasm-bindgen-lite build --crate . --out ./wasm-dist
```

### 4. Use in JavaScript

If you've published your output as an npm package (e.g., `my-wasm-pkg`), consumers can simply import it. Modern runtimes and bundlers will automatically pick the correct version (Node vs Browser) via conditional exports.

```javascript
import { init, my_transform } from 'my-wasm-pkg'

await init()

const input = new Uint8Array([1, 2, 3])
const output = my_transform(input)
console.log(output) // Uint8Array([2, 3, 4])
```

## Publishing & Automatic Export Configuration

When you build your project, `wasm-bindgen-lite` automatically detects your `package.json` and adds or updates the `exports` field to point to the generated artifacts.

This ensures that modern runtimes and bundlers automatically pick the correct version (Node vs Browser) via conditional exports.

### Generated Exports Configuration

```json
{
  "exports": {
    ".": {
      "browser": "./wasm-dist/browser.js",
      "node": "./wasm-dist/node.js",
      "default": "./wasm-dist/node.js"
    },
    "./inline": {
      "browser": "./wasm-dist/browser-inline.js",
      "node": "./wasm-dist/node-inline.js",
      "default": "./wasm-dist/node-inline.js"
    }
  }
}
```

### Import Examples

#### Standard (Automatic Environment Detection)

Used by Vite, Webpack, and Node.js.

```javascript
import { init, my_transform } from 'my-wasm-pkg'
await init()
```

#### Inline (Zero External Files)

Perfect for serverless or single-file distribution.

```javascript
import { init, my_transform } from 'my-wasm-pkg/inline'
await init()
```

#### CDN (jsDelivr, unpkg, etc.)

Because the browser loader uses modern `import.meta.url` resolution, it works out-of-the-box on CDNs. No extra configuration is needed.

```javascript
import {
  init,
  my_transform,
} from 'https://cdn.jsdelivr.net/npm/my-wasm-pkg/wasm-dist/browser.js'
await init()
```

> **Note**: For advanced users, there is a `wasmDelivery: { type: "jsdelivr" }` config option if you want to bundle the JS locally but fetch WASM binaries from a CDN (offloading).

## Initialization Modes (`autoInit`)

The `autoInit` setting controls how and when the WASM module is instantiated.

### 1. `off` (Default)

You must manually call `init()` and wait for it before calling any WASM functions.

```javascript
import { init, process } from 'my-wasm-pkg'
await init()
const result = process(data) // Sync call
```

### 2. `lazy` (Automatic & Async)

The generated wrapper functions are `async`. They will automatically call `init()` on the first invocation.

```javascript
import { process } from 'my-wasm-pkg'
const result = await process(data) // First call inits automatically
const result2 = await process(data2) // Subsequent calls use existing init
```

### 3. `eager` (Immediate)

`init()` is called immediately when the module is imported.

```javascript
import { init, process } from 'my-wasm-pkg'
// init() is already running in the background
await init() // Ensure it's finished
const result = process(data)
```

## Custom JS Wrapper

You can provide a `js.custom` file to add high-level APIs. It has access to the internal `core.js` utilities.

**Example `src/wrapper.js`:**

```javascript
import { createTransformStream } from './core.js'
export * from './core.js' // Re-export everything from core

const decoder = new TextDecoder()

export function createLineStream() {
  // createTransformStream handles alloc/free for you
  const wasmSplit = createTransformStream('splitLines')

  return wasmSplit.readable.pipeThrough(
    new TransformStream({
      transform(chunk, controller) {
        controller.enqueue(decoder.decode(chunk))
      },
    })
  )
}
```

Specify it in your config:

```json
{
  "js": { "custom": "src/wrapper.js" }
}
```

## Configuration (`wasm-bindgen-lite.config.json`)

```json
{
  "outDir": "wasm-dist",
  "artifactBaseName": "mod",
  "inline": true,
  "targets": { "baseline": true, "simd": true },
  "wasmOpt": { "mode": "auto", "args": ["-Oz"] },
  "js": {
    "emit": ["node", "browser", "inline"],
    "custom": "src/wrapper.js"
  },
  "exports": [
    {
      "abi": "my_transform",
      "name": "process",
      "return": "bytes",
      "reuseBuffer": true
    }
  ],
  "autoInit": "lazy",
  "stream": {
    "enable": true,
    "export": "process",
    "delimiter": 10
  },
  "wasmDelivery": { "type": "relative" }
}
```

### Configuration Options

| Option                  | Description                                                  | Default       |
| ----------------------- | ------------------------------------------------------------ | ------------- |
| `outDir`                | Directory for generated files                                | `"dist"`      |
| `artifactBaseName`      | Base name for `.wasm` files                                  | `"mod"`       |
| `inline`                | Whether to generate inline JS modules                        | `false`       |
| `autoInit`              | `"off"`, `"lazy"`, `"eager"`                                 | `"off"`       |
| `exports`               | List of WASM functions to wrap                               | `[]`          |
| `exports[].abi`         | Name of the `extern "C"` function in Rust                    | required      |
| `exports[].name`        | Name of the exported JS function                             | same as `abi` |
| `exports[].return`      | Return type: `bytes`, `f32`, `i32`, `u32`, etc.              | `"bytes"`     |
| `exports[].reuseBuffer` | If true, reuses the same memory buffer to reduce allocations | `false`       |
| `stream.enable`         | Generates a `createTransformStream()` helper                 | `false`       |
| `js.custom`             | Path to a custom JS file to include in the runtime           | `null`        |

## Advanced Usage

### SIMD Acceleration

`wasm-bindgen-lite` automatically compiles your Rust code with SIMD features enabled for the `.simd.wasm` target. The runtime detects support and picks the optimal binary.

### Streaming Processing

Use `createTransformStream()` for high-performance data pipelines:

```javascript
import { init, createTransformStream } from 'my-wasm-pkg'
await init()

const response = await fetch('data.bin')
const processed = response.body.pipeThrough(createTransformStream())
```

## CLI Reference

```bash
wasm-bindgen-lite build [options]

Options:
  --crate <path>      Path to Rust crate (default: ".")
  --out <path>        Output directory
  --release           Build in release mode (default)
  --debug             Build in debug mode
  --inline            Generate inline JS loaders
  --no-simd           Disable SIMD build
  --wasm-opt          Enable wasm-opt (default)
  --wasm-opt-args     Custom args for wasm-opt
```

## Examples

- [node-basic](./examples/node-basic): Minimal Node.js setup.
- [browser-vite](./examples/browser-vite): Modern browser setup with Vite.
- [simd-sum](./examples/simd-sum): SIMD-accelerated array processing.
- [streaming-lines](./examples/streaming-lines): Streaming data with custom wrappers.
- [offset-split](./examples/offset-split): Advanced buffer management and complex ABI.

## License

MIT
