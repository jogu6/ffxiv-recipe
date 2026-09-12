use serde::{Deserialize, Serialize};

mod actions;
mod contract;
mod mechanics;
mod raphael_bridge;
mod telemetry;
mod wasm_api;
#[cfg(target_arch = "wasm32")]
mod allocator;

#[cfg(all(target_arch = "wasm32", feature = "parallel"))]
pub use wasm_bindgen_rayon::init_thread_pool;

pub use actions::{ALL_ACTIONS, Action};
pub use contract::{IngredientInput, RecipeInput, SolveRequest};
pub use mechanics::{BaseIncreases, RecipeLevelModifiers, base_increases};
pub use raphael_bridge::{
    RaphaelSolveGoal, RaphaelSolveSettings, RaphaelSolveStage, solve_raphael_exact,
};
pub use telemetry::{SearchStage, SearchTelemetry};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct CrafterStats {
    pub level: u16,
    pub craftsmanship: u32,
    pub control: u32,
    pub cp: u32,
    pub manipulation: bool,
    pub heart_and_soul: bool,
    pub quick_innovation: bool,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct StatBonus {
    pub craftsmanship_percent: u32,
    pub craftsmanship_cap: u32,
    pub control_percent: u32,
    pub control_cap: u32,
    pub cp_percent: u32,
    pub cp_cap: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct EffectiveStats {
    pub level: u16,
    pub craftsmanship: u32,
    pub control: u32,
    pub cp: u32,
}

fn capped_bonus(base: u32, percent: u32, cap: u32) -> u32 {
    (u64::from(base) * u64::from(percent) / 100).min(u64::from(cap)) as u32
}

pub fn effective_stats(base: CrafterStats, bonuses: &[StatBonus]) -> EffectiveStats {
    let craftsmanship = bonuses.iter().fold(base.craftsmanship, |value, bonus| {
        value.saturating_add(capped_bonus(
            base.craftsmanship,
            bonus.craftsmanship_percent,
            bonus.craftsmanship_cap,
        ))
    });
    let control = bonuses.iter().fold(base.control, |value, bonus| {
        value.saturating_add(capped_bonus(
            base.control,
            bonus.control_percent,
            bonus.control_cap,
        ))
    });
    let cp = bonuses.iter().fold(base.cp, |value, bonus| {
        value.saturating_add(capped_bonus(base.cp, bonus.cp_percent, bonus.cp_cap))
    });
    EffectiveStats {
        level: base.level,
        craftsmanship,
        control,
        cp,
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IngredientQuality {
    pub amount: u32,
    pub hq: bool,
}

pub fn initial_quality(
    max_quality: u32,
    material_quality_percent: u32,
    ingredients: &[IngredientQuality],
) -> u32 {
    if ingredients.is_empty() {
        return 0;
    }
    let hq_types = ingredients
        .iter()
        .filter(|ingredient| ingredient.hq)
        .count() as u64;
    (u64::from(max_quality)
        .saturating_mul(u64::from(material_quality_percent.min(100)))
        .saturating_mul(hq_types)
        / (ingredients.len() as u64).saturating_mul(100)) as u32
}

#[cfg(test)]
mod tests {
    use super::*;

    fn crafter() -> CrafterStats {
        CrafterStats {
            level: 100,
            craftsmanship: 5000,
            control: 4800,
            cp: 600,
            manipulation: true,
            heart_and_soul: false,
            quick_innovation: false,
        }
    }

    #[test]
    fn consumable_bonuses_use_unbuffed_stats_and_caps() {
        let result = effective_stats(
            crafter(),
            &[
                StatBonus {
                    craftsmanship_percent: 5,
                    craftsmanship_cap: 150,
                    control_percent: 0,
                    control_cap: 0,
                    cp_percent: 10,
                    cp_cap: 40,
                },
                StatBonus {
                    craftsmanship_percent: 3,
                    craftsmanship_cap: 80,
                    control_percent: 2,
                    control_cap: 50,
                    cp_percent: 0,
                    cp_cap: 0,
                },
            ],
        );
        assert_eq!(result.craftsmanship, 5230);
        assert_eq!(result.control, 4850);
        assert_eq!(result.cp, 640);
    }

    #[test]
    fn initial_quality_splits_the_material_cap_evenly_by_intermediate_type() {
        assert_eq!(
            initial_quality(
                10_000,
                50,
                &[IngredientQuality {
                    amount: 2,
                    hq: true,
                }],
            ),
            5_000
        );
        let ingredients = [
            IngredientQuality {
                amount: 2,
                hq: true,
            },
            IngredientQuality {
                amount: 1,
                hq: false,
            },
        ];
        assert_eq!(initial_quality(10_000, 50, &ingredients), 2_500);
    }

    #[test]
    fn solve_request_rejects_missing_crafter_values() {
        let request = SolveRequest {
            data_version: "2026-09-03".into(),
            engine_version: "0.0.0".into(),
            crafter: CrafterStats { cp: 0, ..crafter() },
            food: None,
            medicine: None,
            recipe: RecipeInput {
                lodestone_id: "example".into(),
                name: "テストレシピ".into(),
                job: "木工師".into(),
                recipe_level: 100,
                required_job_level: 1,
                max_level_scaling: 0,
                difficulty: 100,
                durability: 70,
                max_quality: 10_000,
                material_quality_percent: 50,
                hq_available: true,
                required_quality: None,
                required_craftsmanship: 0,
                required_control: 0,
                expert: false,
                stellar_steady_hand_charges: 0,
                ingredients: vec![],
            },
        };
        assert_eq!(request.validate(), Err("製作ステータスが未入力です"));
    }

    #[test]
    fn solve_request_converts_hq_ingredient_state() {
        let request = SolveRequest {
            data_version: "2026-09-03".into(),
            engine_version: "0.0.0".into(),
            crafter: crafter(),
            food: None,
            medicine: None,
            recipe: RecipeInput {
                lodestone_id: "example".into(),
                name: "テストレシピ".into(),
                job: "木工師".into(),
                recipe_level: 100,
                required_job_level: 1,
                max_level_scaling: 0,
                difficulty: 100,
                durability: 70,
                max_quality: 10_000,
                material_quality_percent: 50,
                hq_available: true,
                required_quality: None,
                required_craftsmanship: 0,
                required_control: 0,
                expert: false,
                stellar_steady_hand_charges: 0,
                ingredients: vec![IngredientInput {
                    lodestone_id: "material".into(),
                    name: "中間素材".into(),
                    amount: 2,
                    hq: true,
                }],
            },
        };
        assert!(request.validate().is_ok());
        assert_eq!(
            request.ingredient_quality(),
            vec![IngredientQuality {
                amount: 2,
                hq: true,
            }]
        );
        let mut impossible = request.clone();
        impossible.recipe.required_craftsmanship = 6_000;
        assert_eq!(impossible.validate(), Err("作業精度が不足しています"));
    }

    #[test]
    fn base_increases_match_pinned_raphael_roast_chicken_vector() {
        // Raphael v0.28.6, commit 411168605989d573d89f2d71c01acac9f099e55a.
        let result = base_increases(
            100,
            4_956,
            4_963,
            RecipeLevelModifiers {
                job_level: 100,
                progress_divisor: 170,
                quality_divisor: 150,
                progress_modifier: 90,
                quality_modifier: 75,
            },
        )
        .unwrap();
        assert_eq!(
            result,
            BaseIncreases {
                progress: 264,
                quality: 274
            }
        );
    }

    #[test]
    fn base_increases_match_pinned_raphael_level_95_vector() {
        let result = base_increases(
            94,
            4_321,
            4_321,
            RecipeLevelModifiers {
                job_level: 95,
                progress_divisor: 155,
                quality_divisor: 135,
                progress_modifier: 100,
                quality_modifier: 100,
            },
        )
        .unwrap();
        assert_eq!(
            result,
            BaseIncreases {
                progress: 280,
                quality: 355
            }
        );
    }

    #[test]
    fn base_increases_reject_zero_divisors() {
        assert_eq!(
            base_increases(
                100,
                4_000,
                4_000,
                RecipeLevelModifiers {
                    job_level: 100,
                    progress_divisor: 0,
                    quality_divisor: 150,
                    progress_modifier: 90,
                    quality_modifier: 75,
                },
            ),
            None
        );
    }

    #[test]
    fn action_catalog_matches_pinned_raphael_action_count_and_waits() {
        assert_eq!(ALL_ACTIONS.len(), 35);
        assert_eq!(Action::Innovation.wait_seconds(), 2);
        assert_eq!(Action::BasicTouch.wait_seconds(), 3);
        assert_eq!(Action::TrainedPerfection.wait_seconds(), 3);
        assert_eq!(Action::StellarSteadyHand.wait_seconds(), 2);
    }

    #[test]
    fn user_options_control_optional_actions() {
        assert!(!Action::Manipulation.is_available(100, false, true, true));
        assert!(!Action::HeartAndSoul.is_available(100, true, false, true));
        assert!(!Action::QuickInnovation.is_available(100, true, true, false));
        assert!(Action::Manipulation.is_available(100, true, false, false));
        assert!(!Action::TrainedPerfection.is_available(99, true, true, true));
    }

}
