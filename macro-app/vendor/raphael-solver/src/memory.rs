//! Keep search data in RAM while allocations succeed. Spill losslessly only
//! after allocation pressure, or under an explicitly configured test budget.
use std::sync::{Arc, Mutex, RwLock, atomic::{AtomicBool, Ordering}};

const PAGE_BYTES: usize = 4096;
const DISK_BYTES: u64 = 3 * 1024 * 1024 * 1024;
const RECOVERY_HEADROOM_BYTES: usize = 16 * 1024 * 1024;
static CACHE_BYTES: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);
pub fn set_storage_cache_bytes(bytes: usize) {
    CACHE_BYTES.store(bytes, std::sync::atomic::Ordering::Relaxed);
}
pub type SharedStore = Arc<RwLock<PageStore>>;
struct PageSlot { page: Option<Page>, next_free: Option<u64>, disk_slot: Option<u64> }
struct Page { bytes: RwLock<Box<[u8; PAGE_BYTES]>>, referenced: AtomicBool }

pub struct PageStore {
    pages: Vec<PageSlot>,
    clock: usize,
    free: Option<u64>,
    free_disk_slots: Vec<u64>,
    next_disk_slot: u64,
    resident: usize,
    limit: usize,
    pub pressure_events: u64,
    #[cfg(test)]
    fail_page_allocation_after: Option<usize>,
    #[cfg(test)]
    pub force_paged_scratch: bool,
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
            static NEXT_FILE: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
            let path = std::env::temp_dir().join(format!("xivca-search-{}-{}-{}.tmp", std::process::id(),
                std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos(),
                NEXT_FILE.fetch_add(1, Ordering::Relaxed)));
            let file = std::fs::OpenOptions::new().read(true).write(true).create_new(true).open(&path).unwrap();
            (file, path)
        };
        Arc::new(RwLock::new(Self {
            pages: Vec::new(), clock: 0, free: None, free_disk_slots: Vec::new(),
            next_disk_slot: 0, resident: 0,
            limit: if cache_bytes == 0 { usize::MAX / PAGE_BYTES } else { (cache_bytes / PAGE_BYTES).max(2) },
            pressure_events: 0, reads: 0, writes: 0,
            #[cfg(test)] fail_page_allocation_after: None,
            #[cfg(test)] force_paged_scratch: false,
            #[cfg(not(target_arch = "wasm32"))] file: Some(file),
            #[cfg(not(target_arch = "wasm32"))] path,
        }))
    }
    fn evict(&mut self) -> Box<[u8; PAGE_BYTES]> {
        assert!(self.resident > 0, "探索を続けるためのメモリーを確保できません");
        loop {
            let id = self.clock;
            self.clock = (self.clock + 1) % self.pages.len();
            let Some(page) = self.pages[id].page.as_mut() else { continue; };
            if page.referenced.swap(false, Ordering::Relaxed) { continue; }
            let page = self.pages[id].page.take().unwrap();
            self.resident -= 1;
            // Dense disk slots are reusable and no longer belong to a page
            // after it is read. Write every eviction so a clean page cannot
            // later point at a slot that another page has reused.
            let disk_slot = self.free_disk_slots.pop().unwrap_or_else(|| {
                let slot = self.next_disk_slot;
                assert!(slot < DISK_BYTES / PAGE_BYTES as u64,
                    "探索用の一時保存領域3GiBを使い切りました");
                self.next_disk_slot += 1;
                slot
            });
            let bytes = page.bytes.into_inner().unwrap();
            self.write_disk(disk_slot, bytes.as_slice());
            self.pages[id].disk_slot = Some(disk_slot);
            self.writes += 1;
            return bytes;
        }
    }
    // One failed request gets one recovery pass. Release enough cached pages for
    // the requested allocation plus fixed headroom, without collapsing the cache.
    pub fn recover_allocation(&mut self, required_bytes: usize) -> usize {
        self.pressure_events += 1;
        let requested = required_bytes.saturating_add(RECOVERY_HEADROOM_BYTES);
        let release = requested.div_ceil(PAGE_BYTES).max(1)
            .min(self.resident.saturating_sub(1));
        for _ in 0..release { drop(self.evict()); }
        self.limit = self.resident.max(1);
        release * PAGE_BYTES
    }
    // For necessary scratch/index arrays. Large candidate payloads instead
    // migrate to PagedVec; do not use this to retry their geometric growth.
    pub fn reserve_vec<T>(&mut self, values: &mut Vec<T>, additional: usize) {
        if values.try_reserve(additional).is_ok() { return; }
        self.recover_vec(values, additional);
    }
    fn recover_vec<T>(&mut self, values: &mut Vec<T>, additional: usize) {
        let required = additional.saturating_mul(std::mem::size_of::<T>().max(1));
        let released = self.recover_allocation(required);
        assert!(released > 0 && values.try_reserve_exact(additional).is_ok(),
            "探索の作業メモリーを確保できません");
    }
    fn recover_map<K: Eq + std::hash::Hash, V, S: std::hash::BuildHasher>(
        &mut self, values: &mut std::collections::HashMap<K, V, S>, additional: usize,
    ) {
        let required = values.len().saturating_add(additional)
            .saturating_mul(std::mem::size_of::<(K, V)>().saturating_add(1));
        let released = self.recover_allocation(required);
        assert!(released > 0 && values.try_reserve(additional).is_ok(),
            "探索の索引メモリーを確保できません");
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
            let released = self.recover_allocation(std::mem::size_of::<PageSlot>());
            assert!(released > 0 && self.pages.try_reserve_exact(1).is_ok(),
                "探索の索引メモリーを確保できません");
        }
        let mut bytes = self.buffer();
        bytes.fill(0);
        let id = if let Some(id) = self.free {
            self.free = self.pages[id as usize].next_free.take();
            id
        } else {
            self.pages.push(PageSlot { page: None, next_free: None, disk_slot: None });
            (self.pages.len() - 1) as u64
        };
        self.pages[id as usize].page = Some(Page { bytes: RwLock::new(bytes), referenced: AtomicBool::new(true) });
        self.resident += 1;
        id
    }
    fn page(&mut self, id: u64) -> &mut Page {
        if self.pages[id as usize].page.is_none() {
            // Read before eviction: even when all disk slots are occupied,
            // the victim can reuse this slot without growing the disk store.
            let mut incoming = [0u8; PAGE_BYTES];
            let disk_slot = self.pages[id as usize].disk_slot.take()
                .expect("退避した探索ページの位置がありません");
            self.read_disk(disk_slot, &mut incoming);
            self.return_disk_slot(disk_slot);
            let mut bytes = self.buffer();
            bytes.copy_from_slice(&incoming);
            self.reads += 1;
            self.pages[id as usize].page = Some(Page { bytes: RwLock::new(bytes), referenced: AtomicBool::new(true) });
            self.resident += 1;
        }
        let page = self.pages[id as usize].page.as_mut().unwrap();
        page.referenced.store(true, Ordering::Relaxed);
        page
    }
    pub fn resident_bytes(&self) -> usize { self.resident * PAGE_BYTES }
    pub fn allocated_bytes(&self) -> u64 { self.pages.len() as u64 * PAGE_BYTES as u64 }
    pub fn disk_used_bytes(&self) -> u64 {
        (self.next_disk_slot - self.free_disk_slots.len() as u64) * PAGE_BYTES as u64
    }
    pub fn disk_high_water_bytes(&self) -> u64 { self.next_disk_slot * PAGE_BYTES as u64 }
    pub fn disk_capacity_bytes(&self) -> u64 { DISK_BYTES }
    fn release(&mut self, pages: &[u64]) {
        for &id in pages {
            if self.pages[id as usize].page.take().is_some() { self.resident -= 1; }
            if let Some(slot) = self.pages[id as usize].disk_slot.take() {
                self.return_disk_slot(slot);
            }
            self.pages[id as usize].next_free = self.free;
            self.free = Some(id);
        }
    }
    fn return_disk_slot(&mut self, slot: u64) {
        if self.free_disk_slots.try_reserve(1).is_err() {
            let released = self.recover_allocation(std::mem::size_of::<u64>());
            assert!(released > 0 && self.free_disk_slots.try_reserve_exact(1).is_ok(),
                "探索の退避位置を管理するメモリーを確保できません");
        }
        self.free_disk_slots.push(slot);
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
    fn write_disk(&mut self, id: u64, bytes: &[u8]) { write_page(id as f64 * PAGE_BYTES as f64, bytes); }
    #[cfg(target_arch = "wasm32")]
    fn read_disk(&mut self, id: u64, bytes: &mut [u8]) { read_page(id as f64 * PAGE_BYTES as f64, bytes); }
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

pub fn reserve_vec<T>(store: &SharedStore, values: &mut Vec<T>, additional: usize) {
    if values.try_reserve(additional).is_err() {
        store.write().unwrap().recover_vec(values, additional);
    }
}
pub fn reserve_map<K: Eq + std::hash::Hash, V, S: std::hash::BuildHasher>(
    store: &SharedStore, values: &mut std::collections::HashMap<K, V, S>, additional: usize,
) {
    if values.try_reserve(additional).is_err() {
        store.write().unwrap().recover_map(values, additional);
    }
}

pub trait Record: Copy {
    const BYTES: usize;
    fn encode(self, target: &mut [u8]);
    fn decode(source: &[u8]) -> Self;
}

// Preserve the logical batch when a contiguous allocation cannot be made.
// Paging changes storage only; it must not introduce new search/merge boundaries.
pub enum SpillVec<T: Record> {
    Resident(Vec<T>),
    Stored(PagedVec<T>),
}
impl<T: Record + Send + Sync> SpillVec<T> {
    pub fn with_capacity(store: SharedStore, count: usize) -> Self {
        #[cfg(test)]
        if store.read().unwrap().force_paged_scratch { return Self::Stored(PagedVec::new(store)); }
        let mut values = Vec::new();
        if values.try_reserve_exact(count).is_ok() { Self::Resident(values) }
        else { Self::Stored(PagedVec::new(store)) }
    }
    pub fn len(&self) -> usize {
        match self { Self::Resident(v) => v.len(), Self::Stored(v) => v.len() }
    }
    pub fn get(&self, index: usize) -> T {
        match self { Self::Resident(v) => v[index], Self::Stored(v) => v.get(index) }
    }
    pub fn set(&mut self, index: usize, value: T) {
        match self { Self::Resident(v) => v[index] = value, Self::Stored(v) => v.set(index, value) }
    }
    pub fn push(&mut self, value: T, store: &SharedStore) {
        if let Self::Resident(values) = self {
            if values.len() < values.capacity() || values.try_reserve(1).is_ok() {
                values.push(value);
                return;
            }
            *self = Self::Stored(PagedVec::from_slice(store.clone(), values));
        }
        if let Self::Stored(values) = self { values.push(value); }
    }
    pub fn sort_by_key<K: Ord + Send>(
        &mut self, key: impl Fn(&T) -> K + Sync, interrupt: &crate::AtomicFlag,
    ) -> Result<(), crate::SolverException> {
        if interrupt.is_set() { return Err(crate::SolverException::Interrupted); }
        if let Self::Resident(values) = self {
            crate::report_work(2, 0, values.len());
            values.sort_unstable_by_key(key);
            crate::report_work(2, values.len(), values.len());
        } else {
            // In-place heapsort needs no second batch-sized allocation. This
            // fallback is used only when contiguous RAM allocation has failed.
            let len = self.len();
            let total = len / 2 + len.saturating_sub(1);
            crate::report_work(2, 0, total);
            for root in (0..len / 2).rev() {
                if interrupt.is_set() { return Err(crate::SolverException::Interrupted); }
                self.sift_down(root, len, &key);
                crate::report_work(2, len / 2 - root, total);
            }
            for end in (1..len).rev() {
                if interrupt.is_set() { return Err(crate::SolverException::Interrupted); }
                let first = self.get(0); let last = self.get(end);
                self.set(0, last); self.set(end, first);
                self.sift_down(0, end, &key);
                crate::report_work(2, len / 2 + len - end, total);
            }
        }
        if interrupt.is_set() { return Err(crate::SolverException::Interrupted); }
        Ok(())
    }
    fn sift_down<K: Ord>(&mut self, mut root: usize, end: usize, key: &impl Fn(&T) -> K) {
        if root >= end / 2 { return; }
        let original_root = root;
        let value = self.get(root);
        let value_key = key(&value);
        while root < end / 2 {
            let mut child = root * 2 + 1;
            let mut next = self.get(child);
            if child + 1 < end {
                let right = self.get(child + 1);
                if key(&next) < key(&right) { child += 1; next = right; }
            }
            if value_key >= key(&next) { break; }
            self.set(root, next);
            root = child;
        }
        // Keep the displaced value locally and write its final position once.
        // The child choice and equality handling remain identical to swaps.
        if root != original_root { self.set(root, value); }
    }
}

pub struct PagedVec<T: Record> {
    store: SharedStore,
    pages: Vec<u64>,
    len: usize,
    _item: std::marker::PhantomData<T>,
}

// A sequence of resident reads shares one guard. A page fault drops it before
// taking the write lock; callers must also drop this reader before allocations.
pub struct PagedReader<'a, T: Record> {
    values: &'a PagedVec<T>,
    guard: Option<std::sync::RwLockReadGuard<'a, PageStore>>,
}
impl<T: Record> PagedReader<'_, T> {
    pub fn get(&mut self, index: usize) -> T {
        assert!(index < self.values.len);
        if let Some(value) = self.values.get_resident(self.guard.as_ref().unwrap(), index) { return value; }
        self.guard.take();
        let value = self.values.get_in(&mut self.values.store.write().unwrap(), index);
        self.guard = Some(self.values.store.read().unwrap());
        value
    }
}

impl<T: Record> PagedVec<T> {
    pub fn reader(&self) -> PagedReader<'_, T> {
        PagedReader { values: self, guard: Some(self.store.read().unwrap()) }
    }
    pub fn new(store: SharedStore) -> Self { Self { store, pages: Vec::new(), len: 0, _item: std::marker::PhantomData } }
    pub fn len(&self) -> usize { self.len }
    pub fn truncate(&mut self, len: usize) {
        assert!(len <= self.len);
        self.len = len;
        let page_count = len.div_ceil(PAGE_BYTES / T::BYTES);
        self.store.write().unwrap().release(&self.pages[page_count..]);
        self.pages.truncate(page_count);
    }
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
        assert!(start <= self.len && len <= self.len - start);
        reserve_vec(&self.store, target, len);
        self.visit_range(start, len, |value| target.push(map(value)));
    }
    fn copy_range(&self, start: usize, target: &mut [T]) {
        let mut index = 0;
        self.visit_range(start, target.len(), |value| { target[index] = value; index += 1; });
    }
    fn visit_range(&self, start: usize, len: usize, mut visit: impl FnMut(T)) {
        assert!(start <= self.len && len <= self.len - start);
        let per_page = PAGE_BYTES / T::BYTES;
        let mut index = start;
        while index < start + len {
            let id = self.pages[index / per_page];
            let store = self.store.read().unwrap();
            let Some(page) = &store.pages[id as usize].page else {
                drop(store);
                self.store.write().unwrap().page(id);
                continue;
            };
            if !page.referenced.load(Ordering::Relaxed) { page.referenced.store(true, Ordering::Relaxed); }
            let count = (per_page - index % per_page).min(start + len - index);
            let offset = index % per_page * T::BYTES;
            let bytes = page.bytes.read().unwrap();
            for source in bytes[offset..offset + count * T::BYTES].chunks_exact(T::BYTES) { visit(T::decode(source)); }
            index += count;
        }
    }

    pub fn capacity(&self) -> usize { self.pages.len() * (PAGE_BYTES / T::BYTES) }
    pub fn get(&self, index: usize) -> T {
        assert!(index < self.len);
        {
            let store = self.store.read().unwrap();
            if let Some(value) = self.get_resident(&store, index) { return value; }
        }
        let mut store = self.store.write().unwrap();
        self.get_in(&mut store, index)
    }
    fn get_resident(&self, store: &PageStore, index: usize) -> Option<T> {
        let per_page = PAGE_BYTES / T::BYTES;
        let offset = index % per_page * T::BYTES;
        let page = store.pages[self.pages[index / per_page] as usize].page.as_ref()?;
        if !page.referenced.load(Ordering::Relaxed) {
            page.referenced.store(true, Ordering::Relaxed);
        }
        Some(T::decode(&page.bytes.read().unwrap()[offset..offset + T::BYTES]))
    }
    fn partition_value(&self, start: usize, len: usize, predicate: impl Fn(T) -> bool) -> Option<T> {
        let store = self.store.read().unwrap();
        let per_page = PAGE_BYTES / T::BYTES;
        if len == 0 { return None; }
        if start / per_page == (start + len - 1) / per_page {
            if let Some(page) = &store.pages[self.pages[start / per_page] as usize].page {
                if !page.referenced.load(Ordering::Relaxed) { page.referenced.store(true, Ordering::Relaxed); }
                let bytes = page.bytes.read().unwrap();
                let offset = start % per_page;
                let value_at = |index: usize| T::decode(&bytes[(offset + index) * T::BYTES..(offset + index + 1) * T::BYTES]);
                let (mut left, mut right) = (0, len);
                while left < right {
                    let middle = (left + right) / 2;
                    if predicate(value_at(middle)) { left = middle + 1; } else { right = middle; }
                }
                return (left < len).then(|| value_at(left));
            }
        }
        let (mut left, mut right) = (0, len);
        while left < right {
            let middle = (left + right) / 2;
            let Some(value) = self.get_resident(&store, start + middle) else {
                drop(store);
                return self.partition_value_paged(start, len, predicate);
            };
            if predicate(value) { left = middle + 1; } else { right = middle; }
        }
        if left == len { return None; }
        if let Some(value) = self.get_resident(&store, start + left) { return Some(value); }
        drop(store);
        self.partition_value_paged(start, len, predicate)
    }
    fn partition_value_paged(&self, start: usize, len: usize, predicate: impl Fn(T) -> bool) -> Option<T> {
        let mut store = self.store.write().unwrap();
        let (mut left, mut right) = (0, len);
        while left < right {
            let middle = (left + right) / 2;
            if predicate(self.get_in(&mut store, start + middle)) { left = middle + 1; }
            else { right = middle; }
        }
        (left < len).then(|| self.get_in(&mut store, start + left))
    }
    pub fn any(&self, mut predicate: impl FnMut(T) -> bool) -> bool {
        let store = self.store.read().unwrap();
        for index in 0..self.len {
            match self.get_resident(&store, index) {
                Some(value) => if predicate(value) { return true; },
                None => {
                    drop(store);
                    let mut store = self.store.write().unwrap();
                    return (index..self.len).any(|i| predicate(self.get_in(&mut store, i)));
                }
            }
        }
        false
    }
    pub fn retain(&mut self, mut predicate: impl FnMut(T) -> bool) {
        let mut store = self.store.write().unwrap();
        let per_page = PAGE_BYTES / T::BYTES;
        let mut kept = 0;
        for index in 0..self.len {
            let value = self.get_in(&mut store, index);
            if predicate(value) {
                if kept != index {
                    let offset = kept % per_page * T::BYTES;
                    value.encode(&mut store.page(self.pages[kept / per_page]).bytes.get_mut().unwrap()[offset..offset + T::BYTES]);
                }
                kept += 1;
            }
        }
        self.len = kept;
    }
    pub fn set(&mut self, index: usize, value: T) {
        assert!(index < self.len);
        let per_page = PAGE_BYTES / T::BYTES;
        let id = self.pages[index / per_page];
        let offset = index % per_page * T::BYTES;
        self.with_page_mut(id, |bytes| value.encode(&mut bytes[offset..offset + T::BYTES]));
    }
    fn with_page_mut<R>(&self, id: u64, update: impl FnOnce(&mut [u8; PAGE_BYTES]) -> R) -> R {
        let store = self.store.read().unwrap();
        if let Some(page) = &store.pages[id as usize].page {
            if !page.referenced.load(Ordering::Relaxed) { page.referenced.store(true, Ordering::Relaxed); }
            return update(&mut page.bytes.write().unwrap());
        }
        drop(store);
        let mut store = self.store.write().unwrap();
        update(store.page(id).bytes.get_mut().unwrap())
    }
    // Pareto leaves normally fit in one page. Keep the check, compaction and
    // insertion under that page's lock, not an exclusive lock on the whole store.
    pub fn insert_non_dominated(&mut self, item: T, mut dominates: impl FnMut(T, T) -> bool) -> bool {
        let per_page = PAGE_BYTES / T::BYTES;
        if self.pages.len() == 1 && self.len < per_page {
            let len = self.len;
            let kept = self.with_page_mut(self.pages[0], |bytes| {
                if bytes[..len * T::BYTES].chunks_exact(T::BYTES)
                    .any(|source| dominates(T::decode(source), item)) { return None; }
                let mut kept = 0;
                for index in 0..len {
                    let value = T::decode(&bytes[index * T::BYTES..(index + 1) * T::BYTES]);
                    if !dominates(item, value) {
                        if kept != index { value.encode(&mut bytes[kept * T::BYTES..(kept + 1) * T::BYTES]); }
                        kept += 1;
                    }
                }
                item.encode(&mut bytes[kept * T::BYTES..(kept + 1) * T::BYTES]);
                Some(kept + 1)
            });
            if let Some(len) = kept { self.len = len; return true; }
            return false;
        }
        if self.any(|value| dominates(value, item)) { return false; }
        self.retain(|value| !dominates(item, value));
        self.push(item);
        true
    }
    pub fn get_in(&self, store: &mut PageStore, index: usize) -> T {
        let per_page = PAGE_BYTES / T::BYTES;
        let offset = index % per_page * T::BYTES;
        T::decode(&store.page(self.pages[index / per_page]).bytes.get_mut().unwrap()[offset..offset + T::BYTES])
    }
    pub fn replace_from_slice(&mut self, items: &[T]) {
        // Keep existing pages while rewriting; release only the unused tail.
        self.len = 0;
        self.extend_from_slice(items);
        self.truncate(self.len);
    }
    pub fn push(&mut self, item: T) {
        self.extend_from_slice(std::slice::from_ref(&item));
    }
    pub fn extend_from_slice(&mut self, mut items: &[T]) {
        let per_page = PAGE_BYTES / T::BYTES;
        let mut store = self.store.write().unwrap();
        while !items.is_empty() {
            if self.len == self.capacity() {
                store.reserve_vec(&mut self.pages, 1);
                self.pages.push(store.allocate());
            }
            let count = (per_page - self.len % per_page).min(items.len());
            let offset = self.len % per_page * T::BYTES;
            let page = store.page(self.pages[self.len / per_page]);
            for (&item, target) in items[..count].iter().zip(page.bytes.get_mut().unwrap()[offset..offset + count * T::BYTES].chunks_exact_mut(T::BYTES)) {
                item.encode(target);
            }
            self.len += count;
            items = &items[count..];
        }
    }
}

impl<T: Record> Drop for PagedVec<T> {
    fn drop(&mut self) { self.store.write().unwrap().release(&self.pages); }
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

// Exact query results for immutable bound fronts. Entries retain the complete
// pool identity, front identity and requested progress; collisions are misses.
// The fixed thread-local storage needs no allocation during a memory fault.
static NEXT_POOL_ID: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(1);
#[derive(Clone, Copy)]
struct BoundQueryEntry {
    pool: u64,
    front: u64,
    progress: u16,
    value: Option<crate::utils::ParetoValue>,
}
impl BoundQueryEntry {
    const EMPTY: Self = Self { pool: 0, front: 0, progress: 0, value: None };
}
#[derive(Clone, Copy)]
struct BoundFrontEntry {
    pool: u64,
    front: u64,
    values: [crate::utils::ParetoValue; 128],
}
impl BoundFrontEntry {
    const EMPTY: Self = Self { pool: 0, front: 0, values: [crate::utils::ParetoValue::new(0, 0); 128] };
}
// About 1.75 MiB per worker including the short-front cache. This replaces
// repeated shared-table locking, without reducing the original stored data.
struct BoundQueryCache {
    entries: [BoundQueryEntry; 65536],
    fronts: [BoundFrontEntry; 512],
    hits: u64,
    misses: u64,
}
thread_local! {
    static BOUND_QUERIES: std::cell::RefCell<BoundQueryCache> = const {
        std::cell::RefCell::new(BoundQueryCache {
            entries: [BoundQueryEntry::EMPTY; 65536], fronts: [BoundFrontEntry::EMPTY; 512], hits: 0, misses: 0,
        })
    };
}
pub fn reset_bound_query_stats() {
    let reset = || BOUND_QUERIES.with_borrow_mut(|cache| { cache.hits = 0; cache.misses = 0; });
    #[cfg(any(not(target_arch = "wasm32"), feature = "parallel"))]
    {
        rayon::broadcast(|_| reset());
        if rayon::current_thread_index().is_none() { reset(); }
    }
    #[cfg(all(target_arch = "wasm32", not(feature = "parallel")))]
    reset();
}
pub fn bound_query_stats() -> (u64, u64) {
    let local = || BOUND_QUERIES.with_borrow(|cache| (cache.hits, cache.misses));
    #[cfg(any(not(target_arch = "wasm32"), feature = "parallel"))]
    {
        let mut total = rayon::broadcast(|_| local()).into_iter().fold((0, 0), |sum, next| (sum.0 + next.0, sum.1 + next.1));
        if rayon::current_thread_index().is_none() { let next = local(); total.0 += next.0; total.1 += next.1; }
        total
    }
    #[cfg(all(target_arch = "wasm32", not(feature = "parallel")))]
    local()
}

pub struct FrontPool {
    identity: u64,
    store: SharedStore,
    values: RwLock<PagedVec<crate::utils::ParetoValue>>,
    intern: Mutex<Vec<Option<(u64, std::num::NonZeroU64)>>>,
}
pub type FrontPoolGuard<'a> = &'a FrontPool;
impl Default for FrontPool {
    fn default() -> Self { Self::with_store(PageStore::new(CACHE_BYTES.load(std::sync::atomic::Ordering::Relaxed)), 65536) }
}
impl FrontPool {
    fn with_store(store: SharedStore, intern_slots: usize) -> Self { Self {
        identity: NEXT_POOL_ID.fetch_add(1, Ordering::Relaxed),
        values: RwLock::new(PagedVec::new(store.clone())), store,
        intern: Mutex::new(vec![None; intern_slots]),
    } }
    pub fn store(&self) -> SharedStore { self.store.clone() }
    pub fn get(&self) -> FrontPoolGuard<'_> { self }
    pub fn save(&self, values: &[crate::utils::ParetoValue]) -> Result<FrontRef<'_>, crate::SolverException> {
        if values.is_empty() || values.len() >= (1 << 17) {
            return Err(crate::SolverException::InternalError("Invalid Pareto front length".into()));
        }
        let mut data = self.values.write().unwrap();
        let hash = values.iter().fold(values.len() as u64, |hash, value|
            hash.wrapping_mul(0x100000001b3) ^ ((value.progress as u64) << 16 | value.quality as u64));
        let mut intern = self.intern.lock().unwrap();
        let slot = hash as usize % intern.len();
        if let Some((old_hash, encoded)) = intern[slot]
            && old_hash == hash {
            let previous = FrontRef { pool: self, encoded };
            if previous.len() == values.len() {
                let mut reader = data.reader();
                if values.iter().enumerate().all(|(index, value)| reader.get(previous.start() + index) == *value) {
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
        reserve_vec(&self.pool.store, target, additional);
    }
    pub fn len(&self) -> usize { (self.encoded.get() >> 47) as usize }
    fn start(&self) -> usize { ((self.encoded.get() & ((1u64 << 47) - 1)) - 1) as usize }
    #[cfg(test)]
    pub fn get(&self, index: usize) -> Option<crate::utils::ParetoValue> {
        (index < self.len()).then(|| self.pool.values.read().unwrap().get(self.start() + index))
    }
    pub fn first(&self) -> crate::utils::ParetoValue { self.at_progress(0).unwrap() }
    pub fn append_transformed(&self, target: &mut Vec<crate::utils::ParetoValue>, addition: crate::utils::ParetoValue) {
        let data = self.pool.values.read().unwrap();
        data.append_range(self.start(), self.len(), target, |value| value.saturating_add(addition));
    }
    pub fn equals_slice(&self, values: &[crate::utils::ParetoValue]) -> bool {
        if self.len() != values.len() { return false; }
        let data = self.pool.values.read().unwrap();
        let mut reader = data.reader();
        values.iter().enumerate().all(|(index, value)| reader.get(self.start() + index) == *value)
    }
    pub fn at_progress(&self, progress: u16) -> Option<crate::utils::ParetoValue> {
        BOUND_QUERIES.with_borrow_mut(|cache| {
            let front = self.encoded.get();
            let hash = front ^ (front >> 32) ^ u64::from(progress).wrapping_mul(0x9e3779b9);
            let slot = hash as usize & (cache.entries.len() - 1);
            let entry = cache.entries[slot];
            if entry.pool == self.pool.identity && entry.front == front && entry.progress == progress {
                cache.hits += 1;
                return entry.value;
            }
            let len = self.len();
            let value = if len <= 128 {
                // A front is immutable after save. Reuse all its exact values
                // for different progress queries; large fronts keep the paged path.
                let front_slot = (front ^ (front >> 32)).wrapping_mul(0x9e3779b97f4a7c15) as usize & (cache.fronts.len() - 1);
                if cache.fronts[front_slot].pool == self.pool.identity && cache.fronts[front_slot].front == front {
                    cache.hits += 1;
                } else {
                    cache.misses += 1;
                    self.pool.values.read().unwrap().copy_range(self.start(), &mut cache.fronts[front_slot].values[..len]);
                    cache.fronts[front_slot].pool = self.pool.identity;
                    cache.fronts[front_slot].front = front;
                }
                let values = &cache.fronts[front_slot].values[..len];
                values.get(values.partition_point(|value| value.progress < progress)).copied()
            } else {
                cache.misses += 1;
                self.pool.values.read().unwrap().partition_value(self.start(), len, |value| value.progress < progress)
            };
            cache.entries[slot] = BoundQueryEntry { pool: self.pool.identity, front, progress, value };
            value
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::utils::ParetoValue;

    #[test]
    fn query_cache_is_exact_across_fronts_pools_none_results_and_eviction() {
        let pool = FrontPool::with_store(PageStore::new(8192), 64);
        let first = pool.save(&[ParetoValue::new(10, 20), ParetoValue::new(30, 5)]).unwrap();
        assert_eq!(first.at_progress(11), Some(ParetoValue::new(30, 5)));
        let second_pool = FrontPool::with_store(PageStore::new(8192), 64);
        let second = second_pool.save(&[ParetoValue::new(10, 40), ParetoValue::new(30, 15)]).unwrap();
        assert_eq!(first.encoded, second.encoded);
        assert_ne!(pool.identity, second_pool.identity);
        for _ in 0..3 {
            assert_eq!(first.at_progress(11), Some(ParetoValue::new(30, 5)));
            assert_eq!(second.at_progress(11), Some(ParetoValue::new(30, 15)));
            assert_eq!(first.at_progress(31), None);
        }
        let mut more = Vec::new();
        for i in 0..1024u16 {
            more.push(pool.save(&[ParetoValue::new(i, i)]).unwrap());
        }
        for front in more { assert_eq!(front.at_progress(0), Some(front.first())); }
        assert_eq!(first.at_progress(11), Some(ParetoValue::new(30, 5)));
        // A repeated exact query must avoid even the store's shared lock.
        let guard = pool.store.write().unwrap();
        assert_eq!(first.at_progress(11), Some(ParetoValue::new(30, 5)));
        assert_eq!(first.at_progress(12), Some(ParetoValue::new(30, 5)));
        assert_eq!(first.first(), ParetoValue::new(10, 20));
        assert_eq!(first.at_progress(65535), None);
        drop(guard);
    }

    #[test]
    fn independent_resident_updates_do_not_exclusively_lock_the_store() {
        let store = PageStore::new(0);
        let mut a = PagedVec::from_slice(store.clone(), &[ParetoValue::new(1, 2)]);
        let mut b = PagedVec::from_slice(store.clone(), &[ParetoValue::new(2, 1)]);
        assert!(a.insert_non_dominated(ParetoValue::new(3, 4), |lhs, rhs| {
            // A distinct leaf can be changed while this comparison is running.
            assert!(store.try_read().is_ok());
            b.set(0, ParetoValue::new(5, 6));
            lhs.progress >= rhs.progress && lhs.quality >= rhs.quality
        }));
        assert_eq!(a.to_vec(), [ParetoValue::new(3, 4)]);
        assert_eq!(b.to_vec(), [ParetoValue::new(5, 6)]);
        assert_eq!(store.read().unwrap().writes, 0);
    }

    #[test]
    fn spilled_sort_preserves_all_values_and_honors_interrupts() {
        let store = PageStore::new(8192);
        store.write().unwrap().force_paged_scratch = true;
        let mut values = SpillVec::with_capacity(store.clone(), 4097);
        let mut expected: Vec<_> = (0..4097u16).map(|i| ParetoValue::new((i * 13) % 4097, i)).collect();
        for &value in &expected { values.push(value, &store); }
        let flag = crate::AtomicFlag::new();
        flag.set();
        assert!(matches!(values.sort_by_key(|v| (v.progress, v.quality), &flag), Err(crate::SolverException::Interrupted)));
        flag.clear();
        values.sort_by_key(|v| (v.progress, v.quality), &flag).unwrap();
        expected.sort_unstable_by_key(|v| (v.progress, v.quality));
        assert_eq!((0..values.len()).map(|i| values.get(i)).collect::<Vec<_>>(), expected);
        assert!(store.read().unwrap().reads > 0 && store.read().unwrap().writes > 0);
        drop(values);
        assert_eq!(store.read().unwrap().disk_used_bytes(), 0);
    }

    #[test]
    fn paged_heap_sort_keeps_the_previous_order_even_for_equal_keys() {
        fn previous_sift(values: &mut [ParetoValue], mut root: usize, end: usize) {
            while root < end / 2 {
                let mut child = root * 2 + 1;
                if child + 1 < end && values[child].progress < values[child + 1].progress { child += 1; }
                if values[root].progress >= values[child].progress { break; }
                values.swap(root, child);
                root = child;
            }
        }
        for len in [0, 1, 2, 3, 17, 257, 4097] {
            let store = PageStore::new(8192);
            store.write().unwrap().force_paged_scratch = true;
            let mut values = SpillVec::with_capacity(store.clone(), len);
            let mut expected: Vec<_> = (0..len).map(|i| ParetoValue::new(((i * 31) % 23) as u16, i as u16)).collect();
            for &value in &expected { values.push(value, &store); }
            for root in (0..len / 2).rev() { previous_sift(&mut expected, root, len); }
            for end in (1..len).rev() { expected.swap(0, end); previous_sift(&mut expected, 0, end); }
            values.sort_by_key(|v| v.progress, &crate::AtomicFlag::new()).unwrap();
            assert_eq!((0..len).map(|i| values.get(i)).collect::<Vec<_>>(), expected);
        }
    }

    #[test]
    fn paged_heap_sort_reduces_storage_io_against_previous_swaps() {
        fn previous_sift(values: &mut SpillVec<ParetoValue>, mut root: usize, end: usize) {
            while root < end / 2 {
                let mut child = root * 2 + 1;
                if child + 1 < end && values.get(child).progress < values.get(child + 1).progress { child += 1; }
                let value = values.get(root); let next = values.get(child);
                if value.progress >= next.progress { break; }
                values.set(root, next); values.set(child, value); root = child;
            }
        }
        let mut results = Vec::new();
        for previous in [true, false] {
            let store = PageStore::new(8192);
            store.write().unwrap().force_paged_scratch = true;
            let len = 8193;
            let mut values = SpillVec::with_capacity(store.clone(), len);
            for i in 0..len { values.push(ParetoValue::new(((i * 31) % 257) as u16, i as u16), &store); }
            let start = std::time::Instant::now();
            if previous {
                for root in (0..len / 2).rev() { previous_sift(&mut values, root, len); }
                for end in (1..len).rev() {
                    let first = values.get(0); let last = values.get(end);
                    values.set(0, last); values.set(end, first);
                    previous_sift(&mut values, 0, end);
                }
            } else { values.sort_by_key(|v| v.progress, &crate::AtomicFlag::new()).unwrap(); }
            let state = store.read().unwrap();
            let io = state.reads + state.writes;
            eprintln!("heap previous={previous} elapsed={:?} reads={} writes={}", start.elapsed(), state.reads, state.writes);
            drop(state);
            results.push((io, (0..len).map(|i| values.get(i)).collect::<Vec<_>>()));
        }
        assert_eq!(results[0].1, results[1].1);
        assert!(results[1].0 < results[0].0);
    }

    #[test]
    fn resident_comparison_allows_concurrent_readers_without_io() {
        let store = PageStore::new(0);
        let values = PagedVec::from_slice(store.clone(), &[ParetoValue::new(1, 2), ParetoValue::new(3, 4)]);
        assert!(values.any(|value| {
            assert!(store.try_read().is_ok(), "resident comparison must not hold an exclusive lock");
            value.progress == 3
        }));
        let state = store.read().unwrap();
        assert_eq!((state.reads, state.writes, state.pressure_events), (0, 0, 0));
    }

    #[test]
    fn in_place_filter_preserves_order_across_evicted_pages_and_reuses_capacity() {
        for budget in [0, 2 * PAGE_BYTES] {
            let store = PageStore::new(budget);
            let original: Vec<_> = (0..10000u16).map(|i| ParetoValue::new(i, 10000 - i)).collect();
            let mut values = PagedVec::from_slice(store.clone(), &original);
            let capacity = values.capacity();
            values.retain(|value| value.progress % 3 == 0);
            let expected: Vec<_> = original.into_iter().filter(|value| value.progress % 3 == 0).collect();
            assert_eq!(values.to_vec(), expected);
            assert!(values.any(|value| value.progress == 9999));
            assert!(!values.any(|value| value.progress == 9998));
            values.retain(|_| false);
            assert!(!values.any(|_| true));
            values.extend_from_slice(&expected);
            assert_eq!(values.to_vec(), expected);
            assert_eq!(values.capacity(), capacity);
            let state = store.read().unwrap();
            if budget == 0 { assert_eq!((state.reads, state.writes), (0, 0)); }
            else { assert!(state.reads > 0 && state.writes > 0); }
        }
    }

    #[test]
    fn retained_reader_releases_its_guard_for_page_faults() {
        let store = PageStore::new(2 * PAGE_BYTES);
        let original: Vec<_> = (0..10000u16).map(|i| ParetoValue::new(i, 10000 - i)).collect();
        let values = PagedVec::from_slice(store.clone(), &original);
        {
            let mut reader = values.reader();
            for index in (0..original.len()).rev() { assert_eq!(reader.get(index), original[index]); }
        }
        assert!(store.read().unwrap().reads > 0);
        // Subsequent mutation/destruction must not retain the read guard.
        assert!(store.try_write().is_ok());
    }

    #[test]
    fn repeated_recovery_stops_at_minimum_and_pages_remain_readable() {
        assert_eq!(PageStore::new(0).write().unwrap().recover_allocation(1), 0);
        let shared = PageStore::new(0);
        let mut store = shared.write().unwrap();
        for i in 0..64u64 {
            let id = store.allocate();
            store.page(id).bytes.get_mut().unwrap()[..8].copy_from_slice(&i.to_le_bytes());
        }
        assert_eq!(store.resident, 64);
        let impossible = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            store.reserve_vec(&mut Vec::<u64>::new(), usize::MAX);
        }));
        assert!(impossible.is_err());
        assert_eq!(store.pressure_events, 1);
        assert_eq!(store.resident, 1);
        for i in (0..64u64).rev() { assert_eq!(&store.page(i).bytes.get_mut().unwrap()[..8], &i.to_le_bytes()); }
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
        let mut store = shared.write().unwrap();
        for i in 0..1024u64 {
            let id = store.allocate();
            store.page(id).bytes.get_mut().unwrap()[..8].copy_from_slice(&i.to_le_bytes());
        }
        assert_eq!(store.writes, 0);
        assert_eq!(store.pressure_events, 0);
        for i in 0..1024u64 { assert_eq!(&store.page(i).bytes.get_mut().unwrap()[..8], &i.to_le_bytes()); }
    }

    #[test]
    fn parallel_allocation_failure_recovers_and_preserves_all_records() {
        use rayon::prelude::*;
        let store = PageStore::new(0);
        store.write().unwrap().fail_page_allocation_after = Some(16);
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
        let state = store.write().unwrap();
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
        let mut store = shared.write().unwrap();
        store.fail_page_allocation_after = Some(16);
        for i in 0..256u64 {
            let id = store.allocate();
            store.page(id).bytes.get_mut().unwrap()[..8].copy_from_slice(&i.to_le_bytes());
        }
        assert_eq!(store.pressure_events, 1);
        assert!(store.writes > 0);
        for i in (0..256u64).rev() { assert_eq!(&store.page(i).bytes.get_mut().unwrap()[..8], &i.to_le_bytes()); }
        assert!(store.reads > 0);
        assert!(store.resident_bytes() <= 16 * PAGE_BYTES);
    }

    #[test]
    fn cold_pages_round_trip_and_reuse_without_losing_records() {
        let store = PageStore::new(8192);
        let mut values = PagedVec::new(store.clone());
        for i in 0..10000u16 { values.push(ParetoValue::new(i, 10000 - i)); }
        for i in (0..10000usize).rev() { assert_eq!(values.get(i), ParetoValue::new(i as u16, 10000 - i as u16)); }
        assert!(store.write().unwrap().reads > 0);
        assert!(store.write().unwrap().writes > 0);
        assert!(store.write().unwrap().disk_used_bytes() > 0);
        assert!(store.write().unwrap().resident_bytes() <= 8192);
        let high_water = store.write().unwrap().allocated_bytes();
        drop(values);
        assert_eq!(store.write().unwrap().disk_used_bytes(), 0);
        let mut reused = PagedVec::new(store.clone());
        for i in 0..10000u16 { reused.push(ParetoValue::new(i, i)); }
        assert_eq!(store.write().unwrap().allocated_bytes(), high_water);
        for i in 0..10000usize { assert_eq!(reused.get(i), ParetoValue::new(i as u16, i as u16)); }
    }

    #[test]
    fn disk_usage_counts_live_slots_instead_of_cumulative_writes() {
        let shared = PageStore::new(2 * PAGE_BYTES);
        let mut store = shared.write().unwrap();
        let ids: Vec<_> = (0..20).map(|_| store.allocate()).collect();
        let occupied = 18 * PAGE_BYTES as u64;
        assert_eq!(store.disk_used_bytes(), occupied);
        assert_eq!(store.disk_capacity_bytes(), 3 * 1024 * 1024 * 1024);
        for _ in 0..3 { for &id in &ids { let _ = store.page(id); } }
        assert!(store.writes * PAGE_BYTES as u64 > occupied);
        assert_eq!(store.disk_used_bytes(), occupied);
        assert_eq!(store.disk_high_water_bytes(), occupied);
        store.release(&ids);
        assert_eq!(store.disk_used_bytes(), 0);
        assert_eq!(store.disk_high_water_bytes(), occupied);
        let _ = store.allocate();
        assert_eq!(store.disk_used_bytes(), 0);
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
            assert_eq!(front.at_progress(0), Some(ParetoValue::new(0, i as u16)));
            assert_eq!(front.at_progress(49), Some(ParetoValue::new(49, i as u16)));
            assert_eq!(front.at_progress(99), Some(ParetoValue::new(99, i as u16)));
            assert_eq!(front.at_progress(100), None);
            assert_eq!(front.get(99), Some(ParetoValue::new(99, i as u16)));
            assert_eq!(front.get(100), None);
            let expected: Vec<_> = (0..100).map(|j| ParetoValue::new(j, i as u16)).collect();
            assert!(front.equals_slice(&expected));
            let mut appended = Vec::new();
            front.append_transformed(&mut appended, ParetoValue::new(0, 0));
            assert_eq!(appended, expected);
        }
        assert!(pool.store().write().unwrap().resident_bytes() <= 8192);
    }
}
