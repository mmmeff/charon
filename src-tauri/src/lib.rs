use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::{BufRead, BufReader};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use tauri::{Emitter, Manager, State};

// ---------------------------------------------------------------------------
// Agent process registry
// ---------------------------------------------------------------------------

#[derive(Default)]
struct AgentRegistry {
    children: Mutex<HashMap<String, Arc<Mutex<Option<Child>>>>>,
}

#[derive(Clone, Serialize)]
struct AgentStreamEvent {
    id: String,
    kind: String, // "stdout" | "stderr" | "exit" | "spawn-error"
    line: Option<String>,
    code: Option<i32>,
}

/// Spawn a long-running agent process (e.g. cursor-agent) with stdout/stderr
/// streamed back to the webview as `agent-stream` events keyed by `id`.
#[tauri::command]
fn spawn_agent(
    app: tauri::AppHandle,
    registry: State<'_, AgentRegistry>,
    id: String,
    binary: String,
    args: Vec<String>,
    cwd: Option<String>,
    env: Option<HashMap<String, String>>,
) -> Result<(), String> {
    let mut cmd = Command::new(&binary);
    cmd.args(&args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    if let Some(dir) = &cwd {
        cmd.current_dir(dir);
    }
    if let Some(env) = env {
        for (k, v) in env {
            cmd.env(k, v);
        }
    }

    let mut child = match cmd.spawn() {
        Ok(c) => c,
        Err(e) => {
            let _ = app.emit(
                "agent-stream",
                AgentStreamEvent {
                    id: id.clone(),
                    kind: "spawn-error".into(),
                    line: Some(format!("failed to spawn {binary}: {e}")),
                    code: None,
                },
            );
            return Err(format!("failed to spawn {binary}: {e}"));
        }
    };

    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    let shared = Arc::new(Mutex::new(Some(child)));
    registry
        .children
        .lock()
        .unwrap()
        .insert(id.clone(), shared.clone());

    // Reader threads stream each line to the frontend.
    for (pipe_kind, reader) in [("stdout", stdout.map(|s| Box::new(s) as Box<dyn std::io::Read + Send>)),
                                 ("stderr", stderr.map(|s| Box::new(s) as Box<dyn std::io::Read + Send>))]
    {
        if let Some(stream) = reader {
            let app = app.clone();
            let id = id.clone();
            let kind = pipe_kind.to_string();
            std::thread::spawn(move || {
                let buf = BufReader::new(stream);
                for line in buf.lines() {
                    match line {
                        Ok(l) => {
                            let _ = app.emit(
                                "agent-stream",
                                AgentStreamEvent {
                                    id: id.clone(),
                                    kind: kind.clone(),
                                    line: Some(l),
                                    code: None,
                                },
                            );
                        }
                        Err(_) => break,
                    }
                }
            });
        }
    }

    // Waiter thread polls for exit and emits the final event.
    {
        let app = app.clone();
        let id = id.clone();
        let shared = shared.clone();
        std::thread::spawn(move || loop {
            let status = {
                let mut guard = shared.lock().unwrap();
                match guard.as_mut() {
                    Some(child) => child.try_wait().ok().flatten(),
                    None => {
                        // killed and reaped elsewhere
                        let _ = app.emit(
                            "agent-stream",
                            AgentStreamEvent {
                                id: id.clone(),
                                kind: "exit".into(),
                                line: None,
                                code: Some(-9),
                            },
                        );
                        return;
                    }
                }
            };
            if let Some(status) = status {
                // small grace period so reader threads flush remaining lines
                std::thread::sleep(std::time::Duration::from_millis(150));
                let _ = app.emit(
                    "agent-stream",
                    AgentStreamEvent {
                        id: id.clone(),
                        kind: "exit".into(),
                        line: None,
                        code: status.code(),
                    },
                );
                return;
            }
            std::thread::sleep(std::time::Duration::from_millis(200));
        });
    }

    Ok(())
}

#[tauri::command]
fn kill_agent(registry: State<'_, AgentRegistry>, id: String) -> Result<(), String> {
    let map = registry.children.lock().unwrap();
    if let Some(shared) = map.get(&id) {
        let mut guard = shared.lock().unwrap();
        if let Some(child) = guard.as_mut() {
            child.kill().map_err(|e| e.to_string())?;
            let _ = child.wait();
        }
        *guard = None;
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Git
// ---------------------------------------------------------------------------

#[derive(Serialize)]
struct ExecResult {
    code: i32,
    stdout: String,
    stderr: String,
}

#[tauri::command]
async fn run_git(cwd: Option<String>, args: Vec<String>) -> Result<ExecResult, String> {
    run_exec("git".into(), args, cwd).await
}

#[tauri::command]
async fn run_exec(binary: String, args: Vec<String>, cwd: Option<String>) -> Result<ExecResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut cmd = Command::new(&binary);
        cmd.args(&args).stdin(Stdio::null());
        if let Some(dir) = &cwd {
            cmd.current_dir(dir);
        }
        let out = cmd
            .output()
            .map_err(|e| format!("failed to run {binary}: {e}"))?;
        Ok(ExecResult {
            code: out.status.code().unwrap_or(-1),
            stdout: String::from_utf8_lossy(&out.stdout).to_string(),
            stderr: String::from_utf8_lossy(&out.stderr).to_string(),
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

// ---------------------------------------------------------------------------
// HTTP proxy (GitHub API — avoids webview CORS, supports GHE)
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
struct HttpRequest {
    method: String,
    url: String,
    headers: Vec<(String, String)>,
    body: Option<String>,
    insecure: Option<bool>,
}

#[derive(Serialize)]
struct HttpResponse {
    status: u16,
    headers: Vec<(String, String)>,
    body: String,
}

#[tauri::command]
async fn http_request(req: HttpRequest) -> Result<HttpResponse, String> {
    let client = reqwest::Client::builder()
        .danger_accept_invalid_certs(req.insecure.unwrap_or(false))
        .user_agent("pr-copilot/0.1")
        .build()
        .map_err(|e| e.to_string())?;
    let method =
        reqwest::Method::from_bytes(req.method.as_bytes()).map_err(|e| e.to_string())?;
    let mut builder = client.request(method, &req.url);
    for (k, v) in &req.headers {
        builder = builder.header(k, v);
    }
    if let Some(body) = req.body {
        builder = builder.body(body);
    }
    let resp = builder.send().await.map_err(|e| e.to_string())?;
    let status = resp.status().as_u16();
    let headers = resp
        .headers()
        .iter()
        .map(|(k, v)| (k.to_string(), v.to_str().unwrap_or("").to_string()))
        .collect();
    let body = resp.text().await.map_err(|e| e.to_string())?;
    Ok(HttpResponse { status, headers, body })
}

// ---------------------------------------------------------------------------
// Per-repo local storage (JSON blobs under the app data dir)
// ---------------------------------------------------------------------------

fn data_path(app: &tauri::AppHandle, rel: &str) -> Result<PathBuf, String> {
    if rel.contains("..") {
        return Err("invalid path".into());
    }
    let base = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?;
    Ok(base.join(rel))
}

#[tauri::command]
fn load_blob(app: tauri::AppHandle, rel: String) -> Result<Option<String>, String> {
    let path = data_path(&app, &rel)?;
    match std::fs::read_to_string(&path) {
        Ok(s) => Ok(Some(s)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
fn save_blob(app: tauri::AppHandle, rel: String, content: String) -> Result<(), String> {
    let path = data_path(&app, &rel)?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    std::fs::write(&path, content).map_err(|e| e.to_string())
}

#[tauri::command]
fn app_data_dir(app: tauri::AppHandle) -> Result<String, String> {
    let base = app.path().app_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&base).map_err(|e| e.to_string())?;
    Ok(base.to_string_lossy().to_string())
}

// ---------------------------------------------------------------------------
// Skills (~/.cursor)
// ---------------------------------------------------------------------------

#[derive(Serialize)]
struct SkillFile {
    name: String,
    source: String, // "command" | "skill" | "builtin" | "user"
    path: String,
    content: String,
}

const MAX_SKILL_BYTES: usize = 128 * 1024;

fn read_capped(path: &PathBuf) -> Option<String> {
    let data = std::fs::read(path).ok()?;
    let data = if data.len() > MAX_SKILL_BYTES {
        data[..MAX_SKILL_BYTES].to_vec()
    } else {
        data
    };
    Some(String::from_utf8_lossy(&data).to_string())
}

fn scan_skill_dir(dir: &PathBuf, source: &str, out: &mut Vec<SkillFile>) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_file() && path.extension().map(|e| e == "md").unwrap_or(false) {
            let name = path
                .file_stem()
                .map(|s| s.to_string_lossy().to_string())
                .unwrap_or_default();
            if let Some(content) = read_capped(&path) {
                out.push(SkillFile {
                    name,
                    source: source.into(),
                    path: path.to_string_lossy().to_string(),
                    content,
                });
            }
        } else if path.is_dir() {
            // directory skills: <name>/SKILL.md (or any single .md inside)
            let name = path
                .file_name()
                .map(|s| s.to_string_lossy().to_string())
                .unwrap_or_default();
            let candidates = ["SKILL.md", "skill.md", "README.md"];
            let mut found = None;
            for c in candidates {
                let p = path.join(c);
                if p.is_file() {
                    found = Some(p);
                    break;
                }
            }
            if found.is_none() {
                if let Ok(inner) = std::fs::read_dir(&path) {
                    for f in inner.flatten() {
                        let p = f.path();
                        if p.is_file() && p.extension().map(|e| e == "md").unwrap_or(false) {
                            found = Some(p);
                            break;
                        }
                    }
                }
            }
            if let Some(p) = found {
                if let Some(content) = read_capped(&p) {
                    out.push(SkillFile {
                        name,
                        source: source.into(),
                        path: p.to_string_lossy().to_string(),
                        content,
                    });
                }
            }
        }
    }
}

#[tauri::command]
fn list_cursor_skills(extra_dirs: Vec<String>) -> Result<Vec<SkillFile>, String> {
    let home = std::env::var("HOME").map_err(|e| e.to_string())?;
    let home = PathBuf::from(home);
    let mut out = Vec::new();
    scan_skill_dir(&home.join(".cursor/commands"), "command", &mut out);
    scan_skill_dir(&home.join(".cursor/skills"), "skill", &mut out);
    scan_skill_dir(&home.join(".cursor/skills-cursor"), "builtin", &mut out);
    for dir in extra_dirs {
        scan_skill_dir(&PathBuf::from(dir), "user", &mut out);
    }
    Ok(out)
}

// ---------------------------------------------------------------------------
// Windows: one window per repo
// ---------------------------------------------------------------------------

#[tauri::command]
fn open_repo_window(app: tauri::AppHandle, repo: String) -> Result<(), String> {
    let label: String = format!(
        "repo-{}",
        repo.chars()
            .map(|c| if c.is_alphanumeric() { c.to_ascii_lowercase() } else { '-' })
            .collect::<String>()
    );
    if let Some(win) = app.get_webview_window(&label) {
        win.set_focus().map_err(|e| e.to_string())?;
        return Ok(());
    }
    let url = format!("index.html?repo={}", urlencoding::encode(&repo));
    tauri::WebviewWindowBuilder::new(&app, &label, tauri::WebviewUrl::App(url.into()))
        .title(format!("PR Copilot — {repo}"))
        .inner_size(1380.0, 900.0)
        .min_inner_size(900.0, 600.0)
        .build()
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// Re-open the repo picker (e.g. from a repo window). `?picker=1` suppresses
/// the boot-time auto-open of the last repo so the picker actually shows.
#[tauri::command]
fn open_launcher_window(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(win) = app.get_webview_window("launcher") {
        win.show().map_err(|e| e.to_string())?;
        win.set_focus().map_err(|e| e.to_string())?;
        return Ok(());
    }
    tauri::WebviewWindowBuilder::new(
        &app,
        "launcher",
        tauri::WebviewUrl::App("index.html?picker=1".into()),
    )
    .title("PR Copilot")
    .inner_size(760.0, 680.0)
    .min_inner_size(560.0, 480.0)
    .build()
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// Close the window that invoked this command.
#[tauri::command]
fn close_window(window: tauri::WebviewWindow) -> Result<(), String> {
    window.close().map_err(|e| e.to_string())
}

// ---------------------------------------------------------------------------

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(AgentRegistry::default())
        .invoke_handler(tauri::generate_handler![
            spawn_agent,
            kill_agent,
            run_git,
            run_exec,
            http_request,
            load_blob,
            save_blob,
            app_data_dir,
            list_cursor_skills,
            open_repo_window,
            open_launcher_window,
            close_window
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
