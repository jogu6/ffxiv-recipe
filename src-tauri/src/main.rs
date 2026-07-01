use serde_json::Value;
use serde_json::json;
use std::io::{BufRead, BufReader};
use std::net::{TcpStream, UdpSocket};
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::Emitter;

struct PipelineProcess {
    pid: Arc<Mutex<Option<u32>>>,
}

struct PreviewServer {
    pid: Arc<Mutex<Option<u32>>>,
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
    let mut child = Command::new("node")
        .args(command_args)
        .current_dir(root)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
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
            if let Some(app) = app_stdout.as_ref() {
                if let Err(error) = app.emit("pipeline-output", line.clone()) {
                    eprintln!("pipeline-output emit failed: {error}");
                }
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
    let pid = {
        let pid = process.pid.lock().map_err(|error| error.to_string())?;
        *pid
    };
    let Some(pid) = pid else {
        return Ok(());
    };
    let status = if cfg!(windows) {
        Command::new("taskkill")
            .args(["/PID", &pid.to_string(), "/T", "/F"])
            .status()
            .map_err(|error| error.to_string())?
    } else {
        Command::new("kill")
            .args(["-TERM", &pid.to_string()])
            .status()
            .map_err(|error| error.to_string())?
    };
    if status.success() {
        let mut stored = process.pid.lock().map_err(|error| error.to_string())?;
        *stored = None;
        Ok(())
    } else {
        Err(format!("Failed to stop process {pid}"))
    }
}

fn stop_process(pid: u32) -> Result<(), String> {
    let status = if cfg!(windows) {
        Command::new("taskkill")
            .args(["/PID", &pid.to_string(), "/T", "/F"])
            .status()
            .map_err(|error| error.to_string())?
    } else {
        Command::new("kill")
            .args(["-TERM", &pid.to_string()])
            .status()
            .map_err(|error| error.to_string())?
    };
    if status.success() {
        Ok(())
    } else {
        Err(format!("Failed to stop process {pid}"))
    }
}

fn release_preview_port() -> Result<(), String> {
    if cfg!(windows) {
        let script = "Get-NetTCPConnection -LocalPort 4173 -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique | ForEach-Object { Stop-Process -Id $_ -Force }";
        let status = Command::new("powershell")
            .args(["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .map_err(|error| error.to_string())?;
        if !status.success() {
            return Err("4173番を使用中のプロセスを停止できませんでした。".to_string());
        }
    }
    Ok(())
}

fn preview_port_pid() -> Option<u32> {
    if !cfg!(windows) {
        return None;
    }
    let output = Command::new("powershell")
        .args([
            "-NoProfile",
            "-ExecutionPolicy",
            "Bypass",
            "-Command",
            "Get-NetTCPConnection -LocalPort 4173 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty OwningProcess"
        ])
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    String::from_utf8_lossy(&output.stdout).trim().parse::<u32>().ok()
}

fn wait_for_preview_port() -> bool {
    for _ in 0..20 {
        if TcpStream::connect("127.0.0.1:4173").is_ok() {
            return true;
        }
        std::thread::sleep(Duration::from_millis(100));
    }
    false
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

#[tauri::command]
fn read_lan_preview_urls() -> Result<Vec<String>, String> {
    let mut urls = Vec::new();
    if let Ok(socket) = UdpSocket::bind("0.0.0.0:0") {
        if socket.connect("8.8.8.8:80").is_ok() {
            if let Ok(addr) = socket.local_addr() {
                let ip = addr.ip();
                if ip.is_ipv4() && !ip.is_loopback() {
                    urls.push(format!("http://{}:4173/__tmp_icon_quality/", ip));
                }
            }
        }
    }
    if urls.is_empty() {
        urls.push("http://<このPCのIP>:4173/__tmp_icon_quality/".to_string());
    }
    Ok(urls)
}

#[tauri::command]
fn start_preview_server(server: tauri::State<PreviewServer>) -> Result<Vec<String>, String> {
    {
        let pid = server.pid.lock().map_err(|error| error.to_string())?;
        if pid.is_some() {
            return read_lan_preview_urls();
        }
    }

    let root = repo_root()?;
    let site = root.join("site");
    release_preview_port()?;
    let child = Command::new("py")
        .args(["-m", "http.server", "4173", "--bind", "0.0.0.0", "--directory"])
        .arg(site)
        .current_dir(root)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|error| format!("プレビュー用ローカルwebサーバーを起動できませんでした: {error}"))?;
    let child_id = child.id();
    if !wait_for_preview_port() {
        let _ = stop_process(child_id);
        return Err("プレビュー用ローカルwebサーバーが4173番で待受を開始しませんでした。".to_string());
    }
    let mut pid = server.pid.lock().map_err(|error| error.to_string())?;
    *pid = Some(preview_port_pid().unwrap_or(child_id));
    Ok(read_lan_preview_urls()?)
}

#[tauri::command]
fn stop_preview_server(server: tauri::State<PreviewServer>) -> Result<(), String> {
    let pid = {
        let mut pid = server.pid.lock().map_err(|error| error.to_string())?;
        pid.take()
    };
    if let Some(pid) = pid {
        stop_process(pid)?;
    }
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
        .manage(PreviewServer { pid: Arc::new(Mutex::new(None)) })
        .invoke_handler(tauri::generate_handler![run_pipeline_command, cancel_pipeline_command, read_update_state, read_quality_preview_state, read_quality_preview, read_lan_preview_urls, start_preview_server, stop_preview_server])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
