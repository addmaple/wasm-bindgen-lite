# offset-split example

Advanced example demonstrating **SIMD-accelerated line split** with manual memory management and complex ABI interactions.

## Overview

This example shows how to build a high-performance line splitter that uses WASM (with SIMD fallback) to find line break offsets in a buffer. It demonstrates several advanced features of `wasm-bindgen-lite`:

- **Manual Memory Management**: Using `alloc_bytes` and `free_bytes` in Rust for zero-copy data passing.
- **Complex ABI**: Returning a `u32_array` of offsets from Rust to JavaScript.
- **Buffer Reuse**: Using the `reuseBuffer: true` configuration to minimize allocations across calls.
- **Custom Wrapper**: Using `src/lib.js` to provide a clean, high-level `getLines` API while keeping the core logic in WASM.
- **SIMD Acceleration**: Automatic use of 128-bit SIMD instructions on supported platforms for massive performance gains.

## Performance

The WASM implementation uses SIMD to scan 16 bytes at a time for newline characters (`\n` and `\r`). On modern hardware, this typically results in a **10x-20x speedup** over native JavaScript loop-based implementations for large files.

## Project Structure

- `src/lib.rs`: Rust source containing the SIMD-accelerated scanning logic.
- `src/lib.js`: Custom JavaScript wrapper that implements `getLines`.
- `wasm-bindgen-lite.config.json`: Configuration defining the `findOffsets` export and `u32_array` return type.
- `test.js`: Basic functional tests for `\n`, `\r`, and `\r\n` line endings.
- `bench.js`: Performance benchmark comparing WASM vs. native JS.

## Usage

### 1. Build

Generate the WASM binaries and JavaScript glue code:

```bash
npm run build:wasm
```

### 2. Run Tests

Verify correctness across different line ending styles:

```bash
npm test
```

### 3. Run Benchmark

Compare performance on a 50MB synthetic dataset:

```bash
npm run bench
```

## API

The high-level API provided by this example:

```javascript
import { init, getLines } from './dist/node.js'

await init()

const buffer = new TextEncoder().encode('line1\nline2\r\nline3')
const lines = await getLines(buffer)
// ["line1", "line2", "line3"]
```
