use std::collections::{BTreeSet, hash_map::Entry};

use raphael_sim::SimulationState;
#[cfg(not(target_arch = "wasm32"))]
use rayon::prelude::*;
#[cfg(target_arch = "wasm32")]
use crate::sequential::*;
use rustc_hash::FxHashMap;
use smallvec::SmallVec;
use web_time::Instant;

use crate::{
    SolverException, SolverSettings,
    actions::{ActionCombo, use_action_combo},
};

use super::pareto_front::ParetoFront;
use crate::memory::{SharedStore, PagedVec, Record};

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
    const BYTES: usize = 8;
    fn encode(self, target: &mut [u8]) {
        let bits = ((self.parent_idx() as u64) << 6) | self.action().into_bits() as u64;
        target.copy_from_slice(&bits.to_le_bytes());
    }
    fn decode(source: &[u8]) -> Self {
        let bits = u64::from_le_bytes(source.try_into().unwrap());
        Self::new().with_parent_idx((bits >> 6) as usize).with_action(ActionCombo::from_bits((bits & 63) as u8))
    }
}
struct StoredBatch { nodes: PagedVec<SearchNode>, cursor: usize }

#[derive(Debug)]
pub struct Batch {
    pub score: SearchScore,
    pub nodes: Vec<(SimulationState, usize)>,
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
    pub pareto_capacity_bytes: u64,
    pub storage_resident_bytes: u64,
    pub storage_allocated_bytes: u64,
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
    pub fn recover_allocation(&self) { self.store.lock().unwrap().recover_allocation(); }
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
            while self.batches.try_reserve(1).is_err() {
                if self.store.lock().unwrap().recover_allocation() == 0 {
                    return Err(SolverException::SearchQueueCapacityExceeded);
                }
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
                vacant_entry.insert(StoredBatch { nodes, cursor: 0 });
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
                dropped += batch.nodes.len() - batch.cursor;
            }
        }
        if dropped != 0 {
            self.observation.queued_nodes -= dropped;
            self.observation.dropped_nodes += dropped;
            log::trace!("{dropped} nodes dropped ({min_score:?})");
        }
    }

    pub fn pop_batch(&mut self) -> Option<Batch> {
        if let Some(&score) = self.batch_ordering.last()
        {
            let stored = self.batches.get_mut(&score).unwrap();
            // Preserve Raphael's complete score batch while its working arrays
            // can be allocated. Subdivide only after allocation pressure.
            let mut count = stored.nodes.len() - stored.cursor;
            if self.store.lock().unwrap().pressure_events > 0 { count = count.min(4096); }
            let (mut batch, mut decoded, mut output) = loop {
                let mut nodes = Vec::<SearchNode>::new();
                let mut states = Vec::<(SearchNode, SimulationState)>::new();
                let mut output = Vec::<(SimulationState, usize)>::new();
                if nodes.try_reserve_exact(count).is_ok() && states.try_reserve_exact(count).is_ok()
                    && output.try_reserve_exact(count).is_ok() {
                    break (nodes, states, output);
                }
                drop(nodes); drop(states); drop(output);
                let released = self.store.lock().unwrap().recover_allocation();
                assert!(count > 1 || released > 0, "最小の探索作業メモリーを確保できません");
                count = (count / 2).max(1);
            };
            let end = stored.cursor + count;
            batch.extend((stored.cursor..end).map(|index| stored.nodes.get(index)));
            stored.cursor = end;
            if end == stored.nodes.len() {
                self.batches.remove(&score);
                self.batch_ordering.pop_last();
            }
            self.observation.queued_nodes -= batch.len();
            self.observation.popped_nodes += batch.len();
            let popped_count = batch.len();
            let replay_started = Instant::now();
            // Nodes store only the previous action and parent index; replay reconstructs the state.
            let reconstructed = batch
                .into_par_iter()
                .map(|search_node| {
                    let mut state = self.initial_state;
                    let actions = self.get_actions_from_node_idx(search_node.parent_idx());
                    for action in actions {
                        state = use_action_combo(&self.settings, state, action).unwrap();
                    }
                    state = use_action_combo(&self.settings, state, search_node.action()).unwrap();
                    (search_node, state)
                });
            #[cfg(target_arch = "wasm32")]
            decoded.extend(reconstructed);
            #[cfg(not(target_arch = "wasm32"))]
            reconstructed.collect_into_vec(&mut decoded);
            // Filter out Pareto-dominated nodes.
            self.observation.replay_ms += replay_started.elapsed().as_secs_f64() * 1000.0;
            let pareto_started = Instant::now();
            let visited_begin = self.visited_nodes.len();
            for (node, state) in self.pareto_front.insert_batch(decoded, |expanded_node| &expanded_node.1) {
                let index = visited_begin + output.len();
                self.visited_nodes.push(node);
                output.push((state, index));
            }
            self.observation.pareto_ms += pareto_started.elapsed().as_secs_f64() * 1000.0;
            self.observation.pareto_rejected_nodes += popped_count - output.len();
            let batch = Batch { score, nodes: output };
            Some(batch)
        } else {
            None
        }
    }

    pub fn get_actions_from_node_idx(&self, mut idx: usize) -> SmallVec<[ActionCombo; 56]> {
        let mut actions = SmallVec::new();
        let mut store = self.store.lock().unwrap();
        while idx > 0 {
            let search_node = self.visited_nodes.get_in(&mut store, idx);
            actions.push(search_node.action());
            idx = search_node.parent_idx();
        }
        actions.reverse();
        actions
    }

    pub fn runtime_stats(&self) -> SearchQueueStats {
        let store = self.store.lock().unwrap();
        SearchQueueStats {
            inserted_nodes: self.num_inserted_nodes,
            processed_nodes: self.visited_nodes.len(),
            visited_capacity_bytes: (self.visited_nodes.capacity() * SearchNode::BYTES) as u64,
            queued_capacity_bytes: self.batches.values().map(|batch| batch.nodes.capacity() * SearchNode::BYTES).sum::<usize>() as u64,
            storage_resident_bytes: store.resident_bytes() as u64,
            storage_allocated_bytes: store.allocated_bytes(),
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
