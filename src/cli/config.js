import { existsSync, readFileSync } from 'node:fs'
import { resolve, join } from 'node:path'

const DEFAULT_CONFIG = {
  outDir: 'dist-wasm-bindgen-lite',
  artifactBaseName: 'mod',
  targets: {
    baseline: true,
    simd: true,
  },
  inline: true,
  release: true,
  wasmOpt: {
    mode: 'auto', // auto | on | off
    args: ['-Oz'],
  },
  js: {
    emit: {
      node: true,
      browser: true,
      inline: true,
      types: true,
    },
    custom: null, // path to custom JS/TS file to include and re-export
  },
  exports: [
    {
      abi: 'process_bytes',
      name: 'process',
      return: 'bytes', // bytes | f32 | f64 | i32 | u32 | i16 | u16 | i8 | u8
      reuseBuffer: false,
    },
  ],
  autoInit: 'off', // off | lazy | eager
  stream: {
    enable: false,
    export: 'process',
    delimiter: null, // null | number (byte value)
  },
  wasmDelivery: {
    type: 'relative', // relative | jsdelivr
  },
}

function parseTomlName(contents) {
  // leniently find the first name in the [package] section
  const pkgMatch = /\[package\]([\s\S]*?)(?:\n\[[^\]]|\r?\n\[[^\]])/m.exec(
    contents + '\n['
  ) // sentinel [
  if (!pkgMatch) return null
  const body = pkgMatch[1]
  const nameMatch = /name\s*=\s*["']([^"']+)["']/m.exec(body)
  return nameMatch ? nameMatch[1] : null
}

function readCrateName(crateDir) {
  const cargoPath = join(crateDir, 'Cargo.toml')
  const contents = readFileSync(cargoPath, 'utf8')
  const crateName = parseTomlName(contents)
  if (!crateName) {
    throw new Error(`Could not find package.name in ${cargoPath}`)
  }
  return crateName
}

function normalizeEmit(value) {
  if (!value) return { node: true, browser: true, inline: true, types: true }
  if (Array.isArray(value)) {
    const set = new Set(value)
    return {
      node: set.has('node'),
      browser: set.has('browser'),
      inline: set.has('inline'),
      types: set.has('types') || !set.has('no-types'), // default to true if not specified
    }
  }
  if (typeof value === 'object') {
    return {
      node: value.node !== false,
      browser: value.browser !== false,
      inline: value.inline !== false,
      types: value.types !== false,
    }
  }
  return { node: true, browser: true, inline: true, types: true }
}

function normalizeWasmOpt(input) {
  if (!input || input.mode === 'auto' || input === 'auto') {
    return { mode: 'auto', args: input?.args || DEFAULT_CONFIG.wasmOpt.args }
  }
  if (input === 'off' || input?.mode === 'off') {
    return { mode: 'off', args: input?.args || DEFAULT_CONFIG.wasmOpt.args }
  }
  return { mode: 'on', args: input?.args || DEFAULT_CONFIG.wasmOpt.args }
}

export function loadConfigFromCli(cliOpts = {}) {
  const crateDir = resolve(cliOpts.crate || '.')
  const cfgPath = cliOpts.configPath
    ? resolve(crateDir, cliOpts.configPath)
    : resolve(crateDir, 'wasm-bindgen-lite.config.json')

  let fileConfig = {}
  if (existsSync(cfgPath)) {
    fileConfig = JSON.parse(readFileSync(cfgPath, 'utf8'))
  }

  const crateName = readCrateName(crateDir)

  // Merge defaults, file config, and CLI options
  const config = {
    crateDir,
    crateName,
    wasmFileStem: crateName.replace(/-/g, '_'),

    artifactBaseName:
      cliOpts.artifactBaseName ??
      fileConfig.artifactBaseName ??
      DEFAULT_CONFIG.artifactBaseName,

    outDir: resolve(
      crateDir,
      cliOpts.out ?? fileConfig.outDir ?? DEFAULT_CONFIG.outDir
    ),

    release:
      typeof cliOpts.release === 'boolean'
        ? cliOpts.release
        : (fileConfig.release ?? DEFAULT_CONFIG.release),

    targets: {
      baseline:
        cliOpts.baseline ??
        fileConfig.targets?.baseline ??
        DEFAULT_CONFIG.targets.baseline,
      simd:
        typeof cliOpts.simd === 'boolean'
          ? cliOpts.simd
          : (fileConfig.targets?.simd ?? DEFAULT_CONFIG.targets.simd),
    },

    inline:
      typeof cliOpts.inline === 'boolean'
        ? cliOpts.inline
        : (fileConfig.inline ?? DEFAULT_CONFIG.inline),

    wasmOpt: normalizeWasmOpt(
      cliOpts.wasmOptMode
        ? { mode: cliOpts.wasmOptMode, args: cliOpts.wasmOptArgs }
        : (fileConfig.wasmOpt ?? DEFAULT_CONFIG.wasmOpt)
    ),

    js: {
      emit: normalizeEmit(fileConfig.js?.emit ?? DEFAULT_CONFIG.js.emit),
      custom: fileConfig.js?.custom ?? DEFAULT_CONFIG.js.custom,
    },

    exports:
      fileConfig.exports && Array.isArray(fileConfig.exports)
        ? fileConfig.exports
        : DEFAULT_CONFIG.exports,

    autoInit: ['lazy', 'eager', 'off'].includes(fileConfig.autoInit)
      ? fileConfig.autoInit
      : DEFAULT_CONFIG.autoInit,

    stream: {
      enable: fileConfig.stream?.enable ?? DEFAULT_CONFIG.stream.enable,
      export:
        fileConfig.stream?.export ??
        fileConfig.exports?.[0]?.name ??
        DEFAULT_CONFIG.stream.export,
      delimiter:
        fileConfig.stream?.delimiter ?? DEFAULT_CONFIG.stream.delimiter,
      blockSize: fileConfig.stream?.blockSize ?? null,
    },

    wasmDelivery: {
      type: fileConfig.wasmDelivery?.type ?? DEFAULT_CONFIG.wasmDelivery.type,
      package: fileConfig.wasmDelivery?.package ?? fileConfig.name ?? crateName,
      version:
        fileConfig.wasmDelivery?.version ?? fileConfig.version ?? 'latest',
    },
  }

  return config
}

export function summarizeConfig(cfg) {
  return {
    crateDir: cfg.crateDir,
    outDir: cfg.outDir,
    artifactBaseName: cfg.artifactBaseName,
    targets: cfg.targets,
    inline: cfg.inline,
    wasmOpt: cfg.wasmOpt,
    release: cfg.release,
    jsEmit: cfg.js.emit,
    exports: cfg.exports,
    autoInit: cfg.autoInit,
    stream: cfg.stream,
    wasmDelivery: cfg.wasmDelivery,
  }
}
