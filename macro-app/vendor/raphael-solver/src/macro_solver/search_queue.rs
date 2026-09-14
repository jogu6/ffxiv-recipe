// Modified by XIVca: browser execution and search storage integration.
use std::collections::{BTreeSet, hash_map::Entry};

use raphael_sim::SimulationState;
#[cfg(any(not(target_arch = "wasm32"), feature = "parallel"))]
use rayon::prelude::*;
use rustc_hash::FxHashMap;
use smallvec::SmallVec;
use web_time::Instant;

use crate::{
    SolverException, SolverSettings,
    actions::{ActionCombo, use_action_combo},
};

use super::pareto_front::ParetoFront;
use crate::memory::{SharedStore, PagedVec, Record, SpillVec};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct SearchScore {
    pub quality_upper_bound: u16,
    pub steps_lower_bound: u8,
    pub duration_lower_bound: u8,
    pub current_steps: u8,
    pub current_duration: u8,
}

impl SearchScore {
    pub const MIN: Self = Self {
        quality_upper_bound: 0,
        steps_lower_bound: u8::MAX,
        duration_lower_bound: u8::MAX,
        current_steps: u8::MAX,
        current_duration: u8::MAX,
    };

    pub const MAX: Self = Self {
        quality_upper_bound: u16::MAX,
        steps_lower_bound: 0,
        duration_lower_bound: 0,
        current_steps: 0,
        current_duration: 0,
    };
}

impl std::cmp::PartialOrd for SearchScore {
    fn partial_cmp(&self, other: &Self) -> Option<std::cmp::Ordering> {
        Some(std::cmp::Ord::cmp(self, other))
    }
}

impl std::cmp::Ord for SearchScore {
    fn cmp(&self, other: &Self) -> std::cmp::Ordering {
        self.quality_upper_bound
            .cmp(&other.quality_upper_bound)
            .then(other.steps_lower_bound.cmp(&self.steps_lower_bound))
            .then(other.duration_lower_bound.cmp(&self.duration_lower_bound))
            .then(other.current_steps.cmp(&self.current_steps))
            .then(other.current_duration.cmp(&self.current_duration))
    }
}

#[bitfield_struct::bitfield(u64)]
struct SearchNode {
    #[bits(58)]
    parent_idx: usize,
    #[bits(6)]
    action: ActionCombo,
}

impl Record for SearchNode {
    // A WASM parent is at most 32 bits. Five bytes preserve every parent and
    // all six action bits; four bytes would impose a 26-bit parent limit.
    const BYTES: usize = if cfg!(target_pointer_width = "32") { 5 } else { 8 };
    fn encode(self, target: &mut [u8]) {
        let bits = ((self.parent_idx() as u64) << 6) | self.action().into_bits() as u64;
        target.copy_from_slice(&bits.to_le_bytes()[..target.len()]);
    }
    fn decode(source: &[u8]) -> Self {
        let mut bytes = [0u8; 8];
        bytes[..source.len()].copy_from_slice(source);
        let bits = u64::from_le_bytes(bytes);
        Self::new().with_parent_idx((bits >> 6) as usize).with_action(ActionCombo::from_bits((bits & 63) as u8))
    }
}
impl Record for SimulationState {
    const BYTES: usize = 18;
    fn encode(self, target: &mut [u8]) {
        for (i, value) in [self.cp, self.durability, self.progress, self.quality, self.unreliable_quality].into_iter().enumerate() {
            target[i * 2..i * 2 + 2].copy_from_slice(&value.to_le_bytes());
        }
        target[10..18].copy_from_slice(&self.effects.into_bits().to_le_bytes());
    }
    fn decode(source: &[u8]) -> Self {
        let field = |i: usize| u16::from_le_bytes(source[i * 2..i * 2 + 2].try_into().unwrap());
        Self { cp: field(0), durability: field(1), progress: field(2), quality: field(3), unreliable_quality: field(4),
            effects: raphael_sim::Effects::from_bits(u64::from_le_bytes(source[10..18].try_into().unwrap())) }
    }
}
impl Record for (SearchNode, SimulationState) {
    const BYTES: usize = SearchNode::BYTES + SimulationState::BYTES;
    fn encode(self, target: &mut [u8]) {
        self.0.encode(&mut target[..SearchNode::BYTES]); self.1.encode(&mut target[SearchNode::BYTES..]);
    }
    fn decode(source: &[u8]) -> Self { (SearchNode::decode(&source[..SearchNode::BYTES]), SimulationState::decode(&source[SearchNode::BYTES..])) }
}
impl Record for (SimulationState, usize) {
    const BYTES: usize = SimulationState::BYTES + std::mem::size_of::<usize>();
    fn encode(self, target: &mut [u8]) {
        self.0.encode(&mut target[..SimulationState::BYTES]); target[SimulationState::BYTES..].copy_from_slice(&self.1.to_le_bytes());
    }
    fn decode(source: &[u8]) -> Self { (SimulationState::decode(&source[..SimulationState::BYTES]), usize::from_le_bytes(source[SimulationState::BYTES..].try_into().unwrap())) }
}
struct StoredBatch { nodes: PagedVec<SearchNode> }

// Exact reconstructed states scoped to one replay task. Collisions replace
// entries, never history records. Every new batch/generation starts empty.
struct ReplayCache { states: [Option<(usize, SimulationState)>; 256] }
impl ReplayCache {
    fn new() -> Self { Self { states: [None; 256] } }
    fn get(&self, id: usize) -> Option<SimulationState> {
        self.states[id % self.states.len()].filter(|entry| entry.0 == id).map(|entry| entry.1)
    }
    fn save(&mut self, id: usize, state: SimulationState) {
        let slot = id % self.states.len();
        self.states[slot] = Some((id, state));
    }
}

pub struct Batch {
    pub score: SearchScore,
    pub nodes: SpillVec<(SimulationState, usize)>,
}

#[derive(Debug, Clone, Copy, Default)]
pub struct SearchQueueStats {
    pub inserted_nodes: usize,
    pub processed_nodes: usize,
    // XIVca observation only: queue occupancy and cumulative wall-clock timings.
    pub queued_nodes: usize,
    pub popped_nodes: usize,
    pub dropped_nodes: usize,
    pub pareto_rejected_nodes: usize,
    pub visited_capacity_bytes: u64,
    pub queued_capacity_bytes: u64,
    pub replay_ms: f64,
    pub pareto_ms: f64,
    pub pareto_grouping_ms: f64,
    pub pareto_comparison_ms: f64,
    pub pareto_capacity_bytes: u64,
    pub storage_resident_bytes: u64,
    pub storage_allocated_bytes: u64,
    pub storage_disk_used_bytes: u64,
    pub storage_disk_high_water_bytes: u64,
    pub storage_disk_capacity_bytes: u64,
    pub storage_page_reads: u64,
    pub storage_page_writes: u64,
    pub storage_pressure_events: u64,
}

pub struct SearchQueue {
    settings: SolverSettings,
    pareto_front: ParetoFront,
    batch_ordering: BTreeSet<SearchScore>,
    batches: FxHashMap<SearchScore, StoredBatch>,
    visited_nodes: PagedVec<SearchNode>,
    store: SharedStore,
    num_inserted_nodes: usize,
    observation: SearchQueueStats,
    initial_state: SimulationState,
}

impl SearchQueue {
    pub fn store(&self) -> &SharedStore { &self.store }
    pub fn new(settings: SolverSettings, initial_state: SimulationState, bound_store: SharedStore) -> Self {
        let store = bound_store.clone();
        let mut search_queue = Self {
            settings,
            pareto_front: ParetoFront::new(bound_store.clone()),
            batch_ordering: BTreeSet::default(),
            batches: FxHashMap::default(),
            visited_nodes: PagedVec::new(store.clone()),
            store,
            num_inserted_nodes: 0,
            observation: SearchQueueStats::default(),
            initial_state,
        };
        let _ = search_queue.push(SearchScore::MAX, ActionCombo::None, 0);
        search_queue
    }

    pub fn push(
        &mut self,
        score: SearchScore,
        action: ActionCombo,
        parent_idx: usize,
    ) -> Result<(), SolverException> {
        let node = SearchNode::new()
            .with_parent_idx_checked(parent_idx)
            .map_err(|_| SolverException::SearchQueueCapacityExceeded)?
            .with_action(action);
        if self.batches.len() == self.batches.capacity() && self.batches.try_reserve(1).is_err() {
            let released = self.store.write().unwrap().recover_allocation(
                std::mem::size_of::<(SearchScore, StoredBatch)>());
            if released == 0 || self.batches.try_reserve(1).is_err() {
                return Err(SolverException::SearchQueueCapacityExceeded);
            }
        }
        match self.batches.entry(score) {
            Entry::Occupied(occupied_entry) => {
                let batch = occupied_entry.into_mut();
                batch.nodes.push(node);
            }
            Entry::Vacant(vacant_entry) => {
                self.batch_ordering.insert(score);
                let mut nodes = PagedVec::new(self.store.clone());
                nodes.push(node);
                vacant_entry.insert(StoredBatch { nodes });
            }
        }
        self.num_inserted_nodes += 1;
        self.observation.queued_nodes += 1;
        Ok(())
    }

    pub fn drop_nodes_below_score(&mut self, min_score: SearchScore) {
        let mut dropped = 0;
        while let Some(&score) = self.batch_ordering.first()
            && score < min_score
        {
            self.batch_ordering.pop_first();
            if let Some(batch) = self.batches.remove(&score) {
                dropped += batch.nodes.len();
            }
        }
        if dropped != 0 {
            self.observation.queued_nodes -= dropped;
            self.observation.dropped_nodes += dropped;
            log::trace!("{dropped} nodes dropped ({min_score:?})");
        }
    }

    pub fn pop_batch(&mut self, interrupt: &crate::AtomicFlag) -> Result<Option<Batch>, SolverException> {
        if interrupt.is_set() { return Err(SolverException::Interrupted); }
        let Some(score) = self.batch_ordering.pop_last() else { return Ok(None); };
        let stored = self.batches.remove(&score).unwrap();
        let count = stored.nodes.len();
        self.observation.queued_nodes -= count;
        self.observation.popped_nodes += count;
        crate::MEMORY_PHASE.store(1, std::sync::atomic::Ordering::Relaxed);
        let replay_started = Instant::now();
        crate::report_work(1, 0, count);
        let mut decoded = SpillVec::with_capacity(self.store.clone(), count);
        let replay = |cache: &mut ReplayCache, node: SearchNode| {
            let state = self.restore_parent(node.parent_idx(), cache);
            (node, use_action_combo(&self.settings, state, node.action()).unwrap())
        };
        match &mut decoded {
            SpillVec::Resident(values) => {
                // Decode each source page once when a temporary RAM snapshot
                // fits. Failure falls back to direct page reads without retry.
                let mut nodes = Vec::new();
                if nodes.try_reserve_exact(count).is_ok() {
                    stored.nodes.append_range(0, count, &mut nodes, |node| node);
                    #[cfg(any(not(target_arch = "wasm32"), feature = "parallel"))]
                    let reconstructed = nodes.into_par_iter().map_init(ReplayCache::new, replay);
                    #[cfg(all(target_arch = "wasm32", not(feature = "parallel")))]
                    let reconstructed = nodes.into_iter().enumerate().scan(ReplayCache::new(), |cache, (index, node)| {
                        let value = replay(cache, node);
                        crate::report_work(1, index + 1, count);
                        Some(value)
                    });
                    #[cfg(any(not(target_arch = "wasm32"), feature = "parallel"))]
                    reconstructed.collect_into_vec(values);
                    #[cfg(all(target_arch = "wasm32", not(feature = "parallel")))]
                    values.extend(reconstructed);
                } else {
                    #[cfg(any(not(target_arch = "wasm32"), feature = "parallel"))]
                    let reconstructed = (0..count).into_par_iter().map_init(ReplayCache::new, |cache, index| replay(cache, stored.nodes.get(index)));
                    #[cfg(all(target_arch = "wasm32", not(feature = "parallel")))]
                    let reconstructed = (0..count).scan(ReplayCache::new(), |cache, index| {
                        let value = replay(cache, stored.nodes.get(index));
                        crate::report_work(1, index + 1, count);
                        Some(value)
                    });
                    #[cfg(any(not(target_arch = "wasm32"), feature = "parallel"))]
                    reconstructed.collect_into_vec(values);
                    #[cfg(all(target_arch = "wasm32", not(feature = "parallel")))]
                    values.extend(reconstructed);
                }
            }
            SpillVec::Stored(values) => {
                let mut previous = ReplayCache::new();
                for index in 0..count {
                    if interrupt.is_set() { return Err(SolverException::Interrupted); }
                    values.push(replay(&mut previous, stored.nodes.get(index)));
                    crate::report_work(1, index + 1, count);
                }
            }
        }
        drop(stored);
        self.observation.replay_ms += replay_started.elapsed().as_secs_f64() * 1000.0;
        crate::MEMORY_PHASE.store(2, std::sync::atomic::Ordering::Relaxed);
        let pareto_started = Instant::now();
        let output = match decoded {
            SpillVec::Resident(values) => {
                let groups = self.pareto_front.insert_batch(values, |expanded| &expanded.1, interrupt)?;
                let mut output = SpillVec::with_capacity(self.store.clone(), groups.iter().map(SpillVec::len).sum());
                for group in groups {
                    for index in 0..group.len() {
                        let (node, state) = group.get(index);
                        let visited_index = self.visited_nodes.len();
                        self.visited_nodes.push(node);
                        output.push((state, visited_index), &self.store);
                    }
                }
                output
            }
            mut stored => {
                let mut output = SpillVec::Stored(PagedVec::new(self.store.clone()));
                // The full score bucket is sorted before any node is expanded,
                // even when it cannot fit in a single contiguous allocation.
                stored.sort_by_key(|expanded| ParetoFront::sort_key(&expanded.1), interrupt)?;
                crate::report_work(3, 0, stored.len());
                for index in 0..stored.len() {
                    if interrupt.is_set() { return Err(SolverException::Interrupted); }
                    let (node, state) = stored.get(index);
                    if self.pareto_front.insert_sorted(&state) {
                        let visited_index = self.visited_nodes.len();
                        self.visited_nodes.push(node);
                        output.push((state, visited_index), &self.store);
                    }
                    crate::report_work(3, index + 1, stored.len());
                }
                output
            }
        };
        self.observation.pareto_ms += pareto_started.elapsed().as_secs_f64() * 1000.0;
        self.observation.pareto_rejected_nodes += count - output.len();
        Ok(Some(Batch { score, nodes: output }))
    }

    fn restore_parent(&self, mut idx: usize, cache: &mut ReplayCache) -> SimulationState {
        let mut pending = SmallVec::<[(usize, ActionCombo); 56]>::new();
        let mut state = self.initial_state;
        'history: while idx > 0 {
            if let Some(cached) = cache.get(idx) { state = cached; break; }
            if pending.try_reserve(1).is_err() {
                let released = self.store.write().unwrap().recover_allocation(std::mem::size_of::<(usize, ActionCombo)>());
                assert!(released > 0 && pending.try_reserve(1).is_ok(), "候補復元用の作業メモリーを確保できません");
            }
            // Release the page reader before any scratch allocation/recovery.
            let mut reader = self.visited_nodes.reader();
            while idx > 0 && pending.len() < pending.capacity() {
                if let Some(cached) = cache.get(idx) { state = cached; break 'history; }
                let node = reader.get(idx);
                pending.push((idx, node.action()));
                idx = node.parent_idx();
            }
        }
        for (id, action) in pending.into_iter().rev() {
            state = use_action_combo(&self.settings, state, action).unwrap();
            cache.save(id, state);
        }
        state
    }

    pub fn get_actions_from_node_idx(&self, mut idx: usize) -> SmallVec<[ActionCombo; 56]> {
        let mut actions = SmallVec::new();
        while idx > 0 {
            if actions.try_reserve(1).is_err() {
                let released = self.store.write().unwrap().recover_allocation(std::mem::size_of::<ActionCombo>());
                assert!(released > 0 && actions.try_reserve(1).is_ok(),
                    "マクロ復元用の作業メモリーを確保できません");
            }
            let mut reader = self.visited_nodes.reader();
            while idx > 0 && actions.len() < actions.capacity() {
                let search_node = reader.get(idx);
                actions.push(search_node.action());
                idx = search_node.parent_idx();
            }
        }
        actions.reverse();
        actions
    }

    pub fn runtime_stats(&self) -> SearchQueueStats {
        let store = self.store.read().unwrap();
        SearchQueueStats {
            pareto_grouping_ms: self.pareto_front.grouping_ms,
            pareto_comparison_ms: self.pareto_front.comparison_ms,
            inserted_nodes: self.num_inserted_nodes,
            processed_nodes: self.visited_nodes.len(),
            visited_capacity_bytes: (self.visited_nodes.capacity() * SearchNode::BYTES) as u64,
            queued_capacity_bytes: self.batches.values().map(|batch| batch.nodes.capacity() * SearchNode::BYTES).sum::<usize>() as u64,
            storage_resident_bytes: store.resident_bytes() as u64,
            storage_allocated_bytes: store.allocated_bytes(),
            storage_disk_used_bytes: store.disk_used_bytes(),
            storage_disk_high_water_bytes: store.disk_high_water_bytes(),
            storage_disk_capacity_bytes: store.disk_capacity_bytes(),
            storage_page_reads: store.reads,
            storage_page_writes: store.writes,
            storage_pressure_events: store.pressure_events,
            ..self.observation
        }
    }

    pub fn measure_pareto_bytes(&self) -> u64 {
        self.pareto_front.allocated_bytes() as u64
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn settings() -> SolverSettings {
        SolverSettings { simulator_settings: raphael_sim::Settings {
            max_cp: 400, max_durability: 70, max_progress: 4000, max_quality: 7000,
            base_progress: 301, base_quality: 296, job_level: 100,
            allowed_actions: crate::test_utils::REGULAR_ACTIONS, adversarial: true,
            stellar_steady_hand_charges: 0, backload_progress: false,
        }, allow_non_max_quality_solutions: false }
    }

    #[test]
    fn whole_score_bucket_is_consumed_without_a_65536_node_boundary() {
        for (count, paged) in [(65537, false), (257, true)] {
            let settings = settings();
            let state = SimulationState::new(&settings.simulator_settings);
            let store = crate::memory::PageStore::new(if paged { 8192 } else { 0 });
            store.write().unwrap().force_paged_scratch = paged;
            let mut queue = SearchQueue::new(settings, state, store.clone());
            for _ in 1..count { queue.push(SearchScore::MAX, ActionCombo::None, 0).unwrap(); }
            let batch = queue.pop_batch(&crate::AtomicFlag::new()).unwrap().unwrap();
            assert_eq!(batch.nodes.len(), 1);
            assert_eq!(batch.nodes.get(0).0, state);
            let stats = queue.runtime_stats();
            assert_eq!(stats.popped_nodes, count);
            assert_eq!(stats.pareto_rejected_nodes, count - 1);
            assert_eq!(stats.queued_nodes, 0);
            assert!(queue.pop_batch(&crate::AtomicFlag::new()).unwrap().is_none());
        }
    }

    #[test]
    fn replay_cache_preserves_states_across_branches_collisions_and_eviction() {
        for bytes in [0, 8192] {
            let settings = settings();
            let initial = SimulationState::new(&settings.simulator_settings);
            let mut queue = SearchQueue::new(settings, initial, crate::memory::PageStore::new(bytes));
            queue.visited_nodes.push(SearchNode::new().with_action(ActionCombo::None));
            for id in 1..1800 {
                let parent = if id < 80 { id - 1 } else if id % 3 == 0 { id / 3 } else { 0 };
                let action = if parent == 0 { ActionCombo::Single(raphael_sim::Action::Reflect) } else { ActionCombo::None };
                queue.visited_nodes.push(SearchNode::new().with_parent_idx(parent).with_action(action));
            }
            let mut cache = ReplayCache::new();
            for id in (0..1800).chain((0..1800).rev()).chain([1, 257, 1, 513, 1799]) {
                let mut expected = initial;
                for action in queue.get_actions_from_node_idx(id) { expected = use_action_combo(&settings, expected, action).unwrap(); }
                assert_eq!(queue.restore_parent(id, &mut cache), expected);
            }
            // A fully cached parent needs no page lock.
            let expected = queue.restore_parent(1799, &mut cache);
            let guard = queue.store.write().unwrap();
            assert_eq!(queue.restore_parent(1799, &mut cache), expected);
            drop(guard);
        }
    }

    #[test]
    fn expanded_records_keep_every_state_field_and_full_parent_index() {
        let state = SimulationState { cp: 65535, durability: 65534, progress: 65533,
            quality: 65532, unreliable_quality: 65531, effects: raphael_sim::Effects::from_bits(u64::MAX) };
        let original = (state, usize::MAX);
        let mut bytes = vec![0; <(SimulationState, usize)>::BYTES];
        original.encode(&mut bytes);
        assert_eq!(<(SimulationState, usize)>::decode(&bytes), original);
    }

    #[test]
    fn five_byte_nodes_preserve_all_wasm_parent_bits_and_actions() {
        for parent in [0, (1 << 26) - 1, 1 << 26, u32::MAX as usize] {
            for action in std::iter::once(ActionCombo::None).chain(crate::actions::FULL_SEARCH_ACTIONS) {
                let node = SearchNode::new().with_parent_idx_checked(parent).unwrap().with_action(action);
                let mut bytes = [0u8; 5];
                node.encode(&mut bytes);
                let decoded = SearchNode::decode(&bytes);
                assert_eq!(decoded.parent_idx(), parent);
                assert_eq!(decoded.action(), action);
            }
        }
    }

    #[test]
    fn five_byte_nodes_round_trip_across_page_boundaries_and_eviction() {
        #[derive(Clone, Copy)]
        struct CompactNode(SearchNode);
        impl Record for CompactNode {
            const BYTES: usize = 5;
            fn encode(self, target: &mut [u8]) { self.0.encode(target); }
            fn decode(source: &[u8]) -> Self { Self(SearchNode::decode(source)) }
        }
        let store = crate::memory::PageStore::new(8192);
        let mut nodes = PagedVec::new(store.clone());
        let actions = crate::actions::FULL_SEARCH_ACTIONS;
        for i in 0..10000usize {
            nodes.push(CompactNode(SearchNode::new().with_parent_idx(u32::MAX as usize - i)
                .with_action(actions[i % actions.len()])));
        }
        for i in (0..10000usize).rev() {
            let node = nodes.get(i).0;
            assert_eq!(node.parent_idx(), u32::MAX as usize - i);
            assert_eq!(node.action(), actions[i % actions.len()]);
        }
        let state = store.read().unwrap();
        assert!(state.reads > 0 && state.writes > 0);
    }
}
