// Modified by XIVca: telemetry, bounded expansion batches and lossless paged storage.
// Crafting transitions, bound calculations and score comparisons retain Raphael semantics.
mod actions;
mod memory;
#[cfg(all(target_arch = "wasm32", not(feature = "parallel")))]
mod sequential;
pub use memory::set_storage_cache_bytes;
#[cfg(target_arch = "wasm32")]
pub use memory::recover_memory;

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
    /// Backtracking indices are encoded in 64-bit records on all targets.
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
