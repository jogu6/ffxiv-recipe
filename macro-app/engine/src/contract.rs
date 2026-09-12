use serde::{Deserialize, Serialize};

use crate::{CrafterStats, IngredientQuality, StatBonus, effective_stats};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecipeInput {
    pub lodestone_id: String,
    pub name: String,
    pub job: String,
    pub recipe_level: u16,
    #[serde(default)]
    pub required_job_level: u16,
    #[serde(default)]
    pub max_level_scaling: u16,
    pub difficulty: u32,
    pub durability: u32,
    pub max_quality: u32,
    pub material_quality_percent: u32,
    pub hq_available: bool,
    pub required_quality: Option<u32>,
    #[serde(default)]
    pub required_craftsmanship: u32,
    #[serde(default)]
    pub required_control: u32,
    #[serde(default)]
    pub expert: bool,
    #[serde(default)]
    pub stellar_steady_hand_charges: u8,
    pub ingredients: Vec<IngredientInput>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IngredientInput {
    pub lodestone_id: String,
    pub name: String,
    pub amount: u32,
    pub hq: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SolveRequest {
    pub data_version: String,
    pub engine_version: String,
    pub crafter: CrafterStats,
    pub food: Option<StatBonus>,
    pub medicine: Option<StatBonus>,
    pub recipe: RecipeInput,
}

impl SolveRequest {
    pub fn validate(&self) -> Result<(), &'static str> {
        if self.data_version.trim().is_empty() || self.engine_version.trim().is_empty() {
            return Err("データまたはエンジンの版がありません");
        }
        if self.recipe.lodestone_id.trim().is_empty()
            || self.recipe.name.trim().is_empty()
            || self.recipe.job.trim().is_empty()
        {
            return Err("製作アイテムの識別情報がありません");
        }
        if self.crafter.level == 0
            || self.crafter.craftsmanship == 0
            || self.crafter.control == 0
            || self.crafter.cp == 0
        {
            return Err("製作ステータスが未入力です");
        }
        if self.recipe.recipe_level == 0
            || self.recipe.difficulty == 0
            || self.recipe.durability == 0
        {
            return Err("レシピの製作条件が不正です");
        }
        if self.recipe.material_quality_percent > 100 {
            return Err("素材品質上限が不正です");
        }
        if self.recipe.hq_available && self.recipe.max_quality == 0 {
            return Err("HQ可能レシピに品質上限がありません");
        }
        if self.recipe.ingredients.iter().any(|ingredient| {
            ingredient.lodestone_id.trim().is_empty()
                || ingredient.name.trim().is_empty()
                || ingredient.amount == 0
        }) {
            return Err("中間素材情報が不正です");
        }
        if self.recipe.required_job_level > self.crafter.level {
            return Err("ジョブレベルが不足しています");
        }
        let bonuses: Vec<_> = [self.food, self.medicine].into_iter().flatten().collect();
        let stats = effective_stats(self.crafter, &bonuses);
        if stats.craftsmanship < self.recipe.required_craftsmanship {
            return Err("作業精度が不足しています");
        }
        if stats.control < self.recipe.required_control {
            return Err("加工精度が不足しています");
        }
        Ok(())
    }

    pub fn ingredient_quality(&self) -> Vec<IngredientQuality> {
        self.recipe
            .ingredients
            .iter()
            .map(|ingredient| IngredientQuality {
                amount: ingredient.amount,
                hq: ingredient.hq,
            })
            .collect()
    }
}
