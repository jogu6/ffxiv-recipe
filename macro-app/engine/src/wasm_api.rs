use serde::{Deserialize, Serialize};
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub fn configure_storage_cache(bytes: u32) {
    raphael_solver::set_storage_cache_bytes(bytes as usize);
}

use crate::{
    Action, IngredientQuality, RaphaelSolveGoal, RaphaelSolveSettings, RaphaelSolveStage,
    RecipeLevelModifiers, SearchStage, SearchTelemetry, base_increases, initial_quality,
    solve_raphael_exact,
};

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SearchInput {
    crafter_level: u16,
    craftsmanship: u32,
    control: u32,
    max_cp: u32,
    max_durability: u32,
    max_progress: u32,
    max_quality: u32,
    #[serde(default)]
    required_craftsmanship: u32,
    #[serde(default)]
    required_control: u32,
    recipe_level: RecipeLevelModifiers,
    material_quality_percent: u32,
    ingredients: Vec<IngredientQuality>,
    target_quality: u32,
    manipulation_available: bool,
    heart_and_soul_available: bool,
    quick_innovation_available: bool,
    trained_eye_available: bool,
    adversarial: bool,
    stellar_steady_hand_charges: u8,
}

impl SearchInput {
    fn prepare(&self) -> Result<(RaphaelSolveSettings, u32, RaphaelSolveGoal), &'static str> {
        if self.crafter_level == 0
            || self.craftsmanship == 0
            || self.control == 0
            || self.max_cp == 0
            || self.max_durability == 0
            || self.max_progress == 0
            || self.target_quality > self.max_quality
            || self.material_quality_percent > 100
            || self.crafter_level < self.recipe_level.job_level
            || self.craftsmanship < self.required_craftsmanship
            || self.control < self.required_control
        {
            return Err("探索条件が不正です");
        }
        let base = base_increases(
            self.crafter_level,
            self.craftsmanship,
            self.control,
            self.recipe_level,
        )
        .ok_or("レシピレベル補正が不正です")?;
        let settings = RaphaelSolveSettings {
            max_cp: self.max_cp,
            max_durability: self.max_durability,
            max_progress: self.max_progress,
            max_quality: self.max_quality,
            base_progress: base.progress,
            base_quality: base.quality,
            job_level: self.crafter_level,
            manipulation_available: self.manipulation_available,
            heart_and_soul_available: self.heart_and_soul_available,
            quick_innovation_available: self.quick_innovation_available,
            trained_eye_available: self.trained_eye_available,
            adversarial: self.adversarial,
            stellar_steady_hand_charges: self.stellar_steady_hand_charges,
        };
        let initial = initial_quality(
            self.max_quality,
            self.material_quality_percent,
            &self.ingredients,
        );
        let goal = RaphaelSolveGoal {
            progress: self.max_progress,
            quality: self.target_quality,
        };
        Ok((settings, initial, goal))
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DurationResult {
    actions: Option<Vec<Action>>,
    duration: Option<u32>,
}

fn parse_input(value: &str) -> Result<SearchInput, JsValue> {
    serde_json::from_str::<SearchInput>(value)
        .map_err(|error| JsValue::from_str(&format!("探索入力形式が不正です: {error}")))
}

#[wasm_bindgen]
pub fn solve_exact_observed_json(
    value: &str,
    observer: &js_sys::Function,
) -> Result<String, JsValue> {
    use std::cell::Cell;

    let input = parse_input(value)?;
    let (settings, initial, goal) = input.prepare().map_err(JsValue::from_str)?;
    let latest = Cell::new(SearchTelemetry::default());
    let next_search_emit = Cell::new(50_000_u64);
    let emit = |stage: SearchStage| {
        let snapshot = SearchTelemetry {
            stage,
            ..latest.get()
        };
        if let Ok(json) = serde_json::to_string(&snapshot) {
            let _ = observer.call1(&JsValue::NULL, &JsValue::from_str(&json));
        }
    };
    let actions = solve_raphael_exact(
        &settings,
        initial,
        goal,
        |_| {},
        |progress| {
            let nodes = progress.processed_nodes as u64;
            let snapshot = SearchTelemetry {
                stage: SearchStage::BestFirstSearch,
                work_units: nodes,
                search_nodes: nodes,
                search_generated_nodes: progress.inserted_nodes as u64,
                search_queued_nodes: progress.queue.queued_nodes as u64,
                search_popped_nodes: progress.queue.popped_nodes as u64,
                search_dropped_nodes: progress.queue.dropped_nodes as u64,
                search_pareto_rejected_nodes: progress.queue.pareto_rejected_nodes as u64,
                visited_capacity_bytes: progress.queue.visited_capacity_bytes,
                queued_capacity_bytes: progress.queue.queued_capacity_bytes,
                replay_ms: progress.queue.replay_ms,
                pareto_ms: progress.queue.pareto_ms,
                expansion_ms: progress.expansion_ms,
                merge_ms: progress.merge_ms,
                storage_resident_bytes: progress.queue.storage_resident_bytes,
                storage_allocated_bytes: progress.queue.storage_allocated_bytes,
                storage_page_reads: progress.queue.storage_page_reads,
                storage_page_writes: progress.queue.storage_page_writes,
                storage_pressure_events: progress.queue.storage_pressure_events,
                pareto_capacity_bytes: progress.queue.pareto_capacity_bytes,
                quality_bound_bytes: progress.quality_bound_bytes,
                step_bound_bytes: progress.step_bound_bytes,
                candidate_capacity_bytes: progress.candidate_capacity_bytes,
                ..SearchTelemetry::default()
            };
            latest.set(snapshot);
            if nodes < next_search_emit.get() {
                return;
            }
            next_search_emit.set(nodes.saturating_add(50_000));
            if let Ok(json) = serde_json::to_string(&snapshot) {
                let _ = observer.call1(&JsValue::NULL, &JsValue::from_str(&json));
            }
        },
        |stage| {
            let stage = match stage {
                RaphaelSolveStage::FinishSolver => SearchStage::FinishBound,
                RaphaelSolveStage::QualityUpperBound => SearchStage::ResourceQualityBound,
                RaphaelSolveStage::StepLowerBound => SearchStage::StepLowerBound,
                RaphaelSolveStage::Search => SearchStage::BestFirstSearch,
                RaphaelSolveStage::Complete => SearchStage::Complete,
            };
            emit(stage);
        },
    )
    .map_err(|error| JsValue::from_str(&format!("マクロを生成できません: {error}")))?;
    let duration = actions
        .iter()
        .map(|action| u32::from(action.wait_seconds()))
        .sum();
    serde_json::to_string(&DurationResult {
        actions: Some(actions),
        duration: Some(duration),
    })
    .map_err(|error| JsValue::from_str(&format!("探索結果を出力できません: {error}")))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn prepares_only_solver_state_from_raw_browser_input() {
        let input = SearchInput {
            crafter_level: 100,
            craftsmanship: 4_956,
            control: 4_963,
            max_cp: 600,
            max_durability: 70,
            max_progress: 1_000,
            max_quality: 10_000,
            required_craftsmanship: 4_000,
            required_control: 4_000,
            recipe_level: RecipeLevelModifiers {
                job_level: 100,
                progress_divisor: 170,
                quality_divisor: 150,
                progress_modifier: 90,
                quality_modifier: 75,
            },
            material_quality_percent: 50,
            ingredients: vec![IngredientQuality {
                amount: 1,
                hq: true,
            }],
            target_quality: 10_000,
            manipulation_available: true,
            heart_and_soul_available: false,
            quick_innovation_available: false,
            trained_eye_available: false,
            adversarial: true,
            stellar_steady_hand_charges: 0,
        };

        let (settings, initial, goal) = input.prepare().unwrap();

        assert_eq!(settings.base_progress, 264);
        assert_eq!(settings.base_quality, 274);
        assert_eq!(initial, 5_000);
        assert_eq!(goal.quality, 10_000);

        let mut insufficient = input;
        insufficient.required_craftsmanship = insufficient.craftsmanship + 1;
        assert!(insufficient.prepare().is_err());
    }
}
