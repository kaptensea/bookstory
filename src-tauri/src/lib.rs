use serde::{Deserialize, Serialize};
use tauri::{Emitter, Manager};

use axum::{
    extract::{Path, Query, State},
    http::{
        header::{ACCEPT_RANGES, CONTENT_TYPE},
        HeaderMap, HeaderValue, Method, StatusCode,
    },
    response::Response,
    routing::get,
    Router,
};

use rand::{distributions::Alphanumeric, Rng};
use std::collections::HashMap;
use std::fs;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path as FsPath, PathBuf};
use std::process::Command;
use std::sync::{Arc, Mutex};

const SERVICE_NAME: &str = "bookstory";

fn normalize_server_url(mut url: String) -> String {
    url = url.trim().to_string();
    while url.ends_with('/') {
        url.pop();
    }
    url
}

/* -------------------- Shared state -------------------- */

#[derive(Debug)]
pub struct ProxyState {
    pub port: u16,
    pub secret: String,
    pub active_server_url: Mutex<Option<String>>,
    pub active_username: Mutex<Option<String>>,
    pub offline_root: PathBuf,
    pub offline_index_path: PathBuf,
}

#[derive(Clone, Debug)]
pub struct SharedState(pub Arc<ProxyState>);

#[derive(Deserialize)]
struct KeyQuery {
    k: String,
}

#[derive(Deserialize)]
struct HlsUrlQuery {
    url: String,
    k: String,
}

/* -------------------- Keyring helpers -------------------- */

fn account_key(server_url: &str, username: &str) -> String {
    format!("{}|{}", server_url, username)
}

fn get_token_from_keyring(server_url: &str, username: &str) -> Result<String, String> {
    let key = account_key(server_url, username);
    let entry = keyring::Entry::new(SERVICE_NAME, &key)
    .map_err(|e| format!("Keyring error: {}", e))?;
    entry.get_password().map_err(|e| format!("Keyring error: {}", e))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct InstallContext {
    platform: String,
    install_kind: String,
    executable_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct OfflineTrack {
    index: usize,
    ino: String,
    relative_path: String,
    title: Option<String>,
    duration: Option<f64>,
    episode_id: Option<String>,
    size_bytes: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct OfflineItem {
    item_id: String,
    title: String,
    author: String,
    tracks: Vec<OfflineTrack>,
    downloaded_at: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct OfflineProgressEvent {
    item_id: String,
    episode_id: Option<String>,
    current_time: f64,
    queued_at: u64,
}

#[derive(Debug, Default, Clone, Serialize, Deserialize)]
struct OfflineIndex {
    items: HashMap<String, OfflineItem>,
    pending_progress: Vec<OfflineProgressEvent>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct OfflineItemStatus {
    exists: bool,
    track_count: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct OfflineStats {
    item_count: usize,
    track_count: usize,
    total_bytes: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct OfflineDownloadProgressEvent {
    item_id: String,
    percent: u8,
    status: String,
}

fn now_unix_seconds() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

fn ensure_offline_index(path: &FsPath) -> Result<(), String> {
    if path.exists() {
        return Ok(());
    }
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("Failed to create offline dir: {}", e))?;
    }
    fs::write(path, "{\"items\":{},\"pending_progress\":[]}")
        .map_err(|e| format!("Failed to initialize offline index: {}", e))
}

fn load_offline_index(path: &FsPath) -> Result<OfflineIndex, String> {
    ensure_offline_index(path)?;
    let raw = fs::read_to_string(path).map_err(|e| format!("Failed to read offline index: {}", e))?;
    serde_json::from_str::<OfflineIndex>(&raw).map_err(|e| format!("Failed to parse offline index: {}", e))
}

fn save_offline_index(path: &FsPath, idx: &OfflineIndex) -> Result<(), String> {
    let raw = serde_json::to_string_pretty(idx).map_err(|e| format!("Failed to serialize offline index: {}", e))?;
    fs::write(path, raw).map_err(|e| format!("Failed to write offline index: {}", e))
}

fn sanitize_name(raw: &str) -> String {
    raw.chars()
        .map(|c| match c {
            'a'..='z' | 'A'..='Z' | '0'..='9' | '-' | '_' | '.' => c,
            _ => '_',
        })
        .collect::<String>()
}

fn parse_item_tracks(item: &serde_json::Value) -> Vec<OfflineTrack> {
    let mut out = Vec::new();

    if let Some(arr) = item.pointer("/media/audioFiles").and_then(|v| v.as_array()) {
        for (i, f) in arr.iter().enumerate() {
            let ino = f.get("ino").and_then(|v| v.as_str()).map(|s| s.to_string());
            if let Some(ino) = ino {
                out.push(OfflineTrack {
                    index: i,
                    ino,
                    relative_path: String::new(),
                    title: f.get("title").and_then(|v| v.as_str()).map(|s| s.to_string()),
                    duration: f.get("duration").and_then(|v| v.as_f64()),
                    episode_id: None,
                    size_bytes: 0,
                });
            }
        }
        return out;
    }

    if let Some(arr) = item.pointer("/media/episodes").and_then(|v| v.as_array()) {
        for (i, e) in arr.iter().enumerate() {
            let ino = e.pointer("/audioFile/ino").and_then(|v| v.as_str()).map(|s| s.to_string());
            if let Some(ino) = ino {
                out.push(OfflineTrack {
                    index: i,
                    ino,
                    relative_path: String::new(),
                    title: e.get("title").and_then(|v| v.as_str()).map(|s| s.to_string()),
                    duration: e.pointer("/audioFile/duration").and_then(|v| v.as_f64()),
                    episode_id: e.get("id").and_then(|v| v.as_str()).map(|s| s.to_string()),
                    size_bytes: 0,
                });
            }
        }
        return out;
    }

    out
}

async fn write_response_to_file(resp: reqwest::Response, path: &FsPath) -> Result<(), String> {
    use tokio::io::AsyncWriteExt;

    let mut file = tokio::fs::File::create(path)
        .await
        .map_err(|e| format!("Failed to create offline file: {}", e))?;

    let mut stream = resp.bytes_stream();
    use futures_util::StreamExt;
    while let Some(chunk) = stream.next().await {
        let data = chunk.map_err(|e| format!("Download stream failed: {}", e))?;
        file.write_all(&data)
            .await
            .map_err(|e| format!("Failed to write offline file: {}", e))?;
    }

    file.flush()
        .await
        .map_err(|e| format!("Failed to flush offline file: {}", e))
}

fn get_audio_content_type(file_path: &FsPath) -> &'static str {
    match file_path
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_ascii_lowercase()
        .as_str()
    {
        "m4b" | "m4a" | "mp4" => "audio/mp4",
        "aac" => "audio/aac",
        "ogg" => "audio/ogg",
        "opus" => "audio/opus",
        "flac" => "audio/flac",
        "wav" => "audio/wav",
        _ => "audio/mpeg",
    }
}

#[tauri::command(rename_all = "camelCase")]
async fn abs_offline_download_item(
    app: tauri::AppHandle,
    state: tauri::State<'_, SharedState>,
    server_url: String,
    username: String,
    item_id: String,
) -> Result<(), String> {
    let server_url = normalize_server_url(server_url);
    let token = get_token_from_keyring(&server_url, &username)?;
    let s = &state.0;

    fs::create_dir_all(&s.offline_root).map_err(|e| format!("Failed to create offline root: {}", e))?;

    let item_url = format!("{}/api/items/{}?include=progress", server_url, item_id);
    let item_resp = reqwest::Client::new()
        .get(item_url)
        .header("Authorization", format!("Bearer {}", token))
        .send()
        .await
        .map_err(|e| format!("Network error: {}", e))?;

    if !item_resp.status().is_success() {
        return Err(format!("Failed to fetch item for offline download (HTTP {})", item_resp.status()));
    }

    let item_json: serde_json::Value = item_resp
        .json()
        .await
        .map_err(|e| format!("Invalid item response: {}", e))?;

    let mut tracks = parse_item_tracks(&item_json);
    if tracks.is_empty() {
        return Err("No downloadable tracks found for this item".to_string());
    }

    let _ = app.emit(
        "offline-download-progress",
        OfflineDownloadProgressEvent {
            item_id: item_id.clone(),
            percent: 0,
            status: "downloading".to_string(),
        },
    );

    let title = item_json
        .pointer("/media/metadata/title")
        .and_then(|v| v.as_str())
        .unwrap_or("Item")
        .to_string();
    let author = item_json
        .pointer("/media/metadata/authorName")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();

    let item_dir = s.offline_root.join(sanitize_name(&item_id));
    fs::create_dir_all(&item_dir).map_err(|e| format!("Failed to create offline item dir: {}", e))?;

    let total_tracks = tracks.len();
    for (idx, tr) in tracks.iter_mut().enumerate() {
        let file_url = format!(
            "{}/api/items/{}/file/{}?token={}",
            server_url, item_id, tr.ino, token
        );

        let download_resp = reqwest::Client::new()
            .get(file_url)
            .send()
            .await
            .map_err(|e| format!("Download failed: {}", e))?;

        if !download_resp.status().is_success() {
            return Err(format!(
                "Offline download failed for track {} (HTTP {})",
                tr.index,
                download_resp.status()
            ));
        }

        let file_name = format!("{:03}_{}.bin", tr.index, sanitize_name(&tr.ino));
        let full_path = item_dir.join(&file_name);
        write_response_to_file(download_resp, &full_path).await?;
        tr.size_bytes = full_path
            .metadata()
            .map(|m| m.len())
            .unwrap_or(0);
        tr.relative_path = format!("{}/{}", sanitize_name(&item_id), file_name);

        let pct = (((idx + 1) as f64 / total_tracks as f64) * 100.0).round() as u8;
        let _ = app.emit(
            "offline-download-progress",
            OfflineDownloadProgressEvent {
                item_id: item_id.clone(),
                percent: pct,
                status: if pct >= 100 {
                    "ready".to_string()
                } else {
                    "downloading".to_string()
                },
            },
        );
    }

    let mut idx = load_offline_index(&s.offline_index_path)?;
    idx.items.insert(
        item_id.clone(),
        OfflineItem {
            item_id,
            title,
            author,
            tracks,
            downloaded_at: now_unix_seconds(),
        },
    );
    save_offline_index(&s.offline_index_path, &idx)?;
    Ok(())
}

#[tauri::command(rename_all = "camelCase")]
fn abs_offline_item_status(
    state: tauri::State<'_, SharedState>,
    item_id: String,
) -> Result<OfflineItemStatus, String> {
    let idx = load_offline_index(&state.0.offline_index_path)?;
    if let Some(item) = idx.items.get(&item_id) {
        Ok(OfflineItemStatus {
            exists: true,
            track_count: item.tracks.len(),
        })
    } else {
        Ok(OfflineItemStatus {
            exists: false,
            track_count: 0,
        })
    }
}

#[tauri::command(rename_all = "camelCase")]
fn abs_offline_stats(state: tauri::State<'_, SharedState>) -> Result<OfflineStats, String> {
    let idx = load_offline_index(&state.0.offline_index_path)?;
    let item_count = idx.items.len();
    let track_count = idx.items.values().map(|it| it.tracks.len()).sum();
    let total_bytes = idx
        .items
        .values()
        .flat_map(|it| it.tracks.iter())
        .map(|t| t.size_bytes)
        .sum();
    Ok(OfflineStats {
        item_count,
        track_count,
        total_bytes,
    })
}

#[tauri::command(rename_all = "camelCase")]
fn abs_offline_enforce_max_storage(
    state: tauri::State<'_, SharedState>,
    max_bytes: u64,
) -> Result<usize, String> {
    if max_bytes == 0 {
        return Ok(0);
    }

    let s = &state.0;
    let mut idx = load_offline_index(&s.offline_index_path)?;

    let mut current_total: u64 = idx
        .items
        .values()
        .flat_map(|it| it.tracks.iter())
        .map(|t| t.size_bytes)
        .sum();

    if current_total <= max_bytes {
        return Ok(0);
    }

    let mut items_sorted: Vec<OfflineItem> = idx.items.values().cloned().collect();
    items_sorted.sort_by_key(|it| it.downloaded_at);

    let mut removed = 0usize;
    for item in items_sorted {
        if current_total <= max_bytes {
            break;
        }

        let item_size: u64 = item.tracks.iter().map(|t| t.size_bytes).sum();
        idx.items.remove(&item.item_id);

        let dir = s.offline_root.join(sanitize_name(&item.item_id));
        if dir.exists() {
            let _ = fs::remove_dir_all(dir);
        }

        current_total = current_total.saturating_sub(item_size);
        removed += 1;
    }

    save_offline_index(&s.offline_index_path, &idx)?;
    Ok(removed)
}

#[tauri::command(rename_all = "camelCase")]
fn abs_offline_remove_item(
    state: tauri::State<'_, SharedState>,
    item_id: String,
) -> Result<(), String> {
    let s = &state.0;
    let mut idx = load_offline_index(&s.offline_index_path)?;
    idx.items.remove(&item_id);
    save_offline_index(&s.offline_index_path, &idx)?;

    let dir = s.offline_root.join(sanitize_name(&item_id));
    if dir.exists() {
        fs::remove_dir_all(dir).map_err(|e| format!("Failed to remove offline item files: {}", e))?;
    }
    Ok(())
}

#[tauri::command(rename_all = "camelCase")]
fn abs_offline_remove_all(state: tauri::State<'_, SharedState>) -> Result<(), String> {
    let s = &state.0;
    if s.offline_root.exists() {
        fs::remove_dir_all(&s.offline_root).map_err(|e| format!("Failed to clear offline root: {}", e))?;
    }
    fs::create_dir_all(&s.offline_root).map_err(|e| format!("Failed to recreate offline root: {}", e))?;
    save_offline_index(&s.offline_index_path, &OfflineIndex::default())
}

#[tauri::command(rename_all = "camelCase")]
fn abs_offline_local_player_url(
    state: tauri::State<'_, SharedState>,
    item_id: String,
    index: usize,
) -> Result<String, String> {
    let s = &state.0;
    let idx = load_offline_index(&s.offline_index_path)?;
    let item = idx
        .items
        .get(&item_id)
        .ok_or_else(|| "Item is not downloaded for offline playback".to_string())?;
    if item.tracks.iter().any(|t| t.index == index) {
        Ok(format!(
            "http://127.0.0.1:{}/offline/{}/{}?k={}",
            s.port, item_id, index, s.secret
        ))
    } else {
        Err("Track is not available offline".to_string())
    }
}

#[tauri::command(rename_all = "camelCase")]
fn abs_offline_queue_progress(
    state: tauri::State<'_, SharedState>,
    item_id: String,
    episode_id: Option<String>,
    current_time: f64,
) -> Result<(), String> {
    let s = &state.0;
    let mut idx = load_offline_index(&s.offline_index_path)?;
    idx.pending_progress.push(OfflineProgressEvent {
        item_id,
        episode_id,
        current_time,
        queued_at: now_unix_seconds(),
    });
    save_offline_index(&s.offline_index_path, &idx)
}

#[tauri::command(rename_all = "camelCase")]
async fn abs_offline_sync_queued_progress(
    state: tauri::State<'_, SharedState>,
    server_url: String,
    username: String,
) -> Result<usize, String> {
    let server_url = normalize_server_url(server_url);
    let token = get_token_from_keyring(&server_url, &username)?;
    let s = &state.0;

    let mut idx = load_offline_index(&s.offline_index_path)?;
    if idx.pending_progress.is_empty() {
        return Ok(0);
    }

    let mut sent = 0usize;
    let mut remaining: Vec<OfflineProgressEvent> = Vec::new();

    for ev in idx.pending_progress {
        let url = if let Some(ref ep_id) = ev.episode_id {
            format!("{}/api/me/progress/{}/{}", server_url, ev.item_id, ep_id)
        } else {
            format!("{}/api/me/progress/{}", server_url, ev.item_id)
        };

        let body = serde_json::json!({ "currentTime": ev.current_time });
        let resp = reqwest::Client::new()
            .patch(url)
            .header("Authorization", format!("Bearer {}", token))
            .json(&body)
            .send()
            .await;

        match resp {
            Ok(r) if r.status().is_success() => {
                sent += 1;
            }
            _ => remaining.push(ev),
        }
    }

    idx.pending_progress = remaining;
    save_offline_index(&s.offline_index_path, &idx)?;
    Ok(sent)
}

#[cfg(target_os = "linux")]
fn command_succeeds(program: &str, args: &[&str]) -> bool {
    Command::new(program)
        .args(args)
        .status()
        .map(|status| status.success())
        .unwrap_or(false)
}

#[cfg(target_os = "linux")]
fn detect_linux_install_kind(executable_path: &str) -> String {
    let lower = executable_path.to_ascii_lowercase();

    if std::env::var_os("APPIMAGE").is_some()
        || lower.ends_with(".appimage")
        || lower.contains("/.mount_")
    {
        return "appimage".to_string();
    }

    if command_succeeds("pacman", &["-Qm", "bookstory-bin"]) {
        return "aur".to_string();
    }

    if command_succeeds("dpkg-query", &["-S", executable_path]) {
        return "deb".to_string();
    }

    if command_succeeds("rpm", &["-qf", executable_path]) {
        return "rpm".to_string();
    }

    if executable_path.starts_with("/usr/") || executable_path.starts_with("/opt/") {
        return "system".to_string();
    }

    "unknown".to_string()
}

#[tauri::command]
fn abs_get_install_context() -> InstallContext {
    let executable_path = std::env::current_exe()
        .ok()
        .map(|path| path.to_string_lossy().to_string())
        .unwrap_or_default();

    #[cfg(target_os = "linux")]
    let install_kind = detect_linux_install_kind(&executable_path);

    #[cfg(not(target_os = "linux"))]
    let install_kind = "unknown".to_string();

    InstallContext {
        platform: std::env::consts::OS.to_string(),
        install_kind,
        executable_path,
    }
}

/* -------------------- Local HTTP proxy -------------------- */



async fn audio_proxy(
    method: Method,
    State(shared): State<SharedState>,
                     Path((library_id, file_ino)): Path<(String, String)>,
                     Query(q): Query<KeyQuery>,
                     headers: HeaderMap,
) -> Result<Response, StatusCode> {
    let state = &shared.0;

    eprintln!(
        "[audio-proxy] request library_id={} file_ino={} method={}",
        library_id, file_ino, method
    );

    if q.k != state.secret {
        return Err(StatusCode::UNAUTHORIZED);
    }

    let server_url = state
    .active_server_url
    .lock()
    .unwrap()
    .clone()
    .ok_or(StatusCode::PRECONDITION_FAILED)?;

    let username = state
    .active_username
    .lock()
    .unwrap()
    .clone()
    .ok_or(StatusCode::PRECONDITION_FAILED)?;

    let token = get_token_from_keyring(&server_url, &username)
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let client = reqwest::Client::new();

    let range_hdr = headers
    .get("range")
    .and_then(|v| v.to_str().ok())
    .map(|s| s.to_string());

    let target = format!(
        "{}/api/items/{}/file/{}?token={}",
        server_url,
        library_id,
        file_ino,
        token
    );

    eprintln!(
        "[audio-proxy] upstream target={} range={:?}",
        target, range_hdr
    );

    // HEAD: proxy to upstream to get the real content-type (never lie about the format)
    if method == Method::HEAD {
        let res = client.get(&target)
            .header(reqwest::header::RANGE, "bytes=0-0")
            .send()
            .await
            .map_err(|_| StatusCode::BAD_GATEWAY)?;
        let real_ct = res.headers().get(CONTENT_TYPE)
            .and_then(|v| v.to_str().ok())
            .unwrap_or("audio/mpeg")
            .to_string();
        let mut response = Response::new(axum::body::Body::empty());
        *response.status_mut() = StatusCode::OK;
        response.headers_mut().insert(
            CONTENT_TYPE,
            HeaderValue::from_str(&real_ct).unwrap_or(HeaderValue::from_static("audio/mpeg")),
        );
        response.headers_mut().insert(ACCEPT_RANGES, HeaderValue::from_static("bytes"));
        return Ok(response);
    }

    let mut req = client.get(&target);
    if let Some(rng) = &range_hdr {
        req = req.header(reqwest::header::RANGE, rng);
    }

    let res = req
    .send()
    .await
    .map_err(|_| StatusCode::BAD_GATEWAY)?;

    eprintln!(
        "[audio-proxy] upstream status={} content-type={:?}",
        res.status(),
        res.headers().get(CONTENT_TYPE)
    );


    let mut out_headers = axum::http::HeaderMap::new();

    let upstream_ct = res
    .headers()
    .get(CONTENT_TYPE)
    .and_then(|v| v.to_str().ok())
    .unwrap_or("audio/mpeg");

    out_headers.insert(
        CONTENT_TYPE,
        HeaderValue::from_str(upstream_ct).unwrap_or(HeaderValue::from_static("audio/mpeg")),
    );

    out_headers.insert(ACCEPT_RANGES, HeaderValue::from_static("bytes"));

    for h in ["content-length", "content-range"] {
        if let Some(v) = res.headers().get(h) {
            if let Ok(hname) = axum::http::HeaderName::from_bytes(h.as_bytes()) {
                if let Ok(hval) = HeaderValue::from_bytes(v.as_bytes()) {
                    out_headers.insert(hname, hval);
                }
            }
        }
    }

    let status = StatusCode::from_u16(res.status().as_u16()).unwrap_or(StatusCode::BAD_GATEWAY);
    let body = axum::body::Body::from_stream(res.bytes_stream());

    let mut response = Response::new(body);
    *response.status_mut() = status;
    *response.headers_mut() = out_headers;

    Ok(response)
}

async fn offline_audio_proxy(
    method: Method,
    State(shared): State<SharedState>,
    Path((item_id, index)): Path<(String, usize)>,
    Query(q): Query<KeyQuery>,
    headers: HeaderMap,
) -> Result<Response, StatusCode> {
    let state = &shared.0;

    if q.k != state.secret {
        return Err(StatusCode::UNAUTHORIZED);
    }

    let idx = load_offline_index(&state.offline_index_path).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let item = idx.items.get(&item_id).ok_or(StatusCode::NOT_FOUND)?;
    let track = item.tracks.iter().find(|t| t.index == index).ok_or(StatusCode::NOT_FOUND)?;
    let full_path = state.offline_root.join(&track.relative_path);

    if !full_path.exists() {
        return Err(StatusCode::NOT_FOUND);
    }

    let mut file = fs::File::open(&full_path).map_err(|_| StatusCode::NOT_FOUND)?;
    let file_len = file.metadata().map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?.len();
    let ct = get_audio_content_type(&full_path);

    let range_hdr = headers.get("range").and_then(|v| v.to_str().ok()).unwrap_or("");
    let mut start = 0u64;
    let mut end = if file_len > 0 { file_len - 1 } else { 0 };
    let mut partial = false;

    if let Some(rest) = range_hdr.strip_prefix("bytes=") {
        if let Some((a, b)) = rest.split_once('-') {
            if let Ok(parsed_start) = a.parse::<u64>() {
                start = parsed_start.min(file_len.saturating_sub(1));
                if !b.is_empty() {
                    if let Ok(parsed_end) = b.parse::<u64>() {
                        end = parsed_end.min(file_len.saturating_sub(1));
                    }
                }
                if end < start {
                    end = start;
                }
                partial = true;
            }
        }
    }

    let mut out_headers = axum::http::HeaderMap::new();
    out_headers.insert(CONTENT_TYPE, HeaderValue::from_static(ct));
    out_headers.insert(ACCEPT_RANGES, HeaderValue::from_static("bytes"));

    let status = if partial {
        let cr = format!("bytes {}-{}/{}", start, end, file_len);
        out_headers.insert(
            axum::http::header::CONTENT_RANGE,
            HeaderValue::from_str(&cr).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?,
        );
        StatusCode::PARTIAL_CONTENT
    } else {
        StatusCode::OK
    };

    let len = end.saturating_sub(start) + 1;
    out_headers.insert(
        axum::http::header::CONTENT_LENGTH,
        HeaderValue::from_str(&len.to_string()).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?,
    );

    if method == Method::HEAD {
        let mut response = Response::new(axum::body::Body::empty());
        *response.status_mut() = status;
        *response.headers_mut() = out_headers;
        return Ok(response);
    }

    file.seek(SeekFrom::Start(start)).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let mut buf = vec![0u8; len as usize];
    file.read_exact(&mut buf).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let mut response = Response::new(axum::body::Body::from(buf));
    *response.status_mut() = status;
    *response.headers_mut() = out_headers;
    Ok(response)
}

/* -------------------- Direct-audio proxy (for format-fallback URLs) -------------------- */

async fn direct_audio_proxy(
    method: Method,
    State(shared): State<SharedState>,
    Query(q): Query<HlsUrlQuery>,
    headers: HeaderMap,
) -> Result<Response, StatusCode> {
    let state = &shared.0;
    if q.k != state.secret {
        return Err(StatusCode::UNAUTHORIZED);
    }

    let token = state
        .active_server_url
        .lock()
        .unwrap()
        .clone()
        .zip(state.active_username.lock().unwrap().clone())
        .and_then(|(srv, usr)| get_token_from_keyring(&srv, &usr).ok())
        .unwrap_or_default();

    let range_hdr = headers
        .get("range")
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string());

    eprintln!("[direct-audio] url={} range={:?}", q.url, range_hdr);

    let client = reqwest::Client::new();

    // HEAD: fetch real content-type from upstream
    if method == Method::HEAD {
        let res = client.get(&q.url)
            .header("Authorization", format!("Bearer {}", token))
            .header(reqwest::header::RANGE, "bytes=0-0")
            .send()
            .await
            .map_err(|_| StatusCode::BAD_GATEWAY)?;
        let real_ct = res.headers().get(CONTENT_TYPE)
            .and_then(|v| v.to_str().ok())
            .unwrap_or("audio/mpeg")
            .to_string();
        let mut response = Response::new(axum::body::Body::empty());
        *response.status_mut() = StatusCode::OK;
        response.headers_mut().insert(
            CONTENT_TYPE,
            HeaderValue::from_str(&real_ct).unwrap_or(HeaderValue::from_static("audio/mpeg")),
        );
        response.headers_mut().insert(ACCEPT_RANGES, HeaderValue::from_static("bytes"));
        return Ok(response);
    }

    let mut req = client.get(&q.url)
        .header("Authorization", format!("Bearer {}", token));
    if let Some(rng) = &range_hdr {
        req = req.header(reqwest::header::RANGE, rng);
    }
    let res = req.send().await.map_err(|_| StatusCode::BAD_GATEWAY)?;

    let status = StatusCode::from_u16(res.status().as_u16()).unwrap_or(StatusCode::BAD_GATEWAY);
    let upstream_ct = res.headers().get(CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("audio/mpeg")
        .to_string();

    let mut out_headers = axum::http::HeaderMap::new();
    out_headers.insert(
        CONTENT_TYPE,
        HeaderValue::from_str(&upstream_ct).unwrap_or(HeaderValue::from_static("audio/mpeg")),
    );
    out_headers.insert(ACCEPT_RANGES, HeaderValue::from_static("bytes"));
    for h in ["content-length", "content-range"] {
        if let Some(v) = res.headers().get(h) {
            if let Ok(hname) = axum::http::HeaderName::from_bytes(h.as_bytes()) {
                if let Ok(hval) = HeaderValue::from_bytes(v.as_bytes()) {
                    out_headers.insert(hname, hval);
                }
            }
        }
    }

    let body = axum::body::Body::from_stream(res.bytes_stream());
    let mut response = Response::new(body);
    *response.status_mut() = status;
    *response.headers_mut() = out_headers;
    Ok(response)
}

/* -------------------- HLS proxy -------------------- */

async fn hls_manifest_proxy(
    State(shared): State<SharedState>,
    Query(q): Query<HlsUrlQuery>,
) -> Result<Response, StatusCode> {
    let state = &shared.0;
    if q.k != state.secret {
        return Err(StatusCode::UNAUTHORIZED);
    }

    let port = state.port;
    let secret = state.secret.clone();

    // Get auth token to fetch manifest from ABS server
    let token = state
        .active_server_url
        .lock()
        .unwrap()
        .clone()
        .zip(state.active_username.lock().unwrap().clone())
        .and_then(|(srv, usr)| get_token_from_keyring(&srv, &usr).ok())
        .unwrap_or_default();

    eprintln!("[hls-manifest] fetching {}", q.url);

    let client = reqwest::Client::new();
    let mut req = client.get(&q.url);
    if !token.is_empty() {
        req = req.header("Authorization", format!("Bearer {}", token));
    }
    let resp = req.send().await.map_err(|_| StatusCode::BAD_GATEWAY)?;

    if !resp.status().is_success() {
        eprintln!("[hls-manifest] upstream status={}", resp.status());
        return Err(StatusCode::BAD_GATEWAY);
    }

    let text = resp.text().await.map_err(|_| StatusCode::BAD_GATEWAY)?;

    // Resolve the base URL for relative segment paths
    let base_url = q.url.rfind('/').map(|i| &q.url[..=i]).unwrap_or("");

    // Rewrite each non-comment, non-empty line to go through our segment proxy
    let rewritten: String = text
        .lines()
        .map(|line| {
            let trimmed = line.trim();
            if trimmed.is_empty() || trimmed.starts_with('#') {
                return line.to_string();
            }
            // Resolve to absolute URL
            let abs = if trimmed.starts_with("http://") || trimmed.starts_with("https://") {
                trimmed.to_string()
            } else {
                format!("{}{}", base_url, trimmed)
            };
            let encoded = percent_encode_url(&abs);
            format!(
                "http://127.0.0.1:{}/hls-segment?url={}&k={}",
                port, encoded, secret
            )
        })
        .collect::<Vec<_>>()
        .join("\n");

    eprintln!("[hls-manifest] rewritten {} segments", rewritten.lines().filter(|l| l.contains("/hls-segment")).count());

    let mut response = Response::new(axum::body::Body::from(rewritten));
    *response.status_mut() = StatusCode::OK;
    response.headers_mut().insert(
        CONTENT_TYPE,
        HeaderValue::from_static("application/vnd.apple.mpegurl"),
    );
    Ok(response)
}

async fn hls_segment_proxy(
    State(shared): State<SharedState>,
    Query(q): Query<HlsUrlQuery>,
) -> Result<Response, StatusCode> {
    let state = &shared.0;
    if q.k != state.secret {
        return Err(StatusCode::UNAUTHORIZED);
    }

    let token = state
        .active_server_url
        .lock()
        .unwrap()
        .clone()
        .zip(state.active_username.lock().unwrap().clone())
        .and_then(|(srv, usr)| get_token_from_keyring(&srv, &usr).ok())
        .unwrap_or_default();

    let client = reqwest::Client::new();
    let mut req = client.get(&q.url);
    if !token.is_empty() {
        req = req.header("Authorization", format!("Bearer {}", token));
    }
    let resp = req.send().await.map_err(|_| StatusCode::BAD_GATEWAY)?;
    let status = StatusCode::from_u16(resp.status().as_u16()).unwrap_or(StatusCode::BAD_GATEWAY);

    let ct = resp
        .headers()
        .get(CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("video/mp2t")
        .to_string();

    let body = axum::body::Body::from_stream(resp.bytes_stream());
    let mut response = Response::new(body);
    *response.status_mut() = status;
    response.headers_mut().insert(
        CONTENT_TYPE,
        HeaderValue::from_str(&ct).unwrap_or(HeaderValue::from_static("video/mp2t")),
    );
    Ok(response)
}

fn percent_encode_url(s: &str) -> String {
    s.chars()
        .flat_map(|c| match c {
            'A'..='Z' | 'a'..='z' | '0'..='9'
            | '-' | '_' | '.' | '~'
            | ':' | '/' | '?' | '#' | '[' | ']' | '@'
            | '!' | '$' | '&' | '\'' | '(' | ')'
            | '*' | '+' | ',' | ';' | '=' => vec![c],
            c => {
                let mut buf = [0u8; 4];
                let encoded: Vec<char> = c
                    .encode_utf8(&mut buf)
                    .bytes()
                    .flat_map(|b| format!("%{:02X}", b).chars().collect::<Vec<_>>())
                    .collect();
                encoded
            }
        })
        .collect()
}

/* -------------------- Commands used by frontend -------------------- */

#[tauri::command]
async fn abs_stream_chapter_url(
    state: tauri::State<'_, SharedState>,
    library_item_id: String,
    index: usize,
) -> Result<String, String> {

    let s = &state.0;

    let port = s.port;
    let secret = s.secret.clone();

    Ok(format!(
        "http://127.0.0.1:{}/chapter/{}/{}?k={}",
        port,
        library_item_id,
        index,
        secret
    ))
}

#[tauri::command(rename_all = "camelCase")]
fn abs_set_active_user(
    state: tauri::State<SharedState>,
    server_url: String,
    username: String,
) -> Result<(), String> {
    let s = &state.0;
    *s.active_server_url.lock().unwrap() = Some(server_url);
    *s.active_username.lock().unwrap() = Some(username);
    Ok(())
}

#[tauri::command(rename_all = "camelCase")]
fn abs_local_player_url(
    state: tauri::State<SharedState>,
    library_id: String,
    index: String,
) -> Result<String, String> {
    let s = &state.0;

    Ok(format!(
        "http://127.0.0.1:{}/audio/{}/{}?k={}",
        s.port, library_id, index, s.secret
    ))
}

/* -------------------- ABS API: Login / Auth + data endpoints -------------------- */

#[derive(Serialize, Deserialize)]
struct LoginRequest {
    username: String,
    password: String,
}

#[derive(Deserialize)]
struct LoginResponse {
    user: LoginUser,
}

#[derive(Deserialize)]
struct LoginUser {
    token: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct LoginResult {
    username: String,
    server_url: String,
}

#[tauri::command]
async fn abs_login_and_store(server_url: String, username: String, password: String) -> Result<LoginResult, String> {
    let server_url = normalize_server_url(server_url);
    let login_url = format!("{}/login", server_url);

    let client = reqwest::Client::new();
    let resp = client
    .post(login_url)
    .json(&LoginRequest { username: username.clone(), password })
    .send()
    .await
    .map_err(|e| format!("Network error: {}", e))?;

    if !resp.status().is_success() {
        return Err(format!("Login failed (HTTP {}).", resp.status()));
    }

    let data: LoginResponse = resp
    .json()
    .await
    .map_err(|e| format!("Invalid server response: {}", e))?;

    let token = data.user.token;

    let key = account_key(&server_url, &username);
    let entry = keyring::Entry::new(SERVICE_NAME, &key)
    .map_err(|e| format!("Keyring error: {}", e))?;
    entry.set_password(&token).map_err(|e| format!("Keyring error: {}", e))?;

    Ok(LoginResult { username, server_url })
}

#[tauri::command]
async fn abs_is_logged_in(server_url: String, username: String) -> Result<bool, String> {
    let server_url = normalize_server_url(server_url);
    let key = account_key(&server_url, &username);

    let entry = keyring::Entry::new(SERVICE_NAME, &key)
    .map_err(|e| format!("Keyring error: {}", e))?;

    let token = match entry.get_password() {
        Ok(t) => t,
        Err(_) => return Ok(false),
    };

    let authorize_url = format!("{}/api/authorize", server_url);
    let resp = reqwest::Client::new()
    .post(authorize_url)
    .header("Authorization", format!("Bearer {}", token))
    .send()
    .await
    .map_err(|e| format!("Network error: {}", e))?;

    Ok(resp.status().is_success())
}

#[tauri::command]
async fn abs_logout(server_url: String, username: String) -> Result<(), String> {
    let server_url = normalize_server_url(server_url);
    let key = account_key(&server_url, &username);
    let entry = keyring::Entry::new(SERVICE_NAME, &key)
    .map_err(|e| format!("Keyring error: {}", e))?;

    if let Ok(token) = entry.get_password() {
        let logout_url = format!("{}/logout", server_url);
        let _ = reqwest::Client::new()
        .post(logout_url)
        .header("Authorization", format!("Bearer {}", token))
        .send()
        .await;
    }

    entry.delete_credential().map_err(|e| format!("Keyring error: {}", e))?;
    Ok(())
}

#[tauri::command]
async fn abs_get_libraries(server_url: String, username: String) -> Result<serde_json::Value, String> {
    let server_url = normalize_server_url(server_url);
    let token = get_token_from_keyring(&server_url, &username)?;
    let url = format!("{}/api/libraries", server_url);

    let resp = reqwest::Client::new()
    .get(url)
    .header("Authorization", format!("Bearer {}", token))
    .send()
    .await
    .map_err(|e| format!("Network error: {}", e))?;

    if !resp.status().is_success() {
        return Err(format!("Request failed (HTTP {}).", resp.status()));
    }

    resp.json::<serde_json::Value>()
    .await
    .map_err(|e| format!("Invalid server response: {}", e))
}

#[tauri::command]
async fn abs_get_me(server_url: String, username: String) -> Result<serde_json::Value, String> {
    let server_url = normalize_server_url(server_url);
    let token = get_token_from_keyring(&server_url, &username)?;
    let url = format!("{}/api/me", server_url);

    let resp = reqwest::Client::new()
    .get(url)
    .header("Authorization", format!("Bearer {}", token))
    .send()
    .await
    .map_err(|e| format!("Network error: {}", e))?;

    if !resp.status().is_success() {
        return Err(format!("Request failed (HTTP {}).", resp.status()));
    }

    resp.json::<serde_json::Value>()
    .await
    .map_err(|e| format!("Invalid server response: {}", e))
}

#[tauri::command]
async fn abs_get_item(server_url: String, username: String, item_id: String) -> Result<serde_json::Value, String> {
    let server_url = normalize_server_url(server_url);
    let token = get_token_from_keyring(&server_url, &username)?;
    let url = format!("{}/api/items/{}?include=progress", server_url, item_id);

    let resp = reqwest::Client::new()
    .get(url)
    .header("Authorization", format!("Bearer {}", token))
    .send()
    .await
    .map_err(|e| format!("Network error: {}", e))?;

    if !resp.status().is_success() {
        return Err(format!("Request failed (HTTP {}).", resp.status()));
    }

    resp.json::<serde_json::Value>()
    .await
    .map_err(|e| format!("Invalid server response: {}", e))
}

#[tauri::command]
async fn abs_get_progress(
    server_url: String,
    username: String,
    item_id: String,
    episode_id: Option<String>,
) -> Result<serde_json::Value, String> {
    let server_url = normalize_server_url(server_url);
    let token = get_token_from_keyring(&server_url, &username)?;
    let url = if let Some(ref ep_id) = episode_id {
        format!("{}/api/me/progress/{}/{}", server_url, item_id, ep_id)
    } else {
        format!("{}/api/me/progress/{}", server_url, item_id)
    };

    let resp = reqwest::Client::new()
    .get(url)
    .header("Authorization", format!("Bearer {}", token))
    .send()
    .await
    .map_err(|e| format!("Network error: {}", e))?;

    if !resp.status().is_success() {
        return Err(format!("Request failed (HTTP {}).", resp.status()));
    }

    resp.json::<serde_json::Value>()
    .await
    .map_err(|e| format!("Invalid server response: {}", e))
}

#[tauri::command]
async fn abs_get_items_in_progress(
    server_url: String,
    username: String,
) -> Result<serde_json::Value, String> {

    let server_url = normalize_server_url(server_url);
    let token = get_token_from_keyring(&server_url, &username)?;

    // Prefer items-in-progress; fallback to listening-sessions if empty/unavailable.
    let items_url = format!("{}/api/me/items-in-progress?limit=1000", server_url);

    let items_resp = reqwest::Client::new()
    .get(items_url)
    .header("Authorization", format!("Bearer {}", token))
    .send()
    .await
    .map_err(|e| format!("Network error: {}", e))?;

    if items_resp.status().is_success() {
        let items_json = items_resp
        .json::<serde_json::Value>()
        .await
        .map_err(|e| format!("Invalid response: {}", e))?;

        let count = if let Some(arr) = items_json.as_array() {
            arr.len()
        } else if let Some(arr) = items_json.get("results").and_then(|x| x.as_array()) {
            arr.len()
        } else if let Some(arr) = items_json.get("items").and_then(|x| x.as_array()) {
            arr.len()
        } else if let Some(arr) = items_json.get("libraryItems").and_then(|x| x.as_array()) {
            arr.len()
        } else {
            0
        };

        if count > 0 {
            return Ok(items_json);
        }
    }

    let sessions_url = format!("{}/api/me/listening-sessions?itemsPerPage=1000&page=0", server_url);

    let sessions_resp = reqwest::Client::new()
    .get(sessions_url)
    .header("Authorization", format!("Bearer {}", token))
    .send()
    .await
    .map_err(|e| format!("Network error: {}", e))?;

    if !sessions_resp.status().is_success() {
        return Err(format!("In-progress fallback failed (HTTP {}).", sessions_resp.status()));
    }

    sessions_resp
    .json::<serde_json::Value>()
    .await
    .map_err(|e| format!("Invalid response: {}", e))
}

#[tauri::command]
async fn abs_get_library_items(server_url: String, username: String, library_id: String) -> Result<serde_json::Value, String> {
    let server_url = normalize_server_url(server_url);
    let token = get_token_from_keyring(&server_url, &username)?;
    let url = format!("{}/api/libraries/{}/items", server_url, library_id);

    let resp = reqwest::Client::new()
    .get(url)
    .header("Authorization", format!("Bearer {}", token))
    .send()
    .await
    .map_err(|e| format!("Network error: {}", e))?;

    if !resp.status().is_success() {
        return Err(format!("Request failed (HTTP {}).", resp.status()));
    }

    resp.json::<serde_json::Value>()
    .await
    .map_err(|e| format!("Invalid response: {}", e))
}

#[tauri::command]
async fn abs_get_cover_url(server_url: String, username: String, item_id: String) -> Result<String, String> {
    let server_url = normalize_server_url(server_url);
    let token = get_token_from_keyring(&server_url, &username)?;
    Ok(format!("{}/api/items/{}/cover?token={}", server_url, item_id, token))
}

#[tauri::command]
async fn abs_trigger_play(
    server_url: String,
    username: String,
    item_id: String,
) -> Result<(), String> {

    let server_url = normalize_server_url(server_url);
    let token = get_token_from_keyring(&server_url, &username)?;

    let url = format!("{}/api/items/{}/play/0", server_url, item_id);

    let resp = reqwest::Client::new()
    .get(url)
    .header("Authorization", format!("Bearer {}", token))
    .send()
    .await
    .map_err(|e| format!("Network error: {}", e))?;

    if !resp.status().is_success() {
        return Err(format!("Play trigger failed HTTP {}", resp.status()));
    }

    Ok(())
}

#[tauri::command]
async fn abs_start_playback(
    server_url: String,
    username: String,
    item_id: String,
    episode_id: Option<String>,
) -> Result<serde_json::Value, String> {

    let server_url = normalize_server_url(server_url);
    let token = get_token_from_keyring(&server_url, &username)?;

    let url = if let Some(ref ep_id) = episode_id {
        format!("{}/api/items/{}/play/{}", server_url, item_id, ep_id)
    } else {
        format!("{}/api/items/{}/play", server_url, item_id)
    };

    eprintln!(
        "[abs-start-playback] item_id={} episode_id={:?} url={}",
        item_id, episode_id, url
    );

    let body = serde_json::json!({
        "deviceInfo": {
            "clientName": "Bookstory",
            "deviceId": "bookstory-desktop",
            "platform": "desktop"
        }
    });

    let resp = reqwest::Client::new()
    .post(url)
    .header("Authorization", format!("Bearer {}", token))
    .json(&body)
    .send()
    .await
    .map_err(|e| format!("Network error: {}", e))?;

    eprintln!("[abs-start-playback] status={}", resp.status());

    if !resp.status().is_success() {
        return Err(format!("Session start failed (HTTP {})", resp.status()));
    }

    resp.json::<serde_json::Value>()
    .await
    .map_err(|e| format!("Invalid response: {}", e))
}

#[tauri::command(rename_all = "camelCase")]
async fn abs_resolve_playback_url(
    state: tauri::State<'_, SharedState>,
    server_url: String,
    username: String,
    item_id: String,
    episode_id: Option<String>,
) -> Result<String, String> {
    let server_url = normalize_server_url(server_url);
    let token = get_token_from_keyring(&server_url, &username)?;

    let url = if let Some(ref ep_id) = episode_id {
        format!("{}/api/items/{}/play/{}", server_url, item_id, ep_id)
    } else {
        format!("{}/api/items/{}/play", server_url, item_id)
    };

    eprintln!(
        "[abs-resolve-playback-url] item_id={} episode_id={:?} url={}",
        item_id, episode_id, url
    );

    let body = serde_json::json!({
        "forceDirectPlay": true,
        "deviceInfo": {
            "clientName": "Bookstory",
            "deviceId": "bookstory-desktop",
            "platform": "desktop"
        }
    });

    let resp = reqwest::Client::new()
        .post(url)
        .header("Authorization", format!("Bearer {}", token))
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Network error: {}", e))?;

    eprintln!("[abs-resolve-playback-url] status={}", resp.status());

    if !resp.status().is_success() {
        return Err(format!("Playback url resolve failed (HTTP {})", resp.status()));
    }

    let data = resp
        .json::<serde_json::Value>()
        .await
        .map_err(|e| format!("Invalid response: {}", e))?;

    let mut content_url = data
        .pointer("/audioTracks/0/contentUrl")
        .and_then(|v| v.as_str())
        .or_else(|| data.pointer("/media/audioTracks/0/contentUrl").and_then(|v| v.as_str()))
        .or_else(|| data.pointer("/audioTrack/contentUrl").and_then(|v| v.as_str()))
        .or_else(|| data.pointer("/streamUrl").and_then(|v| v.as_str()))
        .map(|s| s.to_string())
        .ok_or_else(|| "Could not find contentUrl in playback response".to_string())?;

    if content_url.starts_with('/') {
        content_url = format!("{}{}", server_url, content_url);
    }

    eprintln!("[abs-resolve-playback-url] resolved={}", content_url);

    let s = &state.0;
    let encoded = percent_encode_url(&content_url);

    // All external URLs must go through the local proxy — the WebView can't reach the ABS server directly
    if content_url.contains(".m3u8") {
        let local_url = format!(
            "http://127.0.0.1:{}/hls-manifest?url={}&k={}",
            s.port, encoded, s.secret
        );
        eprintln!("[abs-resolve-playback-url] wrapping as hls proxy={}", local_url);
        return Ok(local_url);
    }

    let local_url = format!(
        "http://127.0.0.1:{}/direct-audio?url={}&k={}",
        s.port, encoded, s.secret
    );
    eprintln!("[abs-resolve-playback-url] wrapping as direct-audio proxy={}", local_url);
    Ok(local_url)
}

#[tauri::command]
async fn abs_sync_session(server_url: String, username: String, session_id: String, current_time: f64) -> Result<(), String> {
    let server_url = normalize_server_url(server_url);
    let token = get_token_from_keyring(&server_url, &username)?;
    let url = format!("{}/api/session/{}/sync", server_url, session_id);

    let body = serde_json::json!({ "currentTime": current_time });

    let resp = reqwest::Client::new()
    .post(url)
    .header("Authorization", format!("Bearer {}", token))
    .json(&body)
    .send()
    .await
    .map_err(|e| format!("Network error: {}", e))?;

    if !resp.status().is_success() {
        return Err(format!("Sync failed (HTTP {}).", resp.status()));
    }

    Ok(())
}

#[tauri::command]
async fn abs_stop_playback(server_url: String, username: String, session_id: String) -> Result<(), String> {
    let server_url = normalize_server_url(server_url);
    let token = get_token_from_keyring(&server_url, &username)?;
    let url = format!("{}/api/session/{}/close", server_url, session_id);

    let resp = reqwest::Client::new()
    .post(url)
    .header("Authorization", format!("Bearer {}", token))
    .send()
    .await
    .map_err(|e| format!("Network error: {}", e))?;

    if !resp.status().is_success() {
        return Err(format!("Stop failed (HTTP {}).", resp.status()));
    }

    Ok(())
}

#[tauri::command]
async fn abs_update_progress(
    server_url: String,
    username: String,
    item_id: String,
    current_time: f64,
    episode_id: Option<String>,
) -> Result<(), String> {

    let server_url = normalize_server_url(server_url);
    let token = get_token_from_keyring(&server_url, &username)?;

    let url = if let Some(ref ep_id) = episode_id {
        format!("{}/api/me/progress/{}/{}", server_url, item_id, ep_id)
    } else {
        format!("{}/api/me/progress/{}", server_url, item_id)
    };

    let body = serde_json::json!({
        "currentTime": current_time
    });

    let resp = reqwest::Client::new()
    .patch(url)
    .header("Authorization", format!("Bearer {}", token))
    .json(&body)
    .send()
    .await
    .map_err(|e| format!("Network error: {}", e))?;

    if !resp.status().is_success() {
        return Err(format!(
            "Progress update failed (HTTP {})",
                           resp.status()
        ));
    }

    Ok(())
}

#[tauri::command]
async fn abs_mark_played(
    server_url: String,
    username: String,
    item_id: String,
    episode_id: Option<String>,
) -> Result<(), String> {

    let server_url = normalize_server_url(server_url);
    let token = get_token_from_keyring(&server_url, &username)?;

    let url = if let Some(ref ep_id) = episode_id {
        format!("{}/api/me/progress/{}/{}", server_url, item_id, ep_id)
    } else {
        format!("{}/api/me/progress/{}", server_url, item_id)
    };

    let body = serde_json::json!({
        "isFinished": true,
        "progress": 1.0
    });

    let resp = reqwest::Client::new()
    .patch(url)
    .header("Authorization", format!("Bearer {}", token))
    .json(&body)
    .send()
    .await
    .map_err(|e| format!("Network error: {}", e))?;

    if !resp.status().is_success() {
        return Err(format!(
            "Mark played failed (HTTP {})",
            resp.status()
        ));
    }

    Ok(())
}

#[tauri::command]
async fn abs_mark_unplayed(
    server_url: String,
    username: String,
    item_id: String,
    episode_id: Option<String>,
) -> Result<(), String> {

    let server_url = normalize_server_url(server_url);
    let token = get_token_from_keyring(&server_url, &username)?;

    // Step 1: Fetch the current progress record to obtain its UUID.
    // The DELETE endpoint requires the progress record's own UUID, not the
    // library item ID.
    let get_url = if let Some(ref ep_id) = episode_id {
        format!("{}/api/me/progress/{}/{}", server_url, item_id, ep_id)
    } else {
        format!("{}/api/me/progress/{}", server_url, item_id)
    };

    let client = reqwest::Client::new();

    let get_resp = client
        .get(&get_url)
        .header("Authorization", format!("Bearer {}", token))
        .send()
        .await
        .map_err(|e| format!("Network error: {}", e))?;

    // 404 means no progress exists — already unplayed, nothing to do.
    if get_resp.status().as_u16() == 404 {
        return Ok(());
    }

    if !get_resp.status().is_success() {
        return Err(format!(
            "Fetch progress failed (HTTP {})",
            get_resp.status()
        ));
    }

    let progress: serde_json::Value = get_resp
        .json()
        .await
        .map_err(|e| format!("Invalid server response: {}", e))?;

    // Step 2: Extract the progress record's UUID.
    let progress_id = progress["id"]
        .as_str()
        .ok_or_else(|| "Progress record missing id field".to_string())?;

    // Step 3: Delete the progress record entirely.
    // This is the correct ABS API for resetting a book to unplayed —
    // PATCH with isFinished:false is ignored by the server.
    let delete_url = format!("{}/api/me/progress/{}", server_url, progress_id);

    let delete_resp = client
        .delete(&delete_url)
        .header("Authorization", format!("Bearer {}", token))
        .send()
        .await
        .map_err(|e| format!("Network error: {}", e))?;

    if !delete_resp.status().is_success() {
        return Err(format!(
            "Mark unplayed failed (HTTP {})",
            delete_resp.status()
        ));
    }

    Ok(())
}

/* -------------------- Tauri entrypoint -------------------- */

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
    .plugin(tauri_plugin_opener::init())
    .setup(|app| {
        let app_data = app
            .path()
            .app_data_dir()
            .map_err(|e| format!("Failed to resolve app data dir: {}", e))?;
        let offline_root = app_data.join("offline");
        fs::create_dir_all(&offline_root)
            .map_err(|e| format!("Failed to create offline root dir: {}", e))?;
        let offline_index_path = offline_root.join("index.json");
        ensure_offline_index(&offline_index_path)?;

        let secret: String = rand::thread_rng()
        .sample_iter(&Alphanumeric)
        .take(32)
        .map(char::from)
        .collect();

        let listener = tauri::async_runtime::block_on(async {
            tokio::net::TcpListener::bind("127.0.0.1:0").await
        }).expect("failed to bind localhost");

        let port = listener.local_addr().unwrap().port();

        let shared = SharedState(Arc::new(ProxyState {
            port,
            secret,
            active_server_url: Mutex::new(None),
            active_username: Mutex::new(None),
            offline_root,
            offline_index_path,
        }));

        app.manage(shared.clone());

        tauri::async_runtime::spawn(async move {
            let router = Router::new()
            .route("/audio/:library_id/:index", get(audio_proxy).head(audio_proxy))
            .route("/offline/:item_id/:index", get(offline_audio_proxy).head(offline_audio_proxy))
            .route("/direct-audio", get(direct_audio_proxy).head(direct_audio_proxy))
            .route("/hls-manifest", get(hls_manifest_proxy))
            .route("/hls-segment", get(hls_segment_proxy))
            .with_state(shared);

            axum::serve(listener, router)
            .await
            .expect("audio proxy crashed");
        });

        Ok(())
    })
    .invoke_handler(tauri::generate_handler![
        abs_login_and_store,
        abs_is_logged_in,
        abs_logout,
        abs_get_libraries,
        abs_get_me,
        abs_get_item,
        abs_get_progress,
        abs_get_items_in_progress,
        abs_get_library_items,
        abs_get_cover_url,
        abs_start_playback,
        abs_sync_session,
        abs_stop_playback,
        abs_update_progress,
        abs_mark_played,
        abs_mark_unplayed,
        abs_get_install_context,
        abs_set_active_user,
        abs_local_player_url,
        abs_stream_chapter_url,
        abs_resolve_playback_url,
        abs_trigger_play,
        abs_offline_download_item,
        abs_offline_item_status,
        abs_offline_stats,
        abs_offline_enforce_max_storage,
        abs_offline_remove_item,
        abs_offline_remove_all,
        abs_offline_local_player_url,
        abs_offline_queue_progress,
        abs_offline_sync_queued_progress
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
