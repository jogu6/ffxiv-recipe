use std::{cell::Cell, time::Instant};
use xivca_macro_engine::{base_increases, initial_quality, solve_raphael_exact, RaphaelSolveGoal, RaphaelSolveSettings};

fn main() {
    let path = std::env::args().nth(1).expect("profile JSON path");
    let document: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap();
    let input = &document["input"];
    let number = |key: &str| input[key].as_u64().unwrap() as u32;
    let flag = |key: &str| input[key].as_bool().unwrap_or(false);
    let base = base_increases(number("crafterLevel") as u16, number("craftsmanship"), number("control"),
        serde_json::from_value(input["recipeLevel"].clone()).unwrap()).unwrap();
    let initial = initial_quality(number("maxQuality"), number("materialQualityPercent"),
        &serde_json::from_value::<Vec<_>>(input["ingredients"].clone()).unwrap());
    let settings = RaphaelSolveSettings {
        max_cp: number("maxCp"), max_durability: number("maxDurability"),
        max_progress: number("maxProgress"), max_quality: number("maxQuality"),
        base_progress: base.progress, base_quality: base.quality, job_level: number("crafterLevel") as u16,
        manipulation_available: flag("manipulationAvailable"), heart_and_soul_available: flag("heartAndSoulAvailable"),
        quick_innovation_available: flag("quickInnovationAvailable"), trained_eye_available: flag("trainedEyeAvailable"),
        adversarial: flag("adversarial"), stellar_steady_hand_charges: number("stellarSteadyHandCharges") as u8,
    };
    let timer = Instant::now();
    let next = Cell::new(0);
    let result = solve_raphael_exact(&settings, initial,
        RaphaelSolveGoal { progress: number("maxProgress"), quality: number("targetQuality") },
        |_| {}, |progress| {
            if progress.processed_nodes >= next.get() {
                next.set(progress.processed_nodes + 1_000_000);
                println!("{:.2}s {:?}", timer.elapsed().as_secs_f64(), progress);
            }
        }, |stage| println!("{:.2}s {stage:?}", timer.elapsed().as_secs_f64()));
    println!("{:.2}s RESULT {result:?}", timer.elapsed().as_secs_f64());
    assert!(result.is_ok());
}
