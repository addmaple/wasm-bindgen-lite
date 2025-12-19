use std::alloc::{alloc, dealloc, Layout};
use std::mem;

#[no_mangle]
/// # Safety
/// This function is unsafe because it allocates memory using the global allocator and returns a raw pointer.
/// The caller must ensure that the memory is eventually deallocated using `free_bytes` with the same length.
pub unsafe extern "C" fn alloc_bytes(len: usize) -> *mut u8 {
    let layout = Layout::from_size_align(len, mem::align_of::<u8>()).unwrap();
    alloc(layout)
}

#[no_mangle]
/// # Safety
/// This function is unsafe because it deallocates memory using a raw pointer.
/// The caller must ensure that `ptr` was previously allocated by `alloc_bytes` and that `len` is the same as when it was allocated.
pub unsafe extern "C" fn free_bytes(ptr: *mut u8, len: usize) {
    let layout = Layout::from_size_align(len, mem::align_of::<u8>()).unwrap();
    dealloc(ptr, layout);
}

/// A simple example function that "processes" bytes.
/// In a real app, this might be SIMD-accelerated base64, crypto, etc.
///
/// # Safety
/// This function is unsafe because it reads from and writes to raw pointers.
/// The caller must ensure that:
/// - `in_ptr` points to at least `in_len` bytes of valid memory.
/// - `out_ptr` points to at least `in_len` bytes of valid memory.
/// - The memory ranges do not overlap, or if they do, the behavior is acceptable.
#[no_mangle]
pub unsafe extern "C" fn process_bytes(
    in_ptr: *const u8,
    in_len: usize,
    out_ptr: *mut u8,
    _out_len: usize,
) -> isize {
    let input = std::slice::from_raw_parts(in_ptr, in_len);
    let output = std::slice::from_raw_parts_mut(out_ptr, in_len);

    // Just a simple transformation for demonstration
    for i in 0..in_len {
        output[i] = input[i].wrapping_add(1);
    }

    in_len as isize
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_process_bytes() {
        unsafe {
            let input = b"hello";
            let in_len = input.len();
            let in_ptr = alloc_bytes(in_len);
            std::ptr::copy_nonoverlapping(input.as_ptr(), in_ptr, in_len);

            let out_ptr = alloc_bytes(in_len);
            let written = process_bytes(in_ptr, in_len, out_ptr, in_len);

            assert_eq!(written, in_len as isize);
            let output = std::slice::from_raw_parts(out_ptr, in_len);
            assert_eq!(output, b"ifmmp"); // h+1, e+1, l+1, l+1, o+1

            free_bytes(in_ptr, in_len);
            free_bytes(out_ptr, in_len);
        }
    }
}
