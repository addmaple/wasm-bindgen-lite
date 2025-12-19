# simd-sum example

Demonstrates **SIMD-accelerated numeric summation** with automatic fallback for non-SIMD environments.

## Overview

This example showcases how `wasm-bindgen-lite` handles different numeric types and leverages 128-bit SIMD instructions to sum large arrays efficiently.

- **Multi-Type Support**: Implementations for `u8`, `u16`, and `f32` arrays.
- **SIMD Detection**: Uses Rust's `#[cfg(target_feature = "simd128")]` to provide optimized paths.
- **WASM Fallback**: Automatically generates both SIMD and baseline WASM binaries.
- **Performance Benchmarking**: Includes a comparison script to measure WASM vs. native JS speed.

## Project Structure

- `src/lib.rs`: Rust implementation with SIMD intrinsics and scalar fallbacks.
- `test.js`: Functional tests verifying summation accuracy across different types.
- `bench.js`: Benchmark script comparing `sumF32` performance against a native JS loop.

## Usage

### 1. Build

Generate the WASM binaries and Node.js glue code:

```bash
npm run build:wasm
```

### 2. Run Tests

Verify summation logic:

```bash
npm test
```

### 3. Run Benchmark

Compare performance on a 100k element array:

```bash
npm run bench
```

## Performance

SIMD allows the WASM engine to process multiple numbers in a single clock cycle. For large floating-point arrays, this typically results in a **3x-8x speedup** over native JavaScript `for` loops.
