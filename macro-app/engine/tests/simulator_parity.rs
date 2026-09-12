use xivca_macro_engine::{
    Action, Combo, Condition, SimulationError, SimulationSettings, SimulationState, use_action,
};

fn settings() -> SimulationSettings {
    SimulationSettings {
        max_cp: 250,
        max_durability: 60,
        max_progress: 2_000,
        max_quality: 40_000,
        base_progress: 100,
        base_quality: 100,
        job_level: 100,
        manipulation_available: true,
        heart_and_soul_available: true,
        quick_innovation_available: true,
        trained_eye_available: true,
        adversarial: false,
        stellar_steady_hand_charges: 0,
    }
}

fn run(
    settings: &SimulationSettings,
    actions: &[Action],
) -> Result<SimulationState, SimulationError> {
    actions
        .iter()
        .try_fold(SimulationState::new(settings, 0), |state, action| {
            use_action(state, *action, Condition::Normal, settings)
        })
}

fn primary(state: SimulationState, settings: &SimulationSettings) -> (u32, u32, u32, u32) {
    (
        state.progress,
        state.quality.value,
        settings.max_durability - state.durability,
        settings.max_cp - state.cp,
    )
}

#[test]
fn basic_actions_match_raphael_0286() {
    let settings = settings();
    let synthesis = run(&settings, &[Action::BasicSynthesis]).unwrap();
    assert_eq!(primary(synthesis, &settings), (120, 0, 10, 0));
    let touch = run(&settings, &[Action::BasicTouch]).unwrap();
    assert_eq!(primary(touch, &settings), (0, 100, 10, 18));
    assert_eq!(touch.effects.inner_quiet, 1);
    assert_eq!(touch.effects.combo, Combo::BasicTouch);
}

#[test]
fn touch_combo_and_refined_touch_match_raphael_0286() {
    let settings = settings();
    let combo = run(
        &settings,
        &[
            Action::BasicTouch,
            Action::StandardTouch,
            Action::AdvancedTouch,
        ],
    )
    .unwrap();
    assert_eq!(primary(combo, &settings), (0, 417, 30, 54));
    assert_eq!(combo.effects.inner_quiet, 3);
    let refined = run(&settings, &[Action::BasicTouch, Action::RefinedTouch]).unwrap();
    assert_eq!(refined.effects.inner_quiet, 3);
}

#[test]
fn progress_and_repair_actions_match_raphael_0286() {
    let settings = settings();
    let state = run(
        &settings,
        &[
            Action::Manipulation,
            Action::Groundwork,
            Action::Groundwork,
            Action::ImmaculateMend,
        ],
    )
    .unwrap();
    assert_eq!(state.progress, 720);
    assert_eq!(state.durability, settings.max_durability);
    assert_eq!(state.cp, 6);
}

#[test]
fn trained_perfection_is_single_use_and_skips_one_durability_cost() {
    let settings = settings();
    let state = run(
        &settings,
        &[
            Action::TrainedPerfection,
            Action::Observe,
            Action::Groundwork,
        ],
    )
    .unwrap();
    assert_eq!(state.durability, settings.max_durability);
    assert_eq!(
        run(
            &settings,
            &[Action::TrainedPerfection, Action::TrainedPerfection]
        ),
        Err(SimulationError::NoRemainingUses)
    );
}

#[test]
fn heart_and_soul_enables_and_is_consumed_by_intensive_synthesis() {
    let settings = settings();
    assert_eq!(
        run(&settings, &[Action::IntensiveSynthesis]),
        Err(SimulationError::SpecialCondition)
    );
    let state = run(
        &settings,
        &[Action::HeartAndSoul, Action::IntensiveSynthesis],
    )
    .unwrap();
    assert_eq!(state.progress, 400);
    assert!(!state.effects.heart_and_soul_active);
}

#[test]
fn stellar_actions_require_the_guaranteed_success_effect() {
    let mut settings = settings();
    settings.stellar_steady_hand_charges = 1;
    assert_eq!(
        run(&settings, &[Action::RapidSynthesis]),
        Err(SimulationError::UnreliableAction)
    );
    let state = run(
        &settings,
        &[
            Action::StellarSteadyHand,
            Action::HastyTouch,
            Action::DaringTouch,
        ],
    )
    .unwrap();
    assert_eq!(state.quality.value, 265);
    assert_eq!(state.durability, 40);
    assert!(!state.effects.expedience);
}

#[test]
fn progress_completion_prevents_later_quality_action() {
    let mut settings = settings();
    settings.max_progress = 100;
    let completed = run(&settings, &[Action::BasicSynthesis]).unwrap();
    assert!(completed.succeeded(&settings));
    assert_eq!(
        use_action(completed, Action::BasicTouch, Condition::Normal, &settings),
        Err(SimulationError::FinalState)
    );
}

#[test]
fn trained_eye_at_max_quality_does_not_add_inner_quiet_or_adversarial_guard() {
    let mut settings = settings();
    settings.adversarial = true;
    let mut state = SimulationState::new(&settings, settings.max_quality);
    state.effects.inner_quiet = 2;
    state.effects.adversarial_guard = 0;

    let result = use_action(state, Action::TrainedEye, Condition::Normal, &settings).unwrap();

    assert_eq!(result.quality.value, settings.max_quality);
    assert_eq!(result.effects.inner_quiet, 2);
    assert_eq!(result.effects.adversarial_guard, 0);
}

#[test]
fn trained_finesse_matches_raphael_zero_durability_cost() {
    let mut state = SimulationState::new(&settings(), 0);
    state.effects.inner_quiet = 10;

    let result = use_action(
        state,
        Action::TrainedFinesse,
        Condition::Normal,
        &settings(),
    )
    .unwrap();

    assert_eq!(result.quality.value, 200);
    assert_eq!(result.durability, settings().max_durability);
    assert_eq!(result.cp, settings().max_cp - 32);
}

#[test]
fn zero_rounded_quality_does_not_add_inner_quiet_or_guard() {
    let mut low = settings();
    low.base_quality = 0;
    low.adversarial = true;
    let mut state = SimulationState::new(&low, 0);
    state.effects.adversarial_guard = 0;

    let result = use_action(state, Action::BasicTouch, Condition::Normal, &low).unwrap();

    assert_eq!(result.effects.inner_quiet, 0);
    assert_eq!(result.effects.adversarial_guard, 0);
}

#[test]
fn long_normal_macro_vector_matches_raphael_0286() {
    let vector = SimulationSettings {
        max_cp: 700,
        max_durability: 70,
        max_progress: 6_600,
        max_quality: 14_040,
        base_progress: 248,
        base_quality: 270,
        job_level: 90,
        manipulation_available: true,
        heart_and_soul_available: false,
        quick_innovation_available: false,
        trained_eye_available: false,
        adversarial: false,
        stellar_steady_hand_charges: 0,
    };
    let actions = [
        Action::MuscleMemory,
        Action::WasteNot,
        Action::Veneration,
        Action::Groundwork,
        Action::Groundwork,
        Action::Groundwork,
        Action::PrudentSynthesis,
        Action::MastersMend,
        Action::PrudentTouch,
        Action::Innovation,
        Action::PrudentTouch,
        Action::PrudentTouch,
        Action::PrudentTouch,
        Action::PrudentTouch,
        Action::MastersMend,
        Action::Innovation,
        Action::PrudentTouch,
        Action::BasicTouch,
        Action::StandardTouch,
        Action::AdvancedTouch,
        Action::GreatStrides,
        Action::Innovation,
        Action::Observe,
        Action::AdvancedTouch,
        Action::GreatStrides,
        Action::ByregotsBlessing,
    ];

    let result = run(&vector, &actions).unwrap();

    assert_eq!(result.cp, 1);
    assert_eq!(result.durability, 5);
    assert_eq!(result.progress, 6_323);
    assert_eq!(result.quality.value, 11_475);
}

#[test]
fn low_level_actions_do_not_start_inner_quiet_before_level_eleven() {
    let low = SimulationSettings {
        max_cp: 50,
        max_durability: 60,
        max_progress: 33,
        max_quality: 150,
        base_progress: 4,
        base_quality: 38,
        job_level: 10,
        manipulation_available: false,
        heart_and_soul_available: false,
        quick_innovation_available: false,
        trained_eye_available: false,
        adversarial: false,
        stellar_steady_hand_charges: 0,
    };

    let result = run(
        &low,
        &[
            Action::BasicSynthesis,
            Action::BasicTouch,
            Action::BasicTouch,
        ],
    )
    .unwrap();

    assert_eq!(
        (
            result.cp,
            result.durability,
            result.progress,
            result.quality.value
        ),
        (14, 30, 4, 76)
    );
    assert_eq!(result.effects.inner_quiet, 0);
}
