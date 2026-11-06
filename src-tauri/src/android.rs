use serde::{Deserialize, Serialize};
use std::{fs::File, io::Read, os::fd::FromRawFd, path::Path};
use tauri::{
    ipc::Response,
    plugin::{Builder, PluginHandle, TauriPlugin},
    AppHandle, Manager, Wry,
};

const MAX_GPX_BYTES: usize = 50 * 1024 * 1024;

pub fn init() -> TauriPlugin<Wry> {
    Builder::new("rideweave-android")
        .setup(|app, api| {
            app.manage(api.register_android_plugin("com.rideweave.android", "RideWeaveFiles")?);
            Ok(())
        })
        .build()
}

async fn call<T: serde::de::DeserializeOwned>(
    app: &AppHandle,
    method: &str,
    args: impl Serialize,
) -> Result<T, String> {
    app.state::<PluginHandle<Wry>>()
        .run_mobile_plugin_async(method, args)
        .await
        .map_err(|e| e.to_string())
}

#[derive(Deserialize)]
struct BackupResult {
    selected: bool,
}

pub async fn copy_backup(app: &AppHandle, path: &Path, export: bool) -> Result<bool, String> {
    let result: BackupResult = call(
        app,
        "copyBackup",
        serde_json::json!({ "path": path, "export": export }),
    )
    .await?;
    Ok(result.selected)
}

#[derive(Serialize, Deserialize)]
pub struct SharedGpx {
    token: String,
    name: String,
    size: Option<u64>,
}

#[derive(Deserialize)]
struct SharedFiles {
    files: Vec<SharedGpx>,
}

#[tauri::command]
pub async fn take_shared_gpx(app: AppHandle) -> Result<Vec<SharedGpx>, String> {
    let result: SharedFiles = call(&app, "takeSharedGpx", ()).await?;
    Ok(result.files)
}

#[derive(Deserialize)]
struct SharedDescriptor {
    fd: i32,
}

#[tauri::command]
pub async fn read_shared_gpx(app: AppHandle, token: String) -> Result<Response, String> {
    let result: SharedDescriptor =
        call(&app, "openSharedGpx", serde_json::json!({ "token": token })).await?;
    // The Android plugin detaches a valid descriptor and transfers ownership.
    let file = unsafe { File::from_raw_fd(result.fd) };
    tauri::async_runtime::spawn_blocking(move || {
        let mut bytes = Vec::new();
        file.take((MAX_GPX_BYTES + 1) as u64)
            .read_to_end(&mut bytes)
            .map_err(|_| "无法读取分享的 GPX 文件")?;
        if bytes.len() > MAX_GPX_BYTES {
            return Err("文件超过 50 MB 限制".into());
        }
        if std::str::from_utf8(&bytes).is_err() {
            return Err("GPX 文件不是有效的 UTF-8 文本".into());
        }
        Ok(Response::new(bytes))
    })
    .await
    .map_err(|_| "读取文件失败，请重试".to_owned())?
}

#[tauri::command]
pub async fn set_android_theme(app: AppHandle, dark: bool) -> Result<(), String> {
    call(&app, "setTheme", serde_json::json!({ "enabled": dark })).await
}

#[tauri::command]
pub async fn set_android_back_enabled(app: AppHandle, enabled: bool) -> Result<(), String> {
    call(
        &app,
        "setBackEnabled",
        serde_json::json!({ "enabled": enabled }),
    )
    .await
}
