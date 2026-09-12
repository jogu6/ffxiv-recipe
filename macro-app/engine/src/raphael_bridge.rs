// Based on Raphael v0.28.6; XIVca supplies bounded, lossless search storage.
// This bridge only converts XIVca's browser-facing data types.
use crate::Action;
use raphael_sim::{Action as RaphaelAction, ActionMask, Settings};
use raphael_solver::{
    AtomicFlag, MacroSolver, MacroSolverProgress, MacroSolverStage, SolverSettings,
};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RaphaelSolveStage {
    FinishSolver,
    QualityUpperBound,
    StepLowerBound,
    Search,
    Complete,
}

#[derive(Debug, Clone, Copy)]
pub struct RaphaelSolveSettings {
    pub max_cp: u32,
    pub max_durability: u32,
    pub max_progress: u32,
    pub max_quality: u32,
    pub base_progress: u32,
    pub base_quality: u32,
    pub job_level: u16,
    pub manipulation_available: bool,
    pub heart_and_soul_available: bool,
    pub quick_innovation_available: bool,
    pub trained_eye_available: bool,
    pub adversarial: bool,
    pub stellar_steady_hand_charges: u8,
}

#[derive(Debug, Clone, Copy)]
pub struct RaphaelSolveGoal {
    pub progress: u32,
    pub quality: u32,
}

fn map_stage(stage: MacroSolverStage) -> RaphaelSolveStage {
    match stage {
        MacroSolverStage::FinishSolver => RaphaelSolveStage::FinishSolver,
        MacroSolverStage::QualityUpperBound => RaphaelSolveStage::QualityUpperBound,
        MacroSolverStage::StepLowerBound => RaphaelSolveStage::StepLowerBound,
        MacroSolverStage::Search => RaphaelSolveStage::Search,
        MacroSolverStage::Complete => RaphaelSolveStage::Complete,
    }
}

fn checked_u16(value: u32) -> Result<u16, String> {
    value
        .try_into()
        .map_err(|_| "製作条件がRaphaelの有効範囲を超えています".to_owned())
}

fn action_mask(settings: &RaphaelSolveSettings) -> ActionMask {
    let mut mask = ActionMask::all();
    if !settings.manipulation_available {
        mask = mask.remove(RaphaelAction::Manipulation);
    }
    if !settings.heart_and_soul_available {
        mask = mask.remove(RaphaelAction::HeartAndSoul);
    }
    if !settings.quick_innovation_available {
        mask = mask.remove(RaphaelAction::QuickInnovation);
    }
    if !settings.trained_eye_available {
        mask = mask.remove(RaphaelAction::TrainedEye);
    }
    mask
}

fn map_action(action: RaphaelAction) -> Action {
    match action {
        RaphaelAction::BasicSynthesis => Action::BasicSynthesis,
        RaphaelAction::BasicTouch => Action::BasicTouch,
        RaphaelAction::MasterMend => Action::MastersMend,
        RaphaelAction::Observe => Action::Observe,
        RaphaelAction::TricksOfTheTrade => Action::TricksOfTheTrade,
        RaphaelAction::WasteNot => Action::WasteNot,
        RaphaelAction::Veneration => Action::Veneration,
        RaphaelAction::StandardTouch => Action::StandardTouch,
        RaphaelAction::GreatStrides => Action::GreatStrides,
        RaphaelAction::Innovation => Action::Innovation,
        RaphaelAction::WasteNot2 => Action::WasteNotTwo,
        RaphaelAction::ByregotsBlessing => Action::ByregotsBlessing,
        RaphaelAction::PreciseTouch => Action::PreciseTouch,
        RaphaelAction::MuscleMemory => Action::MuscleMemory,
        RaphaelAction::CarefulSynthesis => Action::CarefulSynthesis,
        RaphaelAction::Manipulation => Action::Manipulation,
        RaphaelAction::PrudentTouch => Action::PrudentTouch,
        RaphaelAction::AdvancedTouch => Action::AdvancedTouch,
        RaphaelAction::Reflect => Action::Reflect,
        RaphaelAction::PreparatoryTouch => Action::PreparatoryTouch,
        RaphaelAction::Groundwork => Action::Groundwork,
        RaphaelAction::DelicateSynthesis => Action::DelicateSynthesis,
        RaphaelAction::IntensiveSynthesis => Action::IntensiveSynthesis,
        RaphaelAction::TrainedEye => Action::TrainedEye,
        RaphaelAction::HeartAndSoul => Action::HeartAndSoul,
        RaphaelAction::PrudentSynthesis => Action::PrudentSynthesis,
        RaphaelAction::TrainedFinesse => Action::TrainedFinesse,
        RaphaelAction::RefinedTouch => Action::RefinedTouch,
        RaphaelAction::QuickInnovation => Action::QuickInnovation,
        RaphaelAction::ImmaculateMend => Action::ImmaculateMend,
        RaphaelAction::TrainedPerfection => Action::TrainedPerfection,
        RaphaelAction::StellarSteadyHand => Action::StellarSteadyHand,
        RaphaelAction::RapidSynthesis => Action::RapidSynthesis,
        RaphaelAction::HastyTouch => Action::HastyTouch,
        RaphaelAction::DaringTouch => Action::DaringTouch,
    }
}

pub fn solve_raphael_exact(
    settings: &RaphaelSolveSettings,
    initial_quality: u32,
    goal: RaphaelSolveGoal,
    on_solution: impl Fn(&[Action]),
    on_progress: impl Fn(MacroSolverProgress),
    on_stage: impl Fn(RaphaelSolveStage),
) -> Result<Vec<Action>, String> {
    let remaining_quality = goal.quality.saturating_sub(initial_quality);
    let raphael_settings = Settings {
        max_cp: checked_u16(settings.max_cp)?,
        max_durability: checked_u16(settings.max_durability)?,
        max_progress: checked_u16(goal.progress)?,
        max_quality: checked_u16(remaining_quality)?,
        base_progress: checked_u16(settings.base_progress)?,
        base_quality: checked_u16(settings.base_quality)?,
        job_level: settings
            .job_level
            .try_into()
            .map_err(|_| "ジョブレベルがRaphaelの有効範囲を超えています".to_owned())?,
        allowed_actions: action_mask(settings),
        adversarial: settings.adversarial,
        backload_progress: false,
        stellar_steady_hand_charges: settings.stellar_steady_hand_charges,
    };
    let solver_settings = SolverSettings {
        simulator_settings: raphael_settings,
        allow_non_max_quality_solutions: false,
    };
    let mut solver = MacroSolver::new(
        solver_settings,
        Box::new(|actions| {
            let mapped = actions.iter().copied().map(map_action).collect::<Vec<_>>();
            on_solution(&mapped);
        }),
        Box::new(|_| {}),
        AtomicFlag::new(),
    );
    solver.set_stage_callback(Box::new(|stage| on_stage(map_stage(stage))));
    solver.set_detailed_progress_callback(Box::new(
        on_progress,
    ));
    solver
        .solve()
        .map(|actions| actions.into_iter().map(map_action).collect())
        .map_err(|error| format!("{error:?}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use raphael_sim::{Condition, SimulationState};

    fn simulator_settings(allowed_actions: ActionMask) -> Settings {
        Settings {
            max_cp: 250,
            max_durability: 60,
            max_progress: 2_000,
            max_quality: 40_000,
            base_progress: 100,
            base_quality: 100,
            job_level: 100,
            allowed_actions,
            adversarial: false,
            backload_progress: false,
            stellar_steady_hand_charges: 0,
        }
    }

    #[test]
    fn specialist_options_follow_raphael_simulation() {
        let enabled = simulator_settings(ActionMask::all());
        assert!(SimulationState::new(&enabled)
            .use_action(RaphaelAction::IntensiveSynthesis, Condition::Normal, &enabled)
            .is_err());
        let heart_and_soul = SimulationState::from_macro(
            &enabled,
            &[RaphaelAction::HeartAndSoul, RaphaelAction::IntensiveSynthesis],
        )
        .unwrap();
        assert_eq!(heart_and_soul.progress, 400);
        assert!(!heart_and_soul.effects.heart_and_soul_active());

        let quick_innovation = SimulationState::from_macro(
            &enabled,
            &[RaphaelAction::QuickInnovation, RaphaelAction::BasicTouch],
        )
        .unwrap();
        assert_eq!(quick_innovation.quality, 150);
        assert!(!quick_innovation.effects.quick_innovation_available());
        assert_eq!(quick_innovation.effects.innovation(), 0);

        let disabled = simulator_settings(
            ActionMask::all()
                .remove(RaphaelAction::HeartAndSoul)
                .remove(RaphaelAction::QuickInnovation),
        );
        assert!(SimulationState::new(&disabled)
            .use_action(RaphaelAction::HeartAndSoul, Condition::Normal, &disabled)
            .is_err());
        assert!(SimulationState::new(&disabled)
            .use_action(RaphaelAction::QuickInnovation, Condition::Normal, &disabled)
            .is_err());
    }

    #[test]
    fn solves_courtly_filbert_brush_with_the_exact_raphael_path() {
        let settings = RaphaelSolveSettings {
            max_cp: 664,
            max_durability: 70,
            max_progress: 10_040,
            max_quality: 21_200,
            base_progress: 301,
            base_quality: 296,
            job_level: 100,
            manipulation_available: true,
            heart_and_soul_available: false,
            quick_innovation_available: false,
            trained_eye_available: false,
            adversarial: true,
            stellar_steady_hand_charges: 0,
        };
        let actions = solve_raphael_exact(
            &settings,
            10_600,
            RaphaelSolveGoal { progress: 10_040, quality: 21_200 },
            |_| {},
            |_| {},
            |_| {},
        )
        .unwrap();
        assert_eq!(actions.len(), 25);
        assert_eq!(actions[0], Action::Reflect);
        assert_eq!(actions[1], Action::Veneration);
        assert_eq!(actions[12], Action::PreparatoryTouch);
        assert_eq!(actions[24], Action::CarefulSynthesis);
    }
}
