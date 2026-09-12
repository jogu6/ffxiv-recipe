use crate::memory::FrontPool as BumpPool;
use raphael_sim::*;
#[cfg(not(target_arch = "wasm32"))]
use rayon::prelude::*;

use super::search_queue::{SearchQueueStats, SearchScore};
use crate::actions::{ActionCombo, FULL_SEARCH_ACTIONS, use_action_combo};
use crate::finish_solver::FinishSolverStats;
use crate::macro_solver::search_queue::{Batch, SearchQueue};
use crate::quality_upper_bound_solver::{
    QualityUbSolverShard, QualityUbSolverStats, QualityUbStates,
};
use crate::step_lower_bound_solver::{StepLbSolverShard, StepLbSolverStats, StepLbStates};
use crate::utils::AtomicFlag;
use crate::utils::ScopedTimer;
use crate::{FinishSolver, QualityUbSolver, SolverException, SolverSettings, StepLbSolver};

use std::vec::Vec;

// Modified by XIVca: adds telemetry and allocation-pressure recovery with lossless storage.
// Crafting transitions, bound calculations and score comparisons remain Raphael-based.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MacroSolverStage {
    FinishSolver,
    QualityUpperBound,
    StepLowerBound,
    Search,
    Complete,
}

#[derive(Debug, Clone, Copy, Default)]
pub struct MacroSolverProgress {
    pub inserted_nodes: usize,
    pub processed_nodes: usize,
    pub queue: SearchQueueStats,
    pub expansion_ms: f64,
    pub merge_ms: f64,
    pub quality_bound_bytes: u64,
    pub step_bound_bytes: u64,
    pub candidate_capacity_bytes: u64,
}

#[derive(Clone)]
struct Solution {
    score: (SearchScore, u16),
    solver_actions: Vec<ActionCombo>,
}

impl Solution {
    fn actions(&self) -> Vec<Action> {
        let mut actions = Vec::new();
        for solver_action in &self.solver_actions {
            actions.extend_from_slice(solver_action.actions());
        }
        actions
    }
}

type SolutionCallback<'a> = dyn Fn(&[Action]) + 'a;
type ProgressCallback<'a> = dyn Fn(usize) + 'a;

#[derive(Debug, Default, Clone, Copy)]
pub struct MacroSolverStats {
    pub search_queue_stats: SearchQueueStats,
    pub finish_solver_stats: FinishSolverStats,
    pub quality_ub_stats: QualityUbSolverStats,
    pub step_lb_stats: StepLbSolverStats,
}

pub struct MacroSolver<'a> {
    settings: SolverSettings,
    solution_callback: Box<SolutionCallback<'a>>,
    progress_callback: Box<ProgressCallback<'a>>,
    stage_callback: Box<dyn Fn(MacroSolverStage) + 'a>,
    detailed_progress_callback: Box<dyn Fn(MacroSolverProgress) + 'a>,
    finish_solver: FinishSolver,
    interrupt_signal: AtomicFlag,
    last_solve_runtime_stats: MacroSolverStats,
}

impl<'a> MacroSolver<'a> {
    pub fn new(
        settings: SolverSettings,
        solution_callback: Box<SolutionCallback<'a>>,
        progress_callback: Box<ProgressCallback<'a>>,
        interrupt_signal: AtomicFlag,
    ) -> Self {
        Self {
            settings,
            solution_callback,
            progress_callback,
            stage_callback: Box::new(|_| {}),
            detailed_progress_callback: Box::new(|_| {}),
            finish_solver: FinishSolver::new(settings),
            interrupt_signal,
            last_solve_runtime_stats: MacroSolverStats::default(),
        }
    }

    pub fn set_stage_callback(&mut self, callback: Box<dyn Fn(MacroSolverStage) + 'a>) {
        self.stage_callback = callback;
    }

    pub fn set_detailed_progress_callback(
        &mut self,
        callback: Box<dyn Fn(MacroSolverProgress) + 'a>,
    ) {
        self.detailed_progress_callback = callback;
    }

    pub fn solve(&mut self) -> Result<Vec<Action>, SolverException> {
        log::debug!(
            "rayon::current_num_threads() = {}",
            rayon::current_num_threads()
        );

        self.last_solve_runtime_stats = MacroSolverStats::default();
        let allocator = BumpPool::default();
        let mut quality_ub_solver =
            QualityUbSolver::new(self.settings, self.interrupt_signal.clone(), &allocator);
        let mut step_lb_solver =
            StepLbSolver::new(self.settings, self.interrupt_signal.clone(), &allocator);

        let _total_time = ScopedTimer::new("Total Time");

        let initial_state = SimulationState::new(&self.settings.simulator_settings);

        (self.stage_callback)(MacroSolverStage::FinishSolver);
        let timer = ScopedTimer::new("Finish Solver");
        self.finish_solver.precompute()?;
        if !self.finish_solver.can_finish(&initial_state)? {
            self.last_solve_runtime_stats.finish_solver_stats = self.finish_solver.runtime_stats();
            return Err(SolverException::NoSolution);
        }
        drop(timer);

        (self.stage_callback)(MacroSolverStage::QualityUpperBound);
        let timer = ScopedTimer::new("Quality UB Solver");
        quality_ub_solver.precompute()?;
        drop(timer);

        // The StepLbSolver is only queried when a state has the potential to reach max_quality.
        // If the quality upper-bound of the initial state is less than max_quality, then no
        // subsequent state can reach max_quality, which in turn means the StepLbSolver is not needed.
        let mut quality_ub_solver_shard = quality_ub_solver.create_shard();
        let initial_state_quality_ub =
            quality_ub_solver_shard.quality_upper_bound(initial_state)?;
        quality_ub_solver.extend_solved_states(quality_ub_solver_shard.solved_states());
        if initial_state_quality_ub >= self.settings.max_quality() {
            (self.stage_callback)(MacroSolverStage::StepLowerBound);
            let _timer = ScopedTimer::new("Step LB Solver");
            step_lb_solver.precompute()?;
        }

        (self.stage_callback)(MacroSolverStage::Search);
        let timer = ScopedTimer::new("Search");
        let actions = self
            .do_solve(&mut quality_ub_solver, &mut step_lb_solver, initial_state, allocator.store())?
            .actions();
        drop(timer);

        (self.stage_callback)(MacroSolverStage::Complete);

        log::debug!("{:?}", self.runtime_stats());

        Ok(actions)
    }

    fn do_solve<'alloc>(
        &mut self,
        quality_ub_solver: &mut QualityUbSolver<'alloc>,
        step_lb_solver: &mut StepLbSolver<'alloc>,
        state: SimulationState,
        store: crate::memory::SharedStore,
    ) -> Result<Solution, SolverException> {
        let mut search_queue = SearchQueue::new(self.settings, state, store);
        let mut solution: Option<Solution> = None;
        let mut min_accepted_score = SearchScore::MIN;
        let mut expansion_ms = 0.0;
        let mut merge_ms = 0.0;
        let mut next_memory_sample = 0;
        let mut pareto_bytes = 0;
        let mut quality_bytes = 0;
        let mut step_bytes = 0;

        while let Some(Batch {
            score,
            nodes: batch,
        }) = search_queue.pop_batch()
            && score >= min_accepted_score
        {
            if self.interrupt_signal.is_set() {
                return Err(SolverException::Interrupted);
            }

            let create_worker_data = || WorkerData {
                settings: &self.settings,
                finish_solver: &self.finish_solver,
                quality_ub_solver_shard: quality_ub_solver.create_shard(),
                step_lb_solver_shard: step_lb_solver.create_shard(),
                search_queue: &search_queue,
                min_accepted_score,
                candidate_states: CandidateBuffer::new(),
                best_intermediate_solution: None,
            };

            let expansion_started = web_time::Instant::now();
            #[cfg(target_arch = "wasm32")]
            let worker_results = vec![batch.into_iter().try_fold(create_worker_data(),
                |mut worker_data, (state, backtrack_id)| -> Result<_, SolverException> {
                    worker_data.process_state(state, score, backtrack_id)?;
                    Ok(worker_data)
                })?];
            #[cfg(not(target_arch = "wasm32"))]
            let worker_results = batch
                .into_par_iter()
                .try_fold(
                    create_worker_data,
                    |mut worker_data, (state, backtrack_id)| {
                        worker_data.process_state(state, score, backtrack_id)?;
                        Ok(worker_data)
                    },
                )
                .collect::<Result<Vec<_>, SolverException>>()?;
            expansion_ms += expansion_started.elapsed().as_secs_f64() * 1000.0;
            let merge_started = web_time::Instant::now();

            // Finalize the workers to drop all shared references to `self` to satisfy the borrow checker.
            let worker_results = worker_results
                .into_iter()
                .map(WorkerData::finalize)
                .collect::<Vec<_>>();
            let candidate_capacity_bytes = worker_results.iter().map(|worker|
                worker.candidate_states.capacity_bytes()
            ).sum::<usize>() as u64;

            // Update the current best intermediate solution.
            for worker_data in &worker_results {
                if let Some(worker_solution) = worker_data.best_intermediate_solution.as_ref()
                    && Some(worker_solution.score) > solution.as_ref().map(|s| s.score)
                {
                    solution = Some(worker_solution.clone());
                    (self.solution_callback)(&solution.as_ref().unwrap().actions());
                }
            }

            min_accepted_score = worker_results
                .iter()
                .map(|result| result.min_accepted_score)
                .max()
                .unwrap_or(min_accepted_score);
            search_queue.drop_nodes_below_score(min_accepted_score);

            // Add all eligible candidate states to the search queue.
            for worker_data in &worker_results {
                for (score, action, parent_id) in worker_data.candidate_states.iter() {
                    if score >= min_accepted_score {
                        search_queue.push(score, action, parent_id)?;
                    }
                }
            }

            // Extend inner solvers with local states from all workers.
            for worker_result in worker_results {
                quality_ub_solver.extend_solved_states(worker_result.quality_ub_states);
                step_lb_solver.extend_solved_states(worker_result.step_lb_states);
            }

            let mut runtime_stats = search_queue.runtime_stats();
            if runtime_stats.processed_nodes >= next_memory_sample {
                next_memory_sample = runtime_stats.processed_nodes + 1_000_000;
                pareto_bytes = search_queue.measure_pareto_bytes();
                quality_bytes = quality_ub_solver.runtime_stats().values as u64 * 4;
                step_bytes = step_lb_solver.runtime_stats().values as u64 * 4;
            }
            runtime_stats.pareto_capacity_bytes = pareto_bytes;
            merge_ms += merge_started.elapsed().as_secs_f64() * 1000.0;
            (self.progress_callback)(runtime_stats.processed_nodes);
            (self.detailed_progress_callback)(MacroSolverProgress {
                inserted_nodes: runtime_stats.inserted_nodes,
                processed_nodes: runtime_stats.processed_nodes,
                queue: runtime_stats,
                expansion_ms,
                merge_ms,
                quality_bound_bytes: quality_bytes,
                step_bound_bytes: step_bytes,
                candidate_capacity_bytes,
            });
        }

        self.last_solve_runtime_stats = MacroSolverStats {
            search_queue_stats: search_queue.runtime_stats(),
            finish_solver_stats: self.finish_solver.runtime_stats(),
            quality_ub_stats: quality_ub_solver.runtime_stats(),
            step_lb_stats: step_lb_solver.runtime_stats(),
        };

        if let Some(solution) = &solution
            && solution.score.0.quality_upper_bound < self.settings.max_quality()
            && !self.settings.allow_non_max_quality_solutions
        {
            return Err(SolverException::NoSolution);
        }

        solution.ok_or(SolverException::NoSolution)
    }

    pub fn runtime_stats(&self) -> MacroSolverStats {
        self.last_solve_runtime_stats
    }
}

struct WorkerResult<'alloc> {
    quality_ub_states: QualityUbStates<'alloc>,
    step_lb_states: StepLbStates<'alloc>,
    min_accepted_score: SearchScore,
    candidate_states: CandidateBuffer,
    best_intermediate_solution: Option<Solution>,
}

struct WorkerData<'main, 'alloc> {
    settings: &'main SolverSettings,
    finish_solver: &'main FinishSolver,
    quality_ub_solver_shard: QualityUbSolverShard<'main, 'alloc>,
    step_lb_solver_shard: StepLbSolverShard<'main, 'alloc>,
    search_queue: &'main SearchQueue,
    min_accepted_score: SearchScore,
    candidate_states: CandidateBuffer,
    best_intermediate_solution: Option<Solution>,
}

impl<'main, 'alloc> WorkerData<'main, 'alloc> {
    fn finalize(self) -> WorkerResult<'alloc> {
        WorkerResult {
            quality_ub_states: self.quality_ub_solver_shard.solved_states(),
            step_lb_states: self.step_lb_solver_shard.solved_states(),
            min_accepted_score: self.min_accepted_score,
            candidate_states: self.candidate_states,
            best_intermediate_solution: self.best_intermediate_solution,
        }
    }

    fn update_min_score(&mut self, score: SearchScore) {
        self.min_accepted_score = std::cmp::max(self.min_accepted_score, score);
    }

    fn add_candidate_state(
        &mut self,
        state: SimulationState,
        score: SearchScore,
        action: ActionCombo,
        parent_id: usize,
    ) {
        if state.progress >= self.settings.max_progress() {
            if self
                .best_intermediate_solution
                .as_ref()
                .is_none_or(|solution| solution.score < (score, state.quality))
            {
                let mut actions = self.search_queue.get_actions_from_node_idx(parent_id);
                actions.push(action);
                self.best_intermediate_solution = Some(Solution {
                    score: (score, state.quality),
                    solver_actions: actions.into_vec(),
                });
            }
        } else if score >= self.min_accepted_score {
            self.candidate_states.push((score, action, parent_id), self.search_queue.store());
        }
    }

    fn process_state(
        &mut self,
        state: SimulationState,
        score: SearchScore,
        backtrack_id: usize,
    ) -> Result<(), SolverException> {
        for action in FULL_SEARCH_ACTIONS {
            if let Ok(state) = use_action_combo(self.settings, state, action) {
                if !state.is_final(&self.settings.simulator_settings) {
                    if !self.finish_solver.can_finish(&state)? {
                        continue;
                    }

                    self.update_min_score(SearchScore {
                        quality_upper_bound: std::cmp::min(
                            state.quality,
                            self.settings.max_quality(),
                        ),
                        ..SearchScore::MIN
                    });

                    let quality_upper_bound = if state.quality >= self.settings.max_quality() {
                        self.settings.max_quality()
                    } else {
                        std::cmp::min(
                            score.quality_upper_bound,
                            self.quality_ub_solver_shard.quality_upper_bound(state)?,
                        )
                    };

                    if !self.settings.allow_non_max_quality_solutions
                        && quality_upper_bound < self.settings.max_quality()
                    {
                        continue;
                    }

                    let step_lb_hint = score
                        .steps_lower_bound
                        .saturating_sub(score.current_steps + action.steps());
                    let steps_lower_bound = match quality_upper_bound >= self.settings.max_quality()
                    {
                        true => self
                            .step_lb_solver_shard
                            .step_lower_bound(state, step_lb_hint)?
                            .saturating_add(score.current_steps + action.steps()),
                        false => score.current_steps + action.steps(),
                    };

                    let child_score = SearchScore {
                        quality_upper_bound,
                        steps_lower_bound,
                        duration_lower_bound: score.current_duration + action.duration() + 3,
                        current_steps: score.current_steps + action.steps(),
                        current_duration: score.current_duration + action.duration(),
                    };
                    self.add_candidate_state(state, child_score, action, backtrack_id);
                } else if state.progress >= self.settings.max_progress() {
                    let solution_score = SearchScore {
                        quality_upper_bound: std::cmp::min(
                            state.quality,
                            self.settings.max_quality(),
                        ),
                        steps_lower_bound: score.current_steps + action.steps(),
                        duration_lower_bound: score.current_duration + action.duration(),
                        current_steps: score.current_steps + action.steps(),
                        current_duration: score.current_duration + action.duration(),
                    };
                    self.update_min_score(solution_score);
                    self.add_candidate_state(state, solution_score, action, backtrack_id);
                }
            }
        }
        Ok(())
    }
}

// Large contiguous candidate arrays stay fast until their growth fails. At that
// point move their exact contents into the same lossless store as the queue.
type Candidate = (SearchScore, ActionCombo, usize);
impl crate::memory::Record for Candidate {
    const BYTES: usize = 16;
    fn encode(self, target: &mut [u8]) {
        target[..2].copy_from_slice(&self.0.quality_upper_bound.to_le_bytes());
        target[2] = self.0.steps_lower_bound;
        target[3] = self.0.duration_lower_bound;
        target[4] = self.0.current_steps;
        target[5] = self.0.current_duration;
        target[6] = self.1.into_bits();
        target[7] = 0;
        target[8..].copy_from_slice(&(self.2 as u64).to_le_bytes());
    }
    fn decode(source: &[u8]) -> Self {
        (SearchScore { quality_upper_bound: u16::from_le_bytes(source[..2].try_into().unwrap()),
            steps_lower_bound: source[2], duration_lower_bound: source[3],
            current_steps: source[4], current_duration: source[5] },
            ActionCombo::from_bits(source[6]), u64::from_le_bytes(source[8..].try_into().unwrap()) as usize)
    }
}
enum CandidateBuffer {
    Resident(Vec<Candidate>),
    Stored(crate::memory::PagedVec<Candidate>),
}
impl CandidateBuffer {
    fn new() -> Self { Self::Resident(Vec::new()) }
    fn spill(&mut self, store: &crate::memory::SharedStore) {
        if let Self::Resident(values) = self {
            let stored = crate::memory::PagedVec::from_slice(store.clone(), values);
            *self = Self::Stored(stored);
        }
    }
    fn push(&mut self, item: Candidate, store: &crate::memory::SharedStore) {
        if let Self::Resident(values) = self {
            if values.len() < values.capacity() || values.try_reserve(1).is_ok() {
                values.push(item);
                return;
            }
            store.lock().unwrap().recover_allocation();
            self.spill(store);
        }
        if let Self::Stored(values) = self { values.push(item); }
    }
    fn capacity_bytes(&self) -> usize {
        match self {
            Self::Resident(values) => values.capacity() * std::mem::size_of::<Candidate>(),
            Self::Stored(values) => values.capacity() * <Candidate as crate::memory::Record>::BYTES,
        }
    }
    fn iter(&self) -> CandidateIter<'_> {
        match self {
            Self::Resident(values) => CandidateIter::Resident(values.iter()),
            Self::Stored(values) => CandidateIter::Stored(values, 0),
        }
    }
}
enum CandidateIter<'a> {
    Resident(std::slice::Iter<'a, Candidate>),
    Stored(&'a crate::memory::PagedVec<Candidate>, usize),
}
impl Iterator for CandidateIter<'_> {
    type Item = Candidate;
    fn next(&mut self) -> Option<Candidate> {
        match self {
            Self::Resident(values) => values.next().copied(),
            Self::Stored(values, index) => {
                if *index == values.len() { return None; }
                let value = values.get(*index);
                *index += 1;
                Some(value)
            }
        }
    }
}
#[cfg(test)]
mod candidate_memory_tests {
    use super::*;
    #[test]
    fn spill_preserves_scores_actions_parents_and_append_order() {
        let store = crate::memory::PageStore::new(8192);
        let expected: Vec<_> = (0..10000usize).map(|i| (SearchScore {
            quality_upper_bound: (i * 7) as u16, steps_lower_bound: (i % 255) as u8,
            duration_lower_bound: (i % 91) as u8, current_steps: (i % 80) as u8,
            current_duration: (i % 240) as u8 }, FULL_SEARCH_ACTIONS[i % FULL_SEARCH_ACTIONS.len()], i * 1009)).collect();
        let mut buffer = CandidateBuffer::Resident(expected[..5000].to_vec());
        buffer.spill(&store);
        for &item in &expected[5000..] { buffer.push(item, &store); }
        assert_eq!(buffer.iter().collect::<Vec<_>>(), expected);
        assert!(store.lock().unwrap().writes > 0);
        assert!(store.lock().unwrap().reads > 0);
    }
}
