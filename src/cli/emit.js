import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const UTIL_PATH = fileURLToPath(new URL('../js/util.js', import.meta.url))

function createCore({ exportsList, autoInit, stream }) {
  const needsEnsure = autoInit === 'lazy'
  const toBytesHelper = `function toBytes(input) {
  if (input instanceof Uint8Array) return input;
  if (ArrayBuffer.isView(input)) {
    return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  }
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  throw new TypeError("Expected a TypedArray or ArrayBuffer");
}
`
  const scalarSizeHelper = `function scalarSize(type) {
  switch (type) {
    case "f64": return 8;
    case "f32":
    case "i32":
    case "u32": return 4;
    case "i16":
    case "u16": return 2;
    case "i8":
    case "u8": return 1;
    case "u32_array":
    case "i32_array":
    case "f32_array": return 1024 * 1024; // Default large buffer for arrays, or we can improve this
    default: return 0;
  }
}
`
  const decodeHelper = `function decodeReturn(view, type) {
  switch (type) {
    case "f32": return view.getFloat32(0, true);
    case "f64": return view.getFloat64(0, true);
    case "i32": return view.getInt32(0, true);
    case "u32": return view.getUint32(0, true);
    case "i16": return view.getInt16(0, true);
    case "u16": return view.getUint16(0, true);
    case "i8": return view.getInt8(0);
    case "u8": return view.getUint8(0);
    case "u32_array": return new Uint32Array(view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength));
    case "i32_array": return new Int32Array(view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength));
    case "f32_array": return new Float32Array(view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength));
    default: return null;
  }
}
`

  const wrappers = exportsList
    .map(({ abi, name, return: retType, reuseBuffer }) => {
      const returnType = retType || 'bytes'
      const fnName = name || abi
      const outSizeExpr =
        returnType === 'bytes'
          ? 'Math.max(len, 4)'
          : `(scalarSize('${returnType}') || 4)`

      const stateVars = reuseBuffer
        ? `let _${fnName}_in = { ptr: 0, len: 0 };
let _${fnName}_out = { ptr: 0, len: 0 };`
        : ''

      const allocIn = reuseBuffer
        ? `if (_${fnName}_in.len < len) {
    if (_${fnName}_in.ptr) free(_${fnName}_in.ptr, _${fnName}_in.len);
    _${fnName}_in.ptr = alloc(len);
    _${fnName}_in.len = len;
  }
  const inPtr = _${fnName}_in.ptr;`
        : `const inPtr = alloc(len);`

      const allocOut = reuseBuffer
        ? `if (_${fnName}_out.len < outLen) {
    if (_${fnName}_out.ptr) free(_${fnName}_out.ptr, _${fnName}_out.len);
    _${fnName}_out.ptr = alloc(outLen);
    _${fnName}_out.len = outLen;
  }
  const outPtr = _${fnName}_out.ptr;`
        : `const outPtr = alloc(outLen);`

      const freeIn = reuseBuffer ? '' : `free(inPtr, len);`
      const freeOut = reuseBuffer ? '' : `free(outPtr, outLen);`

      const body = `
  if (!_inst) throw new Error("WASM instance not initialized");
  const view = toBytes(input);
  const len = view.byteLength;
  ${allocIn}
  memoryU8().set(view, inPtr);
  const outLen = ${outSizeExpr};
  ${allocOut}
  const written = _inst.exports.${abi}(
    inPtr, len,
    outPtr, outLen
  );
  if (written < 0) {
    ${reuseBuffer ? '' : `free(inPtr, len); free(outPtr, outLen);`}
    throw new Error("${abi} failed: " + written);
  }
  ${
    returnType === 'bytes'
      ? `const result = memoryU8().slice(outPtr, outPtr + written);`
      : `const retView = new DataView(memoryU8().buffer, outPtr, written);
  const ret = decodeReturn(retView, "${returnType}");`
  }
  ${freeIn}
  ${freeOut}
  ${returnType === 'bytes' ? 'return result;' : 'return ret;'}`

      const wrapper = needsEnsure
        ? `async function ${fnName}(input) { await ensureReady(); ${body} }`
        : `function ${fnName}(input) { ${body} }`

      return `${stateVars}\n${wrapper}\nexport { ${fnName} };`
    })
    .join('\n\n')

  const streamHelper = stream?.enable
    ? `
const __exports = { ${exportsList.map(({ name, abi }) => `${name || abi}: ${name || abi}`).join(', ')} };

export function createTransformStream(fnName = "${stream.export}") {
  const fn = __exports[fnName];
  if (!fn) throw new Error("Unknown export for streaming: " + fnName);
  
  ${
    stream.delimiter !== null
      ? `let buffer = new Uint8Array(0);
  const delimiter = ${stream.delimiter};`
      : ''
  }

  return new TransformStream({
    async transform(chunk, controller) {
      const bytes = toBytes(chunk);
      const processed = ${needsEnsure ? 'await fn(bytes)' : 'fn(bytes)'};
      
      ${
        stream.delimiter !== null
          ? `// Split and buffer
      const combined = new Uint8Array(buffer.length + processed.length);
      combined.set(buffer, 0);
      combined.set(processed, buffer.length);

      let start = 0;
      for (let i = 0; i < combined.length; i += 1) {
        if (combined[i] === delimiter) {
          controller.enqueue(combined.subarray(start, i));
          start = i + 1;
        }
      }
      buffer = combined.slice(start);`
          : 'controller.enqueue(processed);'
      }
    }${
      stream.delimiter !== null
        ? `,
    flush(controller) {
      if (buffer.length) controller.enqueue(buffer);
    }`
        : ''
    }
  });
}
`
    : ''

  const ensure = needsEnsure
    ? `
let _ready = null;
export function registerInit(fn) {
  _initFn = fn;
}

async function ensureReady() {
  if (_ready) return _ready;
  if (!_initFn) throw new Error("init not registered");
  _ready = _initFn();
  return _ready;
}
`
    : `
export function registerInit(fn) {
  _initFn = fn;
}
`

  return `let _inst = null;
let _memU8 = null;
let _initFn = null;

function refreshViews() {
  _memU8 = new Uint8Array(_inst.exports.memory.buffer);
}

export function setInstance(instance) {
  _inst = instance;
  refreshViews();
}

${ensure}

export function memoryU8() {
  if (_memU8 && _memU8.buffer !== _inst.exports.memory.buffer) refreshViews();
  return _memU8;
}

export function alloc(len) {
  return _inst.exports.alloc_bytes(len) >>> 0;
}

export function free(ptr, len) {
  _inst.exports.free_bytes(ptr >>> 0, len >>> 0);
}

${wrappers}
${scalarSizeHelper}
${decodeHelper}
${toBytesHelper}
${streamHelper}
`
}

function createBrowserLoader({ name, autoInit, customJs, wasmDelivery }) {
  const eager =
    autoInit === 'eager'
      ? '\nregisterInit(init);\ninit();'
      : '\nregisterInit(init);'
  const exportFrom = customJs ? './custom.js' : './core.js'

  let simdUrl, baseUrl
  if (wasmDelivery.type === 'jsdelivr') {
    const pkg = wasmDelivery.package
    const ver = wasmDelivery.version
    simdUrl = `https://cdn.jsdelivr.net/npm/${pkg}@${ver}/dist/wasm/${name}.simd.wasm`
    baseUrl = `https://cdn.jsdelivr.net/npm/${pkg}@${ver}/dist/wasm/${name}.base.wasm`
  } else {
    simdUrl = `new URL("./wasm/${name}.simd.wasm", import.meta.url)`
    baseUrl = `new URL("./wasm/${name}.base.wasm", import.meta.url)`
  }

  return `import { setInstance, registerInit } from "./core.js";
import { instantiateWithFallback } from "./util.js";

const simdUrl = ${wasmDelivery.type === 'jsdelivr' ? `"${simdUrl}"` : simdUrl};
const baseUrl = ${wasmDelivery.type === 'jsdelivr' ? `"${baseUrl}"` : baseUrl};

let _ready = null;

export function init(imports = {}) {
  return (_ready ??= (async () => {
    const [simdRes, baseRes] = await Promise.all([
      fetch(simdUrl),
      fetch(baseUrl)
    ]);

    const [simdBytes, baseBytes] = await Promise.all([
      simdRes.arrayBuffer(),
      baseRes.arrayBuffer()
    ]);

    const { instance } = await instantiateWithFallback(simdBytes, baseBytes, imports);
    setInstance(instance);
  })());
}
${eager}
export * from "${exportFrom}";
`
}

function createNodeLoader({ name, autoInit, customJs }) {
  const eager =
    autoInit === 'eager'
      ? '\nregisterInit(init);\ninit();'
      : '\nregisterInit(init);'
  const exportFrom = customJs ? './custom.js' : './core.js'
  return `import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { setInstance, registerInit } from "./core.js";
import { instantiateWithFallback } from "./util.js";

const simdPath = fileURLToPath(new URL("./wasm/${name}.simd.wasm", import.meta.url));
const basePath = fileURLToPath(new URL("./wasm/${name}.base.wasm", import.meta.url));

let _ready = null;

export function init(imports = {}) {
  return (_ready ??= (async () => {
    const [simdBytes, baseBytes] = await Promise.all([
      readFile(simdPath),
      readFile(basePath)
    ]);
    const { instance } = await instantiateWithFallback(simdBytes, baseBytes, imports);
    setInstance(instance);
  })());
}
${eager}
export * from "${exportFrom}";
`
}

function createInlineLoader({ name, autoInit, customJs }) {
  const eager =
    autoInit === 'eager'
      ? '\nregisterInit(init);\ninit();'
      : '\nregisterInit(init);'
  const exportFrom = customJs ? './custom.js' : './core.js'
  return `import { wasmBytes as simdBytes } from "./wasm-inline/${name}.simd.wasm.js";
import { wasmBytes as baseBytes } from "./wasm-inline/${name}.base.wasm.js";
import { setInstance, registerInit } from "./core.js";
import { instantiateWithFallback } from "./util.js";

let _ready = null;

export function init(imports = {}) {
  return (_ready ??= (async () => {
    const { instance } = await instantiateWithFallback(simdBytes, baseBytes, imports);
    setInstance(instance);
  })());
}
${eager}
export * from "${exportFrom}";
`
}

function createInlineModule(bytes) {
  return `// auto-generated
export const wasmBytes = new Uint8Array([${bytes.join(',')}]);
`
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
  outDir,
  artifactBaseName,
  emitNode,
  emitBrowser,
  emitInline,
  wasmPaths,
  exportsList,
  autoInit,
  stream,
  customJs,
  wasmDelivery,
}) {
  mkdirSync(outDir, { recursive: true })

  if (customJs) {
    const customJsContent = readFileSync(join(process.cwd(), customJs), 'utf8')
    writeFileSync(join(outDir, 'custom.js'), customJsContent)
  }

  writeFileSync(
    join(outDir, 'core.js'),
    createCore({ exportsList, autoInit, stream })
  )
  writeFileSync(join(outDir, 'util.js'), readFileSync(UTIL_PATH, 'utf8'))

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
  }

  if (emitNode) {
    writeFileSync(
      join(outDir, 'node.js'),
      createNodeLoader({ name: artifactBaseName, autoInit, customJs })
    )
  }

  if (emitInline && wasmPaths.baselinePath) {
    writeFileSync(
      join(outDir, 'browser-inline.js'),
      createInlineLoader({ name: artifactBaseName, autoInit, customJs })
    )
    writeFileSync(
      join(outDir, 'node-inline.js'),
      createInlineLoader({ name: artifactBaseName, autoInit, customJs })
    )
    writeInlineModules({
      outDir,
      artifactBaseName,
      baselinePath: wasmPaths.baselinePath,
      simdPath: wasmPaths.simdPath,
    })
  }
}
