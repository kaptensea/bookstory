use serde::{Deserialize, Serialize};
use tauri::Manager;

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
use std::sync::{Arc, Mutex};

const SERVICE_NAME: &str = "audiobookshelf-client";

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
}

#[derive(Clone, Debug)]
pub struct SharedState(pub Arc<ProxyState>);

#[derive(Deserialize)]
struct KeyQuery {
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

/* -------------------- Local HTTP proxy -------------------- */



async fn audio_proxy(
    method: Method,
    State(shared): State<SharedState>,
                     Path((library_id, file_ino)): Path<(String, String)>,
                     Query(q): Query<KeyQuery>,
                     headers: HeaderMap,
) -> Result<Response, StatusCode> {
    let state = &shared.0;

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

    // HEAD: WebView frågar ofta först. Svara OK med relevanta headers.
    if method == Method::HEAD {
        let mut response = Response::new(axum::body::Body::empty());
        *response.status_mut() = StatusCode::OK;
        let mut h = axum::http::HeaderMap::new();
        h.insert(CONTENT_TYPE, HeaderValue::from_static("audio/mpeg"));
        h.insert(ACCEPT_RANGES, HeaderValue::from_static("bytes"));
        *response.headers_mut() = h;
        return Ok(response);
    }




    let client = reqwest::Client::new();

    let range_hdr = headers
    .get("range")
    .and_then(|v| v.to_str().ok())
    .map(|s| s.to_string());

    // /play -> audioTracks[0].contentUrl
    let target = format!(
        "{}/api/items/{}/file/{}?token={}",
        server_url,
        library_id,
        file_ino,
        token
    );

    println!("STREAM TARGET = {}", target);

    let mut req = client.get(&target);

    if let Some(rng) = &range_hdr {
        req = req.header(reqwest::header::RANGE, rng);
    }

    let res = req
    .send()
    .await
    .map_err(|_| StatusCode::BAD_GATEWAY)?;


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

/* -------------------- Commands used by frontend -------------------- */

#[tauri::command]
async fn abs_local_audio_file_url(
    state: tauri::State<'_, SharedState>,
    library_item_id: String,
    index: usize,
) -> Result<String, String> {

    let s = &state.0;

    let server_url = s
    .active_server_url
    .lock()
    .unwrap()
    .clone()
    .ok_or("No active server")?;

    let username = s
    .active_username
    .lock()
    .unwrap()
    .clone()
    .ok_or("No active user")?;

    let token = get_token_from_keyring(&server_url, &username)?;

    Ok(format!(
        "{}/api/items/{}/play/{}?token={}",
        server_url,
        library_item_id,
        index,
        token
    ))
}

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
    let url = format!("{}/api/items/{}", server_url, item_id);

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
) -> Result<serde_json::Value, String> {

    let server_url = normalize_server_url(server_url);
    let token = get_token_from_keyring(&server_url, &username)?;

    let url = format!("{}/api/items/{}/play", server_url, item_id);

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

    if !resp.status().is_success() {
        return Err(format!("Session start failed (HTTP {})", resp.status()));
    }

    resp.json::<serde_json::Value>()
    .await
    .map_err(|e| format!("Invalid response: {}", e))
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
async fn abs_update_progress(
    server_url: String,
    username: String,
    item_id: String,
    current_time: f64,
) -> Result<(), String> {

    let server_url = normalize_server_url(server_url);
    let token = get_token_from_keyring(&server_url, &username)?;

    let url = format!(
        "{}/api/me/progress/{}",
        server_url,
        item_id
    );

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
) -> Result<(), String> {

    let server_url = normalize_server_url(server_url);
    let token = get_token_from_keyring(&server_url, &username)?;

    let url = format!(
        "{}/api/me/progress/{}",
        server_url,
        item_id
    );

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
fn abs_build_authed_url(server_url: String, username: String, path: String) -> Result<String, String> {
    let server_url = normalize_server_url(server_url);
    let token = get_token_from_keyring(&server_url, &username)?;

    let full = if path.starts_with("http://") || path.starts_with("https://") {
        path
    } else if path.starts_with('/') {
        format!("{}{}", server_url, path)
    } else {
        format!("{}/{}", server_url, path)
    };

    let joiner = if full.contains('?') { "&" } else { "?" };
    Ok(format!("{}{}token={}", full, joiner, token))
}

/* -------------------- Tauri entrypoint -------------------- */

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
    .setup(|app| {
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
        }));

        app.manage(shared.clone());

        tauri::async_runtime::spawn(async move {
            let router = Router::new()
            .route("/audio/:library_id/:index", get(audio_proxy).head(audio_proxy))
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
        abs_get_items_in_progress,
        abs_get_library_items,
        abs_get_cover_url,
        abs_start_playback,
        abs_sync_session,
        abs_update_progress,
        abs_mark_played,
        abs_build_authed_url,
        abs_set_active_user,
        abs_local_player_url,
        abs_local_audio_file_url,
        abs_stream_chapter_url,
        abs_trigger_play
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
