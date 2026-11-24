//! Updates: the App owns them in an App install, so the App and its CLI never disagree. Every hour
//! the App looks for a newer build, downloads it in the background and verifies its signature, and
//! says so in `update.json`; the page offers it, and replaces the App only when the person asks.
//! Running agent commands (including long-lived `memory mcp` and `peers shim` helpers) keep their
//! old copy of the CLI until they end: Unix unlinks in place, and Windows moves existing sidecars
//! aside in `NSIS_HOOK_PREINSTALL` before writing the new ones. While the App is replaced,
//! `update.lock` keeps new agent commands back (the launcher reads it). The sequence and the files
//! it talks through are in `update_flow.rs`; this file is the updater under it.

use crate::cli;
use crate::update_flow::{
    check_due, now_ms, read_state, take_requests, write_state, Backend, Checked, Engine, Failure,
    Found, Installed, Phase, State,
};
use qualitylayer_launcher::{quality_layer_home, say_err, update_lock};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
#[cfg(test)]
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Manager, Url};
use tauri_plugin_updater::UpdaterExt;

/// How often a waiting update looks again.
const POLL: Duration = Duration::from_secs(if cfg!(feature = "test-updater") {
    1
} else {
    30
});

/// How often the page's request files are looked for.
const WATCH_TICK: Duration = Duration::from_millis(if cfg!(feature = "test-updater") {
    200
} else {
    1000
});

/// How long `update.json` says that this start updated the App, for the page's one toast.
const UPDATED_NOTE_FOR: Duration = Duration::from_secs(2 * 60);

/// Backoff after failed automatic checks (e.g. cold boot before Wi-Fi connects): retries quickly at
/// first, then settles to hourly.
const AUTO_RETRY_BACKOFF: [Duration; 4] = [
    Duration::from_secs(2 * 60),
    Duration::from_secs(5 * 60),
    Duration::from_secs(15 * 60),
    Duration::from_secs(60 * 60),
];

/// Windows replaces the App through its NSIS installer (stopping the local server and handing over
/// `QUALITYLAYER_HOME`), and moves existing CLI/launcher binaries aside before writing the new ones,
/// so no platform waits for running agent commands.
const WINDOWS_INSTALLER: bool = cfg!(windows);
const WAITS_FOR_AGENTS: bool = false;

pub fn auto_retry_delay(failures: u32) -> Duration {
    let index = usize::try_from(failures.saturating_sub(1)).unwrap_or(AUTO_RETRY_BACKOFF.len() - 1);
    AUTO_RETRY_BACKOFF
        .get(index)
        .copied()
        .unwrap_or(AUTO_RETRY_BACKOFF[AUTO_RETRY_BACKOFF.len() - 1])
}

fn updater(app: &AppHandle) -> Result<tauri_plugin_updater::Updater, String> {
    let (endpoint, pubkey) = test_overrides(cfg!(feature = "test-updater"), |name| {
        std::env::var(name).ok()
    });
    let endpoint = endpoint.or_else(|| {
        let home = quality_layer_home()?;
        let installed = app.package_info().version.to_string();
        channel_endpoint(chosen_channel(&home).as_deref(), &installed).map(str::to_owned)
    });
    let mut builder = app.updater_builder();
    if let Some(endpoint) = endpoint {
        let url = Url::parse(&endpoint).map_err(|e| format!("bad update address: {e}"))?;
        builder = builder
            .endpoints(vec![url])
            .map_err(|e| format!("bad update address: {e}"))?;
    }
    if let Some(pubkey) = pubkey {
        builder = builder.pubkey(pubkey);
    }
    builder
        .build()
        .map_err(|e| format!("cannot check for updates: {e}"))
}

/// The code the page shows for an updater error: a signature that does not check, a server or
/// connection that failed, or `otherwise` for the step the error came from.
fn code_of(error: &tauri_plugin_updater::Error, otherwise: &'static str) -> &'static str {
    use tauri_plugin_updater::Error;
    match error {
        Error::Minisign(_)
        | Error::Base64(_)
        | Error::SignatureUtf8(_)
        | Error::SignedVersionMismatch { .. }
        | Error::MissingSignedVersion => "signature",
        Error::Reqwest(_) | Error::Network(_) | Error::ReleaseNotFound => "network",
        _ => otherwise,
    }
}

/// The updater of Tauri under the sequence: the checks, the verified download and the replacing of
/// the App.
pub struct TauriBackend {
    app: AppHandle,
    /// What the new App starts with: nothing for an update the page asked for, the arguments of an
    /// update the command line asked for.
    relaunch: Vec<String>,
    update: Option<tauri_plugin_updater::Update>,
}

impl Backend for TauriBackend {
    type Payload = Vec<u8>;

    fn check(&mut self) -> Result<Option<Found>, Failure> {
        let updater = updater(&self.app).map_err(|message| Failure {
            code: "network",
            message,
        })?;
        let checked = tauri::async_runtime::block_on(updater.check()).map_err(|error| Failure {
            code: code_of(&error, "network"),
            message: format!("cannot check for updates: {error}"),
        })?;
        self.update = checked.clone();
        Ok(checked.map(|update| Found {
            version: update.version,
            notes: update.body.filter(|notes| !notes.trim().is_empty()),
        }))
    }

    fn download(&mut self, _found: &Found) -> Result<Vec<u8>, Failure> {
        let update = self.update.as_ref().ok_or(Failure {
            code: "download",
            message: "there is no update to download".to_string(),
        })?;
        tauri::async_runtime::block_on(update.download(|_, _| {}, || {})).map_err(|error| Failure {
            code: code_of(&error, "download"),
            message: format!(
                "the update could not be downloaded and verified, nothing changed: {error}"
            ),
        })
    }

    fn running(&self) -> usize {
        0
    }

    fn install(&mut self, payload: &Vec<u8>, lock: &Path) -> Result<(), Failure> {
        let update = self.update.as_ref().ok_or(Failure {
            code: "install",
            message: "there is no update to install".to_string(),
        })?;
        install(update, payload, lock, &self.relaunch).map_err(|message| Failure {
            // Installed, but the new App could not be started: something did change.
            code: if message.starts_with("the update was installed") {
                "restart"
            } else {
                "install"
            },
            message,
        })
    }
}

/// What the App keeps for updates while it runs: the sequence, which one thing at a time uses, and
/// the person's cancel of a wait, which has to reach a sequence that is busy waiting.
pub struct Runtime {
    engine: Mutex<Engine<TauriBackend>>,
    cancel: AtomicBool,
    installing: AtomicBool,
    /// When the last check went through (ms); 0 before the first. What the automatic timer reads without
    /// waiting for a check that is running.
    checked_at: AtomicU64,
    /// Consecutive failed automatic checks since the last success, for progressive retry backoff.
    auto_failures: AtomicU32,
}

struct FlagGuard<'a>(&'a AtomicBool);
impl Drop for FlagGuard<'_> {
    fn drop(&mut self) {
        self.0.store(false, Ordering::SeqCst);
    }
}

/// Get ready: the sequence over this App's updater, and the files it talks through. No-op where the
/// App has no command line next to it (a build run from its folder): there is nothing to update.
pub fn setup(app: &AppHandle, relaunch: Vec<String>) -> Result<(), String> {
    let home = quality_layer_home().ok_or("no home directory for QualityLayer")?;
    let _cli = cli::bundled_cli()?;
    let version = app.package_info().version.to_string();
    let state = read_state(&home).unwrap_or_else(|| State::idle(&version));
    let checked_at = state.checked_at.unwrap_or(0);
    let engine = Engine::new(
        TauriBackend {
            app: app.clone(),
            relaunch,
            update: None,
        },
        crate::update_flow::EngineConfig {
            home,
            state,
            waits_for_agents: WAITS_FOR_AGENTS,
            poll: POLL,
            now: now_ms,
        },
    );
    app.manage(Runtime {
        engine: Mutex::new(engine),
        cancel: AtomicBool::new(false),
        installing: AtomicBool::new(false),
        checked_at: AtomicU64::new(checked_at),
        auto_failures: AtomicU32::new(0),
    });
    Ok(())
}

/// Look for an update and download it. When `by_person` is true (explicit "Check now"), waits for
/// any in-flight background check instead of dropping the request silently; skips only if an
/// install is already running.
pub fn check(app: &AppHandle, by_person: bool) -> bool {
    let Some(runtime) = app.try_state::<Runtime>() else {
        return false;
    };
    if runtime.installing.load(Ordering::SeqCst) {
        return false;
    }
    let mut engine = if by_person {
        runtime
            .engine
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    } else {
        let Ok(guard) = runtime.engine.try_lock() else {
            return false;
        };
        guard
    };
    let checked = engine.check(by_person);
    runtime
        .checked_at
        .store(engine.checked_at().unwrap_or(0), Ordering::SeqCst);
    match checked {
        Checked::UpToDate | Checked::Ready(_) => {
            runtime.auto_failures.store(0, Ordering::SeqCst);
        }
        Checked::Failed if !by_person => {
            runtime.auto_failures.fetch_add(1, Ordering::SeqCst);
        }
        Checked::Failed => {}
    }
    true
}

/// Install the update, as the person asked: the one that was downloaded, or one found now. Runs off
/// the main thread and returns once the new App is starting (true: this App ends), the wait was
/// cancelled, or it failed. Duplicate clicks while an install is already running coalesce cleanly.
pub fn install_now(app: &AppHandle) -> Result<bool, String> {
    let Some(runtime) = app.try_state::<Runtime>() else {
        return Err("this App has no updater".to_string());
    };
    if runtime
        .installing
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .is_err()
    {
        return Ok(false);
    }
    let _guard = FlagGuard(&runtime.installing);
    let mut engine = runtime
        .engine
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let outcome = engine.install(&runtime.cancel);
    runtime
        .checked_at
        .store(engine.checked_at().unwrap_or(0), Ordering::SeqCst);
    match outcome {
        Installed::Replaced(_) => Ok(true),
        Installed::UpToDate => {
            say_err!("QualityLayer is up to date.");
            Ok(false)
        }
        Installed::Cancelled => Ok(false),
        Installed::Failed => Err("the update did not finish".to_string()),
    }
}

fn handle_watch_tick(
    app: &AppHandle,
    home: &Path,
    started: Instant,
    told: &mut bool,
    last_try: &mut Option<Instant>,
) {
    let requests = take_requests(home, now_ms());
    let Some(runtime) = app.try_state::<Runtime>() else {
        // No updater here: a request is answered, not left for ever.
        if requests.install || requests.check {
            let version = app.package_info().version.to_string();
            let state = State::updates_off(read_state(home).as_ref(), &version);
            let _ = write_state(home, &state);
        }
        return;
    };
    // A start that updated the App has said so to the page by now.
    if !*told && started.elapsed() >= UPDATED_NOTE_FOR {
        if let Ok(mut engine) = runtime.engine.try_lock() {
            engine.done_telling();
            *told = true;
        }
    }
    // A cancel is for a wait that is going on, and for nothing else.
    if requests.cancel && read_state(home).is_some_and(|s| s.phase == Phase::Waiting) {
        runtime.cancel.store(true, Ordering::SeqCst);
    }
    if requests.install {
        crate::install_update(app);
    } else if requests.check {
        crate::check_for_updates(app, false);
    } else {
        maybe_schedule_auto_check(app, &runtime, last_try);
    }
}

fn maybe_schedule_auto_check(app: &AppHandle, runtime: &Runtime, last_try: &mut Option<Instant>) {
    let checked = runtime.checked_at.load(Ordering::SeqCst);
    let due = check_due((checked != 0).then_some(checked), now_ms());
    let retry_after = auto_retry_delay(runtime.auto_failures.load(Ordering::SeqCst));
    if due && last_try.is_none_or(|at| at.elapsed() >= retry_after) {
        *last_try = Some(Instant::now());
        let handle = app.clone();
        std::thread::spawn(move || {
            check(&handle, false);
        });
    }
}

/// What the page asks for through its request files, and the automatic check. Looks every second, so
/// a click on "Restart and update" starts at once; the work itself runs on threads of its own.
pub fn watch(app: AppHandle) {
    let Some(home) = quality_layer_home() else {
        return;
    };
    std::thread::spawn(move || {
        let started = Instant::now();
        let mut told = false;
        let mut last_try: Option<Instant> = None;
        loop {
            std::thread::sleep(WATCH_TICK);
            handle_watch_tick(&app, &home, started, &mut told, &mut last_try);
        }
    });
}

fn install(
    update: &tauri_plugin_updater::Update,
    bytes: &[u8],
    lock: &Path,
    relaunch: &[String],
) -> Result<(), String> {
    // The server may go for the install: the watch over it (`liveness.rs`) must not start it again.
    crate::liveness::set_updating(true);
    // Windows stops the old server before the NSIS installer runs, hands over QUALITYLAYER_HOME,
    // and marks `update.lock` as a bounded handover so the launcher keeps holding new CLI calls
    // back after `tauri_plugin_updater` exits this process to run NSIS.
    if WINDOWS_INSTALLER {
        let _ = cli::stop();
        leave_home_for_installer();
        let _ = fs::write(lock, update_lock::HANDOVER_MARKER);
    }
    let result = finish_install(
        update.install(bytes).map_err(|error| error.to_string()),
        lock,
        || relaunch_app(relaunch),
    );
    if result.is_err() && WINDOWS_INSTALLER {
        // A server stopped for the install comes back when the update did not go through.
        forget_home_for_installer();
        let _ = cli::ensure();
    }
    result
}

/// What follows the installer: the new App is started and takes the lock over. The watch over the
/// server stays held only while that hand-over is under way; every other way out (the install
/// failed, or it went through and the new App could not be started) lets the watch look again, or
/// the App would never start its server again.
fn finish_install(
    installed: Result<(), String>,
    lock: &Path,
    relaunch: impl FnOnce() -> Result<u32, String>,
) -> Result<(), String> {
    let outcome = match installed {
        Ok(()) => relaunch().map_err(|error| format!("the update was installed, but {error}")),
        Err(error) => Err(format!(
            "the update could not be installed, nothing changed: {error}"
        )),
    };
    match outcome {
        Ok(child) => {
            // The new App takes the lock over, and removes it once it has refreshed the install.
            let _ = fs::write(lock, child.to_string());
            Ok(())
        }
        Err(message) => {
            let _ = fs::remove_file(lock);
            crate::liveness::set_updating(false);
            Err(message)
        }
    }
}

/// Start the App that was just installed; it refreshes the install when it starts. It waits for this
/// process to end first (`QUALITYLAYER_AFTER_PID`), so the one-App-per-home lock is free for it.
fn relaunch_app(args: &[String]) -> Result<u32, String> {
    // An AppImage runs from a mount that goes away with it: the program to start again is the file
    // the person started, which the update has just replaced.
    let program = match std::env::var_os("APPIMAGE") {
        Some(appimage) => PathBuf::from(appimage),
        None => std::env::current_exe().map_err(|e| format!("cannot find the App: {e}"))?,
    };
    Command::new(program)
        .args(args)
        .env("QUALITYLAYER_AFTER_PID", std::process::id().to_string())
        .spawn()
        .map(|child| child.id())
        .map_err(|e| format!("cannot start the new App: {e}"))
}

/// The App's own place for `install --app`: the .app bundle on macOS, else the folder that holds its
/// CLI (beside the program, or `usr/share/qualitylayer` in an AppImage).
fn bundle_path() -> Result<PathBuf, String> {
    let program = std::env::current_exe().map_err(|e| format!("cannot find the App: {e}"))?;
    if cfg!(target_os = "macos") {
        return program
            .ancestors()
            .nth(3)
            .map(Path::to_path_buf)
            .ok_or_else(|| "cannot find the App's folder".to_string());
    }
    cli::bundled_cli()?
        .parent()
        .map(Path::to_path_buf)
        .ok_or_else(|| "cannot find the App's folder".to_string())
}

/// `restarted_by_installer` for this start, read from the install's pointer.
pub fn is_restart_by_installer(app: &AppHandle) -> bool {
    let Some(home) = quality_layer_home() else {
        return false;
    };
    let version = app.package_info().version.to_string();
    restarted_by_installer(read_pointer(&home).as_ref(), &version, cfg!(windows))
}

#[path = "update_handover.rs"]
mod handover;

pub use handover::{
    adopt_home_of_installer, cleanup_retired_binaries, lock_is_ours_to_remove, needs_refresh,
    rename_with_retry, restarted_by_installer, take_lock, updated_to,
};
use handover::{
    channel_endpoint, chosen_channel, forget_home_for_installer, leave_home_for_installer,
    read_pointer, test_overrides,
};
#[cfg(test)]
use handover::{leave_home, needs_refresh_for, take_home, Pointer, BETA_FEED, HANDOVER_FILE};

/// What a start does about the install: when this App is a newer or moved copy of the one the
/// install points at, its CLI refreshes skills, hooks and the mod. Then the update lock this process
/// or an ended updater held is removed, and `update.json` starts over for this version. Returns the
/// version this start updated to, for the page to say so once: no dialog tells it.
pub fn after_start(app: &AppHandle) -> Option<String> {
    let home = quality_layer_home()?;
    let version = app.package_info().version.to_string();
    let mut updated = None;
    if let Ok(cli_path) = cli::bundled_cli() {
        if let Some(dir) = cli_path.parent() {
            cleanup_retired_binaries(dir);
        }
        let pointer = read_pointer(&home);
        if needs_refresh(pointer.as_ref(), &version, &cli_path) {
            match bundle_path().and_then(|bundle| cli::install_app(&bundle)) {
                Ok(()) => updated = updated_to(pointer.as_ref(), &version),
                Err(reason) => say_err!("QualityLayer: could not refresh the install: {reason}"),
            }
        }
    }
    let lock = update_lock::path(&home);
    let content = fs::read_to_string(&lock).ok();
    if lock.exists()
        && lock_is_ours_to_remove(
            content.as_deref(),
            update_lock::is_live_file(&lock),
            std::process::id(),
        )
    {
        let _ = fs::remove_file(&lock);
    }
    let state = State::at_start(read_state(&home).as_ref(), &version, updated.as_deref());
    if let Err(error) = write_state(&home, &state) {
        say_err!("QualityLayer: cannot write update.json: {error}");
    }
    updated
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_watch_is_held_only_while_the_new_app_takes_over_and_every_failure_lets_it_look_again() {
        let dir = std::env::temp_dir().join(format!("ql-finish-install-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let lock = dir.join("update.lock");

        // The installer failed.
        crate::liveness::set_updating(true);
        fs::write(&lock, "1").unwrap();
        let failed = finish_install(Err("disk full".into()), &lock, || {
            panic!("no new App is started after a failed install")
        });
        assert!(failed.unwrap_err().contains("nothing changed: disk full"));
        assert!(!crate::liveness::updating_flag());
        assert!(!lock.exists());

        // The install went through and the new App could not be started.
        crate::liveness::set_updating(true);
        fs::write(&lock, "1").unwrap();
        let stuck = finish_install(Ok(()), &lock, || {
            Err("cannot start the new App: gone".into())
        });
        assert!(stuck
            .unwrap_err()
            .contains("cannot start the new App: gone"));
        assert!(!crate::liveness::updating_flag());
        assert!(!lock.exists());

        // The new App started: the flag and the lock stay for it.
        crate::liveness::set_updating(true);
        fs::write(&lock, "1").unwrap();
        assert!(finish_install(Ok(()), &lock, || Ok(4242)).is_ok());
        assert!(crate::liveness::updating_flag());
        assert_eq!(fs::read_to_string(&lock).unwrap(), "4242");

        crate::liveness::set_updating(false);
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn a_failure_is_named_for_the_page_by_what_went_wrong() {
        use tauri_plugin_updater::Error;
        for error in [
            Error::SignatureUtf8("x".into()),
            Error::MissingSignedVersion,
            Error::SignedVersionMismatch {
                signed: "a".into(),
                announced: "b".into(),
            },
        ] {
            assert_eq!(code_of(&error, "download"), "signature", "{error}");
        }
        assert_eq!(
            code_of(&Error::Network("503".into()), "download"),
            "network"
        );
        assert_eq!(code_of(&Error::ReleaseNotFound, "network"), "network");
        // Anything else is the step it happened in.
        let broken = Error::Io(std::io::Error::other("disk full"));
        assert_eq!(code_of(&broken, "download"), "download");
        assert_eq!(code_of(&Error::EmptyEndpoints, "install"), "install");
    }

    #[test]
    fn a_start_says_it_updated_only_when_the_install_pointed_at_another_version() {
        let pointer = Pointer {
            cli: "/Apps/QualityLayer.app/Contents/MacOS/qualitylayer-cli".into(),
            version: "12.0.0-beta.13".into(),
        };
        assert_eq!(
            updated_to(Some(&pointer), "12.0.0-beta.14").as_deref(),
            Some("12.0.0-beta.14")
        );
        // Moved, not updated.
        assert_eq!(updated_to(Some(&pointer), "12.0.0-beta.13"), None);
        // Never set up here.
        assert_eq!(updated_to(None, "12.0.0-beta.14"), None);
    }

    #[test]
    fn windows_restarts_the_updated_app_through_the_installer_with_update_among_its_arguments() {
        let pointer = Pointer {
            cli: r"C:\Apps\QualityLayer\qualitylayer-cli.exe".into(),
            version: "12.0.0-test.1".into(),
        };
        // The new App finds the install still pointing at the version before: a normal start.
        assert!(restarted_by_installer(
            Some(&pointer),
            "12.0.0-test.2",
            true
        ));
        // The App that is asked to update points the install at itself: it updates.
        assert!(!restarted_by_installer(
            Some(&pointer),
            "12.0.0-test.1",
            true
        ));
        // Never set up here, or any other system (which restarts without `--update`).
        assert!(!restarted_by_installer(None, "12.0.0-test.2", true));
        assert!(!restarted_by_installer(
            Some(&pointer),
            "12.0.0-test.2",
            false
        ));
    }

    #[test]
    fn the_home_goes_to_the_app_the_installer_starts_and_is_taken_once() {
        let dir = std::env::temp_dir().join(format!("ql-update-home-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let file = dir.join(HANDOVER_FILE);
        let home = dir.join("home");
        let set = home.as_os_str();

        // The old App runs in a home of its own: the note says which.
        leave_home(&file, Some(set)).unwrap();
        // The new App has the user's environment, with no home in it: it takes the note's.
        assert_eq!(take_home(&file, None), Some(home.clone()));
        assert!(!file.exists(), "the note is taken once");
        assert_eq!(take_home(&file, None), None);

        // A home the environment names wins, and the note is gone all the same.
        leave_home(&file, Some(set)).unwrap();
        assert_eq!(
            take_home(&file, Some(std::ffi::OsStr::new("/elsewhere"))),
            None
        );
        assert!(!file.exists());

        // No home set, or one that is not absolute: nothing is left, and an old note is cleared.
        leave_home(&file, Some(set)).unwrap();
        leave_home(&file, None).unwrap();
        assert!(!file.exists());
        leave_home(&file, Some(std::ffi::OsStr::new("relative"))).unwrap();
        assert!(!file.exists());
        fs::write(&file, "relative").unwrap();
        assert_eq!(take_home(&file, None), None);
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn a_release_build_ignores_the_test_endpoint_and_key() {
        let env = |name: &str| Some(format!("{name}-value"));
        assert_eq!(test_overrides(false, env), (None, None));
        assert_eq!(
            test_overrides(true, env),
            (
                Some("QUALITYLAYER_UPDATE_ENDPOINT-value".to_string()),
                Some("QUALITYLAYER_UPDATE_PUBKEY-value".to_string())
            )
        );
        assert_eq!(test_overrides(true, |_| None), (None, None));
    }

    #[test]
    fn the_install_is_refreshed_only_when_it_points_at_another_app() {
        let cli = Path::new("/Apps/QualityLayer.app/Contents/MacOS/qualitylayer-cli");
        let same = Pointer {
            cli: cli.display().to_string(),
            version: "12.2.0".into(),
        };
        assert!(!needs_refresh(Some(&same), "12.2.0", cli));
        assert!(needs_refresh(Some(&same), "12.3.0", cli), "a new version");
        assert!(needs_refresh(
            Some(&same),
            "12.2.0",
            Path::new("/Moved/qualitylayer-cli")
        ));
        assert!(
            !needs_refresh(None, "12.2.0", cli),
            "never set up: not for a refresh"
        );
        // Windows path comparison is case-insensitive so differing drive/user casing never re-installs.
        let win_pointer = Pointer {
            cli: r"C:\Users\Max\AppData\Local\QualityLayer\qualitylayer-cli.exe".into(),
            version: "14.4.1".into(),
        };
        assert!(!needs_refresh_for(
            Some(&win_pointer),
            "14.4.1",
            Path::new(r"c:\users\max\appdata\local\qualitylayer\qualitylayer-cli.exe"),
            true
        ));
    }

    #[test]
    fn a_lock_is_removed_when_it_is_ours_a_handover_or_nobody_holds_it() {
        assert!(lock_is_ours_to_remove(Some("7"), true, 7));
        assert!(lock_is_ours_to_remove(Some("handover"), true, 7));
        assert!(lock_is_ours_to_remove(Some("8"), false, 7));
        assert!(lock_is_ours_to_remove(None, false, 7));
        assert!(
            !lock_is_ours_to_remove(Some("8"), true, 7),
            "another live updater"
        );
    }

    #[test]
    fn failed_auto_checks_back_off_progressively_and_cap_at_an_hour() {
        assert_eq!(auto_retry_delay(0), Duration::from_secs(2 * 60));
        assert_eq!(auto_retry_delay(1), Duration::from_secs(2 * 60));
        assert_eq!(auto_retry_delay(2), Duration::from_secs(5 * 60));
        assert_eq!(auto_retry_delay(3), Duration::from_secs(15 * 60));
        assert_eq!(auto_retry_delay(4), Duration::from_secs(60 * 60));
        assert_eq!(auto_retry_delay(99), Duration::from_secs(60 * 60));
    }

    #[test]
    fn retired_windows_sidecars_are_cleaned_up_without_touching_active_files() {
        let dir = std::env::temp_dir().join(format!("ql-retired-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let active_cli = dir.join("qualitylayer-cli.exe");
        let retired_cli = dir.join("qualitylayer-cli.old-0.exe");
        let retired_launcher = dir.join("qualitylayer-launcher.old-1.exe");
        let other = dir.join("other.old-0.exe");
        for file in [&active_cli, &retired_cli, &retired_launcher, &other] {
            fs::write(file, b"stub").unwrap();
        }
        cleanup_retired_binaries(&dir);
        assert!(active_cli.exists());
        assert!(other.exists());
        assert!(!retired_cli.exists());
        assert!(!retired_launcher.exists());
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn the_lock_is_taken_once_and_a_stale_one_is_replaced() {
        let dir = std::env::temp_dir().join(format!("ql-update-lock-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let lock = dir.join("update.lock");
        let _ = fs::remove_file(&lock);

        assert!(take_lock(&lock, std::process::id()).unwrap());
        assert!(
            !take_lock(&lock, std::process::id()).unwrap(),
            "a live lock is held"
        );

        // The holder ended: the next updater takes over.
        let mut gone = Command::new(std::env::current_exe().unwrap())
            .arg("--list")
            .stdout(Stdio::null())
            .spawn()
            .unwrap();
        let pid = gone.id();
        gone.wait().unwrap();
        fs::write(&lock, pid.to_string()).unwrap();
        assert!(take_lock(&lock, std::process::id()).unwrap());
        assert_eq!(
            fs::read_to_string(&lock).unwrap(),
            std::process::id().to_string()
        );
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn the_channel_picks_the_feed_and_an_unset_one_follows_the_installed_version() {
        // Stable asks the plain feed, which the app's configuration names.
        assert_eq!(channel_endpoint(Some("stable"), "12.0.0"), None);
        assert_eq!(channel_endpoint(Some("stable"), "12.1.0-beta.3"), None);
        // Beta asks the feed that also admits prereleases.
        assert_eq!(channel_endpoint(Some("beta"), "12.0.0"), Some(BETA_FEED));
        assert_eq!(
            channel_endpoint(Some("beta"), "12.1.0-beta.3"),
            Some(BETA_FEED)
        );
        // Nobody chose: an installed prerelease counts as Beta, any other install as Stable.
        assert_eq!(channel_endpoint(None, "12.0.0"), None);
        assert_eq!(channel_endpoint(None, "12.1.0-beta.3"), Some(BETA_FEED));
        assert_eq!(channel_endpoint(Some("nightly"), "12.0.0"), None);
        assert_eq!(
            channel_endpoint(Some("nightly"), "12.1.0-beta.3"),
            Some(BETA_FEED)
        );
    }

    #[test]
    fn the_chosen_channel_is_what_the_configuration_says_and_nothing_else_counts() {
        let dir = std::env::temp_dir().join(format!("ql-channel-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let config = dir.join("config.json");
        assert_eq!(chosen_channel(&dir), None, "no configuration");
        for (text, wanted) in [
            (r#"{"updates":{"channel":"beta"}}"#, Some("beta")),
            (r#"{"updates":{"channel":"stable"}}"#, Some("stable")),
            (r#"{"updates":{}}"#, None),
            (r#"{"editor":"zed"}"#, None),
            (r#"{"updates":{"channel":"nightly"}}"#, None),
            (r#"{"updates":{"channel":7}}"#, None),
            ("not json", None),
        ] {
            fs::write(&config, text).unwrap();
            assert_eq!(chosen_channel(&dir).as_deref(), wanted, "{text}");
        }
        // A file this large is not a configuration this updater reads.
        let padding = " ".repeat(64 * 1024);
        fs::write(
            &config,
            format!(r#"{{"updates":{{"channel":"beta"}}}}{padding}"#),
        )
        .unwrap();
        assert_eq!(chosen_channel(&dir), None);
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn a_channel_never_moves_the_app_to_an_older_version() {
        // The updater offers a release only when it is newer than the installed one.
        let offered = |installed: &str, release: &str| {
            semver::Version::parse(release).unwrap() > semver::Version::parse(installed).unwrap()
        };
        // Stable chosen on a beta: the stable release behind it waits.
        assert!(!offered("12.1.0-beta.3", "12.0.0"));
        // Beta chosen on a stable release: the beta ahead of it is offered.
        assert!(offered("12.0.0", "12.1.0-beta.3"));
        // A newer stable release replaces the beta it follows.
        assert!(offered("12.1.0-beta.3", "12.1.0"));
        assert!(offered("12.1.0-beta.3", "12.1.0-beta.10"));
        assert!(!offered("12.1.0-beta.3", "12.1.0-beta.3"));
        assert!(offered("12.0.0-beta.61", "12.0.0"));
        assert!(!offered("12.0.0", "12.0.0-beta.61"));
    }
}
