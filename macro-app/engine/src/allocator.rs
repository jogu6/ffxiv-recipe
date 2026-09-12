use std::alloc::{GlobalAlloc, Layout, System};

struct RecoveringAllocator;
#[global_allocator]
static ALLOCATOR: RecoveringAllocator = RecoveringAllocator;

fn retry(mut allocate: impl FnMut() -> *mut u8) -> *mut u8 {
    loop {
        let pointer = allocate();
        if !pointer.is_null() || !raphael_solver::recover_memory() { return pointer; }
    }
}

// The system allocator retains ownership of every block. A failed allocation
// releases only resident search pages, preserving their contents in IndexedDB,
// then retries the identical request. No search states or actions are discarded.
unsafe impl GlobalAlloc for RecoveringAllocator {
    unsafe fn alloc(&self, layout: Layout) -> *mut u8 {
        retry(|| unsafe { System.alloc(layout) })
    }
    unsafe fn alloc_zeroed(&self, layout: Layout) -> *mut u8 {
        retry(|| unsafe { System.alloc_zeroed(layout) })
    }
    unsafe fn realloc(&self, pointer: *mut u8, layout: Layout, new_size: usize) -> *mut u8 {
        retry(|| unsafe { System.realloc(pointer, layout, new_size) })
    }
    unsafe fn dealloc(&self, pointer: *mut u8, layout: Layout) {
        unsafe { System.dealloc(pointer, layout) }
    }
}
