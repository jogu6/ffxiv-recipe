//! Use the standard dlmalloc algorithm with fewer costly shared-memory grows.
//! Extra reservation is an optimization only: after its first failure, request
//! exact page counts and let fallible collections trigger lossless paging.
use core::cell::Cell;
const PAGE: usize = 65536;
const ADDRESS_PAGES: usize = 65536;
const GROW_PAGES: usize = 16 * 1024 * 1024 / PAGE;

fn grow_region(size: usize, current: usize, maximum: usize, coarse: &Cell<bool>, mut grow: impl FnMut(usize) -> usize) -> Option<(usize, usize)> {
    let needed = size.div_ceil(PAGE);
    let remaining = maximum.min(ADDRESS_PAGES).checked_sub(current)?;
    if needed == 0 || needed > remaining { return None; }
    let preferred = if coarse.get() { needed.max(GROW_PAGES).min(remaining) } else { needed };
    let mut pages = preferred;
    let mut start = grow(pages);
    if start == usize::MAX {
        coarse.set(false);
        if preferred == needed { return None; }
        pages = needed;
        start = grow(pages);
        if start == usize::MAX { return None; }
    }
    let bytes = pages * PAGE - if start + pages == ADDRESS_PAGES { 16 } else { 0 };
    Some((start * PAGE, bytes))
}

#[cfg(target_arch = "wasm32")]
mod wasm {
    use super::*;
    use core::{alloc::{GlobalAlloc, Layout}, cell::UnsafeCell, ptr, sync::atomic::{AtomicBool, AtomicU32, Ordering}};
    use dlmalloc::{Allocator, Dlmalloc};
    static GROW_CALLS: AtomicU32 = AtomicU32::new(0);
    static GROW_FAILURES: AtomicU32 = AtomicU32::new(0);
    static GROWN_PAGES: AtomicU32 = AtomicU32::new(0);
    static MAXIMUM_PAGES: AtomicU32 = AtomicU32::new(ADDRESS_PAGES as u32);
    static STAGE: AtomicU32 = AtomicU32::new(0);
    static AVOIDED: AtomicU32 = AtomicU32::new(0);
    #[derive(Clone, Copy, Default, serde::Serialize)]
    #[serde(rename_all = "camelCase")]
    struct GrowthEvent { sequence: u64, stage: u32, phase: u32, requested_pages: usize, current_pages: usize, maximum_pages: usize, outcome: u8 }
    struct GrowthLog { entries: [GrowthEvent; 64], count: u64 }
    struct LockedLog(UnsafeCell<GrowthLog>);
    // Accessed only while HEAP's lock is held; recording allocates nothing.
    unsafe impl Sync for LockedLog {}
    static EVENTS: LockedLog = LockedLog(UnsafeCell::new(GrowthLog {
        entries: [GrowthEvent { sequence: 0, stage: 0, phase: 0, requested_pages: 0, current_pages: 0, maximum_pages: 0, outcome: 0 }; 64], count: 0
    }));
    fn record(requested_pages: usize, current_pages: usize, maximum_pages: usize, outcome: u8) {
        // Caller holds HEAP. 0 = known limit, 1 = runtime refusal, 2 = success.
        let log = unsafe { &mut *EVENTS.0.get() };
        let index = log.count as usize % log.entries.len();
        log.count += 1;
        log.entries[index] = GrowthEvent { sequence: log.count, stage: STAGE.load(Ordering::Relaxed), phase: raphael_solver::MEMORY_PHASE.load(Ordering::Relaxed), requested_pages, current_pages, maximum_pages, outcome };
    }
    unsafe extern "C" { static __heap_base: u8; static __heap_end: u8; }
    struct WasmPages { coarse: Cell<bool>, donated: Cell<bool> }
    // SAFETY: memory.grow returns disjoint, zero-initialized regions. The linker
    // heap is donated once, under the same allocation lock, as in std dlmalloc.
    unsafe impl Allocator for WasmPages {
        fn alloc(&self, size: usize) -> (*mut u8, usize, u32) {
            if !self.donated.replace(true) {
                let base = core::ptr::addr_of!(__heap_base) as usize;
                let end = core::ptr::addr_of!(__heap_end) as usize;
                if base != 0 && end > base && end - base >= size { return (base as *mut u8, end - base, 0); }
            }
            let current = core::arch::wasm32::memory_size(0);
            let maximum = MAXIMUM_PAGES.load(Ordering::Relaxed) as usize;
            if size.div_ceil(PAGE) > maximum.saturating_sub(current) {
                AVOIDED.fetch_add(1, Ordering::Relaxed);
                record(size.div_ceil(PAGE), current, maximum, 0);
                return (ptr::null_mut(), 0, 0);
            }
            let region = grow_region(size, current, maximum, &self.coarse, |pages| {
                GROW_CALLS.fetch_add(1, Ordering::Relaxed);
                let start = core::arch::wasm32::memory_grow(0, pages);
                if start == usize::MAX { GROW_FAILURES.fetch_add(1, Ordering::Relaxed); }
                else { GROWN_PAGES.fetch_add(pages as u32, Ordering::Relaxed); }
                record(pages, current, maximum, if start == usize::MAX { 1 } else { 2 });
                start
            });
            region.map_or((ptr::null_mut(), 0, 0), |(base, bytes)| (base as *mut u8, bytes, 0))
        }
        fn remap(&self, _: *mut u8, _: usize, _: usize, _: bool) -> *mut u8 { ptr::null_mut() }
        fn free_part(&self, _: *mut u8, _: usize, _: usize) -> bool { false }
        fn free(&self, _: *mut u8, _: usize) -> bool { false }
        fn can_release_part(&self, _: u32) -> bool { false }
        fn allocates_zeros(&self) -> bool { true }
        fn page_size(&self) -> usize { PAGE }
    }
    struct Heap { locked: AtomicBool, allocator: UnsafeCell<Dlmalloc<WasmPages>> }
    // SAFETY: every access to the allocator is serialized by this atomic lock.
    // This lock uses no heap allocation or TLS, including during Rayon TLS setup.
    unsafe impl Sync for Heap {}
    struct Unlock<'a>(&'a AtomicBool);
    impl Drop for Unlock<'_> { fn drop(&mut self) { self.0.store(false, Ordering::Release); } }
    impl Heap {
        fn with<R>(&self, operation: impl FnOnce(&mut Dlmalloc<WasmPages>) -> R) -> R {
            while self.locked.compare_exchange_weak(false, true, Ordering::Acquire, Ordering::Relaxed).is_err() {
                while self.locked.load(Ordering::Relaxed) { core::hint::spin_loop(); }
            }
            let _unlock = Unlock(&self.locked);
            // SAFETY: the lock grants exclusive access; allocator callbacks use
            // only memory.grow and atomics, never recursive heap allocation.
            operation(unsafe { &mut *self.allocator.get() })
        }
    }
    // SAFETY: dlmalloc implements GlobalAlloc's size/alignment/reallocation
    // contracts. Failed realloc preserves its input, enabling paging recovery.
    unsafe impl GlobalAlloc for Heap {
        unsafe fn alloc(&self, layout: Layout) -> *mut u8 {
            self.with(|heap| unsafe { heap.malloc(layout.size(), layout.align()) })
        }
        unsafe fn alloc_zeroed(&self, layout: Layout) -> *mut u8 {
            self.with(|heap| unsafe { heap.calloc(layout.size(), layout.align()) })
        }
        unsafe fn dealloc(&self, pointer: *mut u8, layout: Layout) {
            self.with(|heap| unsafe { heap.free(pointer, layout.size(), layout.align()) });
        }
        unsafe fn realloc(&self, pointer: *mut u8, layout: Layout, size: usize) -> *mut u8 {
            self.with(|heap| unsafe { heap.realloc(pointer, layout.size(), layout.align(), size) })
        }
    }
    #[global_allocator]
    static HEAP: Heap = Heap { locked: AtomicBool::new(false), allocator: UnsafeCell::new(Dlmalloc::new_with_allocator(
        WasmPages { coarse: Cell::new(true), donated: Cell::new(false) })) };
    #[wasm_bindgen::prelude::wasm_bindgen]
    pub fn wasm_memory_grow_calls() -> u32 { GROW_CALLS.load(Ordering::Relaxed) }
    #[wasm_bindgen::prelude::wasm_bindgen]
    pub fn wasm_memory_grow_failures() -> u32 { GROW_FAILURES.load(Ordering::Relaxed) }
    #[wasm_bindgen::prelude::wasm_bindgen]
    pub fn wasm_memory_grown_pages() -> u32 { GROWN_PAGES.load(Ordering::Relaxed) }
    #[wasm_bindgen::prelude::wasm_bindgen]
    pub fn configure_memory_limit(pages: u32) -> bool {
        if pages == 0 || pages > ADDRESS_PAGES as u32 || (pages as usize) < core::arch::wasm32::memory_size(0) { return false; }
        MAXIMUM_PAGES.store(pages, Ordering::Relaxed);
        true
    }
    #[wasm_bindgen::prelude::wasm_bindgen]
    pub fn configure_memory_stage(stage: u32) { STAGE.store(stage, Ordering::Relaxed); }
    #[wasm_bindgen::prelude::wasm_bindgen]
    pub fn wasm_memory_limit_avoided() -> u32 { AVOIDED.load(Ordering::Relaxed) }
    #[wasm_bindgen::prelude::wasm_bindgen]
    pub fn wasm_memory_events_json() -> String {
        let (entries, count) = HEAP.with(|_| {
            let log = unsafe { &*EVENTS.0.get() };
            (log.entries, log.count)
        });
        // Serialize outside the allocator lock. Only the latest 64 events exist.
        let mut entries = entries;
        entries.sort_unstable_by_key(|event| event.sequence);
        serde_json::to_string(&(count, &entries[64 - (count as usize).min(64)..])).unwrap()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn extra_reservation_failure_is_not_repeated_and_exact_failure_is_returned() {
        let coarse = Cell::new(true);
        let mut requests = Vec::new();
        let first = grow_region(PAGE, 100, ADDRESS_PAGES, &coarse, |pages| { requests.push(pages); if pages == 1 { 100 } else { usize::MAX } });
        assert_eq!(requests, [GROW_PAGES, 1]);
        assert_eq!(first, Some((100 * PAGE, PAGE)));
        requests.clear();
        assert_eq!(grow_region(2 * PAGE, 101, ADDRESS_PAGES, &coarse, |pages| { requests.push(pages); usize::MAX }), None);
        assert_eq!(requests, [2]);
        assert_eq!(grow_region(PAGE, 101, ADDRESS_PAGES, &coarse, |_| 101), Some((101 * PAGE, PAGE)));
    }
    #[test]
    fn known_limit_does_not_attempt_impossible_growth_or_disable_smaller_requests() {
        let coarse = Cell::new(true);
        assert_eq!(grow_region(2 * PAGE, 99, 100, &coarse, |_| panic!("known overflow")), None);
        assert_eq!(grow_region(PAGE, 99, 100, &coarse, |pages| { assert_eq!(pages, 1); 99 }), Some((99 * PAGE, PAGE)));
        assert!(coarse.get());
        assert_eq!(grow_region(PAGE, 100, 100, &coarse, |_| panic!("at limit")), None);
    }
    #[test]
    fn abundant_memory_grows_in_blocks_and_four_gib_end_never_wraps() {
        let coarse = Cell::new(true);
        assert_eq!(grow_region(1, 100, ADDRESS_PAGES, &coarse, |pages| { assert_eq!(pages, GROW_PAGES); 100 }), Some((100 * PAGE, GROW_PAGES * PAGE)));
        assert_eq!(grow_region(PAGE, ADDRESS_PAGES - 1, ADDRESS_PAGES, &coarse, |pages| { assert_eq!(pages, 1); ADDRESS_PAGES - 1 }),
            Some(((ADDRESS_PAGES - 1) * PAGE, PAGE - 16)));
        assert_eq!(grow_region(PAGE, ADDRESS_PAGES, ADDRESS_PAGES, &coarse, |_| panic!("must not grow beyond 4 GiB")), None);
    }
}
