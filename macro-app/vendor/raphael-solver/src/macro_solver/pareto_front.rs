// Modified by XIVca: browser execution and search storage integration.
use std::sync::Mutex;
use crate::memory::{SharedStore, PagedVec, Record, SpillVec, reserve_vec, reserve_map};

use raphael_sim::{Effects, SimulationState};
#[cfg(any(not(target_arch = "wasm32"), feature = "parallel"))]
use rayon::prelude::*;
#[cfg(all(target_arch = "wasm32", not(feature = "parallel")))]
use crate::sequential::*;
use rustc_hash::FxHashMap;

// It is important that this mask doesn't use any effect to its full bit range.
// Otherwise, `Value::effect_dominates` will break.
const EFFECTS_VALUE_MASK: u64 = Effects::new()
    .with_inner_quiet(1)
    .with_manipulation(3)
    .with_waste_not(3)
    .with_great_strides(1)
    .with_veneration(3)
    .with_innovation(3)
    .into_bits();

const EFFECTS_KEY_MASK: u64 = !EFFECTS_VALUE_MASK;

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, PartialOrd, Ord, Hash)]
struct Key {
    progress: u16,
    effects: u64,
}

impl From<&SimulationState> for Key {
    fn from(state: &SimulationState) -> Self {
        Self {
            progress: state.progress,
            effects: state.effects.into_bits() & EFFECTS_KEY_MASK,
        }
    }
}

#[derive(Debug, Clone, Copy)]
struct Value(wide::u32x4);

impl Value {
    /// Guard value for Pareto-dominance check.
    /// Value A dominates B is subtracting B from A leaves the guard bits unchanged.
    const GUARD: wide::u32x4 = {
        // The effect bits used for comparison are truncated to 32 bits to make
        // everything fit into a 128-bit SIMD value.
        // The asserts make sure that no information is lost when truncating.
        assert!(EFFECTS_KEY_MASK >> 32 == 0xffffffff);
        assert!(EFFECTS_VALUE_MASK >> 32 == 0x00000000);
        wide::u32x4::new([
            0x80008000,              // CP and Durability
            0x80000000,              // Quality
            0x80000000,              // Unreliable quality
            EFFECTS_KEY_MASK as u32, // Effects
        ])
    };

    /// `A` dominates `B` if every member of `A` is geq the corresponding member in `B`.
    fn dominates(&self, other: &Self) -> bool {
        let guarded_value = Self::GUARD | self.0;
        // Keep the comparison in SIMD registers. wide's WASM PartialEq
        // otherwise emits an out-of-line call with a spill/reload per value.
        ((guarded_value - other.0) & Self::GUARD).simd_eq(Self::GUARD).all()
    }

    fn cp(&self) -> u16 {
        (self.0.as_array()[0] >> 16) as u16
    }
}

impl From<&SimulationState> for Value {
    fn from(state: &SimulationState) -> Self {
        Self(wide::u32x4::new([
            (u32::from(state.cp) << 16) + u32::from(state.durability),
            u32::from(state.quality),
            u32::from(state.quality) + u32::from(state.unreliable_quality),
            (state.effects.into_bits() & EFFECTS_VALUE_MASK) as u32,
        ]))
    }
}

impl Record for Value {
    const BYTES: usize = 16;
    fn encode(self, target: &mut [u8]) {
        for (index, value) in self.0.as_array().iter().enumerate() {
            target[index * 4..index * 4 + 4].copy_from_slice(&value.to_le_bytes());
        }
    }
    fn decode(source: &[u8]) -> Self {
        Self(wide::u32x4::new(std::array::from_fn(|index|
            u32::from_le_bytes(source[index * 4..index * 4 + 4].try_into().unwrap()))))
    }
}

struct IntermediateNode {
    partition_point: u16,
    lhs: Box<TreeNode>,
    rhs: Box<TreeNode>,
}

struct LeafNode {
    range_min: u16,
    range_max: u16,
    values: PagedVec<Value>,
    cache: Option<Vec<Value>>,
    cache_attempted: bool,
    cache_dirty: bool,
}

impl LeafNode {
    fn prepare_cache(&mut self) {
        if self.cache_attempted { return; }
        self.cache_attempted = true;
        #[cfg(test)]
        if self.values.store().read().unwrap().force_paged_scratch { return; }
        let mut values = Vec::new();
        // One attempt per leaf/key group. Failure retains the paged path.
        if values.try_reserve_exact(self.values.len().max(256)).is_err() { return; }
        self.values.append_range(0, self.values.len(), &mut values, |value| value);
        self.cache = Some(values);
    }
    fn flush_cache(&mut self) {
        if let Some(values) = self.cache.take() && self.cache_dirty { self.values.replace_from_slice(&values); }
        self.cache_attempted = false;
        self.cache_dirty = false;
    }
    fn len(&self) -> usize { self.cache.as_ref().map_or_else(|| self.values.len(), Vec::len) }
    fn insert(&mut self, value: Value, cache_allowed: bool) -> bool {
        if cache_allowed { self.prepare_cache(); }
        if let Some(values) = &mut self.cache {
            if values.iter().any(|previous| previous.dominates(&value)) { return false; }
            self.cache_dirty = true;
            values.retain(|previous| !value.dominates(previous));
            if values.len() < values.capacity() || values.try_reserve(1).is_ok() {
                values.push(value);
                return true;
            }
            // Persist every retained value before using the recovery-capable store.
            self.flush_cache();
            self.cache_attempted = true;
        }
        self.values.insert_non_dominated(value, |a, b| a.dominates(&b))
    }
}

enum TreeNode {
    Intermediate(IntermediateNode),
    Leaf(LeafNode),
}

impl TreeNode {
    fn flush_caches(&mut self) {
        match self {
            Self::Leaf(leaf) => leaf.flush_cache(),
            Self::Intermediate(branch) => { branch.lhs.flush_caches(); branch.rhs.flush_caches(); }
        }
    }
    fn new(store: SharedStore) -> Self {
        Self::Leaf(LeafNode {
            range_min: u16::MIN,
            range_max: u16::MAX,
            values: PagedVec::new(store),
            cache: None, cache_attempted: false, cache_dirty: false,
        })
    }
}

pub struct ParetoFront {
    store: SharedStore,
    buckets: FxHashMap<Key, Mutex<TreeNode>>,
    pub grouping_ms: f64,
    pub comparison_ms: f64,
}

impl ParetoFront {
    pub fn new(store: SharedStore) -> Self { Self { store, buckets: FxHashMap::default(), grouping_ms: 0.0, comparison_ms: 0.0 } }
    pub fn allocated_bytes(&self) -> usize {
        fn tree_bytes(node: &TreeNode) -> usize {
            match node {
                TreeNode::Leaf(leaf) => leaf.values.capacity() * std::mem::size_of::<Value>(),
                TreeNode::Intermediate(branch) => 2 * std::mem::size_of::<TreeNode>()
                    + tree_bytes(&branch.lhs) + tree_bytes(&branch.rhs),
            }
        }
        self.buckets.capacity() * std::mem::size_of::<(Key, Mutex<TreeNode>)>()
            + self.buckets.values().map(|node| tree_bytes(&node.lock().unwrap())).sum::<usize>()
    }
    /// Inserts all non-dominated elements into the pareto front while also removing dominated values
    /// from the pareto front. Returns an iterator over elements that were inserted.
    pub fn insert_batch<T: Record + Send + Sync>(
        &mut self,
        mut elements: Vec<T>,
        to_state: impl Fn(&T) -> &SimulationState + Sync,
        interrupt: &crate::AtomicFlag,
    ) -> Result<Vec<SpillVec<T>>, crate::SolverException> {
        // Preserve Raphael's whole-score grouping, then descending weight
        // within each key. Storage allocation failures never split that group.
        let grouping_started = web_time::Instant::now();
        elements.par_sort_unstable_by_key(|element| Key::from(to_state(element)));
        let mut groups = Vec::new();
        let mut end = elements.len();
        while end > 0 {
            let key = Key::from(to_state(&elements[end - 1]));
            let mut start = end - 1;
            while start > 0 && Key::from(to_state(&elements[start - 1])) == key { start -= 1; }
            reserve_vec(&self.store, &mut groups, 1);
            groups.push((key, start, end));
            end = start;
        }
        let missing = groups.iter().filter(|(key, _, _)| !self.buckets.contains_key(key)).count();
        reserve_map(&self.store, &mut self.buckets, missing);
        for (key, _, _) in &groups {
            self.buckets.entry(*key).or_insert_with(|| Mutex::new(TreeNode::new(self.store.clone())));
        }
        let mut results = Vec::new();
        reserve_vec(&self.store, &mut results, groups.len());
        self.grouping_ms += grouping_started.elapsed().as_secs_f64() * 1000.0;
        let comparison_started = web_time::Instant::now();
        #[cfg(all(target_arch = "wasm32", not(feature = "parallel")))]
        let comparison_completed = std::cell::Cell::new(0_usize);
        crate::report_work(3, 0, elements.len());
        let computed = groups.into_par_iter().with_max_len(1).map(|(key, start, end)| {
            let mut copied = SpillVec::with_capacity(self.store.clone(), end - start);
            for &element in &elements[start..end] { copied.push(element, &self.store); }
            copied.sort_by_key(|element| std::cmp::Reverse(Self::weight(to_state(element))), interrupt)?;
            let mut root = self.buckets.get(&key).unwrap().lock().unwrap();
            let mut kept = 0;
            let compared = copied.len();
            crate::report_work(3, 0, compared);
            for index in 0..copied.len() {
                if interrupt.is_set() { return Err(crate::SolverException::Interrupted); }
                let element = copied.get(index);
                if Self::insert(to_state(&element), &mut root, true) {
                    copied.set(kept, element);
                    kept += 1;
                }
                if index % 256 == 255 { crate::LIVE_SEARCH_ACTIVITY.fetch_add(256, std::sync::atomic::Ordering::Relaxed); }
                crate::report_work(3, index + 1, compared);
            }
            crate::LIVE_SEARCH_ACTIVITY.fetch_add(compared % 256, std::sync::atomic::Ordering::Relaxed);
            #[cfg(all(target_arch = "wasm32", not(feature = "parallel")))]
            {
                let previous = comparison_completed.get();
                let completed = previous + compared;
                comparison_completed.set(completed);
                if completed == elements.len() || completed / 4096 != previous / 4096 {
                    crate::report_work(3, if completed == elements.len() { completed } else { completed / 4096 * 4096 }, elements.len());
                }
            }
            root.flush_caches();
            match &mut copied {
                SpillVec::Resident(values) => values.truncate(kept),
                SpillVec::Stored(values) => values.truncate(kept),
            }
            Ok(copied)
        });
        #[cfg(any(not(target_arch = "wasm32"), feature = "parallel"))]
        computed.collect_into_vec(&mut results);
        #[cfg(all(target_arch = "wasm32", not(feature = "parallel")))]
        results.extend(computed);
        self.comparison_ms += comparison_started.elapsed().as_secs_f64() * 1000.0;
        let mut output = Vec::new();
        reserve_vec(&self.store, &mut output, results.len());
        for result in results { output.push(result?); }
        Ok(output)
    }

    fn weight(state: &SimulationState) -> u64 {
        u64::from(state.cp) + u64::from(state.durability) + u64::from(state.quality)
            + u64::from(state.unreliable_quality) + state.effects.into_bits()
    }
    pub(super) fn sort_key(state: &SimulationState) -> impl Ord + Send + use<> {
        // The same comparison order as insert_batch, including descending keys.
        (std::cmp::Reverse(Key::from(state)), std::cmp::Reverse(Self::weight(state)))
    }
    pub(super) fn insert_sorted(&mut self, state: &SimulationState) -> bool {
        let key = Key::from(state);
        if !self.buckets.contains_key(&key) {
            reserve_map(&self.store, &mut self.buckets, 1);
        }
        let root = self.buckets.entry(key).or_insert_with(|| Mutex::new(TreeNode::new(self.store.clone())));
        let inserted = Self::insert(state, root.get_mut().unwrap(), false);
        crate::LIVE_SEARCH_ACTIVITY.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        inserted
    }

    fn insert(state: &SimulationState, mut node: &mut TreeNode, cache_allowed: bool) -> bool {
        const MAX_LEAF_SIZE: usize = 200;
        let new_value = Value::from(state);
        while let TreeNode::Intermediate(intermediate) = node {
            if new_value.cp() < intermediate.partition_point {
                node = intermediate.lhs.as_mut();
            } else {
                node = intermediate.rhs.as_mut();
            }
        }
        if let TreeNode::Leaf(leaf) = node {
            let inserted = leaf.insert(new_value, cache_allowed);
            if leaf.len() > MAX_LEAF_SIZE && leaf.range_min + 1 != leaf.range_max {
                let mut values = leaf.cache.take().unwrap_or_else(|| leaf.values.to_vec());
                values.sort_unstable_by_key(Value::cp);
                let (lhs_values, rhs_values) = values.split_at(MAX_LEAF_SIZE / 2);
                let store = leaf.values.store();
                let partition_point = rhs_values[0].cp();
                *node = TreeNode::Intermediate(IntermediateNode {
                    partition_point,
                    lhs: Box::new(TreeNode::Leaf(LeafNode {
                        range_min: leaf.range_min,
                        range_max: partition_point,
                        values: PagedVec::from_slice(store.clone(), lhs_values),
                        cache: None, cache_attempted: false, cache_dirty: false,
                    })),
                    rhs: Box::new(TreeNode::Leaf(LeafNode {
                        range_min: partition_point,
                        range_max: leaf.range_max,
                        values: PagedVec::from_slice(store.clone(), rhs_values),
                        cache: None, cache_attempted: false, cache_dirty: false,
                    })),
                });
            }
            inserted
        } else {
            unreachable!()
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::memory::PageStore;

    #[test]
    fn simd_dominance_matches_each_original_guarded_lane() {
        let mut seed = 0x92d68ca2u32;
        let mut next = || { seed = seed.wrapping_mul(1664525).wrapping_add(1013904223); seed };
        for _ in 0..10000 {
            let a = Value(wide::u32x4::new(std::array::from_fn(|_| next())));
            let b = Value(wide::u32x4::new(std::array::from_fn(|_| next())));
            let expected = (0..4).all(|i| {
                let guard = Value::GUARD.as_array()[i];
                (a.0.as_array()[i] | guard).wrapping_sub(b.0.as_array()[i]) & guard == guard
            });
            assert_eq!(a.dominates(&b), expected);
        }
    }

    #[test]
    fn later_stronger_candidate_is_compared_before_any_weaker_candidate_is_returned() {
        let weak = SimulationState { cp: 100, durability: 40, progress: 100,
            quality: 100, unreliable_quality: 0, effects: Effects::new() };
        let strong = SimulationState { cp: 101, quality: 101, ..weak };
        let mut input = vec![weak; 65536];
        input.push(strong);
        let flag = crate::AtomicFlag::new();
        let store = PageStore::new(0);
        let mut front = ParetoFront::new(store);
        let result = front.insert_batch(input, |state| state, &flag).unwrap();
        let states: Vec<_> = result.iter().flat_map(|group| (0..group.len()).map(|i| group.get(i))).collect();
        assert_eq!(states, [strong]);
    }

    #[test]
    fn scoped_cache_flush_preserves_split_fronts_across_batches() {
        let state = |i: u16| SimulationState { cp: 100 + i, durability: 40, progress: 100,
            quality: 3000 - i * 2, unreliable_quality: 0, effects: Effects::new() };
        let flag = crate::AtomicFlag::new();
        for cached in [true, false] {
            let store = PageStore::new(8192);
            store.write().unwrap().force_paged_scratch = !cached;
            let mut front = ParetoFront::new(store);
            let mut seen = Vec::<SimulationState>::new();
            for input in [(0..400).map(state).collect::<Vec<_>>(), (200..600).map(state).collect(),
                (100..800).map(state).collect(), vec![SimulationState { cp: 3000, quality: 4000, ..state(0) }],
                (0..800).map(state).collect()] {
                let mut ordered = input.clone();
                ordered.sort_unstable_by_key(ParetoFront::sort_key);
                let mut expected = Vec::new();
                for value in ordered {
                    if !seen.iter().any(|previous| Value::from(previous).dominates(&Value::from(&value))) {
                        seen.retain(|previous| !Value::from(&value).dominates(&Value::from(previous)));
                        seen.push(value); expected.push(value);
                    }
                }
                let groups = front.insert_batch(input, |state| state, &flag).unwrap();
                let actual: Vec<_> = groups.iter().flat_map(|group| (0..group.len()).map(|i| group.get(i))).collect();
                assert_eq!(actual, expected);
                fn flushed(node: &TreeNode) -> bool {
                    match node {
                        TreeNode::Leaf(leaf) => leaf.cache.is_none(),
                        TreeNode::Intermediate(branch) => flushed(&branch.lhs) && flushed(&branch.rhs),
                    }
                }
                assert!(front.buckets.values().all(|root| flushed(&root.lock().unwrap())));
            }
        }
    }

    #[test]
    fn ram_and_spilled_comparisons_match_a_direct_dominance_reference() {
        let input: Vec<_> = (0..600u16).map(|i| SimulationState {
            cp: 100 + i % 41, durability: 40 + i % 3, progress: i % 7,
            quality: (i * 83) % 997, unreliable_quality: i % 5, effects: Effects::new(),
        }).collect();
        let mut ordered = input.clone();
        ordered.sort_unstable_by_key(ParetoFront::sort_key);
        let mut expected = Vec::<SimulationState>::new();
        for state in ordered {
            if !expected.iter().any(|previous| Key::from(previous) == Key::from(&state)
                && Value::from(previous).dominates(&Value::from(&state))) { expected.push(state); }
        }
        let flag = crate::AtomicFlag::new();
        for paged in [false, true] {
            let store = PageStore::new(if paged { 8192 } else { 0 });
            store.write().unwrap().force_paged_scratch = paged;
            let mut front = ParetoFront::new(store.clone());
            let groups = front.insert_batch(input.clone(), |state| state, &flag).unwrap();
            let actual: Vec<_> = groups.iter().flat_map(|group| (0..group.len()).map(|i| group.get(i))).collect();
            assert_eq!(actual, expected);
        }
    }
}
