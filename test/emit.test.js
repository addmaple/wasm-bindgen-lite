import test from 'node:test'
import assert from 'node:assert'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  code,
  buildWrapperIR,
  createCore,
  createLoader,
  emitRuntime,
} from '../src/cli/emit.js'

test('code builder should manage indentation and blank lines', () => {
  const b = code()
  b.line('function test() {')
    .indent(() => {
      b.line('if (true) {')
        .indent(() => {
          b.line('console.log("hi");')
        })
        .line('}')
    })
    .line('}')
    .blank()
    .line('// end')

  const output = b.toString()
  assert.strictEqual(
    output,
    `function test() {
  if (true) {
    console.log("hi");
  }
}

// end`
  )
})

test('buildWrapperIR should normalize export entries', () => {
  const exportsList = [
    { abi: 'add', name: 'plus', return: 'i32' },
    { abi: 'process', reuseBuffer: true, outSize: 'len * 2' },
  ]
  const ir = buildWrapperIR(exportsList)

  assert.strictEqual(ir.length, 2)

  assert.deepStrictEqual(ir[0], {
    abi: 'add',
    fnName: 'plus',
    returnType: 'i32',
    reuseBuffer: false,
    outSizeExpr: "(scalarSize('i32') || 4)",
  })

  assert.deepStrictEqual(ir[1], {
    abi: 'process',
    fnName: 'process',
    returnType: 'bytes',
    reuseBuffer: true,
    outSizeExpr: 'len * 2',
  })
})

test('createCore should generate expected boilerplate', () => {
  const exportsList = [{ abi: 'add', return: 'i32' }]
  const coreCode = createCore({ exportsList, autoInit: 'eager' })

  // Basic checks for key components
  assert.ok(coreCode.includes('export function setInstance'))
  assert.ok(coreCode.includes('export function memoryU8'))
  assert.ok(coreCode.includes('function callWasm'))
  assert.ok(coreCode.includes('function add(input)'))
  assert.ok(coreCode.includes('export { add }'))
  assert.ok(!coreCode.includes('async function add')) // eager init = synchronous wrapper
})

test('createCore should generate async wrappers for lazy init', () => {
  const exportsList = [{ abi: 'add', return: 'i32' }]
  const coreCode = createCore({ exportsList, autoInit: 'lazy' })

  assert.ok(coreCode.includes('async function add(input)'))
  assert.ok(coreCode.includes('await ensureReady()'))
})

test('createLoader should use the unified template', () => {
  const loader = createLoader({
    exportFrom: './core.js',
    autoInit: 'eager',
    getBytesSrc: 'const getBytes = () => ({ simdBytes: [], baseBytes: [] });',
  })

  assert.ok(
    loader.includes('import { setInstance, registerInit } from "./core.js"')
  )
  assert.ok(
    loader.includes('const { simdBytes, baseBytes } = await getWasmBytes()')
  )
  assert.ok(loader.includes('registerInit(init);'))
  assert.ok(loader.includes('init();'))
  assert.ok(loader.includes('export * from "./core.js"'))
})

test('streaming logic should be included when enabled', () => {
  const exportsList = [{ abi: 'process' }]
  const stream = {
    enable: true,
    export: 'process',
    blockSize: 16,
    delimiter: null,
  }
  const coreCode = createCore({ exportsList, autoInit: 'eager', stream })

  assert.ok(coreCode.includes('export function createChunkTransform'))
  assert.ok(coreCode.includes('export function createTransformStream'))
  assert.ok(coreCode.includes('const __exports = {'))
})

test('emitRuntime should transpile custom TypeScript runtime', () => {
  const tempRoot = mkdtempSync(join(tmpdir(), 'wbl-'))
  const crateDir = join(tempRoot, 'crate')
  const outDir = join(tempRoot, 'out')

  mkdirSync(crateDir, { recursive: true })

  writeFileSync(
    join(crateDir, 'custom.ts'),
    `
export function greet(name: string) {
  return \`hi \${name}\`;
}
`
  )

  emitRuntime({
    crateDir,
    outDir,
    artifactBaseName: 'mod',
    emitNode: false,
    emitBrowser: false,
    emitInline: false,
    emitTypes: false,
    wasmPaths: { baselinePath: null, simdPath: null },
    exportsList: [],
    autoInit: 'off',
    stream: { enable: false, export: '', delimiter: null, blockSize: null },
    customJs: 'custom.ts',
    wasmDelivery: { type: 'relative', package: 'demo', version: 'latest' },
  })

  const emitted = readFileSync(join(outDir, 'custom.js'), 'utf8')
  assert.ok(emitted.includes('export function greet(name)'), 'transpiles TS to JS')

  rmSync(tempRoot, { recursive: true, force: true })
})

