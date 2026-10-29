#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

#[cfg(all(not(debug_assertions), not(feature = "custom-protocol")))]
compile_error!("Release builds must embed frontend assets. Use npm run tauri build -- --features custom-protocol.");

mod gpx_drop;
use gpx_drop::DroppedGpxFiles;
use tauri::Manager;

#[tauri::command]
async fn read_dropped_gpx(
    path: std::path::PathBuf,
    dropped: tauri::State<'_, DroppedGpxFiles>,
) -> Result<String, String> {
    dropped.claim(&path)?;
    tauri::async_runtime::spawn_blocking(move || gpx_drop::read_gpx(&path))
        .await
        .map_err(|_| "读取文件失败，请重试".to_string())?
}

fn main() {
    tauri::Builder::default()
        .manage(DroppedGpxFiles::default())
        .invoke_handler(tauri::generate_handler![read_dropped_gpx])
        .on_window_event(|window, event| {
            if window.label() == "main" {
                if let tauri::WindowEvent::DragDrop(tauri::DragDropEvent::Drop { paths, .. }) = event {
                    window.state::<DroppedGpxFiles>().allow_drop(paths);
                }
            }
        })
        .on_webview_event(|webview, event| {
            if webview.label() == "main" {
                if let tauri::WebviewEvent::DragDrop(tauri::DragDropEvent::Drop { paths, .. }) = event {
                    webview.state::<DroppedGpxFiles>().allow_drop(paths);
                }
            }
        })
        .plugin(tauri_plugin_sql::Builder::default().add_migrations("sqlite:rideweave.db", vec![
            tauri_plugin_sql::Migration {
                version: 1,
                description: "create rides",
                sql: "CREATE TABLE IF NOT EXISTS rides (id TEXT PRIMARY KEY, name TEXT NOT NULL, date TEXT, distance REAL NOT NULL, duration REAL, segments TEXT NOT NULL, raw_gpx TEXT NOT NULL, filename TEXT NOT NULL, imported_at TEXT NOT NULL);",
                kind: tauri_plugin_sql::MigrationKind::Up,
            }
        ]).build())
        .run(tauri::generate_context!())
        .expect("无法启动 RideWeave");
}

