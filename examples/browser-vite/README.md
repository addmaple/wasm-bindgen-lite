# browser-vite example

A complete example of using `wasm-bindgen-lite` in a modern browser environment with **Vite**, featuring **Web Worker** integration.

## Overview

This example demonstrates how to integrate `wasm-bindgen-lite` into a modern frontend workflow:

- **Vite Integration**: Uses Vite for bundling, development, and asset management.
- **Main Thread Usage**: Loading and running WASM directly in the browser's main thread.
- **Web Worker Usage**: Offloading WASM processing to a background thread to keep the UI responsive.
- **Cross-Thread Initialization**: Shared initialization patterns between main and worker threads.
- **Automated Testing**: Integration with **Playwright** for end-to-end browser testing.

## Project Structure

- `src/main.js`: Entry point that initializes WASM in the main thread and spawns a worker.
- `src/worker.js`: Web Worker that initializes WASM and processes data in the background.
- `src/lib.rs`: Rust source for a simple byte-doubling transformation.
- `wasm-bindgen-lite.config.json`: Configuration specifying `browser` and `lazy` initialization.

## Usage

### 1. Build WASM

Generate the WASM binaries and browser glue code:

```bash
npm run build:wasm
```

### 2. Run Development Server

Start Vite's development server:

```bash
npm run dev
```

### 3. Build for Production

Bundle the entire app for production:

```bash
npm run build
```

### 4. Run Tests

Execute the Playwright end-to-end tests:

```bash
npm run test:pw
```

## How it Works

The generated `wasm-dist/browser.js` uses `fetch()` and `instantiateStreaming()` (with fallbacks) to load the WASM modules. Because `autoInit` is set to `lazy`, the first call to any exported function (like `process()`) will automatically trigger the WASM initialization if it hasn't happened yet.
