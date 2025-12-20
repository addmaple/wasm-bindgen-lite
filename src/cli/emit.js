import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join, extname } from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const UTIL_PATH = fileURLToPath(new URL('../js/util.js', import.meta.url))
const require = createRequire(import.meta.url)
const TS_EXTS = new Set(['.ts', '.tsx', '.cts', '.mts'])

export function buildWrapperIR(exportsList) {
  return exportsList.map((entry) => {
    const { abi, name, return: retType, reuseBuffer, outSize } = entry
    const returnType = retType || 'bytes'
    const fnName = name || abi
    const outSizeExpr =
      returnType !== 'bytes'
        ? `(scalarSize('${returnType}') || 4)`
        : outSize
          ? outSize.replace(/\blen\b/g, 'len')
          : 'Math.max(len, 4)'

    return {
      abi,
      fnName,
      returnType,
      reuseBuffer: !!reuseBuffer,
      outSizeExpr,
    }
  })
}

export function createCore({ exportsList, autoInit, stream }) {
  const needsEnsure = autoInit === 'lazy'
  const wrappersIR = buildWrapperIR(exportsList)
  const b = code()

  b.line('let _inst = null;')
  b.line('let _memU8 = null;')
  b.line('let _initFn = null;')
  b.blank()

  b.line('function refreshViews() {')
  b.indent(() => {
    b.line('_memU8 = new Uint8Array(_inst.exports.memory.buffer);')
  })
  b.line('}')
  b.blank()

  b.line('export function setInstance(instance) {')
  b.indent(() => {
    b.line('_inst = instance;')
    b.line('refreshViews();')
  })
  b.line('}')
  b.blank()

  b.line('export function wasmExports() {')
  b.indent(() => {
    b.line('return _inst.exports;')
  })
  b.line('}')
  b.blank()

  if (needsEnsure) {
    b.line('let _ready = null;')
    b.line('export function registerInit(fn) { _initFn = fn; }')
    b.blank()
    b.line('async function ensureReady() {')
    b.indent(() => {
      b.line('if (_ready) return _ready;')
      b.line('if (!_initFn) throw new Error("init not registered");')
      b.line('_ready = _initFn();')
      b.line('return _ready;')
    })
    b.line('}')
  } else {
    b.line('export function registerInit(fn) { _initFn = fn; }')
  }
  b.blank()

  b.line('export function memoryU8() {')
  b.indent(() => {
    b.line(
      'if (_memU8 && _memU8.buffer !== _inst.exports.memory.buffer) refreshViews();'
    )
    b.line('return _memU8;')
  })
  b.line('}')
  b.blank()

  b.line('export function alloc(len) {')
  b.indent(() => {
    b.line('return _inst.exports.alloc_bytes(len) >>> 0;')
  })
  b.line('}')
  b.blank()

  b.line('export function free(ptr, len) {')
  b.indent(() => {
    b.line('_inst.exports.free_bytes(ptr >>> 0, len >>> 0);')
  })
  b.line('}')
  b.blank()

  // Runtime Helpers
  b.line('function toBytes(input) {')
  b.indent(() => {
    b.line('if (input instanceof Uint8Array) return input;')
    b.line(
      'if (ArrayBuffer.isView(input)) return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);'
    )
    b.line('if (input instanceof ArrayBuffer) return new Uint8Array(input);')
    b.line('throw new TypeError("Expected a TypedArray or ArrayBuffer");')
  })
  b.line('}')
  b.blank()

  const needsDecoders = wrappersIR.some((w) => w.returnType !== 'bytes')

  if (needsDecoders) {
    b.line('function scalarSize(type) {')
    b.indent(() => {
      b.line('switch (type) {')
      b.line('  case "f64": return 8;')
      b.line('  case "f32":')
      b.line('  case "i32":')
      b.line('  case "u32": return 4;')
      b.line('  case "i16":')
      b.line('  case "u16": return 2;')
      b.line('  case "i8":')
      b.line('  case "u8": return 1;')
      b.line('  case "u32_array":')
      b.line('  case "i32_array":')
      b.line('  case "f32_array": return 1024 * 1024;')
      b.line('  default: return 0;')
      b.line('}')
    })
    b.line('}')
    b.blank()

    b.line('function decodeReturn(view, type) {')
    b.indent(() => {
      b.line('switch (type) {')
      b.line('  case "f32": return view.getFloat32(0, true);')
      b.line('  case "f64": return view.getFloat64(0, true);')
      b.line('  case "i32": return view.getInt32(0, true);')
      b.line('  case "u32": return view.getUint32(0, true);')
      b.line('  case "i16": return view.getInt16(0, true);')
      b.line('  case "u16": return view.getUint16(0, true);')
      b.line('  case "i8": return view.getInt8(0);')
      b.line('  case "u8": return view.getUint8(0);')
      b.line(
        '  case "u32_array": return new Uint32Array(view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength));'
      )
      b.line(
        '  case "i32_array": return new Int32Array(view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength));'
      )
      b.line(
        '  case "f32_array": return new Float32Array(view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength));'
      )
      b.line('  default: return null;')
      b.line('}')
    })
    b.line('}')
    b.blank()
  }

  b.line('function callWasm(abi, input, outLen, reuse) {')
  b.indent(() => {
    b.line('if (!_inst) throw new Error("WASM instance not initialized");')
    b.line('const view = toBytes(input);')
    b.line('const len = view.byteLength;')
    b.blank()
    b.line('let inPtr, outPtr;')
    b.line('if (reuse) {')
    b.indent(() => {
      b.line('if (reuse.in.len < len) {')
      b.indent(() => {
        b.line('if (reuse.in.ptr) free(reuse.in.ptr, reuse.in.len);')
        b.line('reuse.in.ptr = alloc(len);')
        b.line('reuse.in.len = len;')
      })
      b.line('}')
      b.line('if (reuse.out.len < outLen) {')
      b.indent(() => {
        b.line('if (reuse.out.ptr) free(reuse.out.ptr, reuse.out.len);')
        b.line('reuse.out.ptr = alloc(outLen);')
        b.line('reuse.out.len = outLen;')
      })
      b.line('}')
      b.line('inPtr = reuse.in.ptr;')
      b.line('outPtr = reuse.out.ptr;')
    })
    b.line('} else {')
    b.indent(() => {
      b.line('inPtr = alloc(len);')
      b.line('outPtr = alloc(outLen);')
    })
    b.line('}')
    b.blank()
    b.line('memoryU8().set(view, inPtr);')
    b.line('const written = _inst.exports[abi](inPtr, len, outPtr, outLen);')
    b.line('if (written < 0) {')
    b.indent(() => {
      b.line('if (!reuse) { free(inPtr, len); free(outPtr, outLen); }')
      b.line('throw new Error(abi + " failed: " + written);')
    })
    b.line('}')
    b.blank()
    b.line('return { inPtr, outPtr, len, outLen, written };')
  })
  b.line('}')
  b.blank()

  // Wrappers
  wrappersIR.forEach((w) => {
    if (w.reuseBuffer) {
      b.line(
        `const _${w.fnName}_reuse = { in: { ptr: 0, len: 0 }, out: { ptr: 0, len: 0 } };`
      )
    }
    const asyncPrefix = needsEnsure ? 'async ' : ''
    b.line(`${asyncPrefix}function ${w.fnName}(input) {`)
    b.indent(() => {
      if (needsEnsure) b.line('await ensureReady();')
      b.line('const view = toBytes(input);')
      b.line('const len = view.byteLength;')
      b.line(`const outLen = ${w.outSizeExpr};`)
      b.line(
        `const { outPtr, written, inPtr } = callWasm("${w.abi}", view, outLen, ${w.reuseBuffer ? `_${w.fnName}_reuse` : 'null'});`
      )
      b.blank()
      if (w.returnType === 'bytes') {
        b.line('const result = memoryU8().slice(outPtr, outPtr + written);')
      } else {
        b.line(
          'const retView = new DataView(memoryU8().buffer, outPtr, written);'
        )
        b.line(`const result = decodeReturn(retView, "${w.returnType}");`)
      }
      b.blank()
      if (!w.reuseBuffer) {
        b.line('free(inPtr, len);')
        b.line('free(outPtr, outLen);')
      }
      b.line('return result;')
    })
    b.line('}')
    b.line(`export { ${w.fnName} };`)
    b.blank()
  })

  // Streaming
  if (stream?.enable) {
    b.line('const __exports = {')
    b.indent(() => {
      exportsList.forEach((e) => {
        b.line(
          `${e.name || e.abi}: { fn: ${e.name || e.abi}, blockSize: ${e.blockSize || 'null'} },`
        )
      })
    })
    b.line('};')
    b.blank()

    b.line(
      'export function createChunkTransform(processFn, { blockSize = null, delimiter = null } = {}) {'
    )
    b.indent(() => {
      b.line('let buffer = new Uint8Array(0);')
      b.line('return new TransformStream({')
      b.indent(() => {
        b.line('async transform(chunk, controller) {')
        b.indent(() => {
          b.line('const bytes = toBytes(chunk);')
          b.line('let input = bytes;')
          b.blank()
          b.line(
            'if (buffer.length > 0 || blockSize !== null || delimiter !== null) {'
          )
          b.indent(() => {
            b.line(
              'const combined = new Uint8Array(buffer.length + bytes.length);'
            )
            b.line('combined.set(buffer, 0);')
            b.line('combined.set(bytes, buffer.length);')
            b.line('input = combined;')
          })
          b.line('}')
          b.blank()
          b.line('if (delimiter !== null) {')
          b.indent(() => {
            b.line('let start = 0;')
            b.line('for (let i = 0; i < input.length; i++) {')
            b.indent(() => {
              b.line('if (input[i] === delimiter) {')
              b.indent(() => {
                b.line(
                  'controller.enqueue(await processFn(input.subarray(start, i)));'
                )
                b.line('start = i + 1;')
              })
              b.line('}')
            })
            b.line('}')
            b.line('buffer = input.slice(start);')
          })
          b.line('} else if (blockSize !== null) {')
          b.indent(() => {
            b.line(
              'const processLen = input.length - (input.length % blockSize);'
            )
            b.line('if (processLen > 0) {')
            b.indent(() => {
              b.line(
                'controller.enqueue(await processFn(input.subarray(0, processLen)));'
              )
              b.line('buffer = input.slice(processLen);')
            })
            b.line('} else {')
            b.indent(() => {
              b.line('buffer = input;')
            })
            b.line('}')
          })
          b.line('} else {')
          b.indent(() => {
            b.line('controller.enqueue(await processFn(input));')
            b.line('buffer = new Uint8Array(0);')
          })
          b.line('}')
        })
        b.line('},')
        b.line('async flush(controller) {')
        b.indent(() => {
          b.line('if (buffer.length > 0) {')
          b.indent(() => {
            b.line('controller.enqueue(await processFn(buffer));')
            b.line('buffer = new Uint8Array(0);')
          })
          b.line('}')
        })
        b.line('}')
      })
      b.line('});')
    })
    b.line('}')
    b.blank()

    b.line(
      `export function createTransformStream(fnName = "${stream.export}") {`
    )
    b.indent(() => {
      b.line('const entry = __exports[fnName];')
      b.line(
        'if (!entry) throw new Error("Unknown export for streaming: " + fnName);'
      )
      b.line('const { fn, blockSize: entryBlockSize } = entry;')
      b.line(
        `const blockSize = entryBlockSize ?? ${stream.blockSize !== null ? stream.blockSize : 'null'};`
      )
      b.line(
        `const delimiter = ${stream.delimiter !== null ? stream.delimiter : 'null'};`
      )
      b.line('return createChunkTransform(fn, { blockSize, delimiter });')
    })
    b.line('}')
  }

  return b.toString()
}

export function createCoreTypes({ exportsList, autoInit, stream }) {
  const needsEnsure = autoInit === 'lazy'
  const wrappersIR = buildWrapperIR(exportsList)
  const b = code()

  b.line('export type WasmInput = Uint8Array | ArrayBufferView | ArrayBuffer;')
  b.blank()

  b.line('export function setInstance(instance: WebAssembly.Instance): void;')
  b.line('export function wasmExports(): WebAssembly.Exports;')
  b.line('export function memoryU8(): Uint8Array;')
  b.line('export function alloc(len: number): number;')
  b.line('export function free(ptr: number, len: number): void;')
  b.blank()

  wrappersIR.forEach((w) => {
    let tsRetType
    switch (w.returnType) {
      case 'f32':
      case 'f64':
      case 'i32':
      case 'u32':
      case 'i16':
      case 'u16':
      case 'i8':
      case 'u8':
        tsRetType = 'number'
        break
      case 'u32_array':
        tsRetType = 'Uint32Array'
        break
      case 'i32_array':
        tsRetType = 'Int32Array'
        break
      case 'f32_array':
        tsRetType = 'Float32Array'
        break
      case 'bytes':
      default:
        tsRetType = 'Uint8Array'
    }

    const ret = needsEnsure ? `Promise<${tsRetType}>` : tsRetType
    b.line(`export function ${w.fnName}(input: WasmInput): ${ret};`)
  })

  if (stream?.enable) {
    b.blank()
    b.line(
      'export function createTransformStream(fnName?: string): TransformStream<WasmInput, Uint8Array>;'
    )
  }

  return b.toString()
}

export function code() {
  const lines = []
  let indent = 0
  const api = {
    line(s = '') {
      lines.push('  '.repeat(indent) + s)
      return api
    },
    blank() {
      lines.push('')
      return api
    },
    indent(fn) {
      indent++
      fn()
      indent--
      return api
    },
    toString() {
      return lines.join('\n')
    },
  }
  return api
}

export function createLoaderTypes({ exportFrom }) {
  return `export function init(imports?: WebAssembly.Imports): Promise<void>;
export * from "${exportFrom}";
`
}

export function createLoader({ exportFrom, autoInit, getBytesSrc }) {
  const eager =
    autoInit === 'eager'
      ? '\nregisterInit(init);\ninit();'
      : '\nregisterInit(init);'

  return `import { setInstance, registerInit } from "./core.js";
import { instantiateWithFallback } from "./util.js";
${getBytesSrc}

let _ready = null;
export function init(imports = {}) {
  return (_ready ??= (async () => {
    const { simdBytes, baseBytes } = await getWasmBytes();
    const { instance } = await instantiateWithFallback(simdBytes, baseBytes, imports);
    setInstance(instance);
  })());
}
${eager}
export * from "${exportFrom}";
`
}

function createBrowserLoader({ name, autoInit, customJs, wasmDelivery }) {
  const exportFrom = customJs ? './custom.js' : './core.js'

  let simdUrl, baseUrl
  if (wasmDelivery.type === 'jsdelivr') {
    const pkg = wasmDelivery.package
    const ver = wasmDelivery.version
    simdUrl = `"https://cdn.jsdelivr.net/npm/${pkg}@${ver}/dist/wasm/${name}.simd.wasm"`
    baseUrl = `"https://cdn.jsdelivr.net/npm/${pkg}@${ver}/dist/wasm/${name}.base.wasm"`
  } else {
    simdUrl = `new URL("./wasm/${name}.simd.wasm", import.meta.url)`
    baseUrl = `new URL("./wasm/${name}.base.wasm", import.meta.url)`
  }

  const getBytesSrc = `
const simdUrl = ${simdUrl};
const baseUrl = ${baseUrl};

async function getWasmBytes() {
  const [simdRes, baseRes] = await Promise.all([fetch(simdUrl), fetch(baseUrl)]);
  const [simdBytes, baseBytes] = await Promise.all([simdRes.arrayBuffer(), baseRes.arrayBuffer()]);
  return { simdBytes, baseBytes };
}
`
  return createLoader({ exportFrom, autoInit, getBytesSrc })
}

function createNodeLoader({ name, autoInit, customJs }) {
  const exportFrom = customJs ? './custom.js' : './core.js'
  const getBytesSrc = `
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const simdPath = fileURLToPath(new URL("./wasm/${name}.simd.wasm", import.meta.url));
const basePath = fileURLToPath(new URL("./wasm/${name}.base.wasm", import.meta.url));

async function getWasmBytes() {
  const [simdBytes, baseBytes] = await Promise.all([readFile(simdPath), readFile(basePath)]);
  return { simdBytes, baseBytes };
}
`
  return createLoader({ exportFrom, autoInit, getBytesSrc })
}

function createInlineLoader({ name, autoInit, customJs }) {
  const exportFrom = customJs ? './custom.js' : './core.js'
  const getBytesSrc = `
import { wasmBytes as simdBytes } from "./wasm-inline/${name}.simd.wasm.js";
import { wasmBytes as baseBytes } from "./wasm-inline/${name}.base.wasm.js";

async function getWasmBytes() {
  return { simdBytes, baseBytes };
}
`
  return createLoader({ exportFrom, autoInit, getBytesSrc })
}

function createInlineModule(bytes) {
  return `// auto-generated
export const wasmBytes = new Uint8Array([${bytes.join(',')}]);
`
}

function loadCustomModule(crateDir, customJs) {
  const customPath = join(crateDir, customJs)
  const source = readFileSync(customPath, 'utf8')
  const ext = extname(customJs).toLowerCase()

  if (!TS_EXTS.has(ext)) return source

  let ts
  try {
    ts = require('typescript')
  } catch {
    throw new Error(
      "Custom TypeScript runtime requires the 'typescript' package. Install it with `npm install typescript` in your project."
    )
  }

  const { outputText } = ts.transpileModule(source, {
    fileName: customPath,
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2020,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
      allowSyntheticDefaultImports: true,
      sourceMap: false,
    },
    reportDiagnostics: false,
  })

  return outputText
}

function writeInlineModules({
  outDir,
  artifactBaseName,
  baselinePath,
  simdPath,
}) {
  const inlineDir = join(outDir, 'wasm-inline')
  mkdirSync(inlineDir, { recursive: true })

  const baseBytes = readFileSync(baselinePath)
  const simdBytes = simdPath ? readFileSync(simdPath) : baseBytes

  writeFileSync(
    join(inlineDir, `${artifactBaseName}.base.wasm.js`),
    createInlineModule(baseBytes)
  )
  writeFileSync(
    join(inlineDir, `${artifactBaseName}.simd.wasm.js`),
    createInlineModule(simdBytes)
  )
}

export function emitRuntime({
  crateDir,
  outDir,
  artifactBaseName,
  emitNode,
  emitBrowser,
  emitInline,
  emitTypes,
  wasmPaths,
  exportsList,
  autoInit,
  stream,
  customJs,
  wasmDelivery,
}) {
  mkdirSync(outDir, { recursive: true })

  if (customJs) {
    const customJsContent = loadCustomModule(crateDir, customJs)
    writeFileSync(join(outDir, 'custom.js'), customJsContent)

    if (emitTypes) {
      const customTsPath = customJs.replace(/\.[^.]+$/, '.d.ts')
      if (existsSync(join(crateDir, customTsPath))) {
        writeFileSync(
          join(outDir, 'custom.d.ts'),
          readFileSync(join(crateDir, customTsPath), 'utf8')
        )
      }
    }
  }

  writeFileSync(
    join(outDir, 'core.js'),
    createCore({ exportsList, autoInit, stream })
  )
  if (emitTypes) {
    writeFileSync(
      join(outDir, 'core.d.ts'),
      createCoreTypes({ exportsList, autoInit, stream })
    )
  }
  writeFileSync(join(outDir, 'util.js'), readFileSync(UTIL_PATH, 'utf8'))

  const loaderTypes = emitTypes
    ? createLoaderTypes({
        exportFrom: customJs ? './custom.js' : './core.js',
      })
    : null

  if (emitBrowser) {
    writeFileSync(
      join(outDir, 'browser.js'),
      createBrowserLoader({
        name: artifactBaseName,
        autoInit,
        customJs,
        wasmDelivery,
      })
    )
    if (emitTypes) writeFileSync(join(outDir, 'browser.d.ts'), loaderTypes)
  }

  if (emitNode) {
    writeFileSync(
      join(outDir, 'node.js'),
      createNodeLoader({ name: artifactBaseName, autoInit, customJs })
    )
    if (emitTypes) writeFileSync(join(outDir, 'node.d.ts'), loaderTypes)
  }

  if (emitInline && wasmPaths.baselinePath) {
    writeFileSync(
      join(outDir, 'browser-inline.js'),
      createInlineLoader({ name: artifactBaseName, autoInit, customJs })
    )
    if (emitTypes)
      writeFileSync(join(outDir, 'browser-inline.d.ts'), loaderTypes)
    writeFileSync(
      join(outDir, 'node-inline.js'),
      createInlineLoader({ name: artifactBaseName, autoInit, customJs })
    )
    if (emitTypes) writeFileSync(join(outDir, 'node-inline.d.ts'), loaderTypes)
    writeInlineModules({
      outDir,
      artifactBaseName,
      baselinePath: wasmPaths.baselinePath,
      simdPath: wasmPaths.simdPath,
    })
  }
}
