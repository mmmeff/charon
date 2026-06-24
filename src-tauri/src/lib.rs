use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::mpsc::Sender;
use std::sync::{Arc, Mutex};
use tauri::{Emitter, Manager, State};

// ---------------------------------------------------------------------------
// Agent process registry
// ---------------------------------------------------------------------------

#[derive(Default)]
struct AgentRegistry {
    children: Mutex<HashMap<String, Arc<Mutex<Option<Child>>>>>,
    // per-agent stdin writer channel: agent_send pushes a line, a dedicated
    // writer thread drains it to the child's stdin (non-blocking sends,
    // order-preserved, never stalls the IPC thread on a full pipe)
    writers: Mutex<HashMap<String, Sender<String>>>,
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
        // stdin is piped (not null) so ACP agents can be driven over JSON-RPC
        // via agent_send; processes that don't read stdin simply ignore it
        .stdin(Stdio::piped())
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

    let stdin = child.stdin.take();
    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    let shared = Arc::new(Mutex::new(Some(child)));
    registry
        .children
        .lock()
        .unwrap()
        .insert(id.clone(), shared.clone());

    // dedicated writer thread: owns stdin, drains the channel. Dropping the
    // sender (on kill / completion) ends the loop and closes the pipe.
    if let Some(mut stdin) = stdin {
        let (tx, rx) = std::sync::mpsc::channel::<String>();
        registry.writers.lock().unwrap().insert(id.clone(), tx);
        std::thread::spawn(move || {
            while let Ok(line) = rx.recv() {
                if stdin.write_all(line.as_bytes()).is_err()
                    || stdin.write_all(b"\n").is_err()
                    || stdin.flush().is_err()
                {
                    break;
                }
            }
        });
    }

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

/// Queue one framed message (a line) to an agent's stdin — the client→agent
/// half of ACP's JSON-RPC-over-stdio. Non-blocking: hands off to the writer
/// thread, which appends the newline and drains to the pipe.
#[tauri::command]
fn agent_send(registry: State<'_, AgentRegistry>, id: String, line: String) -> Result<(), String> {
    let map = registry.writers.lock().unwrap();
    let tx = map.get(&id).ok_or_else(|| format!("no agent stdin for {id}"))?;
    tx.send(line).map_err(|_| "agent stdin closed".to_string())
}

/// Resolve opencode's data dir: `$XDG_DATA_HOME/opencode` or
/// `$HOME/.local/share/opencode` (opencode uses the XDG path even on macOS,
/// not `~/Library/Application Support`). Returns None if HOME is unset.
fn opencode_data_dir() -> Option<PathBuf> {
    if let Ok(xdg) = std::env::var("XDG_DATA_HOME") {
        if !xdg.is_empty() {
            return Some(PathBuf::from(xdg).join("opencode"));
        }
    }
    std::env::var("HOME").ok().map(|h| PathBuf::from(h).join(".local/share/opencode"))
}

/// Tail opencode's own log for a `stream error` line matching `session_id`
/// (the `ses_...` id from `session/new`) and `small=false` (the main build
/// agent, not the background title-generation call). opencode 1.17.x swallows
/// provider errors (rate limit, billing, auth) internally — it logs them here
/// but never surfaces them over ACP, so `session/prompt` hangs forever. This
/// lets the caller confirm a stall is a real provider failure and surface the
/// harness's own message instead of spinning indefinitely.
///
/// `since_ms` is a Unix-epoch-ms cutoff (typically the moment we sent
/// `session/prompt`): only log lines timestamped after it are considered, so a
/// stale error from a prior run on the same session can't fire.
#[tauri::command]
fn opencode_session_errors(session_id: String, since_ms: u64) -> Result<Vec<String>, String> {
    let log_path = opencode_data_dir()
        .ok_or_else(|| "HOME unset; can't locate opencode log".to_string())?
        .join("log/opencode.log");

    let file = std::fs::File::open(&log_path)
        .map_err(|e| format!("can't open opencode log at {}: {e}", log_path.display()))?;

    // Seek near the tail — the log grows unbounded (7MB+ in production) and
    // we only care about recent lines. Read the last 512KB.
    let len = file
        .metadata()
        .map_err(|e| e.to_string())?
        .len();
    let tail_start = len.saturating_sub(512 * 1024);
    let mut file = file;
    use std::io::{Read, Seek, SeekFrom};
    file.seek(SeekFrom::Start(tail_start))
        .map_err(|e| e.to_string())?;

    let mut buf = String::new();
    file.read_to_string(&mut buf)
        .map_err(|e| e.to_string())?;

    // Drop the partial first line (we sought mid-line). The first newline
    // boundary lands us on a full line.
    let body = buf.split_once('\n').map(|(_, rest)| rest).unwrap_or(&buf);

    let mut errors: Vec<String> = Vec::new();
    for line in body.lines() {
        // Fast reject: must be a stream-error line for this session's main turn.
        if !line.contains("stream error") || !line.contains(&session_id) {
            continue;
        }
        // Skip the title-generation sub-call (small=true) — it fires its own
        // stream error on the same session, but it's noise for us; the build
        // agent's failure is what stalled the prompt.
        if line.contains("small=true") {
            continue;
        }
        // Timestamp gate: opencode logs in ISO-8601 UTC
        // (`timestamp=2026-06-23T23:46:23.425Z`). Parse and compare to
        // since_ms so stale errors from a prior run on a reused session id
        // can't fire. If the timestamp is unparseable, fall through (treat as
        // a candidate — a false positive is better than a missed diagnosis).
        if let Some(ts) = line.strip_prefix("timestamp=").and_then(|rest| rest.split_whitespace().next()) {
            if let Some(parsed) = parse_iso_ms(ts) {
                if parsed < since_ms {
                    continue;
                }
            }
        }
        // Extract `error.error="..."` — the real provider message
        // (e.g. "AI_APICallError: Rate limit exceeded. Please try again later.").
        if let Some(msg) = extract_field(line, "error.error=") {
            errors.push(msg);
        } else if let Some(msg) = extract_field(line, "error=") {
            // Some lines use `error=` instead of `error.error=`
            errors.push(msg);
        }
    }
    Ok(errors)
}

/// Parse an ISO-8601 UTC timestamp (`2026-06-23T23:46:23.425Z`) to Unix epoch
/// milliseconds. Returns None on any parse failure (caller treats None as
/// "don't gate on timestamp").
fn parse_iso_ms(ts: &str) -> Option<u64> {
    // Cheapest correct path: the Tauri build already pulls chrono via
    // tauri/tokio transitively, but we avoid a direct chrono dep by hand-rolling
    // the common case. Format: YYYY-MM-DDTHH:MM:SS.mmmZ
    let b = ts.as_bytes();
    if b.len() < 24 || b[4] != b'-' || b[7] != b'-' || b[10] != b'T' || b[13] != b':' || b[16] != b':' || b[19] != b'.' || b[23] != b'Z' {
        return None;
    }
    let y: u64 = std::str::from_utf8(&b[0..4]).ok()?.parse().ok()?;
    let mo: u64 = std::str::from_utf8(&b[5..7]).ok()?.parse().ok()?;
    let d: u64 = std::str::from_utf8(&b[8..10]).ok()?.parse().ok()?;
    let h: u64 = std::str::from_utf8(&b[11..13]).ok()?.parse().ok()?;
    let mi: u64 = std::str::from_utf8(&b[14..16]).ok()?.parse().ok()?;
    let s: u64 = std::str::from_utf8(&b[17..19]).ok()?.parse().ok()?;
    let ms: u64 = std::str::from_utf8(&b[20..23]).ok()?.parse().ok()?;
    // Days from civil epoch (1970-01-01) using the well-known days-from-civil
    // formula (Howard Hinnant). Avoids month-length tables.
    let y2 = if mo <= 2 { y - 1 } else { y };
    let era = y2 / 400;
    let yoe = y2 - era * 400;
    let m = if mo > 2 { mo - 3 } else { mo + 9 };
    let doy = (153 * m + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    let days_since_epoch = era * 146097 + doe - 719468;
    let secs = days_since_epoch * 86400 + h * 3600 + mi * 60 + s;
    Some(secs * 1000 + ms)
}

/// Extract the value of a `key="..."` field from a structured-log line. Handles
/// quoted values with escaped quotes. Returns the inner string (unescaped).
fn extract_field(line: &str, key: &str) -> Option<String> {
    let idx = line.find(key)?;
    let rest = &line[idx + key.len()..];
    let quote = rest.chars().next()?;
    if quote != '"' {
        // Unquoted value — take up to the next space.
        let val: String = rest.chars().take_while(|c| !c.is_whitespace()).collect();
        return if val.is_empty() { None } else { Some(val) };
    }
    // Quoted: scan to the matching close quote, respecting `\"`.
    let mut out = String::new();
    let mut chars = rest[1..].chars().peekable();
    while let Some(c) = chars.next() {
        if c == '\\' {
            if let Some(next) = chars.next() {
                out.push(next);
            }
            continue;
        }
        if c == '"' {
            return Some(out);
        }
        out.push(c);
    }
    None
}

#[tauri::command]
fn kill_agent(registry: State<'_, AgentRegistry>, id: String) -> Result<(), String> {
    // drop the writer sender → writer thread ends, stdin pipe closes
    registry.writers.lock().unwrap().remove(&id);
    // remove from the map first so the map lock isn't held across wait()
    let shared = registry.children.lock().unwrap().remove(&id);
    if let Some(shared) = shared {
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
// Windows: one window per repo, with remembered sizes
// ---------------------------------------------------------------------------

fn window_sizes_path(app: &tauri::AppHandle) -> Option<PathBuf> {
    app.path().app_data_dir().ok().map(|d| d.join("window-sizes.json"))
}

fn load_window_sizes(app: &tauri::AppHandle) -> HashMap<String, (f64, f64)> {
    window_sizes_path(app)
        .and_then(|p| std::fs::read_to_string(p).ok())
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn save_window_size(app: &tauri::AppHandle, label: &str, w: f64, h: f64) {
    let mut map = load_window_sizes(app);
    map.insert(label.to_string(), (w, h));
    if let Some(p) = window_sizes_path(app) {
        if let Some(parent) = p.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        if let Ok(json) = serde_json::to_string(&map) {
            let _ = std::fs::write(p, json);
        }
    }
}

/// The window label for a repo, e.g. `owner/name` → `repo-owner-name`. The
/// frontend never sees this; it's how we find/focus an existing repo window.
fn repo_window_label(repo: &str) -> String {
    format!(
        "repo-{}",
        repo.chars()
            .map(|c| if c.is_alphanumeric() { c.to_ascii_lowercase() } else { '-' })
            .collect::<String>()
    )
}

/// Build a fresh repo window. `pr` deep-links the window straight to a PR on
/// load (used by the notification-click path when no window is open yet).
fn build_repo_window(app: &tauri::AppHandle, repo: &str, pr: Option<i64>) -> Result<(), String> {
    let label = repo_window_label(repo);
    let (w, h) = load_window_sizes(app)
        .get(&label)
        .copied()
        .unwrap_or((1380.0, 900.0));
    let mut url = format!("index.html?repo={}", urlencoding::encode(repo));
    if let Some(pr) = pr {
        url.push_str(&format!("&pr={pr}"));
    }
    tauri::WebviewWindowBuilder::new(app, &label, tauri::WebviewUrl::App(url.into()))
        .title(format!("Charon — {repo}"))
        .inner_size(w, h)
        .min_inner_size(900.0, 600.0)
        .build()
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn open_repo_window(app: tauri::AppHandle, repo: String) -> Result<(), String> {
    let label = repo_window_label(&repo);
    if let Some(win) = app.get_webview_window(&label) {
        win.set_focus().map_err(|e| e.to_string())?;
        return Ok(());
    }
    build_repo_window(&app, &repo, None)
}

/// Open/focus the repo's window and navigate it to a specific PR. Backs the
/// macOS notification-click → "open the app on that PR" flow. The click can be
/// delivered to any window (the plugin broadcasts), so routing lives here where
/// there's one view of every window; it's idempotent under duplicate delivery.
#[tauri::command]
fn focus_pr(app: tauri::AppHandle, repo: String, pr_number: i64) -> Result<(), String> {
    let label = repo_window_label(&repo);
    if let Some(win) = app.get_webview_window(&label) {
        let _ = win.unminimize();
        win.show().map_err(|e| e.to_string())?;
        win.set_focus().map_err(|e| e.to_string())?;
        // scoped to this repo's window: a bare PR number would otherwise make
        // sibling repo windows jump to a same-numbered PR of their own
        app.emit_to(&label, "navigate-to-pr", pr_number)
            .map_err(|e| e.to_string())?;
        return Ok(());
    }
    // no window yet — open it pointed straight at the PR. If another opener won
    // a race to create it, fall back to focusing + emitting the nav event (a
    // window that already loaded won't pick up the `?pr=` URL).
    if build_repo_window(&app, &repo, Some(pr_number)).is_err() {
        if let Some(win) = app.get_webview_window(&label) {
            let _ = win.show();
            let _ = win.set_focus();
            app.emit_to(&label, "navigate-to-pr", pr_number)
                .map_err(|e| e.to_string())?;
        }
    }
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
    .title("Charon")
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

/// Open a URL in the system default browser.
#[tauri::command]
fn open_url(url: String) -> Result<(), String> {
    if !(url.starts_with("https://") || url.starts_with("http://")) {
        return Err("only http(s) urls can be opened".into());
    }
    #[cfg(target_os = "macos")]
    let result = Command::new("open").arg(&url).spawn();
    #[cfg(target_os = "linux")]
    let result = Command::new("xdg-open").arg(&url).spawn();
    #[cfg(target_os = "windows")]
    let result = Command::new("cmd").args(["/C", "start", "", &url]).spawn();
    result.map(|_| ()).map_err(|e| e.to_string())
}

// ---------------------------------------------------------------------------

/// macOS/Linux apps launched from Finder/Dock (or `open`) inherit only
/// launchd's minimal PATH (`/usr/bin:/bin:/usr/sbin:/sbin`), so user-installed
/// tools like `cursor-agent` (~/.local/bin, Homebrew, …) can't be found and
/// spawning them fails with ENOENT. `tauri dev` doesn't hit this because it
/// inherits the terminal's PATH. Resolve the *login shell's* PATH once at
/// startup and merge it — plus common bin dirs — into this process's env so
/// every child command inherits a real PATH.
#[cfg(unix)]
fn fixup_path() {
    use std::collections::HashSet;

    fn add(raw: &str, ordered: &mut Vec<String>, seen: &mut HashSet<String>) {
        for d in raw.split(':') {
            let d = d.trim();
            if !d.is_empty() && seen.insert(d.to_string()) {
                ordered.push(d.to_string());
            }
        }
    }

    let mut ordered: Vec<String> = Vec::new();
    let mut seen: HashSet<String> = HashSet::new();

    // 1. The login shell's PATH (sources .zprofile/.zshrc/.bash_profile/…).
    //    Wrap the value in delimiters so noisy rc output (p10k, motd, etc.)
    //    can't corrupt what we parse.
    if let Ok(shell) = std::env::var("SHELL") {
        let marker = "__CHARON_PATH__";
        let script = format!("printf '%s%s%s' '{marker}' \"$PATH\" '{marker}'");
        if let Ok(out) = Command::new(&shell)
            .args(["-ilc", &script])
            .stdin(Stdio::null())
            .output()
        {
            let s = String::from_utf8_lossy(&out.stdout);
            if let (Some(start), Some(end)) = (s.find(marker), s.rfind(marker)) {
                if end > start {
                    add(&s[start + marker.len()..end], &mut ordered, &mut seen);
                }
            }
        }
    }

    // 2. Whatever PATH this process already has.
    if let Ok(p) = std::env::var("PATH") {
        add(&p, &mut ordered, &mut seen);
    }

    // 3. Common install locations as a backstop.
    if let Ok(home) = std::env::var("HOME") {
        for sub in [".local/bin", ".cargo/bin", ".bun/bin", ".deno/bin", ".volta/bin"] {
            add(&format!("{home}/{sub}"), &mut ordered, &mut seen);
        }
    }
    add(
        "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin",
        &mut ordered,
        &mut seen,
    );

    std::env::set_var("PATH", ordered.join(":"));
}

#[cfg(not(unix))]
fn fixup_path() {}

/// Add "Check for Updates…" to the macOS app menu (right under "About"),
/// keeping the rest of the default menu intact. The click is forwarded to the
/// focused window as a `menu-check-updates` event; the frontend runs the
/// actual updater check and shows the result.
#[cfg(target_os = "macos")]
fn install_app_menu(app: &tauri::App) -> tauri::Result<()> {
    use tauri::menu::{Menu, MenuItem, MenuItemKind};

    let handle = app.handle();
    let menu = Menu::default(handle)?;
    if let Some(MenuItemKind::Submenu(app_menu)) = menu.items()?.first() {
        let check = MenuItem::with_id(
            handle,
            "check-updates",
            "Check for Updates…",
            true,
            None::<&str>,
        )?;
        // default app submenu starts [About, separator, …] — slot in after About
        app_menu.insert(&check, 1)?;
    }
    app.set_menu(menu)?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    fixup_path();
    tauri::Builder::default()
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            #[cfg(desktop)]
            if !cfg!(debug_assertions) {
                app.handle()
                    .plugin(tauri_plugin_updater::Builder::new().build())?;
            }
            // Local development should not run updater or desktop notification
            // plumbing. Bundled release builds must initialize notifications:
            // the notification-click -> open-PR flow depends on this plugin.
            if !cfg!(debug_assertions) {
                if let Err(e) = app.handle().plugin(tauri_plugin_notifications::init()) {
                    return Err(e.into());
                }
            }
            #[cfg(target_os = "macos")]
            if !cfg!(debug_assertions) {
                install_app_menu(app)?;
            }
            Ok(())
        })
        .on_menu_event(|app, event| {
            if event.id() == "check-updates" {
                // target one window so only one dialog/notification shows
                let windows = app.webview_windows();
                let target = windows
                    .iter()
                    .find(|(_, w)| w.is_focused().unwrap_or(false))
                    .or_else(|| windows.iter().next())
                    .map(|(label, _)| label.clone());
                if let Some(label) = target {
                    let _ = app.emit_to(label, "menu-check-updates", ());
                }
            }
        })
        .on_window_event(|window, event| {
            // remember per-repo window sizes (logical units) across launches
            if let tauri::WindowEvent::Resized(size) = event {
                if window.label().starts_with("repo-") {
                    let scale = window.scale_factor().unwrap_or(1.0);
                    let w = size.width as f64 / scale;
                    let h = size.height as f64 / scale;
                    if w > 200.0 && h > 200.0 {
                        save_window_size(&window.app_handle().clone(), window.label(), w, h);
                    }
                }
            }
        })
        .manage(AgentRegistry::default())
        .invoke_handler(tauri::generate_handler![
            spawn_agent,
            agent_send,
            kill_agent,
            opencode_session_errors,
            run_git,
            run_exec,
            http_request,
            load_blob,
            save_blob,
            app_data_dir,
            list_cursor_skills,
            open_repo_window,
            focus_pr,
            open_launcher_window,
            close_window,
            open_url
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
