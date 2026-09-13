// Modified by XIVca: telemetry, whole-score comparison batches and lossless paged storage.
// Crafting transitions, bound calculations and score comparisons retain Raphael semantics.
// Observation only: a supervisor can read completed expansions while the main
// solver is inside one whole-score batch. This counter never affects pruning.
static LIVE_SEARCH_NODES: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);
static LIVE_SEARCH_ACTIVITY: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);
// Observation only, updated at batch boundaries: replay, comparison, expansion, merge.
pub static MEMORY_PHASE: std::sync::atomic::AtomicU32 = std::sync::atomic::AtomicU32::new(0);
pub fn live_search_activity_address() -> usize { LIVE_SEARCH_ACTIVITY.as_ptr() as usize }
pub fn live_search_nodes_address() -> usize { LIVE_SEARCH_NODES.as_ptr() as usize }

// Serial workers cannot be observed through shared memory. Report completed
// loop work in bounded intervals; this never yields or changes search batches.
#[inline]
pub(crate) fn report_work(phase: u32, completed: usize, total: usize) {
    #[cfg(all(target_arch = "wasm32", not(feature = "parallel")))]
    if phase == 6 || (total >= 4096 && (completed == 0 || completed == total || completed % 4096 == 0)) {
        #[wasm_bindgen::prelude::wasm_bindgen]
        extern "C" {
            #[wasm_bindgen(catch, js_namespace = globalThis, js_name = __xivcaWorkProgress)]
            fn notify(phase: u32, completed: usize, total: usize) -> Result<(), wasm_bindgen::JsValue>;
        }
        let _ = notify(phase, completed, total);
    }
    #[cfg(not(all(target_arch = "wasm32", not(feature = "parallel"))))]
    let _ = (phase, completed, total);
}

mod actions;
mod memory;
#[cfg(all(target_arch = "wasm32", not(feature = "parallel")))]
mod sequential;
pub use memory::{set_storage_cache_bytes, bound_query_stats};

mod finish_solver;
use finish_solver::FinishSolver;

mod quality_upper_bound_solver;
use quality_upper_bound_solver::*;

mod step_lower_bound_solver;
use step_lower_bound_solver::StepLbSolver;

mod macro_solver;
pub use macro_solver::{MacroSolver, MacroSolverProgress, MacroSolverStage};

mod utils;
pub use utils::AtomicFlag;

#[cfg(test)]
pub mod test_utils;

#[derive(Clone, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub enum SolverException {
    NoSolution,
    Interrupted,
    /// The `SearchQueueCapacityExceeded` error is raised when there are no more valid
    /// indices for the already visited nodes in the search queue.
    ///
    /// Backtracking indices retain every WASM pointer bit in five-byte records;
    /// native 64-bit targets use eight-byte records.
    SearchQueueCapacityExceeded,
    InternalError(String),
}

impl std::fmt::Debug for SolverException {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::NoSolution => write!(f, "NoSolution"),
            Self::Interrupted => write!(f, "Interrupted"),
            Self::SearchQueueCapacityExceeded => write!(f, "SearchQueueCapacityExceeded"),
            Self::InternalError(message) => f.write_str(message),
        }
    }
}

mod macros {
    macro_rules! internal_error {
        ( $desc:expr, $( $x:expr ),* ) => {
            {
                use std::fmt::Write as _;
                let mut message = String::from(concat!(
                    "The solver encountered an internal error.\n",
                    "Please submit a bug report.\n\n",
                    "--- Description ---\n\n",
                ));
                write!(message, "{}\n\n", $desc).unwrap();
                write!(message, "Location: {}:{}:{}\n\n", file!(), line!(), column!()).unwrap();
                message += "--- Debug info ---\n";
                $(
                    write!(message, "\n{} = {:#?}\n", stringify!($x), $x).unwrap();
                )*
                crate::SolverException::InternalError(message)
            }
        };
    }
    pub(crate) use internal_error;
}

#[derive(Clone, Copy, Debug)]
pub struct SolverSettings {
    pub simulator_settings: raphael_sim::Settings,
    pub allow_non_max_quality_solutions: bool,
}

impl SolverSettings {
    pub fn max_durability(&self) -> u16 {
        self.simulator_settings.max_durability
    }

    pub fn max_cp(&self) -> u16 {
        self.simulator_settings.max_cp
    }

    pub fn max_progress(&self) -> u16 {
        self.simulator_settings.max_progress
    }

    pub fn max_quality(&self) -> u16 {
        self.simulator_settings.max_quality
    }

    pub fn base_progress(&self) -> u16 {
        self.simulator_settings.base_progress
    }

    pub fn base_quality(&self) -> u16 {
        self.simulator_settings.base_quality
    }
}
