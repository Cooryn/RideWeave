use sqlx::{sqlite::SqliteConnectOptions, Connection, SqliteConnection, SqlitePool};

use std::fs::File;
use std::path::Path;
use tauri::{AppHandle, Manager};
use tauri_plugin_sql::{DbInstances, DbPool};

pub const DATABASE: &str = "sqlite:rideweave.db";
pub const CREATE_RIDES: &str = "CREATE TABLE IF NOT EXISTS rides (id TEXT PRIMARY KEY, name TEXT NOT NULL, date TEXT, distance REAL NOT NULL, duration REAL, segments TEXT NOT NULL, raw_gpx TEXT NOT NULL, filename TEXT NOT NULL, imported_at TEXT NOT NULL);";
const FORMAT_ID: i32 = 0x52575642;
const FORMAT_VERSION: i32 = 1;
const BACKUP_NAME: &str = "RideWeave.rideweave-backup";

async fn ride_pool(app: &AppHandle) -> Result<SqlitePool, String> {
    let instances = app.state::<DbInstances>();
    let databases = instances.0.read().await;
    match databases.get(DATABASE) {
        Some(DbPool::Sqlite(pool)) => Ok(pool.clone()),
        _ => Err("本地数据库尚未就绪".into()),
    }
}

fn temporary_backup(app: &AppHandle) -> Result<tempfile::TempDir, String> {
    let cache = app.path().app_cache_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&cache).map_err(|e| e.to_string())?;
    tempfile::Builder::new()
        .prefix("rideweave-backup-")
        .tempdir_in(cache)
        .map_err(|e| format!("无法创建临时备份：{e}"))
}

async fn export_snapshot(pool: &SqlitePool, snapshot: &Path) -> Result<(), sqlx::Error> {
    let path = snapshot
        .to_str()
        .ok_or_else(|| sqlx::Error::InvalidArgument("备份路径含有不受支持的字符".into()))?;
    sqlx::query("VACUUM INTO ?")
        .bind(path)
        .execute(pool)
        .await?;
    let mut output =
        SqliteConnection::connect_with(&SqliteConnectOptions::new().filename(snapshot)).await?;
    sqlx::query(&format!(
        "PRAGMA application_id={FORMAT_ID}; PRAGMA user_version={FORMAT_VERSION}"
    ))
    .execute(&mut output)
    .await?;
    output.close().await
}

#[tauri::command]
pub async fn export_backup(app: AppHandle) -> Result<bool, String> {
    let pool = ride_pool(&app).await?;

    let destination = tauri::async_runtime::spawn_blocking(|| {
        rfd::FileDialog::new()
            .set_title("导出骑行备份")
            .set_file_name(BACKUP_NAME)
            .add_filter("RideWeave 备份", &["rideweave-backup"])
            .save_file()
    })
    .await
    .map_err(|e| e.to_string())?;

    let Some(destination) = destination else {
        return Ok(false);
    };

    let temporary = temporary_backup(&app)?;
    let snapshot = temporary.path().join(BACKUP_NAME);
    export_snapshot(&pool, &snapshot)
        .await
        .map_err(|e| format!("无法生成备份：{e}"))?;

    {
        let app_config = app.path().app_config_dir().map_err(|e| e.to_string())?;
        tauri::async_runtime::spawn_blocking(move || {
            if destination.extension().and_then(|ext| ext.to_str()) != Some("rideweave-backup") {
                return Err("请将文件名以 .rideweave-backup 结尾".into());
            }
            let parent = destination.parent().ok_or("备份位置无效")?;
            if parent.canonicalize().ok() == app_config.canonicalize().ok() {
                return Err("请选择应用数据目录以外的位置".into());
            }
            let write = || -> std::io::Result<()> {
                let mut output = tempfile::NamedTempFile::new_in(parent)?;
                std::io::copy(&mut File::open(snapshot)?, output.as_file_mut())?;
                output.as_file().sync_all()?;
                output.persist(&destination)?;
                Ok(())
            };
            write().map_err(|e| format!("无法保存备份：{e}"))?;
            Ok(true)
        })
        .await
        .map_err(|e| e.to_string())?
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn snapshot_preserves_backup_format_and_original_ride_fields() {
        tauri::async_runtime::block_on(async {
            let temp = tempfile::tempdir().unwrap();
            let options = SqliteConnectOptions::new()
                .filename(temp.path().join("rides.db"))
                .create_if_missing(true);
            let pool = SqlitePool::connect_with(options).await.unwrap();
            sqlx::query(CREATE_RIDES).execute(&pool).await.unwrap();
            sqlx::query("INSERT INTO rides VALUES ('a', '已改名称', NULL, 5.5, NULL, '[]', '<gpx/>', 'ride.gpx', '2025-10-01')")
                .execute(&pool)
                .await
                .unwrap();

            let snapshot = temp.path().join(BACKUP_NAME);
            export_snapshot(&pool, &snapshot).await.unwrap();
            let mut output = SqliteConnection::connect_with(
                &SqliteConnectOptions::new()
                    .filename(snapshot)
                    .read_only(true),
            )
            .await
            .unwrap();
            let format = sqlx::query_as::<_, (i32, i32)>(
                "SELECT application_id, user_version FROM pragma_application_id(), pragma_user_version()",
            )
            .fetch_one(&mut output)
            .await
            .unwrap();
            assert_eq!(format, (0x52575642, 1));
            let ride = sqlx::query_as::<_, (String, String, String, String)>(
                "SELECT id, name, raw_gpx, imported_at FROM rides",
            )
            .fetch_one(&mut output)
            .await
            .unwrap();
            assert_eq!(
                ride,
                (
                    "a".into(),
                    "已改名称".into(),
                    "<gpx/>".into(),
                    "2025-10-01".into()
                )
            );
        });
    }
}
