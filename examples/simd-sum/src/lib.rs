#![cfg(target_arch = "wasm32")]

use std::alloc::{alloc, dealloc, Layout};
use std::mem;

#[no_mangle]
#[allow(clippy::missing_safety_doc)]
pub unsafe extern "C" fn alloc_bytes(len: usize) -> *mut u8 {
    let layout = Layout::from_size_align(len, mem::align_of::<u8>()).unwrap();
    alloc(layout)
}

#[no_mangle]
#[allow(clippy::missing_safety_doc)]
pub unsafe extern "C" fn free_bytes(ptr: *mut u8, len: usize) {
    let layout = Layout::from_size_align(len, mem::align_of::<u8>()).unwrap();
    dealloc(ptr, layout);
}

#[inline]
unsafe fn sum_u8(buf: &[u8]) -> f32 {
    #[cfg(target_feature = "simd128")]
    {
        use core::arch::wasm32::*;
        let chunks = buf.chunks_exact(16); // 16 * u8
        let remainder = chunks.remainder();
        let mut acc_vec = i32x4_splat(0);

        for chunk in chunks {
            let v = v128_load(chunk.as_ptr() as *const v128);
            // widen u8 -> u16 pairwise -> i32 lanes, accumulate
            let widened = i32x4_extadd_pairwise_u16x8(i16x8_extadd_pairwise_u8x16(v));
            acc_vec = i32x4_add(acc_vec, widened);
        }

        let mut tmp = [0i32; 4];
        v128_store(tmp.as_mut_ptr() as *mut v128, acc_vec);
        let mut sum = tmp.iter().copied().map(|x| x as f32).sum::<f32>();

        for &b in remainder {
            sum += b as f32;
        }
        return sum;
    }

    #[cfg(not(target_feature = "simd128"))]
    {
        buf.iter().fold(0f32, |acc, b| acc + (*b as f32))
    }
}

#[inline]
unsafe fn sum_u16(buf: &[u8]) -> f32 {
    #[cfg(target_feature = "simd128")]
    {
        use core::arch::wasm32::*;
        let chunks = buf.chunks_exact(16); // 8 * u16
        let remainder = chunks.remainder();
        let mut acc_vec = i32x4_splat(0);

        for chunk in chunks {
            let v = v128_load(chunk.as_ptr() as *const v128);
            let widened = i32x4_extadd_pairwise_u16x8(v);
            acc_vec = i32x4_add(acc_vec, widened);
        }

        let mut tmp = [0i32; 4];
        v128_store(tmp.as_mut_ptr() as *mut v128, acc_vec);
        let mut sum = tmp.iter().copied().map(|x| x as f32).sum::<f32>();

        for chunk in remainder.chunks_exact(2) {
            let mut bytes = [0u8; 2];
            bytes.copy_from_slice(chunk);
            sum += u16::from_le_bytes(bytes) as f32;
        }
        return sum;
    }

    #[cfg(not(target_feature = "simd128"))]
    {
        let mut acc = 0f32;
        for chunk in buf.chunks_exact(2) {
            let mut bytes = [0u8; 2];
            bytes.copy_from_slice(chunk);
            acc += u16::from_le_bytes(bytes) as f32;
        }
        acc
    }
}

#[inline]
unsafe fn sum_f32(buf: &[u8]) -> f32 {
    let mut sum = 0.0f32;

    #[cfg(target_feature = "simd128")]
    {
        use core::arch::wasm32::*;
        let chunks = buf.chunks_exact(16); // 4 * f32
        let remainder = chunks.remainder();
        let mut acc = f32x4_splat(0.0);

        for chunk in chunks {
            let v = v128_load(chunk.as_ptr() as *const v128);
            acc = f32x4_add(acc, v);
        }

        let mut tmp = [0f32; 4];
        v128_store(tmp.as_mut_ptr() as *mut v128, acc);
        sum += tmp.iter().copied().sum::<f32>();

        for r in remainder.chunks_exact(4) {
            let mut bytes = [0u8; 4];
            bytes.copy_from_slice(r);
            sum += f32::from_le_bytes(bytes);
        }
    }

    #[cfg(not(target_feature = "simd128"))]
    {
        for chunk in buf.chunks_exact(4) {
            let mut bytes = [0u8; 4];
            bytes.copy_from_slice(chunk);
            sum += f32::from_le_bytes(bytes);
        }
    }

    sum
}

fn write_f32(out_ptr: *mut u8, out_len: usize, value: f32) -> isize {
    if out_len < 4 {
        return -1;
    }
    let bytes = value.to_le_bytes();
    unsafe {
        std::ptr::copy_nonoverlapping(bytes.as_ptr(), out_ptr, 4);
    }
    4
}

/// Sum u8 array bytes -> f32
#[no_mangle]
#[allow(clippy::missing_safety_doc)]
pub unsafe extern "C" fn sum_u8_bytes(
    in_ptr: *const u8,
    in_len: usize,
    out_ptr: *mut u8,
    out_len: usize,
) -> isize {
    let input = std::slice::from_raw_parts(in_ptr, in_len);
    let sum = sum_u8(input);
    write_f32(out_ptr, out_len, sum)
}

/// Sum u16 array bytes -> f32
#[no_mangle]
#[allow(clippy::missing_safety_doc)]
pub unsafe extern "C" fn sum_u16_bytes(
    in_ptr: *const u8,
    in_len: usize,
    out_ptr: *mut u8,
    out_len: usize,
) -> isize {
    if in_len % 2 != 0 {
        return -1;
    }
    let input = std::slice::from_raw_parts(in_ptr, in_len);
    let sum = sum_u16(input);
    write_f32(out_ptr, out_len, sum)
}

/// Sum f32 array bytes -> f32
#[no_mangle]
#[allow(clippy::missing_safety_doc)]
pub unsafe extern "C" fn sum_f32_bytes(
    in_ptr: *const u8,
    in_len: usize,
    out_ptr: *mut u8,
    out_len: usize,
) -> isize {
    if in_len % 4 != 0 {
        return -1;
    }
    let input = std::slice::from_raw_parts(in_ptr, in_len);
    let sum = sum_f32(input);
    write_f32(out_ptr, out_len, sum)
}
