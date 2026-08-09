#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde_json::Value;
use serde_json::json;
use std::fs::{File, OpenOptions};
use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::Emitter;
use tauri::Manager;

#[cfg(windows)]
use std::os::windows::process::CommandExt;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;

struct PipelineProcess {
    pid: Arc<Mutex<Option<u32>>>,
}

struct RunLogs {
    run: File,
    latest: File,
}

fn unix_millis() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
}

fn jst_timestamp() -> String {
    let millis = unix_millis() as i64;
    let seconds = millis.div_euclid(1000) + 9 * 60 * 60;
    let days = seconds.div_euclid(86_400);
    let day_seconds = seconds.rem_euclid(86_400);
    let shifted = days + 719_468;
    let era = shifted.div_euclid(146_097);
    let day_of_era = shifted - era * 146_097;
    let year_of_era = (day_of_era - day_of_era / 1_460 + day_of_era / 36_524 - day_of_era / 146_096) / 365;
    let mut year = year_of_era + era * 400;
    let day_of_year = day_of_era - (365 * year_of_era + year_of_era / 4 - year_of_era / 100);
    let month_prime = (5 * day_of_year + 2) / 153;
    let day = day_of_year - (153 * month_prime + 2) / 5 + 1;
    let month = month_prime + if month_prime < 10 { 3 } else { -9 };
    year += if month <= 2 { 1 } else { 0 };
    let hour = day_seconds / 3_600;
    let minute = day_seconds % 3_600 / 60;
    let second = day_seconds % 60;
    format!("{year:04}-{month:02}-{day:02}T{hour:02}:{minute:02}:{second:02}+09:00")
}

fn create_run_logs(root: &std::path::Path, command: &str) -> Result<Arc<Mutex<RunLogs>>, String> {
    let logs_root = root.join("pipeline").join("logs");
    let runs_root = logs_root.join("runs");
    std::fs::create_dir_all(&runs_root).map_err(|error| error.to_string())?;
    let safe_command: String = command
        .chars()
        .map(|value| if value.is_ascii_alphanumeric() || value == '-' { value } else { '_' })
        .collect();
    let run_path = runs_root.join(format!("{}-{}.log", unix_millis(), safe_command));
    let run = OpenOptions::new()
        .create(true)
        .append(true)
        .open(run_path)
        .map_err(|error| error.to_string())?;
    let latest = OpenOptions::new()
        .create(true)
        .append(true)
        .open(logs_root.join("latest.log"))
        .map_err(|error| error.to_string())?;
    Ok(Arc::new(Mutex::new(RunLogs { run, latest })))
}

fn append_run_log(logs: &Arc<Mutex<RunLogs>>, stream: &str, line: &str) {
    let Ok(mut files) = logs.lock() else {
        return;
    };
    let entry = format!("[{}] [{}] {}\n", jst_timestamp(), stream, line);
    let _ = files.run.write_all(entry.as_bytes());
    let _ = files.latest.write_all(entry.as_bytes());
    let _ = files.run.flush();
    let _ = files.latest.flush();
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
    let logs = create_run_logs(&root, &command)?;
    append_run_log(&logs, "INFO", &format!("開始: {command} {}", args.join(" ")));
    let script = root.join("pipeline").join("tool").join("pipeline-tool.mjs");
    let mut command_args = vec!["--expose-gc".to_string(), script.to_string_lossy().to_string(), command.clone()];
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
    let stdout_logs = logs.clone();
    let stdout_thread = std::thread::spawn(move || {
        let mut text = String::new();
        for line in BufReader::new(stdout).lines().map_while(Result::ok) {
            append_run_log(&stdout_logs, "OUT", &line);
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
    let stderr_logs = logs.clone();
    let stderr_thread = std::thread::spawn(move || {
        let mut text = String::new();
        for line in BufReader::new(stderr).lines().map_while(Result::ok) {
            append_run_log(&stderr_logs, "ERR", &line);
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
    append_run_log(
        &logs,
        "INFO",
        &format!("終了: {command} code={}", status.code().unwrap_or(-1)),
    );
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
    let _ = process;
    write_cancel_request()
}

#[tauri::command]
fn read_pipeline_ui_definition() -> Result<Value, String> {
    let root = repo_root()?;
    let script = root
        .join("pipeline")
        .join("tool")
        .join("pipeline-ui-definition.mjs");
    let mut command = Command::new("node");
    command
        .arg(script)
        .current_dir(root)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(windows)]
    command.creation_flags(CREATE_NO_WINDOW);
    let output = command.output().map_err(|error| error.to_string())?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }
    serde_json::from_slice(&output.stdout).map_err(|error| error.to_string())
}

#[tauri::command]
fn read_pipeline_workflow_status() -> Result<Value, String> {
    let root = repo_root()?;
    let script = root
        .join("pipeline")
        .join("tool")
        .join("pipeline-tool.mjs");
    let mut command = Command::new("node");
    command
        .arg(script)
        .arg("workflow-status")
        .current_dir(root)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(windows)]
    command.creation_flags(CREATE_NO_WINDOW);
    let output = command.output().map_err(|error| error.to_string())?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }
    serde_json::from_slice(&output.stdout).map_err(|error| error.to_string())
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

#[tauri::command]
fn read_oxidizer_import_preview() -> Result<Value, String> {
    let path = repo_root()?
        .join("pipeline")
        .join("state")
        .join("oxidizer-import.json");
    if !path.exists() {
        return Err("Oxidizer CSVの差分確認結果がありません。".to_string());
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

#[tauri::command]
fn read_equipment_role_groups() -> Result<Value, String> {
    let output = run_pipeline_script(None, None, "equipment-role-groups".to_string(), Vec::new())?;
    let mut groups: Value = serde_json::from_str(&output).map_err(|error| error.to_string())?;
    let icon_root = repo_root()?.join("site").join("assets").join("item-icons");
    if let Some(group_rows) = groups.as_array_mut() {
        for group in group_rows {
            let Some(items) = group.get_mut("items").and_then(|value| value.as_array_mut()) else {
                continue;
            };
            for item in items {
                let Some(icon_file) = item.get("iconFile").and_then(|value| value.as_str()) else {
                    continue;
                };
                if icon_file.len() < 3 {
                    continue;
                }
                let icon_path = icon_root.join(&icon_file[..3]).join(icon_file);
                if icon_path.is_file() {
                    item["iconDataUrl"] = json!(data_url(&icon_path)?);
                }
            }
        }
    }
    Ok(groups)
}

#[tauri::command]
fn read_equipment_role_summary() -> Result<Value, String> {
    let output = run_pipeline_script(None, None, "equipment-role-summary".to_string(), Vec::new())?;
    serde_json::from_str(&output).map_err(|error| error.to_string())
}

#[tauri::command]
fn save_equipment_role_overrides(overrides: Value) -> Result<(), String> {
    let path = repo_root()?
        .join("pipeline")
        .join("input")
        .join("equipment-role-overrides.json");
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let text = serde_json::to_string_pretty(&overrides).map_err(|error| error.to_string())?;
    std::fs::write(path, format!("{text}\n")).map_err(|error| error.to_string())
}

#[tauri::command]
fn read_publication_review() -> Result<Value, String> {
    let output = run_pipeline_script(None, None, "publication-review".to_string(), Vec::new())?;
    serde_json::from_str(output.trim()).map_err(|error| error.to_string())
}

#[tauri::command]
fn save_publication_decisions(decisions: Value) -> Result<(), String> {
    let root = repo_root()?;
    let path = root
        .join("pipeline")
        .join("input")
        .join("publication-decisions.json");
    let mut current: Value = if path.exists() {
        let text = std::fs::read_to_string(&path).map_err(|error| error.to_string())?;
        serde_json::from_str(&text).map_err(|error| error.to_string())?
    } else {
        json!({ "version": 1, "items": {} })
    };
    let current_items = current
        .get_mut("items")
        .and_then(Value::as_object_mut)
        .ok_or_else(|| "既存の公開判定ファイルが不正です".to_string())?;
    let incoming = decisions
        .get("items")
        .and_then(Value::as_object)
        .ok_or_else(|| "公開判定データが不正です".to_string())?;
    for (id, decision) in incoming {
        let kind = decision.get("decision").and_then(Value::as_str).unwrap_or("");
        let reason = decision.get("reason").and_then(Value::as_str).unwrap_or("").trim();
        if !matches!(kind, "keep" | "exclude" | "hold") || reason.is_empty() {
            return Err(format!("{id}: 判定または理由が不正です"));
        }
        current_items.insert(id.clone(), decision.clone());
    }
    current["version"] = json!(1);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let text = serde_json::to_string_pretty(&current).map_err(|error| error.to_string())?;
    std::fs::write(path, format!("{text}\n")).map_err(|error| error.to_string())
}

#[tauri::command]
fn open_log_directory() -> Result<(), String> {
    let path = repo_root()?.join("pipeline").join("logs");
    std::fs::create_dir_all(&path).map_err(|error| error.to_string())?;
    let mut command = if cfg!(windows) {
        let mut command = Command::new("explorer.exe");
        command.arg(&path);
        command
    } else if cfg!(target_os = "macos") {
        let mut command = Command::new("open");
        command.arg(&path);
        command
    } else {
        let mut command = Command::new("xdg-open");
        command.arg(&path);
        command
    };
    #[cfg(windows)]
    command.creation_flags(CREATE_NO_WINDOW);
    command.spawn().map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
fn select_directory(initial_path: String) -> Result<String, String> {
    if !cfg!(windows) {
        return Err("フォルダー選択は現在Windows版でのみ利用できます".to_string());
    }
    let script = r#"
Add-Type -AssemblyName System.Windows.Forms
$dialog = New-Object System.Windows.Forms.FolderBrowserDialog
if ($args[0] -and (Test-Path -LiteralPath $args[0])) { $dialog.SelectedPath = $args[0] }
if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {
  [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
  Write-Output $dialog.SelectedPath
}
"#;
    let mut command = Command::new("powershell.exe");
    command
        .args(["-NoProfile", "-STA", "-Command", script, initial_path.as_str()])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(windows)]
    command.creation_flags(CREATE_NO_WINDOW);
    let output = command.output().map_err(|error| error.to_string())?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

#[tauri::command]
fn select_file(initial_path: String) -> Result<String, String> {
    if !cfg!(windows) {
        return Err("ファイル選択は現在Windows版でのみ利用できます".to_string());
    }
    let script = r#"
Add-Type -AssemblyName System.Windows.Forms
$dialog = New-Object System.Windows.Forms.OpenFileDialog
if ($args[0]) {
  if (Test-Path -LiteralPath $args[0] -PathType Leaf) { $dialog.FileName = $args[0] }
  elseif (Test-Path -LiteralPath $args[0] -PathType Container) { $dialog.InitialDirectory = $args[0] }
}
if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {
  [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
  Write-Output $dialog.FileName
}
"#;
    let mut command = Command::new("powershell.exe");
    command
        .args(["-NoProfile", "-STA", "-Command", script, initial_path.as_str()])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(windows)]
    command.creation_flags(CREATE_NO_WINDOW);
    let output = command.output().map_err(|error| error.to_string())?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}
#[tauri::command]
fn open_external_url(url: String) -> Result<(), String> {
    if !url.starts_with("https://jp.finalfantasyxiv.com/lodestone/") {
        return Err("許可されていないURLです".to_string());
    }
    let mut command = if cfg!(windows) {
        let mut command = Command::new("rundll32");
        command.args(["url.dll,FileProtocolHandler", &url]);
        command
    } else if cfg!(target_os = "macos") {
        let mut command = Command::new("open");
        command.arg(&url);
        command
    } else {
        let mut command = Command::new("xdg-open");
        command.arg(&url);
        command
    };
    #[cfg(windows)]
    command.creation_flags(CREATE_NO_WINDOW);
    command.spawn().map_err(|error| error.to_string())?;
    Ok(())
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
        .invoke_handler(tauri::generate_handler![run_pipeline_command, cancel_pipeline_command, read_pipeline_ui_definition, read_pipeline_workflow_status, read_update_state, read_oxidizer_import_preview, read_quality_preview_state, read_quality_preview, read_equipment_role_groups, read_equipment_role_summary, save_equipment_role_overrides, save_publication_decisions, read_publication_review, open_log_directory, select_directory, select_file, open_external_url])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
