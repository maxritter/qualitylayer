//! Viewer-local file downloads. WKWebView stages bytes, then an atomic new link publishes them.

use std::collections::HashMap;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{webview::DownloadEvent, Manager, Runtime, Webview};

const MAX_BYTES: u64 = 20 * 1024 * 1024;
const MAX_PENDING: usize = 8;
static NEXT: AtomicU64 = AtomicU64::new(0);
static PENDING: OnceLock<Mutex<HashMap<String, Pending>>> = OnceLock::new();

fn pending() -> &'static Mutex<HashMap<String, Pending>> {
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
    let stem = Path::new(clean).file_stem()?.to_str()?;
    let upper = stem.to_ascii_uppercase();
    let reserved = matches!(upper.as_str(), "CON" | "PRN" | "AUX" | "NUL")
        || (upper.len() == 4
            && (upper.starts_with("COM") || upper.starts_with("LPT"))
            && upper.as_bytes()[3].is_ascii_digit());
    Some(format!("{}{clean}", if reserved { "export-" } else { "" }))
}

struct Pending {
    downloads: PathBuf,
    directory: PathBuf,
    file: PathBuf,
    name: String,
}

impl Pending {
    fn create(downloads: &Path, suggested: &Path) -> io::Result<Self> {
        let name = basename(suggested).ok_or(io::ErrorKind::InvalidInput)?;
        if !downloads.is_absolute() {
            return Err(io::ErrorKind::InvalidInput.into());
        }
        fs::create_dir_all(downloads)?;
        let downloads = downloads.canonicalize()?;
        for _ in 0..16 {
            let now = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos();
            let nonce = NEXT.fetch_add(1, Ordering::Relaxed);
            let directory = downloads.join(format!(
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
                        file: directory.join(&name),
                        downloads,
                        directory,
                        name,
                    })
                }
                Err(error) if error.kind() == io::ErrorKind::AlreadyExists => continue,
                Err(error) => return Err(error),
            }
        }
        Err(io::ErrorKind::AlreadyExists.into())
    }

    fn publish(&self) -> io::Result<PathBuf> {
        let info = fs::symlink_metadata(&self.file)?;
        if !info.is_file() || info.is_symlink() || info.len() == 0 || info.len() > MAX_BYTES {
            return Err(io::ErrorKind::InvalidData.into());
        }
        let path = Path::new(&self.name);
        let stem = path
            .file_stem()
            .ok_or(io::ErrorKind::InvalidInput)?
            .to_string_lossy();
        let extension = path
            .extension()
            .map(|value| format!(".{}", value.to_string_lossy()))
            .unwrap_or_default();
        for index in 0..1000 {
            let name = if index == 0 {
                self.name.clone()
            } else {
                format!("{stem} ({index}){extension}")
            };
            let target = self.downloads.join(name);
            // Unlike exists()+rename(), hard_link cannot overwrite a file created concurrently.
            match fs::hard_link(&self.file, &target) {
                Ok(()) => return Ok(target),
                Err(error) if error.kind() == io::ErrorKind::AlreadyExists => continue,
                Err(error) => return Err(error),
            }
        }
        Err(io::ErrorKind::AlreadyExists.into())
    }
}

impl Drop for Pending {
    fn drop(&mut self) {
        // Only this request's exclusively created private staging directory; never a prefix scan.
        let _ = fs::remove_dir_all(&self.directory);
    }
}

fn failed<R: Runtime>(webview: &Webview<R>) {
    let _ = webview.eval("window.dispatchEvent(new CustomEvent('qualitylayer-download-failed',{detail:{message:'The download could not be saved to Downloads. Check folder permissions and try again.'}}))");
}

pub fn handle<R: Runtime>(webview: Webview<R>, event: DownloadEvent<'_>) -> bool {
    match event {
        DownloadEvent::Requested { url, destination } => {
            if !crate::external::for_download(&url) {
                return false;
            }
            let mut active = pending().lock().unwrap_or_else(|error| error.into_inner());
            if active.len() >= MAX_PENDING || active.contains_key(url.as_str()) {
                failed(&webview);
                return false;
            }
            let entry = webview
                .app_handle()
                .path()
                .download_dir()
                .ok()
                .and_then(|folder| Pending::create(&folder, destination).ok());
            let Some(entry) = entry else {
                failed(&webview);
                return false;
            };
            *destination = entry.file.clone();
            active.insert(url.to_string(), entry);
            true
        }
        DownloadEvent::Finished { url, success, .. } => {
            let entry = pending()
                .lock()
                .unwrap_or_else(|error| error.into_inner())
                .remove(url.as_str());
            if let Some(entry) = entry {
                if !success || entry.publish().is_err() {
                    failed(&webview);
                }
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
    fn filenames_are_safe_basenames_without_restricting_existing_attachment_types() {
        assert_eq!(
            basename(Path::new("../../elsewhere/report.pdf")),
            Some("report.pdf".into())
        );
        assert_eq!(
            basename(Path::new("CON.zip")),
            Some("export-CON.zip".into())
        );
        assert_eq!(basename(Path::new("README")), Some("README".into()));
        assert_eq!(
            basename(Path::new("records.json")),
            Some("records.json".into())
        );
        assert_eq!(
            basename(Path::new("evil\\path.PNG")),
            Some(
                if cfg!(windows) {
                    "path.PNG"
                } else {
                    "evil_path.PNG"
                }
                .into()
            )
        );
        assert!(basename(Path::new("...")).is_none());
    }

    #[test]
    fn completed_files_publish_without_overwrite_and_owned_staging_is_removed() {
        let dir = folder();
        fs::write(dir.join("report.pdf"), b"existing").unwrap();
        let entry = Pending::create(&dir, Path::new("report.pdf")).unwrap();
        let stage = entry.directory.clone();
        assert!(!entry.file.exists());
        fs::write(&entry.file, b"%PDF-fixture").unwrap();
        let saved = entry.publish().unwrap();
        assert_eq!(saved, dir.join("report (1).pdf"));
        assert_eq!(fs::read(dir.join("report.pdf")).unwrap(), b"existing");
        assert_eq!(fs::read(&saved).unwrap(), b"%PDF-fixture");
        drop(entry);
        assert!(!stage.exists());
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn unfinished_empty_and_oversized_files_never_publish_and_cleanup_is_exact() {
        let dir = folder();
        let entry = Pending::create(&dir, Path::new("report.png")).unwrap();
        let stage = entry.directory.clone();
        assert!(entry.publish().is_err());
        fs::write(&entry.file, []).unwrap();
        assert!(entry.publish().is_err());
        fs::File::create(&entry.file)
            .unwrap()
            .set_len(MAX_BYTES + 1)
            .unwrap();
        assert!(entry.publish().is_err());
        drop(entry);
        assert!(!stage.exists());
        assert!(!dir.join("report.png").exists());
        fs::remove_dir_all(dir).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn symlinks_cannot_publish_another_file() {
        use std::os::unix::fs::symlink;
        let dir = folder();
        let entry = Pending::create(&dir, Path::new("report.html")).unwrap();
        let source = dir.join("untouched.txt");
        fs::write(&source, b"private").unwrap();
        symlink(&source, &entry.file).unwrap();
        assert!(entry.publish().is_err());
        drop(entry);
        assert_eq!(fs::read(&source).unwrap(), b"private");
        fs::remove_dir_all(dir).unwrap();
    }
}
