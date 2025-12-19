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

/// Find line break offsets and write them as u32s to out_ptr.
/// Returns number of bytes written to out_ptr (count * 4).
#[no_mangle]
#[allow(clippy::missing_safety_doc)]
pub unsafe extern "C" fn find_line_offsets(
    in_ptr: *const u8,
    in_len: usize,
    out_ptr: *mut u32,
    out_len_bytes: usize,
) -> isize {
    let input = std::slice::from_raw_parts(in_ptr, in_len);
    let max_offsets = out_len_bytes / 4;
    let mut count = 0;
    let mut i = 0;

    #[cfg(target_feature = "simd128")]
    {
        use core::arch::wasm32::*;
        let n_splat = i8x16_splat(b'\n' as i8);
        let r_splat = i8x16_splat(b'\r' as i8);

        while i + 16 <= in_len && count < max_offsets {
            let v = v128_load(in_ptr.add(i) as *const v128);
            let mask = i8x16_bitmask(v128_or(i8x16_eq(v, n_splat), i8x16_eq(v, r_splat)));

            if mask == 0 {
                i += 16;
            } else {
                // Process these 16 bytes
                for _ in 0..16 {
                    if i >= in_len || count >= max_offsets {
                        break;
                    }
                    let b = input[i];
                    if b == b'\n' {
                        *out_ptr.add(count) = i as u32;
                        count += 1;
                    } else if b == b'\r' {
                        if i + 1 < in_len && input[i + 1] == b'\n' {
                            *out_ptr.add(count) = i as u32;
                            count += 1;
                            i += 1; // skip \n
                        } else {
                            *out_ptr.add(count) = i as u32;
                            count += 1;
                        }
                    }
                    i += 1;
                }
            }
        }
    }

    while i < in_len && count < max_offsets {
        let b = input[i];
        if b == b'\n' {
            *out_ptr.add(count) = i as u32;
            count += 1;
        } else if b == b'\r' {
            if i + 1 < in_len && input[i + 1] == b'\n' {
                *out_ptr.add(count) = i as u32;
                count += 1;
                i += 1;
            } else {
                *out_ptr.add(count) = i as u32;
                count += 1;
            }
        }
        i += 1;
    }

    (count * 4) as isize
}
