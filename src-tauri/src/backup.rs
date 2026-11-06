#[cfg(any(test, target_os = "android"))]
use sqlx::Row;
use sqlx::{sqlite::SqliteConnectOptions, Connection, SqliteConnection, SqlitePool};
#[cfg(windows)]
use std::fs::File;
use std::path::Path;
use tauri::{AppHandle, Manager};
use tauri_plugin_sql::{DbInstances, DbPool};

pub const DATABASE: &str = "sqlite:rideweave.db";
pub const CREATE_RIDES: &str = "CREATE TABLE IF NOT EXISTS rides (id TEXT PRIMARY KEY, name TEXT NOT NULL, date TEXT, distance REAL NOT NULL, duration REAL, segments TEXT NOT NULL, raw_gpx TEXT NOT NULL, filename TEXT NOT NULL, imported_at TEXT NOT NULL);";
const FORMAT_ID: i32 = 0x52575642;
const FORMAT_VERSION: i32 = 1;
const BACKUP_NAME: &str = "RideWeave.rideweave-backup";
#[cfg(any(test, target_os = "android"))]
const RIDE_COLUMNS: &str = "id,name,date,distance,duration,segments,raw_gpx,filename,imported_at";

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
    #[cfg(windows)]
    let destination = tauri::async_runtime::spawn_blocking(|| {
        rfd::FileDialog::new()
            .set_title("导出骑行备份")
            .set_file_name(BACKUP_NAME)
            .add_filter("RideWeave 备份", &["rideweave-backup"])
            .save_file()
    })
    .await
    .map_err(|e| e.to_string())?;
    #[cfg(windows)]
    let Some(destination) = destination
    else {
        return Ok(false);
    };

    let temporary = temporary_backup(&app)?;
    let snapshot = temporary.path().join(BACKUP_NAME);
    export_snapshot(&pool, &snapshot)
        .await
        .map_err(|e| format!("无法生成备份：{e}"))?;

    #[cfg(windows)]
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
    #[cfg(target_os = "android")]
    {
        crate::android::copy_backup(&app, &snapshot, true).await
    }
    #[cfg(not(any(windows, target_os = "android")))]
    Ok(false)
}

#[cfg(any(test, target_os = "android"))]
#[derive(Debug, PartialEq, serde::Serialize)]
pub struct RestoreReport {
    pub added: u64,
    pub duplicates: u64,
}

#[cfg(any(test, target_os = "android"))]
async fn restore_snapshot(pool: &SqlitePool, snapshot: &Path) -> Result<RestoreReport, String> {
    use futures_util::TryStreamExt;
    let mut source = SqliteConnection::connect_with(
        &SqliteConnectOptions::new()
            .filename(snapshot)
            .read_only(true)
            .immutable(true)
            .pragma("trusted_schema", "OFF"),
    )
    .await
    .map_err(|_| "无法打开备份文件")?;
    let validation = sqlx::query(
        "SELECT application_id, user_version FROM pragma_application_id(), pragma_user_version()
         WHERE EXISTS (SELECT 1 FROM pragma_table_list('rides') WHERE schema='main' AND type='table')",
    ).fetch_optional(&mut source).await.map_err(|_| "备份格式无效")?;
    if validation.map(|row| (row.get::<i32, _>(0), row.get::<i32, _>(1)))
        != Some((FORMAT_ID, FORMAT_VERSION))
    {
        return Err("备份格式或版本不受支持".into());
    }
    if sqlx::query_scalar::<_, String>("PRAGMA quick_check(1)")
        .fetch_one(&mut source)
        .await
        .ok()
        .as_deref()
        != Some("ok")
    {
        return Err("备份文件损坏".into());
    }
    let select = format!("SELECT {RIDE_COLUMNS} FROM rides");
    let insert = format!(
        "INSERT INTO rides ({RIDE_COLUMNS}) VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING"
    );
    let mut rows = sqlx::query(&select).fetch(&mut source);
    let mut tx = pool
        .begin()
        .await
        .map_err(|e| format!("无法开始恢复：{e}"))?;
    let mut report = RestoreReport {
        added: 0,
        duplicates: 0,
    };
    let invalid_row = |_| "备份包含无法读取的骑行记录";
    while let Some(row) = rows.try_next().await.map_err(invalid_row)? {
        let id: String = row.try_get(0).map_err(invalid_row)?;
        let name: String = row.try_get(1).map_err(invalid_row)?;
        let date: Option<String> = row.try_get(2).map_err(invalid_row)?;
        let distance: f64 = row.try_get(3).map_err(invalid_row)?;
        let duration: Option<f64> = row.try_get(4).map_err(invalid_row)?;
        let segments: String = row.try_get(5).map_err(invalid_row)?;
        let raw: String = row.try_get(6).map_err(invalid_row)?;
        let filename: String = row.try_get(7).map_err(invalid_row)?;
        let imported_at: String = row.try_get(8).map_err(invalid_row)?;
        if id.is_empty()
            || !distance.is_finite()
            || duration.is_some_and(|value| !value.is_finite())
            || !valid_segments(&segments)
        {
            return Err("备份包含无效的骑行数据".into());
        }
        let result = sqlx::query(&insert)
            .bind(id)
            .bind(name)
            .bind(date)
            .bind(distance)
            .bind(duration)
            .bind(segments)
            .bind(raw)
            .bind(filename)
            .bind(imported_at)
            .execute(&mut *tx)
            .await
            .map_err(|e| format!("恢复失败：{e}"))?;
        if result.rows_affected() > 0 {
            report.added += 1;
        } else {
            report.duplicates += 1;
        }
    }
    tx.commit()
        .await
        .map_err(|e| format!("无法保存恢复结果：{e}"))?;
    Ok(report)
}

#[cfg(any(test, target_os = "android"))]
fn valid_segments(raw: &str) -> bool {
    let Ok(serde_json::Value::Array(segments)) = serde_json::from_str(raw) else {
        return false;
    };
    segments.iter().all(|segment| {
        segment.as_array().is_some_and(|points| {
            points.iter().all(|point| {
                point["lat"]
                    .as_f64()
                    .is_some_and(|lat| (-90.0..=90.0).contains(&lat))
                    && point["lon"]
                        .as_f64()
                        .is_some_and(|lon| (-180.0..=180.0).contains(&lon))
                    && (point["elevation"].is_null() || point["elevation"].is_number())
                    && (point["time"].is_null() || point["time"].is_string())
                    && (point["speed"].is_null() || point["speed"].is_number())
            })
        })
    })
}

#[cfg(target_os = "android")]
#[tauri::command]
pub async fn restore_backup(app: AppHandle) -> Result<Option<RestoreReport>, String> {
    let pool = ride_pool(&app).await?;
    let temporary = temporary_backup(&app)?;
    let snapshot = temporary.path().join(BACKUP_NAME);
    if !crate::android::copy_backup(&app, &snapshot, false).await? {
        return Ok(None);
    }
    restore_snapshot(&pool, &snapshot).await.map(Some)
}

#[cfg(test)]
mod tests {
    use super::*;

    async fn database(path: &Path) -> SqlitePool {
        let options = SqliteConnectOptions::new()
            .filename(path)
            .create_if_missing(true);
        let pool = SqlitePool::connect_with(options).await.unwrap();
        sqlx::query(CREATE_RIDES).execute(&pool).await.unwrap();
        pool
    }

    async fn seed(pool: &SqlitePool, id: &str, name: &str) {
        sqlx::query("INSERT INTO rides VALUES (?, ?, NULL, 5.5, NULL, ?, ?, ?, ?)")
            .bind(id)
            .bind(name)
            .bind(r#"[[{"lat":31.2,"lon":121.4,"elevation":null,"time":null}]]"#)
            .bind("<gpx>原始轨迹</gpx>")
            .bind("骑行.gpx")
            .bind("2025-10-01T12:00:00.000Z")
            .execute(pool)
            .await
            .unwrap();
    }

    #[test]
    fn snapshots_preserve_original_fields_and_merge_without_overwriting() {
        tauri::async_runtime::block_on(async {
            let temp = tempfile::tempdir().unwrap();
            let windows = database(&temp.path().join("windows.db")).await;
            let android = database(&temp.path().join("android.db")).await;
            let another_android = database(&temp.path().join("other.db")).await;
            let snapshot = temp.path().join("snapshot.rideweave-backup");
            let mobile_snapshot = temp.path().join("mobile.rideweave-backup");
            seed(&windows, "first", "已改名称").await;
            seed(&windows, "duplicate", "Windows 名称").await;
            seed(&android, "duplicate", "手机名称").await;
            export_snapshot(&windows, &snapshot).await.unwrap();
            assert_eq!(
                restore_snapshot(&android, &snapshot).await.unwrap(),
                RestoreReport {
                    added: 1,
                    duplicates: 1
                },
            );
            let rows = sqlx::query_as::<_, (String, String, String, String)>(
                "SELECT name, raw_gpx, filename, imported_at FROM rides ORDER BY id DESC",
            )
            .fetch_all(&android)
            .await
            .unwrap();
            assert_eq!(
                rows[0],
                (
                    "已改名称".into(),
                    "<gpx>原始轨迹</gpx>".into(),
                    "骑行.gpx".into(),
                    "2025-10-01T12:00:00.000Z".into(),
                )
            );
            assert_eq!(rows[1].0, "手机名称");
            assert_eq!(
                restore_snapshot(&android, &snapshot).await.unwrap(),
                RestoreReport {
                    added: 0,
                    duplicates: 2
                },
            );
            export_snapshot(&android, &mobile_snapshot).await.unwrap();
            assert_eq!(
                restore_snapshot(&another_android, &mobile_snapshot)
                    .await
                    .unwrap(),
                RestoreReport {
                    added: 2,
                    duplicates: 0
                },
            );
        });
    }

    #[test]
    fn invalid_backup_and_midway_insert_failure_leave_existing_data_intact() {
        tauri::async_runtime::block_on(async {
            let temp = tempfile::tempdir().unwrap();
            let source = database(&temp.path().join("source.db")).await;
            let dest = database(&temp.path().join("dest.db")).await;
            let snapshot = temp.path().join("snapshot.rideweave-backup");
            seed(&source, "a", "第一条").await;
            seed(&source, "b", "第二条").await;
            seed(&dest, "existing", "已有记录").await;
            export_snapshot(&source, &snapshot).await.unwrap();
            sqlx::query(
                "CREATE TRIGGER reject_b BEFORE INSERT ON rides WHEN NEW.id = 'b'
                BEGIN SELECT RAISE(ABORT, 'test failure'); END",
            )
            .execute(&dest)
            .await
            .unwrap();
            assert!(restore_snapshot(&dest, &snapshot).await.is_err());
            let corrupt = temp.path().join("broken.rideweave-backup");
            std::fs::write(&corrupt, b"bad database").unwrap();
            assert!(restore_snapshot(&dest, &corrupt).await.is_err());
            assert_eq!(
                sqlx::query_scalar::<_, String>("SELECT name FROM rides")
                    .fetch_all(&dest)
                    .await
                    .unwrap(),
                ["已有记录"],
            );
        });
    }
}
