use std::{
    collections::HashSet,
    fs::File,
    io::{Read, Seek, SeekFrom},
    path::{Path, PathBuf},
    sync::Mutex,
};

const MAX_BYTES: u64 = 50 * 1024 * 1024;

#[derive(Default)]
pub struct DroppedImportFiles(Mutex<HashSet<PathBuf>>);

pub fn has_extension(path: &Path, expected: &str) -> bool {
    path.extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| extension.eq_ignore_ascii_case(expected))
}

impl DroppedImportFiles {
    // Only native drop events grant access. No general filesystem API is exposed.
    pub fn allow_drop(&self, paths: &[PathBuf]) {
        if let Ok(mut allowed) = self.0.lock() {
            allowed.extend(
                paths
                    .iter()
                    .filter(|path| has_extension(path, "gpx") || has_extension(path, "zip"))
                    .cloned(),
            );
        }
    }

    pub fn claim(&self, path: &Path) -> Result<(), String> {
        let mut allowed = self
            .0
            .lock()
            .map_err(|_| "文件读取状态不可用，请重启应用")?;
        if !allowed.remove(path) {
            return Err("仅能读取拖入窗口的 GPX 或 ZIP 文件".into());
        }
        Ok(())
    }
}

pub fn read_gpx(path: &Path) -> Result<String, String> {
    let (file, size) = open_file(path)?;
    if size > MAX_BYTES {
        return Err("文件超过 50 MB 限制".into());
    }
    // Bound the read as well, in case another program grows the file after metadata.
    let mut bytes = Vec::new();
    file.take(MAX_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| "读取文件失败，请重试")?;
    if bytes.len() as u64 > MAX_BYTES {
        return Err("文件超过 50 MB 限制".into());
    }
    let text = String::from_utf8(bytes).map_err(|_| "GPX 文件不是有效的 UTF-8 文本")?;
    Ok(text.strip_prefix('\u{feff}').unwrap_or(&text).to_owned())
}

fn open_file(path: &Path) -> Result<(File, u64), String> {
    let file = File::open(path).map_err(|_| "无法打开文件，请检查是否已移动或无读取权限")?;
    let metadata = file.metadata().map_err(|_| "无法读取文件信息")?;
    if !metadata.is_file() {
        return Err("请拖入文件，不支持文件夹".into());
    }
    Ok((file, metadata.len()))
}

#[derive(Default)]
pub struct DroppedZip(Mutex<Option<(File, u64)>>);

impl DroppedZip {
    pub fn open(&self, path: &Path) -> Result<u64, String> {
        let (file, size) = open_file(path)?;
        *self.0.lock().map_err(|_| "ZIP 读取状态不可用")? = Some((file, size));
        Ok(size)
    }

    pub fn read(&self, offset: u64, length: usize) -> Result<Vec<u8>, String> {
        let mut active = self.0.lock().map_err(|_| "ZIP 读取状态不可用")?;
        let (file, size) = active.as_mut().ok_or("请先打开拖入的 ZIP 文件")?;
        if length > 1024 * 1024 || offset > *size || length as u64 > *size - offset {
            return Err("ZIP 读取范围无效".into());
        }
        let mut bytes = vec![0; length];
        file.seek(SeekFrom::Start(offset))
            .and_then(|_| file.read_exact(&mut bytes))
            .map_err(|_| "读取 ZIP 失败，请检查文件是否已更改或尚未下载")?;
        Ok(bytes)
    }

    pub fn close(&self) {
        if let Ok(mut active) = self.0.lock() {
            *active = None;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        fs,
        sync::atomic::{AtomicUsize, Ordering},
    };

    struct TestDirectory(PathBuf);
    impl TestDirectory {
        fn new() -> Self {
            static NEXT: AtomicUsize = AtomicUsize::new(0);
            let path = std::env::temp_dir().join(format!(
                "rideweave-drop-test-{}-{}",
                std::process::id(),
                NEXT.fetch_add(1, Ordering::Relaxed)
            ));
            fs::create_dir(&path).unwrap();
            Self(path)
        }
        fn file(&self, name: &str, content: &[u8]) -> PathBuf {
            let path = self.0.join(name);
            fs::write(&path, content).unwrap();
            path
        }
    }
    impl Drop for TestDirectory {
        fn drop(&mut self) {
            for entry in fs::read_dir(&self.0).unwrap() {
                let path = entry.unwrap().path();
                if path.is_dir() {
                    fs::remove_dir(path).unwrap();
                } else {
                    fs::remove_file(path).unwrap();
                }
            }
            fs::remove_dir(&self.0).unwrap();
        }
    }

    #[test]
    fn requires_a_native_drop_and_consumes_each_grant_once() {
        let directory = TestDirectory::new();
        let path = directory.file("测试 路线.GPX", b"\xef\xbb\xbf<gpx/>");
        let state = DroppedImportFiles::default();
        assert!(state.claim(&path).is_err());
        state.allow_drop(&[path.clone(), path.clone()]);
        state.claim(&path).unwrap();
        assert_eq!(read_gpx(&path).unwrap(), "<gpx/>");
        assert!(state.claim(&path).is_err());
        assert_eq!(fs::read(&path).unwrap(), b"\xef\xbb\xbf<gpx/>");
    }

    #[test]
    fn rejects_non_gpx_folders_missing_and_invalid_text() {
        let directory = TestDirectory::new();
        let other = directory.file("other.txt", b"<gpx/>");
        let bad = directory.file("invalid.gpx", &[0xff, 0xfe]);
        let folder = directory.0.join("folder.gpx");
        fs::create_dir(&folder).unwrap();
        let state = DroppedImportFiles::default();
        state.allow_drop(&[other.clone()]);
        assert!(state.claim(&other).is_err());
        assert!(read_gpx(&bad).unwrap_err().contains("UTF-8"));
        assert!(read_gpx(&folder).is_err());
        assert!(read_gpx(&directory.0.join("missing.gpx")).is_err());
    }

    #[test]
    fn rejects_oversized_files_before_loading_their_contents() {
        let directory = TestDirectory::new();
        let path = directory.file("large.gpx", b"");
        File::options()
            .write(true)
            .open(&path)
            .unwrap()
            .set_len(MAX_BYTES + 1)
            .unwrap();
        assert!(read_gpx(&path).unwrap_err().contains("50 MB"));
        assert_eq!(fs::metadata(&path).unwrap().len(), MAX_BYTES + 1);
    }

    #[test]
    fn keeps_existing_batch_grants_when_more_files_are_dropped() {
        let state = DroppedImportFiles::default();
        let first = PathBuf::from("first.gpx");
        let second = PathBuf::from("second.gpx");
        state.allow_drop(&[first.clone()]);
        state.allow_drop(&[second.clone()]);
        state.claim(&first).unwrap();
        state.claim(&second).unwrap();
    }

    #[test]
    fn accepts_dropped_zip_and_bounds_reads_to_the_open_archive() {
        let directory = TestDirectory::new();
        let path = directory.file("导出.ZIP", b"0123456789");
        let state = DroppedImportFiles::default();
        let zip = DroppedZip::default();
        assert!(zip.read(0, 1).is_err());
        assert!(state.claim(&path).is_err());
        state.allow_drop(std::slice::from_ref(&path));
        state.claim(&path).unwrap();
        assert!(state.claim(&path).is_err());
        assert_eq!(zip.open(&path).unwrap(), 10);
        assert_eq!(zip.read(6, 3).unwrap(), b"678");
        assert_eq!(zip.read(0, 2).unwrap(), b"01");
        assert!(zip.read(8, 3).is_err());
        zip.close();
        assert!(zip.read(0, 1).is_err());
    }
}
