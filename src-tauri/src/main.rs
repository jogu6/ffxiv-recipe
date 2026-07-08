#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde_json::Value;
use serde_json::json;
use std::io::{BufRead, BufReader};
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::{Arc, Mutex};
use tauri::Emitter;
use tauri::Manager;

#[cfg(windows)]
use std::os::windows::process::CommandExt;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;

struct PipelineProcess {
    pid: Arc<Mutex<Option<u32>>>,
}

fn write_cancel_request() -> Result<(), String> {
    let path = repo_root()?
        .join("pipeline")
        .join("state")
        .join("cancel-requested.json");
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    std::fs::write(path, r#"{"cancelled":true}"#).map_err(|error| error.to_string())
}

fn repo_root() -> Result<PathBuf, String> {
    let mut candidates = Vec::new();
    candidates.push(std::env::current_dir().map_err(|error| error.to_string())?);
    if let Ok(exe) = std::env::current_exe() {
        if let Some(parent) = exe.parent() {
            candidates.push(parent.to_path_buf());
        }
    }

    for candidate in candidates {
        for ancestor in candidate.ancestors() {
            if ancestor
                .join("pipeline")
                .join("tool")
                .join("pipeline-tool.mjs")
                .exists()
            {
                return Ok(ancestor.to_path_buf());
            }
        }
    }
    Err("Could not locate repository root from current directory or executable path.".to_string())
}

fn stop_pipeline_process(process: &PipelineProcess) -> Result<(), String> {
    let _ = write_cancel_request();
    let pid = {
        let pid = process.pid.lock().map_err(|error| error.to_string())?;
        *pid
    };
    let Some(pid) = pid else {
        return Ok(());
    };
    let mut stop_command = if cfg!(windows) {
        let mut command = Command::new("taskkill");
        command.args(["/PID", &pid.to_string(), "/T", "/F"]);
        command
    } else {
        let mut command = Command::new("kill");
        command.args(["-TERM", &pid.to_string()]);
        command
    };
    #[cfg(windows)]
    stop_command.creation_flags(CREATE_NO_WINDOW);
    let status = stop_command.status().map_err(|error| error.to_string())?;
    if status.success() {
        let mut stored = process.pid.lock().map_err(|error| error.to_string())?;
        *stored = None;
        Ok(())
    } else {
        Err(format!("Failed to stop process {pid}"))
    }
}

fn run_pipeline_script(
    app: Option<tauri::AppHandle>,
    pid_store: Option<Arc<Mutex<Option<u32>>>>,
    command: String,
    args: Vec<String>,
) -> Result<String, String> {
    let root = repo_root()?;
    let script = root.join("pipeline").join("tool").join("pipeline-tool.mjs");
    let mut command_args = vec!["--expose-gc".to_string(), script.to_string_lossy().to_string(), command];
    command_args.extend(args);
    let mut child_command = Command::new("node");
    child_command
        .args(command_args)
        .current_dir(root)
        .env("FFXIV_RECIPE_GUI", "1")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(windows)]
    child_command.creation_flags(CREATE_NO_WINDOW);
    let mut child = child_command
        .spawn()
        .map_err(|error| error.to_string())?;
    if let Some(pid_store) = pid_store.as_ref() {
        let mut pid = pid_store.lock().map_err(|error| error.to_string())?;
        *pid = Some(child.id());
    }

    let stdout = child.stdout.take().ok_or_else(|| "stdout unavailable".to_string())?;
    let stderr = child.stderr.take().ok_or_else(|| "stderr unavailable".to_string())?;
    let app_stdout = app.clone();
    let stdout_thread = std::thread::spawn(move || {
        let mut text = String::new();
        for line in BufReader::new(stdout).lines().map_while(Result::ok) {
            let is_eta_line = line.starts_with("__ETA__ ");
            if let Some(app) = app_stdout.as_ref() {
                if let Err(error) = app.emit("pipeline-output", line.clone()) {
                    eprintln!("pipeline-output emit failed: {error}");
                }
            }
            if is_eta_line {
                continue;
            }
            text.push_str(&line);
            text.push('\n');
        }
        text
    });
    let app_stderr = app.clone();
    let stderr_thread = std::thread::spawn(move || {
        let mut text = String::new();
        for line in BufReader::new(stderr).lines().map_while(Result::ok) {
            if let Some(app) = app_stderr.as_ref() {
                if let Err(error) = app.emit("pipeline-output", line.clone()) {
                    eprintln!("pipeline-output emit failed: {error}");
                }
            }
            text.push_str(&line);
            text.push('\n');
        }
        text
    });

    let status = child.wait().map_err(|error| error.to_string())?;
    if let Some(pid_store) = pid_store.as_ref() {
        let mut pid = pid_store.lock().map_err(|error| error.to_string())?;
        *pid = None;
    }
    let stdout_text = stdout_thread.join().map_err(|_| "stdout thread failed".to_string())?;
    let stderr_text = stderr_thread.join().map_err(|_| "stderr thread failed".to_string())?;
    if status.success() {
        Ok(stdout_text)
    } else {
        Err(format!("{}{}", stdout_text, stderr_text))
    }
}

#[tauri::command]
async fn run_pipeline_command(
    app: tauri::AppHandle,
    process: tauri::State<'_, PipelineProcess>,
    command: String,
    args: Vec<String>,
) -> Result<String, String> {
    let pid_store = process.pid.clone();
    tauri::async_runtime::spawn_blocking(move || run_pipeline_script(Some(app), Some(pid_store), command, args))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
fn cancel_pipeline_command(process: tauri::State<PipelineProcess>) -> Result<(), String> {
    stop_pipeline_process(&process)
}

#[tauri::command]
fn read_update_state() -> Result<Value, String> {
    let path = repo_root()?
        .join("pipeline")
        .join("state")
        .join("update-check.json");
    if !path.exists() {
        return Ok(serde_json::json!({}));
    }
    let text = std::fs::read_to_string(path).map_err(|error| error.to_string())?;
    serde_json::from_str(&text).map_err(|error| error.to_string())
}

fn preview_root() -> Result<PathBuf, String> {
    Ok(repo_root()?.join("site").join("__tmp_icon_quality"))
}

fn data_url(file: &std::path::Path) -> Result<String, String> {
    let bytes = std::fs::read(file).map_err(|error| error.to_string())?;
    let mime = match file.extension().and_then(|ext| ext.to_str()).unwrap_or("") {
        "png" => "image/png",
        "webp" => "image/webp",
        _ => "application/octet-stream",
    };
    const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut encoded = String::with_capacity((bytes.len() + 2) / 3 * 4);
    for chunk in bytes.chunks(3) {
        let b0 = chunk[0];
        let b1 = *chunk.get(1).unwrap_or(&0);
        let b2 = *chunk.get(2).unwrap_or(&0);
        encoded.push(TABLE[(b0 >> 2) as usize] as char);
        encoded.push(TABLE[(((b0 & 0x03) << 4) | (b1 >> 4)) as usize] as char);
        encoded.push(if chunk.len() > 1 { TABLE[(((b1 & 0x0f) << 2) | (b2 >> 6)) as usize] as char } else { '=' });
        encoded.push(if chunk.len() > 2 { TABLE[(b2 & 0x3f) as usize] as char } else { '=' });
    }
    Ok(format!("data:{mime};base64,{encoded}"))
}

fn png_dimensions(file: &std::path::Path) -> Option<(u32, u32)> {
    let bytes = std::fs::read(file).ok()?;
    if bytes.len() < 24 || &bytes[0..8] != b"\x89PNG\r\n\x1a\n" {
        return None;
    }
    let width = u32::from_be_bytes([bytes[16], bytes[17], bytes[18], bytes[19]]);
    let height = u32::from_be_bytes([bytes[20], bytes[21], bytes[22], bytes[23]]);
    Some((width, height))
}

#[tauri::command]
fn read_quality_preview_state() -> Result<Value, String> {
    let root = preview_root()?;
    Ok(json!({
        "available": root.join("manifest.json").exists() && root.join("preview-data.json").exists()
    }))
}

#[tauri::command]
fn read_quality_preview() -> Result<Value, String> {
    let root = preview_root()?;
    let text = std::fs::read_to_string(root.join("preview-data.json")).map_err(|error| error.to_string())?;
    let mut rows: Value = serde_json::from_str(&text).map_err(|error| error.to_string())?;
    if let Some(items) = rows.as_array_mut() {
        for row in items {
            if let Some(file) = row.get("pngFile").and_then(|value| value.as_str()) {
                let path = root.join(file);
                if row.get("pngWidth").and_then(|value| value.as_u64()).is_none() {
                    if let Some((width, height)) = png_dimensions(&path) {
                        row["pngWidth"] = json!(width);
                        row["pngHeight"] = json!(height);
                    }
                }
                row["pngFile"] = json!(data_url(&path)?);
            }
            if let Some(variants) = row.get_mut("variants").and_then(|value| value.as_array_mut()) {
                for variant in variants {
                    if let Some(file) = variant.get("file").and_then(|value| value.as_str()) {
                        variant["file"] = json!(data_url(&root.join(file))?);
                    }
                }
            }
        }
    }
    Ok(rows)
}

fn main() {
    if std::env::args().any(|arg| arg == "--pipeline-smoke") {
        match run_pipeline_script(None, None, "smoke-test".to_string(), Vec::new()) {
            Ok(output) => {
                print!("{output}");
                return;
            }
            Err(error) => {
                eprint!("{error}");
                std::process::exit(1);
            }
        }
    }

    tauri::Builder::default()
        .manage(PipelineProcess { pid: Arc::new(Mutex::new(None)) })
        .on_window_event(|window, event| {
            if matches!(event, tauri::WindowEvent::CloseRequested { .. }) {
                let process = window.state::<PipelineProcess>();
                let _ = stop_pipeline_process(&process);
            }
        })
        .invoke_handler(tauri::generate_handler![run_pipeline_command, cancel_pipeline_command, read_update_state, read_quality_preview_state, read_quality_preview])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
