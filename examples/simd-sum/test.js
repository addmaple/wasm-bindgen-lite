import assert from 'node:assert'
import { init, sumU8, sumU16, sumF32 } from './dist/node.js'

async function main() {
  await init()

  const f32 = new Float32Array([1.5, 2.5, 3.0])
  const totalF32 = await sumF32(f32)
  console.log('Testing f32 sum:', f32, '→', totalF32)
  assert(Math.abs(totalF32 - 7.0) < 1e-5)

  const u16 = new Uint16Array([1, 2, 3, 4])
  const totalU16 = await sumU16(u16)
  console.log('Testing u16 sum:', u16, '→', totalU16)
  assert(Math.abs(totalU16 - 10.0) < 1e-5)

  const u8 = new Uint8Array([10, 20, 30])
  const totalU8 = await sumU8(u8)
  console.log('Testing u8 sum:', u8, '→', totalU8)
  assert(Math.abs(totalU8 - 60.0) < 1e-5)

  console.log('✓ simd-sum example passed')
}

main().catch((err) => {
  console.error('Test failed:', err)
  process.exit(1)
})
