#[cfg(all(not(debug_assertions), not(feature = "custom-protocol")))]
compile_error!("Release builds must embed frontend assets. Use npm run tauri build -- --features custom-protocol.");

#[cfg(target_os = "android")]
mod android;
mod backup;
#[cfg(desktop)]
mod gpx_drop;
#[cfg(desktop)]
use gpx_drop::DroppedGpxFiles;
#[cfg(desktop)]
use tauri::Manager;

#[cfg(desktop)]
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default();
    #[cfg(desktop)]
    let builder = builder
        .manage(DroppedGpxFiles::default())
        .invoke_handler(tauri::generate_handler![
            read_dropped_gpx,
            backup::export_backup
        ])
        .on_window_event(|window, event| {
            if window.label() == "main" {
                if let tauri::WindowEvent::DragDrop(tauri::DragDropEvent::Drop { paths, .. }) =
                    event
                {
                    window.state::<DroppedGpxFiles>().allow_drop(paths);
                }
            }
        })
        .on_webview_event(|webview, event| {
            if webview.label() == "main" {
                if let tauri::WebviewEvent::DragDrop(tauri::DragDropEvent::Drop { paths, .. }) =
                    event
                {
                    webview.state::<DroppedGpxFiles>().allow_drop(paths);
                }
            }
        });
    #[cfg(target_os = "android")]
    let builder = builder
        .plugin(android::init())
        .invoke_handler(tauri::generate_handler![
            backup::export_backup,
            backup::restore_backup,
            android::take_shared_gpx,
            android::read_shared_gpx,
            android::set_android_theme,
            android::set_android_back_enabled
        ]);
    builder
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
