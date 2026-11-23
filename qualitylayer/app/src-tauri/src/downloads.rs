//! Viewer-local, OS-selected downloads. No filesystem capability is exposed to page JavaScript.

use std::collections::HashMap;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{webview::DownloadEvent, Runtime, Webview};

pub const INITIALIZATION_SCRIPT: &str =
    "Object.defineProperty(window,'__QUALITYLAYER_NATIVE_DOWNLOADS__',{value:true})";
const MAX_BYTES: u64 = 20 * 1024 * 1024;
const MAX_PENDING: usize = 8;
static NEXT: AtomicU64 = AtomicU64::new(0);
static PENDING: OnceLock<Mutex<HashMap<String, Option<Pending>>>> = OnceLock::new();

fn pending() -> &'static Mutex<HashMap<String, Option<Pending>>> {
    PENDING.get_or_init(|| Mutex::new(HashMap::new()))
}

fn basename(suggested: &Path) -> Option<String> {
    let raw = suggested.file_name()?.to_str()?;
    let clean: String = raw
        .chars()
        .take(180)
        .map(|ch| {
            if ch.is_control()
                || "/\\:*?\"<>|".contains(ch)
                || ('\u{202a}'..='\u{202e}').contains(&ch)
                || ('\u{2066}'..='\u{2069}').contains(&ch)
            {
                '_'
            } else {
                ch
            }
        })
        .collect();
    let clean = clean.trim_matches([' ', '.']);
    if clean.is_empty() {
        return None;
    }
    let upper = Path::new(clean).file_stem()?.to_str()?.to_ascii_uppercase();
    Some(format!(
        "{}{clean}",
        if is_windows_reserved(&upper) {
            "export-"
        } else {
            ""
        }
    ))
}

fn is_windows_reserved(upper: &str) -> bool {
    if matches!(upper, "CON" | "PRN" | "AUX" | "NUL") {
        return true;
    }
    let has_port_prefix = upper.starts_with("COM") || upper.starts_with("LPT");
    upper.len() == 4 && has_port_prefix && upper.as_bytes()[3].is_ascii_digit()
}

#[derive(Debug, PartialEq)]
struct TargetStamp {
    length: u64,
    modified: Option<SystemTime>,
    #[cfg(unix)]
    identity: (u64, u64),
}

fn target_stamp(path: &Path) -> io::Result<Option<TargetStamp>> {
    let info = match fs::symlink_metadata(path) {
        Ok(info) => info,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(error),
    };
    if !info.is_file() || info.is_symlink() {
        return Err(io::ErrorKind::InvalidInput.into());
    }
    Ok(Some(TargetStamp {
        length: info.len(),
        modified: info.modified().ok(),
        #[cfg(unix)]
        identity: {
            use std::os::unix::fs::MetadataExt;
            (info.dev(), info.ino())
        },
    }))
}

struct Pending {
    target: PathBuf,
    expected: Option<TargetStamp>,
    directory: PathBuf,
    file: PathBuf,
}

impl Pending {
    /// `target` comes only from the native Save dialog, including its overwrite confirmation.
    fn create(target: &Path) -> io::Result<Self> {
        if !target.is_absolute() {
            return Err(io::ErrorKind::InvalidInput.into());
        }
        let parent = target
            .parent()
            .ok_or(io::ErrorKind::InvalidInput)?
            .canonicalize()?;
        let name = target.file_name().ok_or(io::ErrorKind::InvalidInput)?;
        let target = parent.join(name);
        let expected = target_stamp(&target)?;
        for _ in 0..16 {
            let now = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos();
            let nonce = NEXT.fetch_add(1, Ordering::Relaxed);
            let directory = parent.join(format!(
                ".qualitylayer-export-{}-{now}-{nonce}",
                std::process::id()
            ));
            #[cfg(unix)]
            let mut builder = fs::DirBuilder::new();
            #[cfg(not(unix))]
            let builder = fs::DirBuilder::new();
            #[cfg(unix)]
            {
                use std::os::unix::fs::DirBuilderExt;
                builder.mode(0o700);
            }
            match builder.create(&directory) {
                Ok(()) => {
                    return Ok(Self {
                        file: directory.join("download"),
                        target,
                        expected,
                        directory,
                    })
                }
                Err(error) if error.kind() == io::ErrorKind::AlreadyExists => continue,
                Err(error) => return Err(error),
            }
        }
        Err(io::ErrorKind::AlreadyExists.into())
    }

    fn publish(&self) -> io::Result<()> {
        let info = fs::symlink_metadata(&self.file)?;
        if !info.is_file() || info.is_symlink() || info.len() == 0 || info.len() > MAX_BYTES {
            return Err(io::ErrorKind::InvalidData.into());
        }
        fs::File::open(&self.file)?.sync_all()?;
        if target_stamp(&self.target)? != self.expected {
            return Err(io::ErrorKind::AlreadyExists.into());
        }
        if self.expected.is_some() {
            // Detect changes since OS consent. Rename replaces this path atomically, never follows
            // a destination symlink; this is not a filesystem compare-and-swap operation.
            fs::rename(&self.file, &self.target)
        } else {
            // A concurrent creation after the check must never be overwritten.
            fs::hard_link(&self.file, &self.target)
        }
    }
}

impl Drop for Pending {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.directory);
    }
}

fn outcome<R: Runtime>(webview: &Webview<R>, url: &str, status: &str) {
    let detail = serde_json::json!({"url":url,"status":status});
    let _ = webview.eval(format!(
        "window.dispatchEvent(new CustomEvent('qualitylayer-download-result',{{detail:{detail}}}))"
    ));
}

pub fn handle<R: Runtime>(webview: Webview<R>, event: DownloadEvent<'_>) -> bool {
    match event {
        DownloadEvent::Requested { url, destination } => {
            if !crate::external::for_download(&url) {
                return false;
            }
            {
                let mut active = pending().lock().unwrap_or_else(|error| error.into_inner());
                if active.len() >= MAX_PENDING || active.contains_key(url.as_str()) {
                    outcome(&webview, url.as_str(), "failed");
                    return false;
                }
                // Reserve before entering the modal event loop, without holding the mutex.
                active.insert(url.to_string(), None);
            }
            let Some(name) = basename(destination) else {
                pending()
                    .lock()
                    .unwrap_or_else(|error| error.into_inner())
                    .remove(url.as_str());
                outcome(&webview, url.as_str(), "failed");
                return false;
            };
            let chosen = rfd::FileDialog::new()
                .set_parent(&webview.window())
                .set_title("Save export")
                .set_file_name(name)
                .save_file();
            let Some(target) = chosen else {
                pending()
                    .lock()
                    .unwrap_or_else(|error| error.into_inner())
                    .remove(url.as_str());
                outcome(&webview, url.as_str(), "cancelled");
                return false;
            };
            match Pending::create(&target) {
                Ok(entry) => {
                    *destination = entry.file.clone();
                    pending()
                        .lock()
                        .unwrap_or_else(|error| error.into_inner())
                        .insert(url.to_string(), Some(entry));
                    true
                }
                Err(_) => {
                    pending()
                        .lock()
                        .unwrap_or_else(|error| error.into_inner())
                        .remove(url.as_str());
                    outcome(&webview, url.as_str(), "failed");
                    false
                }
            }
        }
        DownloadEvent::Finished { url, success, .. } => {
            let entry = pending()
                .lock()
                .unwrap_or_else(|error| error.into_inner())
                .remove(url.as_str())
                .flatten();
            if let Some(entry) = entry {
                let status = if success && entry.publish().is_ok() {
                    "saved"
                } else {
                    "failed"
                };
                outcome(&webview, url.as_str(), status);
            }
            true
        }
        _ => false,
    }
}

pub fn cleanup() {
    pending()
        .lock()
        .unwrap_or_else(|error| error.into_inner())
        .clear();
}

#[cfg(test)]
mod tests {
    use super::*;
    fn folder() -> PathBuf {
        let nonce = NEXT.fetch_add(1, Ordering::Relaxed);
        let dir = std::env::temp_dir().join(format!(
            "ql-native-download-test-{}-{nonce}",
            std::process::id()
        ));
        fs::create_dir(&dir).unwrap();
        dir
    }
    #[test]
    fn filenames_remain_safe_suggestions() {
        assert_eq!(
            basename(Path::new("../../elsewhere/report.pdf")),
            Some("report.pdf".into())
        );
        assert_eq!(
            basename(Path::new("CON.zip")),
            Some("export-CON.zip".into())
        );
        assert_eq!(basename(Path::new("README")), Some("README".into()));
        assert!(basename(Path::new("...")).is_none());
    }
    #[test]
    fn selected_new_file_and_consented_overwrite_publish_and_clean_staging() {
        let dir = folder();
        let target = dir.join("Chosen report.pdf");
        for content in [b"%PDF-first".as_slice(), b"%PDF-replaced".as_slice()] {
            let entry = Pending::create(&target).unwrap();
            let stage = entry.directory.clone();
            fs::write(&entry.file, content).unwrap();
            entry.publish().unwrap();
            assert_eq!(fs::read(&target).unwrap(), content);
            drop(entry);
            assert!(!stage.exists());
        }
        fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn empty_oversized_unfinished_and_changed_targets_are_never_published() {
        let dir = folder();
        let target = dir.join("report.png");
        let entry = Pending::create(&target).unwrap();
        assert!(entry.publish().is_err());
        fs::write(&entry.file, []).unwrap();
        assert!(entry.publish().is_err());
        fs::File::create(&entry.file)
            .unwrap()
            .set_len(MAX_BYTES + 1)
            .unwrap();
        assert!(entry.publish().is_err());
        fs::write(&entry.file, b"new").unwrap();
        fs::write(&target, b"concurrent").unwrap();
        assert!(entry.publish().is_err());
        drop(entry);
        let overwrite = Pending::create(&target).unwrap();
        fs::write(&overwrite.file, b"new").unwrap();
        fs::write(&target, b"concurrent changed").unwrap();
        assert!(overwrite.publish().is_err());
        assert_eq!(fs::read(&target).unwrap(), b"concurrent changed");
        drop(overwrite);
        fs::remove_dir_all(dir).unwrap();
    }
    #[cfg(unix)]
    #[test]
    fn source_and_destination_symlinks_are_refused() {
        use std::os::unix::fs::symlink;
        let dir = folder();
        let source = dir.join("untouched.txt");
        fs::write(&source, b"private").unwrap();
        let target = dir.join("report.html");
        symlink(&source, &target).unwrap();
        assert!(Pending::create(&target).is_err());
        fs::remove_file(&target).unwrap();
        let entry = Pending::create(&target).unwrap();
        symlink(&source, &entry.file).unwrap();
        assert!(entry.publish().is_err());
        drop(entry);
        assert_eq!(fs::read(&source).unwrap(), b"private");
        fs::remove_dir_all(dir).unwrap();
    }
}
