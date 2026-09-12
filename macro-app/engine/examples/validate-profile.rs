// Replays a saved browser result without running the search again.
use xivca_macro_engine::{Action, base_increases, initial_quality};
use raphael_sim::{Action as RaphaelAction, ActionMask, Settings, SimulationState};
fn map_action(action: Action) -> RaphaelAction {
    match action {
        Action::BasicSynthesis => RaphaelAction::BasicSynthesis,
        Action::BasicTouch => RaphaelAction::BasicTouch,
        Action::MastersMend => RaphaelAction::MasterMend,
        Action::Observe => RaphaelAction::Observe,
        Action::TricksOfTheTrade => RaphaelAction::TricksOfTheTrade,
        Action::WasteNot => RaphaelAction::WasteNot,
        Action::Veneration => RaphaelAction::Veneration,
        Action::StandardTouch => RaphaelAction::StandardTouch,
        Action::GreatStrides => RaphaelAction::GreatStrides,
        Action::Innovation => RaphaelAction::Innovation,
        Action::WasteNotTwo => RaphaelAction::WasteNot2,
        Action::ByregotsBlessing => RaphaelAction::ByregotsBlessing,
        Action::PreciseTouch => RaphaelAction::PreciseTouch,
        Action::MuscleMemory => RaphaelAction::MuscleMemory,
        Action::CarefulSynthesis => RaphaelAction::CarefulSynthesis,
        Action::Manipulation => RaphaelAction::Manipulation,
        Action::PrudentTouch => RaphaelAction::PrudentTouch,
        Action::AdvancedTouch => RaphaelAction::AdvancedTouch,
        Action::Reflect => RaphaelAction::Reflect,
        Action::PreparatoryTouch => RaphaelAction::PreparatoryTouch,
        Action::Groundwork => RaphaelAction::Groundwork,
        Action::DelicateSynthesis => RaphaelAction::DelicateSynthesis,
        Action::IntensiveSynthesis => RaphaelAction::IntensiveSynthesis,
        Action::TrainedEye => RaphaelAction::TrainedEye,
        Action::HeartAndSoul => RaphaelAction::HeartAndSoul,
        Action::PrudentSynthesis => RaphaelAction::PrudentSynthesis,
        Action::TrainedFinesse => RaphaelAction::TrainedFinesse,
        Action::RefinedTouch => RaphaelAction::RefinedTouch,
        Action::QuickInnovation => RaphaelAction::QuickInnovation,
        Action::ImmaculateMend => RaphaelAction::ImmaculateMend,
        Action::TrainedPerfection => RaphaelAction::TrainedPerfection,
        Action::StellarSteadyHand => RaphaelAction::StellarSteadyHand,
        Action::RapidSynthesis => RaphaelAction::RapidSynthesis,
        Action::HastyTouch => RaphaelAction::HastyTouch,
        Action::DaringTouch => RaphaelAction::DaringTouch,
    }
}
fn main() {
    for path in std::env::args().skip(1) {
        let document: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
        let input = &document["input"];
        let number = |key: &str| input[key].as_u64().unwrap() as u32;
        let flag = |key: &str| input[key].as_bool().unwrap_or(false);
        let actions: Vec<Action> = serde_json::from_value(document["result"]["actions"].clone()).unwrap();
        let base = base_increases(number("crafterLevel") as u16, number("craftsmanship"), number("control"),
            serde_json::from_value(input["recipeLevel"].clone()).unwrap()).unwrap();
        let initial = initial_quality(number("maxQuality"), number("materialQualityPercent"),
            &serde_json::from_value::<Vec<_>>(input["ingredients"].clone()).unwrap());
        let mut allowed = ActionMask::all();
        for (enabled, action) in [("manipulationAvailable", RaphaelAction::Manipulation),
            ("heartAndSoulAvailable", RaphaelAction::HeartAndSoul),
            ("quickInnovationAvailable", RaphaelAction::QuickInnovation),
            ("trainedEyeAvailable", RaphaelAction::TrainedEye)] {
            if !flag(enabled) { allowed = allowed.remove(action); }
        }
        let settings = Settings {
            max_cp: number("maxCp") as u16, max_durability: number("maxDurability") as u16,
            max_progress: number("maxProgress") as u16,
            max_quality: number("targetQuality").saturating_sub(initial) as u16,
            base_progress: base.progress as u16, base_quality: base.quality as u16,
            job_level: number("crafterLevel") as u8, allowed_actions: allowed,
            adversarial: flag("adversarial"), backload_progress: false,
            stellar_steady_hand_charges: number("stellarSteadyHandCharges") as u8,
        };
        let duration: u32 = actions.iter().map(|action| action.wait_seconds() as u32).sum();
        let mapped: Vec<_> = actions.iter().copied().map(map_action).collect();
        let final_state = SimulationState::from_macro(&settings, &mapped).expect("生成マクロに実行できないアクションがあります");
        assert!(final_state.progress >= settings.max_progress);
        assert!(final_state.quality >= settings.max_quality);
        assert_eq!(Some(duration as u64), document["result"]["duration"].as_u64());
        println!("{}", serde_json::json!({ "file": path, "valid": true, "actions": actions.len(),
            "progress": final_state.progress, "guaranteedQuality": initial + final_state.quality as u32,
            "remainingCp": final_state.cp, "remainingDurability": final_state.durability, "duration": duration }));
    }
}
