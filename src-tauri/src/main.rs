#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

#[cfg(all(not(debug_assertions), not(feature = "custom-protocol")))]
compile_error!("Release builds must embed frontend assets. Use npm run tauri build -- --features custom-protocol.");

mod backup;
mod gpx_drop;
use gpx_drop::{has_extension, DroppedImportFiles, DroppedZip};
use tauri::{ipc::Response, AppHandle, Manager};

#[tauri::command]
async fn read_dropped_gpx(
    path: std::path::PathBuf,
    dropped: tauri::State<'_, DroppedImportFiles>,
) -> Result<String, String> {
    if !has_extension(&path, "gpx") {
        return Err("仅支持 GPX 文件".into());
    }
    dropped.claim(&path)?;
    tauri::async_runtime::spawn_blocking(move || gpx_drop::read_gpx(&path))
        .await
        .map_err(|_| "读取文件失败，请重试".to_string())?
}

#[tauri::command]
async fn open_dropped_zip(
    path: std::path::PathBuf,
    dropped: tauri::State<'_, DroppedImportFiles>,
    app: AppHandle,
) -> Result<u64, String> {
    if !has_extension(&path, "zip") {
        return Err("仅支持 ZIP 压缩包".into());
    }
    dropped.claim(&path)?;
    tauri::async_runtime::spawn_blocking(move || app.state::<DroppedZip>().open(&path))
        .await
        .map_err(|_| "打开 ZIP 失败，请重试".to_string())?
}

#[tauri::command]
async fn read_dropped_zip_range(
    offset: u64,
    length: usize,
    app: AppHandle,
) -> Result<Response, String> {
    tauri::async_runtime::spawn_blocking(move || {
        app.state::<DroppedZip>()
            .read(offset, length)
            .map(Response::new)
    })
    .await
    .map_err(|_| "读取 ZIP 失败，请重试".to_string())?
}

#[tauri::command]
fn close_dropped_zip(zip: tauri::State<'_, DroppedZip>) {
    zip.close();
}

fn main() {
    tauri::Builder::default()
        .manage(DroppedImportFiles::default())
        .manage(DroppedZip::default())
        .invoke_handler(tauri::generate_handler![
            read_dropped_gpx,
            open_dropped_zip,
            read_dropped_zip_range,
            close_dropped_zip,
            backup::export_backup
        ])
        .on_window_event(|window, event| {
            if window.label() == "main" {
                if let tauri::WindowEvent::DragDrop(tauri::DragDropEvent::Drop { paths, .. }) =
                    event
                {
                    window.state::<DroppedImportFiles>().allow_drop(paths);
                }
            }
        })
        .on_webview_event(|webview, event| {
            if webview.label() == "main" {
                if let tauri::WebviewEvent::DragDrop(tauri::DragDropEvent::Drop { paths, .. }) =
                    event
                {
                    webview.state::<DroppedImportFiles>().allow_drop(paths);
                }
            }
        })
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations(
                    backup::DATABASE,
                    vec![tauri_plugin_sql::Migration {
                        version: 1,
                        description: "create rides",
                        sql: backup::CREATE_RIDES,
                        kind: tauri_plugin_sql::MigrationKind::Up,
                    }],
                )
                .build(),
        )
        .run(tauri::generate_context!())
        .expect("无法启动 RideWeave");
}
