#[cfg(all(
    target_os = "android",
    not(debug_assertions),
    not(feature = "custom-protocol")
))]
compile_error!("Release builds must embed frontend assets. Pass --features custom-protocol to the Android build.");

#[cfg(target_os = "android")]
mod android;
#[cfg(any(test, target_os = "android"))]
mod backup;

#[cfg(target_os = "android")]
#[tauri::mobile_entry_point]
pub fn run() {
    tauri::Builder::default()
        .plugin(android::init())
        .invoke_handler(tauri::generate_handler![
            backup::export_backup,
            backup::restore_backup,
            android::take_shared_gpx,
            android::read_shared_gpx,
            android::set_android_theme,
            android::set_android_back_enabled
        ])
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
