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

/// Normalize newlines and mark splits: convert CRLF/CR/LF to '\0' separators.
/// Writes into out_ptr (same length budget), returns bytes written.
#[no_mangle]
#[allow(clippy::missing_safety_doc)]
pub unsafe extern "C" fn split_lines_chunk(
    in_ptr: *const u8,
    in_len: usize,
    out_ptr: *mut u8,
    out_len: usize,
) -> isize {
    let input = std::slice::from_raw_parts(in_ptr, in_len);
    if out_len < in_len {
        return -1;
    }

    let mut written = 0usize;
    let mut i = 0usize;

    #[cfg(target_feature = "simd128")]
    {
        use core::arch::wasm32::*;
        let n_splat = i8x16_splat(b'\n' as i8);
        let r_splat = i8x16_splat(b'\r' as i8);

        while i + 16 <= in_len {
            let v = v128_load(in_ptr.add(i) as *const v128);
            // Check for both \n and \r
            let mask = i8x16_bitmask(v128_or(i8x16_eq(v, n_splat), i8x16_eq(v, r_splat)));

            if mask == 0 {
                // Fast path: no newlines in these 16 bytes
                v128_store(out_ptr.add(written) as *mut v128, v);
                written += 16;
                i += 16;
            } else {
                // Slow path: process byte-by-byte to handle normalization/splitting
                for _ in 0..16 {
                    let b = input[i];
                    if b == b'\r' {
                        if i + 1 < in_len && input[i + 1] == b'\n' {
                            *out_ptr.add(written) = 0;
                            written += 1;
                            i += 2;
                        } else {
                            *out_ptr.add(written) = 0;
                            written += 1;
                            i += 1;
                        }
                    } else if b == b'\n' {
                        *out_ptr.add(written) = 0;
                        written += 1;
                        i += 1;
                    } else {
                        *out_ptr.add(written) = b;
                        written += 1;
                        i += 1;
                    }
                }
            }
        }
    }

    // Remainder
    while i < in_len {
        let b = input[i];
        if b == b'\r' {
            if i + 1 < in_len && input[i + 1] == b'\n' {
                *out_ptr.add(written) = 0;
                written += 1;
                i += 2;
            } else {
                *out_ptr.add(written) = 0;
                written += 1;
                i += 1;
            }
        } else if b == b'\n' {
            *out_ptr.add(written) = 0;
            written += 1;
            i += 1;
        } else {
            *out_ptr.add(written) = b;
            written += 1;
            i += 1;
        }
    }

    written as isize
}
