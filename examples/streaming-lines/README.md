# streaming-lines example

Demonstrates high-performance **streaming line-by-line processing** using Web Streams and WASM SIMD.

## Overview

This example shows how to process large data streams efficiently by splitting chunks in WASM and emitting them as a stream of strings.

- **`TransformStream` Integration**: Seamlessly plugs into standard Web Streams.
- **WASM Acceleration**: Uses SIMD to scan for newlines (`\n`, `\r`, `\r\n`) and normalize them.
- **Buffer Reuse**: Minimizes garbage collection by reusing input/output buffers in WASM.
- **Custom Wrapper**: Provides a high-level `createLineStream()` API via `src/lib.js`.
- **Zero-Copy Intent**: Normalizes newlines to null terminators (`\0`) in-place where possible.

## Project Structure

- `src/lib.rs`: Rust logic for scanning and normalizing newline characters in chunks.
- `src/lib.js`: Custom JavaScript wrapper that provides the `createLineStream` API.
- `demo.js`: Demonstrates usage by reading a local file and printing lines.
- `bench.js`: Compares streaming performance against a naive JS `TransformStream`.

## Usage

### 1. Build

Generate the WASM binaries and Node.js glue code:

```bash
npm run build:wasm
```

### 2. Run Demo

Process the included `sample.txt`:

```bash
npm run demo
```

### 3. Run Benchmark

Compare streaming performance on a 20MB synthetic dataset:

```bash
npm run bench
```

## Performance

By offloading the scanning and normalization to WASM SIMD, this implementation can process text streams significantly faster than pure JS implementations, especially when dealing with mixed line endings.
