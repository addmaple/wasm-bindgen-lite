import { rmSync, existsSync } from 'node:fs'
import { loadConfigFromCli, summarizeConfig } from './config.js'
import { buildArtifacts } from './build.js'
import { emitRuntime } from './emit.js'
import { updatePackageJson } from './pkg.js'

export async function runBuild(cliOpts) {
  const cfg = loadConfigFromCli(cliOpts)
  console.log('Configuration:', summarizeConfig(cfg))

  const wasmPaths = buildArtifacts({
    crateDir: cfg.crateDir,
    wasmFileStem: cfg.wasmFileStem,
    artifactBaseName: cfg.artifactBaseName,
    outDir: cfg.outDir,
    targets: cfg.targets,
    release: cfg.release,
    wasmOpt: cfg.wasmOpt,
  })

  emitRuntime({
    outDir: cfg.outDir,
    artifactBaseName: cfg.artifactBaseName,
    emitNode: cfg.js.emit.node,
    emitBrowser: cfg.js.emit.browser,
    emitInline: cfg.inline && cfg.js.emit.inline,
    wasmPaths,
    exportsList: cfg.exports,
    autoInit: cfg.autoInit,
    stream: cfg.stream,
    customJs: cfg.js.custom,
    wasmDelivery: cfg.wasmDelivery,
  })

  updatePackageJson({
    crateDir: cfg.crateDir,
    outDir: cfg.outDir,
    artifactBaseName: cfg.artifactBaseName,
    js: cfg.js,
    inline: cfg.inline,
  })

  console.log('Build complete:', cfg.outDir)
}

export async function runClean(cliOpts) {
  const cfg = loadConfigFromCli(cliOpts)
  if (existsSync(cfg.outDir)) {
    rmSync(cfg.outDir, { recursive: true, force: true })
    console.log(`Removed ${cfg.outDir}`)
  } else {
    console.log(`Nothing to clean at ${cfg.outDir}`)
  }
}

export function printHelp() {
  const help = `
wasm-bindgen-lite <command> [options]

Commands:
  build         Build wasm artifacts and emit JS loaders (default release)
  clean         Remove the configured output directory
  help          Show this message

Options (for build):
  --crate <path>         Crate root (default: .)
  --out <path>           Output dir (default: dist-wasm-bindgen-lite)
  --config <path>        Path to config JSON (default: wasm-bindgen-lite.config.json)
  --release | --debug    Toggle cargo profile (default: release)
  --inline | --no-inline Emit inline loaders and byte modules (default: inline)
  --simd | --no-simd     Build SIMD variant (default: simd on)
  --wasm-opt | --no-wasm-opt  Force enable/disable wasm-opt (default: auto detect)
  --wasm-opt-args "<args>"    Extra args, default "-Oz"
`
  console.log(help)
}
