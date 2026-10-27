#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

#[cfg(all(not(debug_assertions), not(feature = "custom-protocol")))]
compile_error!("Release builds must embed frontend assets. Use npm run tauri build -- --features custom-protocol.");

fn main() {
    tauri::Builder::default()
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

