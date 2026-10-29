use std::{
    collections::HashSet,
    fs::File,
    io::Read,
    path::{Path, PathBuf},
    sync::Mutex,
};

const MAX_BYTES: u64 = 50 * 1024 * 1024;

#[derive(Default)]
pub struct DroppedGpxFiles(Mutex<HashSet<PathBuf>>);

fn is_gpx(path: &Path) -> bool {
    path.extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| extension.eq_ignore_ascii_case("gpx"))
}

impl DroppedGpxFiles {
    // Only native drop events grant access. No general filesystem API is exposed.
    pub fn allow_drop(&self, paths: &[PathBuf]) {
        if let Ok(mut allowed) = self.0.lock() {
            allowed.extend(paths.iter().filter(|path| is_gpx(path)).cloned());
        }
    }

    pub fn claim(&self, path: &Path) -> Result<(), String> {
        let mut allowed = self
            .0
            .lock()
            .map_err(|_| "文件读取状态不可用，请重启应用")?;
        if !allowed.remove(path) {
            return Err("仅能读取本次拖入窗口的 GPX 文件".into());
        }
        Ok(())
    }
}

pub fn read_gpx(path: &Path) -> Result<String, String> {
    if !is_gpx(path) {
        return Err("仅支持 GPX 文件".into());
    }
    let file = File::open(path).map_err(|_| "无法打开文件，请检查是否已移动或无读取权限")?;
    let metadata = file.metadata().map_err(|_| "无法读取文件信息")?;
    if !metadata.is_file() {
        return Err("请拖入 GPX 文件，不支持文件夹".into());
    }
    if metadata.len() > MAX_BYTES {
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
        let state = DroppedGpxFiles::default();
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
        let state = DroppedGpxFiles::default();
        state.allow_drop(&[other.clone()]);
        assert!(state.claim(&other).is_err());
        assert!(read_gpx(&other).is_err());
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
        let state = DroppedGpxFiles::default();
        let first = PathBuf::from("first.gpx");
        let second = PathBuf::from("second.gpx");
        state.allow_drop(&[first.clone()]);
        state.allow_drop(&[second.clone()]);
        state.claim(&first).unwrap();
        state.claim(&second).unwrap();
    }
}
