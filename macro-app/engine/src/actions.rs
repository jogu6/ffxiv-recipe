use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Action {
    BasicSynthesis,
    BasicTouch,
    MastersMend,
    Observe,
    TricksOfTheTrade,
    WasteNot,
    Veneration,
    StandardTouch,
    GreatStrides,
    Innovation,
    WasteNotTwo,
    ByregotsBlessing,
    PreciseTouch,
    MuscleMemory,
    CarefulSynthesis,
    Manipulation,
    PrudentTouch,
    AdvancedTouch,
    Reflect,
    PreparatoryTouch,
    Groundwork,
    DelicateSynthesis,
    IntensiveSynthesis,
    TrainedEye,
    HeartAndSoul,
    PrudentSynthesis,
    TrainedFinesse,
    RefinedTouch,
    QuickInnovation,
    ImmaculateMend,
    TrainedPerfection,
    StellarSteadyHand,
    RapidSynthesis,
    HastyTouch,
    DaringTouch,
}

pub const ALL_ACTIONS: [Action; 35] = [
    Action::BasicSynthesis,
    Action::BasicTouch,
    Action::MastersMend,
    Action::Observe,
    Action::TricksOfTheTrade,
    Action::WasteNot,
    Action::Veneration,
    Action::StandardTouch,
    Action::GreatStrides,
    Action::Innovation,
    Action::WasteNotTwo,
    Action::ByregotsBlessing,
    Action::PreciseTouch,
    Action::MuscleMemory,
    Action::CarefulSynthesis,
    Action::Manipulation,
    Action::PrudentTouch,
    Action::AdvancedTouch,
    Action::Reflect,
    Action::PreparatoryTouch,
    Action::Groundwork,
    Action::DelicateSynthesis,
    Action::IntensiveSynthesis,
    Action::TrainedEye,
    Action::HeartAndSoul,
    Action::PrudentSynthesis,
    Action::TrainedFinesse,
    Action::RefinedTouch,
    Action::QuickInnovation,
    Action::ImmaculateMend,
    Action::TrainedPerfection,
    Action::StellarSteadyHand,
    Action::RapidSynthesis,
    Action::HastyTouch,
    Action::DaringTouch,
];

impl Action {
    pub const fn wait_seconds(self) -> u8 {
        match self {
            Self::WasteNot
            | Self::Veneration
            | Self::GreatStrides
            | Self::Innovation
            | Self::WasteNotTwo
            | Self::Manipulation
            | Self::StellarSteadyHand => 2,
            _ => 3,
        }
    }

    pub const fn level_requirement(self) -> u16 {
        match self {
            Self::BasicSynthesis => 1,
            Self::BasicTouch => 5,
            Self::MastersMend => 7,
            Self::RapidSynthesis | Self::HastyTouch => 9,
            Self::Observe | Self::TricksOfTheTrade => 13,
            Self::WasteNot | Self::Veneration => 15,
            Self::StandardTouch => 18,
            Self::GreatStrides => 21,
            Self::Innovation => 26,
            Self::WasteNotTwo => 47,
            Self::ByregotsBlessing => 50,
            Self::PreciseTouch => 53,
            Self::MuscleMemory => 54,
            Self::CarefulSynthesis => 62,
            Self::Manipulation => 65,
            Self::PrudentTouch => 66,
            Self::AdvancedTouch => 68,
            Self::Reflect => 69,
            Self::PreparatoryTouch => 71,
            Self::Groundwork => 72,
            Self::DelicateSynthesis => 76,
            Self::IntensiveSynthesis => 78,
            Self::TrainedEye => 80,
            Self::HeartAndSoul => 86,
            Self::PrudentSynthesis => 88,
            Self::TrainedFinesse | Self::StellarSteadyHand => 90,
            Self::RefinedTouch => 92,
            Self::QuickInnovation | Self::DaringTouch => 96,
            Self::ImmaculateMend => 98,
            Self::TrainedPerfection => 100,
        }
    }

    pub const fn is_available(
        self,
        level: u16,
        manipulation: bool,
        heart_and_soul: bool,
        quick_innovation: bool,
    ) -> bool {
        level >= self.level_requirement()
            && (!matches!(self, Self::Manipulation) || manipulation)
            && (!matches!(self, Self::HeartAndSoul) || heart_and_soul)
            && (!matches!(self, Self::QuickInnovation) || quick_innovation)
    }
}
