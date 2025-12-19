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

#[no_mangle]
#[allow(clippy::missing_safety_doc)]
pub unsafe extern "C" fn process_bytes(
    in_ptr: *const u8,
    in_len: usize,
    out_ptr: *mut u8,
    _out_len: usize,
) -> isize {
    let input = std::slice::from_raw_parts(in_ptr, in_len);
    let output = std::slice::from_raw_parts_mut(out_ptr, in_len);

    for i in 0..in_len {
        output[i] = input[i].wrapping_add(2);
    }

    in_len as isize
}
