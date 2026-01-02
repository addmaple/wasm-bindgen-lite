# WASM SIMD Analysis

> **Note**: This functionality is now integrated into the `wasm-bindgen-lite` CLI.
> Use `wasm-bindgen-lite bench --crate <path>` instead of the standalone scripts.

## Quick Start

```bash
# In any Rust crate with wasm-bindgen-lite.config.json
wasm-bindgen-lite bench --crate .
```

### CLI Integration

Integrate the benchmark command into your crate’s workflow via your root `package.json`. For example:

```json
{
  "scripts": {
    "bench": "wasm-bindgen-lite bench --crate ."
  }
}
```

Then run:

```bash
npm run bench           # builds variants and runs benchmarks
npm run bench -- --clean # ensure dist/bench_out/simd_out are rebuilt
```

Use `--clean` to drop previously generated artifacts before the build and re-run the benchmarks.

This builds a variant matrix (scalar, autovec, explicit-*), analyzes SIMD instructions, runs benchmarks, and generates comprehensive reports.

## Configuration

Add SIMD configuration to your `wasm-bindgen-lite.config.json`:

```json
{
  "simd": {
    "features": {
      "explicit-simd-encode": { "name": "encode" },
      "explicit-simd-decode": { "name": "decode" }
    },
    "allFeature": "explicit-simd"
  },
  "bench": {
    "outputDir": "bench_out",
    "warmupRuns": 10,
    "samples": 60,
    "dataSizes": [1024, 16384, 65536, 262144, 1048576]
  }
}
```

### Configuration Options

| Field | Description |
|-------|-------------|
| `simd.features` | Map of Cargo feature names to display names |
| `simd.allFeature` | Feature that enables all SIMD (default: `explicit-simd`) |
| `bench.outputDir` | Output directory (default: `bench_out`) |
| `bench.warmupRuns` | Warmup iterations (default: 10) |
| `bench.samples` | Benchmark samples (default: 60) |
| `bench.dataSizes` | Array of input sizes to test |

## What It Does

### 1. Builds Variant Matrix

| Variant | Description |
|---------|-------------|
| `scalar` | No SIMD (baseline) |
| `autovec` | LLVM autovectorization only (+simd128) |
| `explicit-*` | Individual explicit SIMD features |
| `explicit-all` | All explicit SIMD features combined |

### 2. Runs SIMD Detection

Analyzes each WASM binary for:
- Total SIMD instruction count
- SIMD density (% of ops that are SIMD)
- Per-function breakdown
- Source file:line mapping (via DWARF)
- Opcode distribution

### 3. Computes SIMD Provenance

Determines where SIMD instructions originate:

```
compiler_simd = simd_ops(autovec) - simd_ops(scalar)
explicit_simd = simd_ops(explicit) - simd_ops(autovec)
```

### 4. Runs Performance Benchmarks

If your crate exports functions with `alloc_bytes`/`free_bytes`, benchmarks run automatically:
- Tests all configured data sizes
- Computes throughput (MB/s)
- Calculates speedup vs scalar baseline

## Output Files

```
bench_out/
├── report.json    # Full JSON results
├── report.html    # Interactive HTML report
├── report.md      # Markdown summary
├── dist/          # Built WASM variants
│   ├── manifest.json
│   ├── scalar.wasm
│   ├── autovec.wasm
│   └── explicit-*.wasm
└── simd_out/      # Per-variant SIMD analysis
    ├── scalar.json
    ├── autovec.json
    └── explicit-*.json
```

## CLI Options

```bash
wasm-bindgen-lite bench [options]

Options:
  --crate <path>    Crate root (default: .)
  --config <path>   Path to config JSON
  --clean           Clean output directory before building
  --skip-build      Skip building, use existing variants
```

## Example Usage

```bash
# Full analysis
wasm-bindgen-lite bench --crate .

# Use existing builds (skip recompile)
wasm-bindgen-lite bench --crate . --skip-build

# Clean and rebuild
wasm-bindgen-lite bench --crate . --clean
```

## Example: base64-simd

```json
{
  "crateName": "base64_simd",
  "exports": [
    { "name": "encode", "abi": "base64_encode", "outSize": "Math.ceil(len * 4 / 3)" },
    { "name": "decode", "abi": "base64_decode", "outSize": "Math.ceil(len * 3 / 4)" }
  ],
  "simd": {
    "features": {
      "explicit-simd-encode": { "name": "encode" },
      "explicit-simd-decode": { "name": "decode" }
    },
    "allFeature": "explicit-simd"
  }
}
```

Then run:
```bash
npm run bench
# or directly:
wasm-bindgen-lite bench --crate .
```

## Interpreting Results

### Speedup Analysis

- **scalar → autovec**: LLVM autovectorization benefit
- **autovec → explicit**: Explicit SIMD benefit over compiler
- **scalar → explicit-all**: Total SIMD benefit

### SIMD Provenance

| Metric | Meaning |
|--------|---------|
| `compiler_added > 0` | LLVM is autovectorizing some code |
| `explicit_added > 0` | Your hand-written SIMD adds value |
| `explicit_added ≈ 0` | Compiler already optimizes well |

---

## Standalone Usage (Legacy)

If you still need to iterate on the bench tooling directly, the scripts in this folder remain available:

```bash
cd bench
npm run all         # Full pipeline
npm run build       # Build variants only
npm run bench       # Run benchmarks only
npm run merge       # Merge reports
```

### simd-detect Tool

The Rust CLI tool for SIMD analysis:

```bash
cd simd-detect
cargo build --release

# Analyze any WASM file
./target/release/simd-detect path/to/file.wasm --variant myvariant -o output.json
```

## Requirements

- Node.js 20+
- Rust with `wasm32-unknown-unknown` target
- wasm-bindgen-lite installed

```bash
rustup target add wasm32-unknown-unknown
npm install -g wasm-bindgen-lite
```
