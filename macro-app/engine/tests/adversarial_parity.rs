use xivca_macro_engine::{Action, Condition, SimulationSettings, SimulationState, use_action};

fn settings() -> SimulationSettings {
    SimulationSettings {
        max_cp: 1_000,
        max_durability: 80,
        max_progress: 2_000,
        max_quality: 40_000,
        base_progress: 100,
        base_quality: 100,
        job_level: 100,
        manipulation_available: true,
        heart_and_soul_available: true,
        quick_innovation_available: true,
        trained_eye_available: true,
        adversarial: true,
        stellar_steady_hand_charges: 0,
    }
}

fn guaranteed_quality(actions: &[Action]) -> u32 {
    let settings = settings();
    actions
        .iter()
        .try_fold(SimulationState::new(&settings, 0), |state, action| {
            use_action(state, *action, Condition::Normal, &settings)
        })
        .unwrap()
        .quality
        .value
}

#[test]
fn short_vectors_match_raphael_0286() {
    assert_eq!(
        guaranteed_quality(&[
            Action::Observe,
            Action::Observe,
            Action::PreparatoryTouch,
            Action::BasicSynthesis,
        ]),
        100
    );
    assert_eq!(guaranteed_quality(&[Action::Reflect]), 300);
    assert_eq!(
        guaranteed_quality(&[
            Action::Reflect,
            Action::PreparatoryTouch,
            Action::PreparatoryTouch,
            Action::PreparatoryTouch,
        ]),
        1_140
    );
}

#[test]
fn alternating_quality_vector_matches_raphael_0286() {
    assert_eq!(
        guaranteed_quality(&[
            Action::MuscleMemory,
            Action::GreatStrides,
            Action::BasicTouch,
            Action::GreatStrides,
            Action::BasicTouch,
            Action::GreatStrides,
            Action::BasicTouch,
        ]),
        440
    );
}

#[test]
fn long_vector_matches_raphael_0286() {
    assert_eq!(
        guaranteed_quality(&[
            Action::Reflect,
            Action::Manipulation,
            Action::Innovation,
            Action::WasteNotTwo,
            Action::BasicTouch,
            Action::StandardTouch,
            Action::PreparatoryTouch,
            Action::Veneration,
            Action::DelicateSynthesis,
            Action::Groundwork,
            Action::Groundwork,
            Action::Groundwork,
            Action::Innovation,
            Action::BasicTouch,
            Action::StandardTouch,
            Action::AdvancedTouch,
            Action::ByregotsBlessing,
            Action::CarefulSynthesis,
        ]),
        2_924
    );
}
