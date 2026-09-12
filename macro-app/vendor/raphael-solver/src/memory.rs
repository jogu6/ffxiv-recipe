//! Keep search data in RAM while allocations succeed. Spill losslessly only
//! after allocation pressure, or under an explicitly configured test budget.
use std::sync::{Arc, Mutex, MutexGuard};

const PAGE_BYTES: usize = 4096;
static CACHE_BYTES: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);
#[cfg(target_arch = "wasm32")]
static STORE_SERIAL: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);
pub fn set_storage_cache_bytes(bytes: usize) {
    CACHE_BYTES.store(bytes, std::sync::atomic::Ordering::Relaxed);
}
pub type SharedStore = Arc<StoreMutex>;
thread_local! {
    static STORE_LOCK_DEPTH: std::cell::Cell<usize> = const { std::cell::Cell::new(0) };
}
pub struct StoreMutex { inner: Mutex<PageStore> }
pub struct StoreGuard<'a> { inner: MutexGuard<'a, PageStore> }
impl StoreMutex {
    pub fn lock(&self) -> Result<StoreGuard<'_>, &'static str> {
        let inner = self.inner.lock().map_err(|_| "探索用メモリーのロックが破損しました")?;
        STORE_LOCK_DEPTH.with(|depth| depth.set(depth.get() + 1));
        Ok(StoreGuard { inner })
    }
}
impl std::ops::Deref for StoreGuard<'_> {
    type Target = PageStore;
    fn deref(&self) -> &PageStore { &self.inner }
}
impl std::ops::DerefMut for StoreGuard<'_> {
    fn deref_mut(&mut self) -> &mut PageStore { &mut self.inner }
}
impl Drop for StoreGuard<'_> {
    fn drop(&mut self) { STORE_LOCK_DEPTH.with(|depth| depth.set(depth.get() - 1)); }
}
#[cfg(target_arch = "wasm32")]
static ACTIVE_STORE: Mutex<Option<std::sync::Weak<StoreMutex>>> = Mutex::new(None);

// Called by the WASM allocator after an actual allocation failure, including
// ordinary Vec/HashMap scratch allocations. Never re-enter a store lock held
// by this thread: those paths already use fallible allocation and local recovery.
#[cfg(target_arch = "wasm32")]
pub fn recover_memory() -> bool {
    if STORE_LOCK_DEPTH.with(|depth| depth.get() != 0) { return false; }
    let store = ACTIVE_STORE.lock().ok().and_then(|active| active.as_ref().and_then(std::sync::Weak::upgrade));
    store.is_some_and(|store| store.lock().is_ok_and(|mut store| store.recover_allocation() > 0))
}
struct PageSlot { page: Option<Page>, next_free: Option<u64> }
struct Page { bytes: Box<[u8; PAGE_BYTES]>, dirty: bool, referenced: bool }

pub struct PageStore {
    pages: Vec<PageSlot>,
    clock: usize,
    free: Option<u64>,
    resident: usize,
    limit: usize,
    pub pressure_events: u64,
    #[cfg(test)]
    fail_page_allocation_after: Option<usize>,
    #[cfg(target_arch = "wasm32")]
    namespace: usize,
    pub reads: u64,
    pub writes: u64,
    #[cfg(not(target_arch = "wasm32"))]
    file: Option<std::fs::File>,
    #[cfg(not(target_arch = "wasm32"))]
    path: std::path::PathBuf,
}

impl PageStore {
    pub fn new(cache_bytes: usize) -> SharedStore {
        #[cfg(not(target_arch = "wasm32"))]
        let (file, path) = {
            let path = std::env::temp_dir().join(format!("xivca-search-{}-{}.tmp", std::process::id(),
                std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()));
            let file = std::fs::OpenOptions::new().read(true).write(true).create_new(true).open(&path).unwrap();
            (file, path)
        };
        let store = Arc::new(StoreMutex { inner: Mutex::new(Self {
            pages: Vec::new(), clock: 0, free: None, resident: 0,
            limit: if cache_bytes == 0 { usize::MAX / PAGE_BYTES } else { (cache_bytes / PAGE_BYTES).max(2) },
            pressure_events: 0, reads: 0, writes: 0,
            #[cfg(test)] fail_page_allocation_after: None,
            #[cfg(target_arch = "wasm32")]
            namespace: STORE_SERIAL.fetch_add(1, std::sync::atomic::Ordering::Relaxed),
            #[cfg(not(target_arch = "wasm32"))] file: Some(file),
            #[cfg(not(target_arch = "wasm32"))] path,
        }) });
        #[cfg(target_arch = "wasm32")]
        { *ACTIVE_STORE.lock().unwrap() = Some(Arc::downgrade(&store)); }
        store
    }
    fn evict(&mut self) -> Box<[u8; PAGE_BYTES]> {
        assert!(self.resident > 0, "探索を続けるためのメモリーを確保できません");
        loop {
            let id = self.clock;
            self.clock = (self.clock + 1) % self.pages.len();
            let Some(page) = self.pages[id].page.as_mut() else { continue; };
            if page.referenced { page.referenced = false; continue; }
            let page = self.pages[id].page.take().unwrap();
            self.resident -= 1;
            if page.dirty {
                self.write_disk(id as u64, page.bytes.as_slice());
                self.writes += 1;
            }
            return page.bytes;
        }
    }
    // Called only on a failed allocation. Release part of the data already held
    // so metadata and bounded search scratch allocations can continue too.
    pub fn recover_allocation(&mut self) -> usize {
        self.pressure_events += 1;
        let release = (self.resident / 4).max(1).min(self.resident.saturating_sub(1));
        for _ in 0..release { drop(self.evict()); }
        self.limit = self.resident.max(1);
        release * PAGE_BYTES
    }
    // For necessary scratch/index arrays. Large candidate payloads instead
    // migrate to PagedVec; do not use this to retry their geometric growth.
    pub fn reserve_vec<T>(&mut self, values: &mut Vec<T>, additional: usize) {
        if values.try_reserve(additional).is_ok() { return; }
        while values.try_reserve_exact(additional).is_err() {
            assert!(self.recover_allocation() > 0, "探索の作業メモリーを確保できません");
        }
    }
    fn try_buffer(&self) -> Option<Box<[u8; PAGE_BYTES]>> {
        #[cfg(test)]
        if self.fail_page_allocation_after.is_some_and(|limit| self.resident >= limit) { return None; }
        let mut bytes = Vec::new();
        bytes.try_reserve_exact(PAGE_BYTES).ok()?;
        bytes.resize(PAGE_BYTES, 0);
        Some(bytes.into_boxed_slice().try_into().unwrap())
    }
    fn buffer(&mut self) -> Box<[u8; PAGE_BYTES]> {
        if self.resident >= self.limit { return self.evict(); }
        if let Some(bytes) = self.try_buffer() { return bytes; }
        self.pressure_events += 1;
        self.limit = self.resident.max(1);
        self.evict()
    }
    pub fn allocate(&mut self) -> u64 {
        if self.free.is_none() && self.pages.try_reserve(1).is_err() {
            // Minimum growth first; retry only after actually freeing storage.
            while self.pages.try_reserve_exact(1).is_err() {
                assert!(self.recover_allocation() > 0, "探索の索引メモリーを確保できません");
            }
        }
        let mut bytes = self.buffer();
        bytes.fill(0);
        let id = if let Some(id) = self.free {
            self.free = self.pages[id as usize].next_free.take();
            id
        } else {
            self.pages.push(PageSlot { page: None, next_free: None });
            (self.pages.len() - 1) as u64
        };
        self.pages[id as usize].page = Some(Page { bytes, dirty: true, referenced: true });
        self.resident += 1;
        id
    }
    fn page(&mut self, id: u64) -> &mut Page {
        if self.pages[id as usize].page.is_none() {
            let mut bytes = self.buffer();
            self.read_disk(id, bytes.as_mut_slice());
            self.reads += 1;
            self.pages[id as usize].page = Some(Page { bytes, dirty: false, referenced: true });
            self.resident += 1;
        }
        let page = self.pages[id as usize].page.as_mut().unwrap();
        page.referenced = true;
        page
    }
    pub fn resident_bytes(&self) -> usize { self.resident * PAGE_BYTES }
    pub fn allocated_bytes(&self) -> u64 { self.pages.len() as u64 * PAGE_BYTES as u64 }
    fn release(&mut self, pages: &[u64]) {
        for &id in pages {
            if self.pages[id as usize].page.take().is_some() { self.resident -= 1; }
            self.pages[id as usize].next_free = self.free;
            self.free = Some(id);
        }
    }
    #[cfg(not(target_arch = "wasm32"))]
    fn write_disk(&mut self, id: u64, bytes: &[u8]) {
        use std::io::{Seek, Write};
        let file = self.file.as_mut().unwrap();
        file.seek(std::io::SeekFrom::Start(id * PAGE_BYTES as u64)).unwrap();
        file.write_all(bytes).expect("探索用一時ファイルへ書き込めません");
    }
    #[cfg(not(target_arch = "wasm32"))]
    fn read_disk(&mut self, id: u64, bytes: &mut [u8]) {
        use std::io::{Read, Seek};
        let file = self.file.as_mut().unwrap();
        file.seek(std::io::SeekFrom::Start(id * PAGE_BYTES as u64)).unwrap();
        file.read_exact(bytes).expect("探索用一時ファイルを読み込めません");
    }
    #[cfg(target_arch = "wasm32")]
    fn write_disk(&mut self, id: u64, bytes: &[u8]) { write_page(self.namespace as f64 * 4398046511104.0 + id as f64 * PAGE_BYTES as f64, bytes); }
    #[cfg(target_arch = "wasm32")]
    fn read_disk(&mut self, id: u64, bytes: &mut [u8]) { read_page(self.namespace as f64 * 4398046511104.0 + id as f64 * PAGE_BYTES as f64, bytes); }
}

#[cfg(not(target_arch = "wasm32"))]
impl Drop for PageStore {
    fn drop(&mut self) {
        // Windows needs the handle closed before removing the temporary file.
        drop(self.file.take());
        let _ = std::fs::remove_file(&self.path);
    }
}

#[cfg(target_arch = "wasm32")]
#[wasm_bindgen::prelude::wasm_bindgen]
extern "C" {
    #[wasm_bindgen(js_namespace = ["globalThis", "__xivcaSearchStore"], js_name = write)]
    fn write_page(at: f64, bytes: &[u8]);
    #[wasm_bindgen(js_namespace = ["globalThis", "__xivcaSearchStore"], js_name = read)]
    fn read_page(at: f64, bytes: &mut [u8]);
}

pub trait Record: Copy {
    const BYTES: usize;
    fn encode(self, target: &mut [u8]);
    fn decode(source: &[u8]) -> Self;
}

pub struct PagedVec<T: Record> {
    store: SharedStore,
    pages: Vec<u64>,
    len: usize,
    _item: std::marker::PhantomData<T>,
}

impl<T: Record> PagedVec<T> {
    pub fn new(store: SharedStore) -> Self { Self { store, pages: Vec::new(), len: 0, _item: std::marker::PhantomData } }
    pub fn len(&self) -> usize { self.len }
    pub fn from_slice(store: SharedStore, values: &[T]) -> Self {
        let mut result = Self::new(store);
        result.extend_from_slice(values);
        result
    }
    pub fn store(&self) -> SharedStore { self.store.clone() }
    pub fn to_vec(&self) -> Vec<T> {
        self.range(0, self.len)
    }
    pub fn range(&self, start: usize, len: usize) -> Vec<T> {
        let mut result = Vec::new();
        self.append_range(start, len, &mut result, |value| value);
        result
    }
    pub fn append_range(&self, start: usize, len: usize, target: &mut Vec<T>, mut map: impl FnMut(T) -> T) {
        let mut store = self.store.lock().unwrap();
        let per_page = PAGE_BYTES / T::BYTES;
        let mut index = start;
        store.reserve_vec(target, len);
        while index < start + len {
            let count = (per_page - index % per_page).min(start + len - index);
            let offset = index % per_page * T::BYTES;
            let page = store.page(self.pages[index / per_page]);
            target.extend(page.bytes[offset..offset + count * T::BYTES].chunks_exact(T::BYTES).map(T::decode).map(&mut map));
            index += count;
        }
    }
    pub fn partition_range(&self, start: usize, len: usize, predicate: impl Fn(T) -> bool) -> usize {
        let mut store = self.store.lock().unwrap();
        let per_page = PAGE_BYTES / T::BYTES;
        if len == 0 { return 0; }
        let (mut left, mut right) = (0, len);
        if start / per_page == (start + len - 1) / per_page {
            let page = store.page(self.pages[start / per_page]);
            while left < right {
                let middle = (left + right) / 2;
                let offset = (start % per_page + middle) * T::BYTES;
                if predicate(T::decode(&page.bytes[offset..offset + T::BYTES])) { left = middle + 1; }
                else { right = middle; }
            }
        } else {
            while left < right {
                let middle = (left + right) / 2;
                if predicate(self.get_in(&mut store, start + middle)) { left = middle + 1; }
                else { right = middle; }
            }
        }
        left
    }
    pub fn replace(&mut self, values: &[T]) {
        self.len = 0;
        self.extend_from_slice(values);
    }
    pub fn capacity(&self) -> usize { self.pages.len() * (PAGE_BYTES / T::BYTES) }
    pub fn get(&self, index: usize) -> T {
        assert!(index < self.len);
        let mut store = self.store.lock().unwrap();
        self.get_in(&mut store, index)
    }
    pub fn get_in(&self, store: &mut PageStore, index: usize) -> T {
        let per_page = PAGE_BYTES / T::BYTES;
        let offset = index % per_page * T::BYTES;
        T::decode(&store.page(self.pages[index / per_page]).bytes[offset..offset + T::BYTES])
    }
    pub fn push(&mut self, item: T) {
        self.extend_from_slice(std::slice::from_ref(&item));
    }
    pub fn extend_from_slice(&mut self, mut items: &[T]) {
        let per_page = PAGE_BYTES / T::BYTES;
        let mut store = self.store.lock().unwrap();
        while !items.is_empty() {
            if self.len == self.capacity() {
                store.reserve_vec(&mut self.pages, 1);
                self.pages.push(store.allocate());
            }
            let count = (per_page - self.len % per_page).min(items.len());
            let offset = self.len % per_page * T::BYTES;
            let page = store.page(self.pages[self.len / per_page]);
            for (&item, target) in items[..count].iter().zip(page.bytes[offset..offset + count * T::BYTES].chunks_exact_mut(T::BYTES)) {
                item.encode(target);
            }
            page.dirty = true;
            self.len += count;
            items = &items[count..];
        }
    }
}

impl<T: Record> Drop for PagedVec<T> {
    fn drop(&mut self) { self.store.lock().unwrap().release(&self.pages); }
}

impl Record for crate::utils::ParetoValue {
    const BYTES: usize = 4;
    fn encode(self, target: &mut [u8]) {
        target[..2].copy_from_slice(&self.progress.to_le_bytes());
        target[2..].copy_from_slice(&self.quality.to_le_bytes());
    }
    fn decode(source: &[u8]) -> Self {
        Self::new(u16::from_le_bytes(source[..2].try_into().unwrap()),
            u16::from_le_bytes(source[2..].try_into().unwrap()))
    }
}

pub struct FrontPool {
    store: SharedStore,
    values: Mutex<PagedVec<crate::utils::ParetoValue>>,
    intern: Mutex<Vec<Option<(u64, std::num::NonZeroU64)>>>,
}
pub type FrontPoolGuard<'a> = &'a FrontPool;
impl Default for FrontPool {
    fn default() -> Self { Self::with_store(PageStore::new(CACHE_BYTES.load(std::sync::atomic::Ordering::Relaxed)), 65536) }
}
impl FrontPool {
    fn with_store(store: SharedStore, intern_slots: usize) -> Self { Self {
        values: Mutex::new(PagedVec::new(store.clone())), store,
        intern: Mutex::new(vec![None; intern_slots]),
    } }
    pub fn store(&self) -> SharedStore { self.store.clone() }
    pub fn get(&self) -> FrontPoolGuard<'_> { self }
    pub fn save(&self, values: &[crate::utils::ParetoValue]) -> Result<FrontRef<'_>, crate::SolverException> {
        if values.is_empty() || values.len() >= (1 << 17) {
            return Err(crate::SolverException::InternalError("Invalid Pareto front length".into()));
        }
        let mut data = self.values.lock().unwrap();
        let hash = values.iter().fold(values.len() as u64, |hash, value|
            hash.wrapping_mul(0x100000001b3) ^ ((value.progress as u64) << 16 | value.quality as u64));
        let mut intern = self.intern.lock().unwrap();
        let slot = hash as usize % intern.len();
        if let Some((old_hash, encoded)) = intern[slot]
            && old_hash == hash {
            let previous = FrontRef { pool: self, encoded };
            if previous.len() == values.len() {
                let mut store = data.store.lock().unwrap();
                if values.iter().enumerate().all(|(index, value)| data.get_in(&mut store, previous.start() + index) == *value) {
                    return Ok(previous);
                }
            }
        }
        let start = data.len();
        data.extend_from_slice(values);
        let encoded = std::num::NonZeroU64::new((values.len() as u64) << 47 | (start as u64 + 1)).unwrap();
        intern[slot] = Some((hash, encoded));
        Ok(FrontRef { pool: self, encoded })
    }
}

#[derive(Clone, Copy)]
pub struct FrontRef<'a> { pool: &'a FrontPool, encoded: std::num::NonZeroU64 }
impl std::fmt::Debug for FrontRef<'_> {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result { f.debug_tuple("FrontRef").field(&self.encoded).finish() }
}
impl FrontRef<'_> {
    pub fn reserve<T>(&self, target: &mut Vec<T>, additional: usize) {
        self.pool.store.lock().unwrap().reserve_vec(target, additional);
    }
    pub fn len(&self) -> usize { (self.encoded.get() >> 47) as usize }
    fn start(&self) -> usize { ((self.encoded.get() & ((1u64 << 47) - 1)) - 1) as usize }
    pub fn get(&self, index: usize) -> Option<crate::utils::ParetoValue> {
        (index < self.len()).then(|| self.pool.values.lock().unwrap().get(self.start() + index))
    }
    pub fn first(&self) -> crate::utils::ParetoValue { self.get(0).unwrap() }
    pub fn append_transformed(&self, target: &mut Vec<crate::utils::ParetoValue>, addition: crate::utils::ParetoValue) {
        let data = self.pool.values.lock().unwrap();
        data.append_range(self.start(), self.len(), target, |value| value.saturating_add(addition));
    }
    pub fn equals_slice(&self, values: &[crate::utils::ParetoValue]) -> bool {
        if self.len() != values.len() { return false; }
        let data = self.pool.values.lock().unwrap();
        let mut store = data.store.lock().unwrap();
        values.iter().enumerate().all(|(index, value)| data.get_in(&mut store, self.start() + index) == *value)
    }
    pub fn partition_point(&self, predicate: impl Fn(&crate::utils::ParetoValue) -> bool) -> usize {
        let data = self.pool.values.lock().unwrap();
        data.partition_range(self.start(), self.len(), |value| predicate(&value))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::utils::ParetoValue;

    #[test]
    fn repeated_recovery_stops_at_minimum_and_pages_remain_readable() {
        assert_eq!(PageStore::new(0).lock().unwrap().recover_allocation(), 0);
        let shared = PageStore::new(0);
        let mut store = shared.lock().unwrap();
        for i in 0..64u64 {
            let id = store.allocate();
            store.page(id).bytes[..8].copy_from_slice(&i.to_le_bytes());
        }
        assert_eq!(store.resident, 64);
        let impossible = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            store.reserve_vec(&mut Vec::<u64>::new(), usize::MAX);
        }));
        assert!(impossible.is_err());
        assert!(store.pressure_events < 64);
        assert_eq!(store.resident, 1);
        for i in (0..64u64).rev() { assert_eq!(&store.page(i).bytes[..8], &i.to_le_bytes()); }
        let capacity = store.pages.capacity();
        store.release(&(0..64).collect::<Vec<_>>());
        assert_eq!(store.resident, 0);
        assert_eq!(store.pages.capacity(), capacity);
        for _ in 0..64 { store.allocate(); }
        assert_eq!(store.pages.len(), 64);
    }

    #[test]
    fn successful_allocations_do_not_spill() {
        let shared = PageStore::new(0);
        let mut store = shared.lock().unwrap();
        for i in 0..1024u64 {
            let id = store.allocate();
            store.page(id).bytes[..8].copy_from_slice(&i.to_le_bytes());
        }
        assert_eq!(store.writes, 0);
        assert_eq!(store.pressure_events, 0);
        for i in 0..1024u64 { assert_eq!(&store.page(i).bytes[..8], &i.to_le_bytes()); }
    }

    #[test]
    fn parallel_allocation_failure_recovers_and_preserves_all_records() {
        use rayon::prelude::*;
        let store = PageStore::new(0);
        store.lock().unwrap().fail_page_allocation_after = Some(16);
        let threads = rayon::ThreadPoolBuilder::new().num_threads(4).build().unwrap();
        let lists = threads.install(|| (0..8u16).into_par_iter().map(|owner| {
            let mut values = PagedVec::new(store.clone());
            for i in 0..10000u16 { values.push(ParetoValue::new(i, owner)); }
            values
        }).collect::<Vec<_>>());
        threads.install(|| lists.par_iter().enumerate().for_each(|(owner, values)| {
            for i in (0..10000usize).rev() {
                assert_eq!(values.get(i), ParetoValue::new(i as u16, owner as u16));
            }
        }));
        let state = store.lock().unwrap();
        assert!(state.pressure_events > 0);
        assert!(state.reads > 0 && state.writes > 0);
        assert!(state.resident_bytes() <= 16 * PAGE_BYTES);
        let path = state.path.clone();
        drop(state);
        drop(lists);
        drop(store);
        assert!(!path.exists());
    }

    #[test]
    fn failed_allocation_spills_and_preserves_every_record() {
        let shared = PageStore::new(0);
        let mut store = shared.lock().unwrap();
        store.fail_page_allocation_after = Some(16);
        for i in 0..256u64 {
            let id = store.allocate();
            store.page(id).bytes[..8].copy_from_slice(&i.to_le_bytes());
        }
        assert_eq!(store.pressure_events, 1);
        assert!(store.writes > 0);
        for i in (0..256u64).rev() { assert_eq!(&store.page(i).bytes[..8], &i.to_le_bytes()); }
        assert!(store.reads > 0);
        assert!(store.resident_bytes() <= 16 * PAGE_BYTES);
    }

    #[test]
    fn cold_pages_round_trip_and_reuse_without_losing_records() {
        let store = PageStore::new(8192);
        let mut values = PagedVec::new(store.clone());
        for i in 0..10000u16 { values.push(ParetoValue::new(i, 10000 - i)); }
        for i in (0..10000usize).rev() { assert_eq!(values.get(i), ParetoValue::new(i as u16, 10000 - i as u16)); }
        assert!(store.lock().unwrap().reads > 0);
        assert!(store.lock().unwrap().writes > 0);
        assert!(store.lock().unwrap().resident_bytes() <= 8192);
        let high_water = store.lock().unwrap().allocated_bytes();
        drop(values);
        let mut reused = PagedVec::new(store.clone());
        for i in 0..10000u16 { reused.push(ParetoValue::new(i, i)); }
        assert_eq!(store.lock().unwrap().allocated_bytes(), high_water);
        for i in 0..10000usize { assert_eq!(reused.get(i), ParetoValue::new(i as u16, i as u16)); }
    }

    #[test]
    fn bound_fronts_preserve_order_and_binary_search_after_eviction() {
        let pool = FrontPool::with_store(PageStore::new(8192), 64);
        let mut handles = Vec::new();
        for i in 0..400u16 {
            let values: Vec<_> = (0..100u16).map(|j| ParetoValue::new(j, i)).collect();
            handles.push(pool.save(&values).unwrap());
        }
        for (i, front) in handles.iter().enumerate().rev() {
            assert_eq!(front.len(), 100);
            assert_eq!(front.first(), ParetoValue::new(0, i as u16));
            assert_eq!(front.partition_point(|value| value.progress < 49), 49);
            assert_eq!(front.get(99), Some(ParetoValue::new(99, i as u16)));
            assert_eq!(front.get(100), None);
            let expected: Vec<_> = (0..100).map(|j| ParetoValue::new(j, i as u16)).collect();
            assert!(front.equals_slice(&expected));
            let mut appended = Vec::new();
            front.append_transformed(&mut appended, ParetoValue::new(0, 0));
            assert_eq!(appended, expected);
        }
        assert!(pool.store().lock().unwrap().resident_bytes() <= 8192);
    }
}
