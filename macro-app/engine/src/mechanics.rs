use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecipeLevelModifiers {
    pub job_level: u16,
    pub progress_divisor: u32,
    pub quality_divisor: u32,
    pub progress_modifier: u32,
    pub quality_modifier: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BaseIncreases {
    pub progress: u32,
    pub quality: u32,
}

pub fn base_increases(
    crafter_level: u16,
    craftsmanship: u32,
    control: u32,
    recipe_level: RecipeLevelModifiers,
) -> Option<BaseIncreases> {
    if recipe_level.progress_divisor == 0 || recipe_level.quality_divisor == 0 {
        return None;
    }

    // The game performs these operations with single-precision values before truncation.
    let mut progress = craftsmanship as f32 * 10.0 / recipe_level.progress_divisor as f32 + 2.0;
    let mut quality = control as f32 * 10.0 / recipe_level.quality_divisor as f32 + 35.0;
    if crafter_level <= recipe_level.job_level {
        progress *= recipe_level.progress_modifier as f32 / 100.0;
        quality *= recipe_level.quality_modifier as f32 / 100.0;
    }

    Some(BaseIncreases {
        progress: progress as u32,
        quality: quality as u32,
    })
}
