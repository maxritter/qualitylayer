//! The update's sequence and what it tells the page, apart from the updater and the window: an hourly
//! check that downloads in the background, and an install the person starts from the page. The page
//! never reaches a native command, so the two talk through files in the QualityLayer home: this
//! side writes `update.json`, and the server writes a request file for each thing the page asks
//! (install, check now, cancel), which the watcher here takes and removes.
//!
//! The sequence runs against a `Backend`, so its rules are tested without a network, a signature or
//! a real App to replace; `update.rs` is the Backend over Tauri's updater.

use crate::update::{rename_with_retry, take_lock};
use qualitylayer_launcher::{say_err, update_lock};
use serde_json::{json, Value};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

/// What the page reads: the state of the update.
pub const STATE_FILE: &str = "update.json";
/// The page asks for the install, a check now, or to cancel the wait (Windows).
pub const INSTALL_REQUEST: &str = "update-request.json";
pub const CHECK_REQUEST: &str = "update-check.json";
pub const CANCEL_REQUEST: &str = "update-cancel.json";

/// The update is looked for every hour.
pub const CHECK_EVERY_MS: u64 = 60 * 60 * 1000;
/// A request older than this was left by a page that is gone: it is dropped, never acted on.
const REQUEST_FRESH_MS: u64 = 5 * 60 * 1000;

/// Milliseconds since the epoch.
pub fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |since| since.as_millis() as u64)
}

/// Where the update stands, as the page names it.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Phase {
    Idle,
    Downloading,
    Ready,
    /// Windows only: waiting for agent commands to finish.
    Waiting,
    Installing,
    Failed,
}

impl Phase {
    pub fn as_str(self) -> &'static str {
        match self {
            Phase::Idle => "idle",
            Phase::Downloading => "downloading",
            Phase::Ready => "ready",
            Phase::Waiting => "waiting",
            Phase::Installing => "installing",
            Phase::Failed => "failed",
        }
    }

    fn parse(word: &str) -> Phase {
        match word {
            "downloading" => Phase::Downloading,
            "ready" => Phase::Ready,
            "waiting" => Phase::Waiting,
            "installing" => Phase::Installing,
            "failed" => Phase::Failed,
            _ => Phase::Idle,
        }
    }
}

/// The contents of `update.json`.
#[derive(Clone, Debug, PartialEq)]
pub struct State {
    pub current: String,
    pub available: Option<String>,
    /// The release's CHANGELOG section, as the updater's manifest carries it.
    pub notes: Option<String>,
    pub downloaded: bool,
    /// When the last check went through (ms), none before the first.
    pub checked_at: Option<u64>,
    pub phase: Phase,
    /// The running agent commands the install waits for.
    pub waiting_for: Option<usize>,
    /// Why it failed: `signature`, `network`, `download`, `install`.
    pub error: Option<String>,
    /// The version this App was just updated to: the page's toast reads it once.
    pub updated: Option<String>,
}

impl State {
    pub fn idle(current: &str) -> State {
        State {
            current: current.to_string(),
            available: None,
            notes: None,
            downloaded: false,
            checked_at: None,
            phase: Phase::Idle,
            waiting_for: None,
            error: None,
            updated: None,
        }
    }

    pub fn to_json(&self) -> Value {
        let mut json = json!({
            "current": self.current,
            "available": self.available,
            "notes": self.notes,
            "downloaded": self.downloaded,
            "checkedAt": self.checked_at,
            "state": self.phase.as_str(),
        });
        if let Some(count) = self.waiting_for {
            json["waitingFor"] = json!(count);
        }
        if let Some(code) = &self.error {
            json["error"] = json!(code);
        }
        if let Some(version) = &self.updated {
            json["updated"] = json!(version);
        }
        json
    }

    pub fn from_json(json: &Value) -> Option<State> {
        let text = |key: &str| json[key].as_str().map(str::to_string);
        Some(State {
            current: text("current")?,
            available: text("available"),
            notes: text("notes"),
            downloaded: json["downloaded"] == true,
            checked_at: json["checkedAt"].as_u64(),
            phase: Phase::parse(json["state"].as_str().unwrap_or("")),
            waiting_for: json["waitingFor"]
                .as_u64()
                .and_then(|count| usize::try_from(count).ok()),
            error: text("error"),
            updated: text("updated"),
        })
    }

    /// The state a start begins with. An update that was found but not installed is lost with the
    /// process (what was downloaded lives in memory), so its check is due again at once; one that
    /// was installed keeps its last successful check. `updated` names the version a start just
    /// updated to.
    pub fn at_start(before: Option<&State>, version: &str, updated: Option<&str>) -> State {
        let mut state = State::idle(version);
        let pending = before.is_some_and(|b| b.available.as_deref().is_some_and(|a| a != version));
        if !pending {
            state.checked_at = before.and_then(|b| b.checked_at);
        }
        state.updated = updated.map(str::to_string);
        state
    }
}

impl State {
    /// The state when the page asks for something and this App has no updater (a build run from its
    /// folder, with no command line beside it): the request is answered, as a failure with this code.
    pub fn updates_off(before: Option<&State>, version: &str) -> State {
        let mut state = before.cloned().unwrap_or_else(|| State::idle(version));
        state.phase = Phase::Failed;
        state.waiting_for = None;
        state.error = Some("unavailable".to_string());
        state
    }
}

pub fn read_state(home: &Path) -> Option<State> {
    let text = fs::read_to_string(home.join(STATE_FILE)).ok()?;
    State::from_json(&serde_json::from_str(&text).ok()?)
}

/// Write the state whole: to a file of its own first, so the server never reads half of it.
pub fn write_state(home: &Path, state: &State) -> std::io::Result<()> {
    let temp = home.join(format!("{STATE_FILE}.{}.tmp", std::process::id()));
    fs::write(&temp, format!("{}\n", state.to_json()))?;
    rename_with_retry(&temp, &home.join(STATE_FILE))
}

/// The version that is downloaded and verified, ready to install, if there is one.
pub fn ready_version(home: &Path) -> Option<String> {
    let state = read_state(home)?;
    (state.phase == Phase::Ready && state.downloaded)
        .then_some(state.available)
        .flatten()
}

/// Whether the hourly check is due: never made, an hour old, or dated in the future (a clock that was
/// set back must not hold the check off for days).
pub fn check_due(checked_at: Option<u64>, now: u64) -> bool {
    match checked_at {
        None => true,
        Some(at) => at > now || now - at >= CHECK_EVERY_MS,
    }
}

/// What the page asked for since the last look.
#[derive(Debug, Default, PartialEq, Eq)]
pub struct Requests {
    pub install: bool,
    pub check: bool,
    pub cancel: bool,
}

/// Take one request file: it is removed whatever it says. A fresh one counts; its time is the
/// `at` it holds, else the file's own.
fn take(home: &Path, name: &str, now: u64) -> bool {
    let path = home.join(name);
    let Ok(meta) = fs::metadata(&path) else {
        return false;
    };
    let written = fs::read_to_string(&path)
        .ok()
        .and_then(|text| serde_json::from_str::<Value>(&text).ok())
        .and_then(|json| json["at"].as_u64())
        .or_else(|| {
            meta.modified()
                .ok()
                .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
                .map(|since| since.as_millis() as u64)
        })
        .unwrap_or(0);
    let _ = fs::remove_file(&path);
    now.saturating_sub(written) <= REQUEST_FRESH_MS
}

pub fn take_requests(home: &Path, now: u64) -> Requests {
    Requests {
        install: take(home, INSTALL_REQUEST, now),
        check: take(home, CHECK_REQUEST, now),
        cancel: take(home, CANCEL_REQUEST, now),
    }
}

/// An update the check found.
#[derive(Clone, Debug, PartialEq)]
pub struct Found {
    pub version: String,
    pub notes: Option<String>,
}

/// Why a step failed: a code for the page, and the words for the log.
#[derive(Debug, PartialEq)]
pub struct Failure {
    pub code: &'static str,
    pub message: String,
}

/// What the sequence needs from the world.
pub trait Backend {
    /// What a download is, once verified.
    type Payload;
    fn check(&mut self) -> Result<Option<Found>, Failure>;
    /// Download and verify the signature. Nothing on disk changes.
    fn download(&mut self, found: &Found) -> Result<Self::Payload, Failure>;
    /// How many agent commands run now, the server apart.
    fn running(&self) -> usize;
    /// Replace the App and start the new one. `lock` is held by this process and passes to the new
    /// App. On an error nothing was changed.
    fn install(&mut self, payload: &Self::Payload, lock: &Path) -> Result<(), Failure>;
}

/// How an install ended.
#[derive(Debug, PartialEq, Eq)]
pub enum Installed {
    /// The new App is starting: this one ends.
    Replaced(String),
    UpToDate,
    /// The person cancelled the wait.
    Cancelled,
    Failed,
}

/// How a check ended.
#[derive(Debug, PartialEq, Eq)]
pub enum Checked {
    UpToDate,
    Ready(String),
    Failed,
}

pub struct Engine<B: Backend> {
    pub backend: B,
    home: PathBuf,
    /// Only Windows holds a running program file: elsewhere the install does not wait.
    waits_for_agents: bool,
    /// How often a waiting install looks again.
    poll: Duration,
    now: fn() -> u64,
    state: State,
    ready: Option<(Found, B::Payload)>,
}

pub struct EngineConfig {
    pub home: PathBuf,
    pub state: State,
    pub waits_for_agents: bool,
    pub poll: Duration,
    pub now: fn() -> u64,
}

impl<B: Backend> Engine<B> {
    pub fn new(backend: B, config: EngineConfig) -> Self {
        Engine {
            backend,
            home: config.home,
            waits_for_agents: config.waits_for_agents,
            poll: config.poll,
            now: config.now,
            state: config.state,
            ready: None,
        }
    }

    pub fn checked_at(&self) -> Option<u64> {
        self.state.checked_at
    }

    fn put(&mut self, change: impl FnOnce(&mut State)) {
        change(&mut self.state);
        if let Err(error) = write_state(&self.home, &self.state) {
            say_err!("QualityLayer: cannot write {STATE_FILE}: {error}");
        }
        crate::refresh_tray_from_state();
    }

    /// Something the person started did not finish: the page says so, with the code.
    fn fail(&mut self, failure: &Failure) {
        say_err!(
            "QualityLayer: the update did not finish: {}",
            failure.message
        );
        let code = failure.code.to_string();
        self.put(|state| {
            state.phase = Phase::Failed;
            state.waiting_for = None;
            state.error = Some(code);
        });
    }

    /// A check failed. One the person started (check now, install) says so as `failed`. A check
    /// nobody asked for never makes noise: with an update already downloaded it is only logged and
    /// that update stays ready, and with none it stays `idle`, the error noted for the page.
    fn check_failed(&mut self, failure: &Failure, by_person: bool) {
        if self.ready.is_some() {
            say_err!(
                "QualityLayer: the update check did not go through: {}",
                failure.message
            );
            return;
        }
        if by_person {
            return self.fail(failure);
        }
        say_err!("QualityLayer: the update check failed: {}", failure.message);
        let code = failure.code.to_string();
        self.put(|state| {
            state.available = None;
            state.notes = None;
            state.downloaded = false;
            state.phase = Phase::Idle;
            state.waiting_for = None;
            state.error = Some(code);
        });
    }

    /// Look for an update and, when there is one, download it and check its signature, all in the
    /// background. A version already downloaded is not downloaded again. Nothing on disk but
    /// `update.json` changes, and a failure says so there (see `check_failed`: `by_person` is
    /// whether someone asked for this check).
    pub fn check(&mut self, by_person: bool) -> Checked {
        let found = match self.backend.check() {
            Ok(found) => found,
            Err(failure) => {
                self.check_failed(&failure, by_person);
                return Checked::Failed;
            }
        };
        let now = (self.now)();
        let Some(found) = found else {
            self.ready = None;
            self.put(|state| {
                state.available = None;
                state.notes = None;
                state.downloaded = false;
                state.phase = Phase::Idle;
                state.error = None;
                state.checked_at = Some(now);
            });
            return Checked::UpToDate;
        };
        if self
            .ready
            .as_ref()
            .is_some_and(|(have, _)| have.version == found.version)
        {
            self.put(|state| {
                state.phase = Phase::Ready;
                state.error = None;
                state.checked_at = Some(now);
            });
            return Checked::Ready(found.version);
        }
        self.ready = None;
        let (version, notes) = (found.version.clone(), found.notes.clone());
        self.put(|state| {
            state.available = Some(version);
            state.notes = notes;
            state.downloaded = false;
            state.phase = Phase::Downloading;
            state.error = None;
        });
        match self.backend.download(&found) {
            Ok(payload) => {
                let version = found.version.clone();
                self.ready = Some((found, payload));
                self.put(|state| {
                    state.downloaded = true;
                    state.phase = Phase::Ready;
                    state.checked_at = Some(now);
                });
                Checked::Ready(version)
            }
            Err(failure) => {
                self.check_failed(&failure, by_person);
                Checked::Failed
            }
        }
    }

    /// Wait one poll, in steps of a second so a cancel is heard at once. True when `cancel` was set
    /// (and it is used up).
    fn nap(&self, cancel: &AtomicBool) -> bool {
        let mut left = self.poll;
        while !cancel.swap(false, Ordering::SeqCst) {
            if left.is_zero() {
                return false;
            }
            let step = left.min(Duration::from_secs(1));
            std::thread::sleep(step);
            left -= step;
        }
        true
    }

    fn ensure_ready(&mut self) -> Result<(), Installed> {
        if self.ready.is_some() {
            return Ok(());
        }
        match self.check(true) {
            Checked::Ready(_) => Ok(()),
            Checked::UpToDate => Err(Installed::UpToDate),
            Checked::Failed => Err(Installed::Failed),
        }
    }

    fn wait_for_running_agents(&mut self, cancel: &AtomicBool) -> Result<bool, Installed> {
        if !self.waits_for_agents {
            return Ok(false);
        }
        let running = self.backend.running();
        if running == 0 {
            return Ok(false);
        }
        say_err!("QualityLayer: waiting for {}", agent_commands(running));
        self.put(|state| {
            state.phase = Phase::Waiting;
            state.waiting_for = Some(running);
        });
        if self.nap(cancel) {
            self.back_to_ready();
            return Err(Installed::Cancelled);
        }
        Ok(true)
    }

    fn acquire_update_lock(&mut self, lock: &Path, cancel: &AtomicBool) -> Result<bool, Installed> {
        match take_lock(lock, std::process::id()) {
            Ok(true) => {
                if self.waits_for_agents && self.backend.running() > 0 {
                    let _ = fs::remove_file(lock);
                    return Ok(false);
                }
                Ok(true)
            }
            Ok(false) => {
                if self.nap(cancel) {
                    self.back_to_ready();
                    return Err(Installed::Cancelled);
                }
                Ok(false)
            }
            Err(error) => {
                self.fail(&Failure {
                    code: "install",
                    message: format!("cannot take the update lock: {error}"),
                });
                Err(Installed::Failed)
            }
        }
    }

    fn run_locked_install(&mut self, lock: &Path) -> Installed {
        self.put(|state| {
            state.phase = Phase::Installing;
            state.waiting_for = None;
        });
        let Some((found, payload)) = self.ready.as_ref() else {
            let _ = fs::remove_file(lock);
            return Installed::UpToDate;
        };
        match self.backend.install(payload, lock) {
            Ok(()) => Installed::Replaced(found.version.clone()),
            Err(failure) => {
                let _ = fs::remove_file(lock);
                self.fail(&failure);
                Installed::Failed
            }
        }
    }

    /// Install the update, as the person asked. With none downloaded yet it is looked for and
    /// downloaded first. Where running agent commands hold their program file (Windows) it waits for
    /// them, until `cancel` is set while it waits (a cancel from before is forgotten). Elsewhere
    /// running commands finish on the old copy, and the lock holds new ones back while the App is
    /// replaced.
    pub fn install(&mut self, cancel: &AtomicBool) -> Installed {
        cancel.store(false, Ordering::SeqCst);
        if let Err(outcome) = self.ensure_ready() {
            return outcome;
        }
        let lock = update_lock::path(&self.home);
        loop {
            match self.wait_for_running_agents(cancel) {
                Ok(true) => continue,
                Ok(false) => {}
                Err(outcome) => return outcome,
            }
            match self.acquire_update_lock(&lock, cancel) {
                Ok(true) => return self.run_locked_install(&lock),
                Ok(false) => continue,
                Err(outcome) => return outcome,
            }
        }
    }

    /// The page has had its time to say "Updated to …": take the note out of `update.json`, so a
    /// page that opens later does not say it again.
    pub fn done_telling(&mut self) {
        if self.state.updated.is_some() {
            self.put(|state| state.updated = None);
        }
    }

    fn back_to_ready(&mut self) {
        self.put(|state| {
            state.phase = Phase::Ready;
            state.waiting_for = None;
        });
    }
}

fn agent_commands(count: usize) -> String {
    if count == 1 {
        "1 agent command".to_string()
    } else {
        format!("{count} agent commands")
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;
    use std::rc::Rc;
    use std::sync::Arc;

    fn temp(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("ql-flow-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    const NOW: u64 = 1_800_000_000_000;

    fn clock() -> u64 {
        NOW
    }

    /// What the fake world did, in order.
    #[derive(Default)]
    struct Log {
        events: Vec<String>,
        /// What `update.json` said each time the sequence asked how many commands run.
        seen: Vec<Option<State>>,
    }

    struct Fake {
        home: PathBuf,
        log: Rc<RefCell<Log>>,
        /// What a check finds, in order; the last repeats.
        finds: Vec<Result<Option<Found>, (&'static str, &'static str)>>,
        download: Result<(), (&'static str, &'static str)>,
        /// How many commands run at each look, in order; the last repeats.
        running: RefCell<Vec<usize>>,
        install: Result<(), (&'static str, &'static str)>,
        cancel_at_look: Option<(usize, Arc<AtomicBool>)>,
        looks: RefCell<usize>,
    }

    fn found(version: &str) -> Found {
        Found {
            version: version.into(),
            notes: Some("### New\n\n- A thing.".into()),
        }
    }

    fn fake(home: &Path, log: &Rc<RefCell<Log>>) -> Fake {
        Fake {
            home: home.to_path_buf(),
            log: log.clone(),
            finds: vec![Ok(Some(found("12.0.0-beta.14")))],
            download: Ok(()),
            running: RefCell::new(vec![0]),
            install: Ok(()),
            cancel_at_look: None,
            looks: RefCell::new(0),
        }
    }

    impl Backend for Fake {
        type Payload = Vec<u8>;

        fn check(&mut self) -> Result<Option<Found>, Failure> {
            self.log.borrow_mut().events.push("check".into());
            let next = if self.finds.len() > 1 {
                self.finds.remove(0)
            } else {
                self.finds[0].clone()
            };
            next.map_err(|(code, message)| Failure {
                code,
                message: message.into(),
            })
        }

        fn download(&mut self, found: &Found) -> Result<Vec<u8>, Failure> {
            self.log
                .borrow_mut()
                .events
                .push(format!("download {}", found.version));
            self.download
                .map(|()| vec![1, 2, 3])
                .map_err(|(code, message)| Failure {
                    code,
                    message: message.into(),
                })
        }

        fn running(&self) -> usize {
            let look = {
                let mut looks = self.looks.borrow_mut();
                *looks += 1;
                *looks
            };
            self.log.borrow_mut().seen.push(read_state(&self.home));
            if let Some((at, cancel)) = &self.cancel_at_look {
                if look == *at {
                    cancel.store(true, Ordering::SeqCst);
                }
            }
            let mut counts = self.running.borrow_mut();
            if counts.len() > 1 {
                counts.remove(0)
            } else {
                counts[0]
            }
        }

        fn install(&mut self, payload: &Vec<u8>, lock: &Path) -> Result<(), Failure> {
            assert_eq!(payload, &vec![1, 2, 3], "installs what was downloaded");
            assert!(lock.exists(), "the lock is held while the App is replaced");
            self.log.borrow_mut().events.push("install".into());
            self.install.map_err(|(code, message)| Failure {
                code,
                message: message.into(),
            })
        }
    }

    fn build_engine(home: &Path, backend: Fake, waits: bool) -> Engine<Fake> {
        Engine::new(
            backend,
            EngineConfig {
                home: home.to_path_buf(),
                state: State::idle("12.0.0-beta.13"),
                waits_for_agents: waits,
                poll: Duration::ZERO,
                now: clock,
            },
        )
    }

    #[test]
    fn update_json_says_each_state_in_the_pages_words() {
        let mut state = State::idle("12.0.0-beta.13");
        assert_eq!(
            state.to_json(),
            json!({
                "current": "12.0.0-beta.13", "available": null, "notes": null, "downloaded": false,
                "checkedAt": null, "state": "idle"
            })
        );
        state.available = Some("12.0.0-beta.14".into());
        state.notes = Some("### New\n\n- A thing.".into());
        state.checked_at = Some(NOW);
        state.phase = Phase::Downloading;
        assert_eq!(state.to_json()["state"], "downloading");
        assert_eq!(state.to_json()["downloaded"], false);
        state.phase = Phase::Ready;
        state.downloaded = true;
        let ready = state.to_json();
        assert_eq!(ready["state"], "ready");
        assert_eq!(ready["downloaded"], true);
        assert_eq!(ready["available"], "12.0.0-beta.14");
        assert_eq!(ready["notes"], "### New\n\n- A thing.");
        assert_eq!(ready["checkedAt"], NOW);
        assert!(ready.get("waitingFor").is_none() && ready.get("error").is_none());
        state.phase = Phase::Waiting;
        state.waiting_for = Some(2);
        let waiting = state.to_json();
        assert_eq!(
            (waiting["state"].as_str(), waiting["waitingFor"].as_u64()),
            (Some("waiting"), Some(2))
        );
        state.phase = Phase::Installing;
        state.waiting_for = None;
        assert_eq!(state.to_json()["state"], "installing");
        state.phase = Phase::Failed;
        state.error = Some("signature".into());
        let failed = state.to_json();
        assert_eq!(
            (failed["state"].as_str(), failed["error"].as_str()),
            (Some("failed"), Some("signature"))
        );
        // And it reads back as it was written.
        assert_eq!(State::from_json(&failed), Some(state));
    }

    #[test]
    fn the_state_file_is_written_whole_and_read_back() {
        let home = temp("file");
        assert_eq!(read_state(&home), None);
        let mut state = State::idle("12.0.0-beta.13");
        state.phase = Phase::Ready;
        state.downloaded = true;
        state.available = Some("12.0.0-beta.14".into());
        write_state(&home, &state).unwrap();
        assert_eq!(read_state(&home), Some(state));
        assert_eq!(ready_version(&home).as_deref(), Some("12.0.0-beta.14"));
        assert!(!home.join("update.json.tmp").exists());
        // Not ready until it is downloaded.
        let mut half = State::idle("12.0.0-beta.13");
        half.phase = Phase::Downloading;
        half.available = Some("12.0.0-beta.14".into());
        write_state(&home, &half).unwrap();
        assert_eq!(ready_version(&home), None);
        fs::remove_dir_all(&home).unwrap();
    }

    #[test]
    fn the_check_runs_at_start_when_none_was_made_or_the_last_is_an_hour_old() {
        assert!(check_due(None, NOW));
        assert!(!check_due(Some(NOW), NOW));
        assert!(!check_due(Some(NOW - 45 * 60 * 1000), NOW));
        assert!(!check_due(Some(NOW - 60 * 60 * 1000 + 1), NOW));
        assert!(check_due(Some(NOW - 60 * 60 * 1000), NOW));
        assert!(check_due(Some(NOW - 2 * 60 * 60 * 1000), NOW));
        // A clock set back is not trusted.
        assert!(check_due(Some(NOW + 1), NOW));
    }

    #[test]
    fn a_start_keeps_the_last_check_unless_an_update_was_found_and_not_installed() {
        let mut before = State::idle("12.0.0-beta.13");
        before.checked_at = Some(NOW - 1000);
        // Up to date: the check stands.
        assert_eq!(
            State::at_start(Some(&before), "12.0.0-beta.13", None).checked_at,
            before.checked_at
        );
        // Found beta.14 and never installed it (the download is lost with the process): check again.
        before.available = Some("12.0.0-beta.14".into());
        assert_eq!(
            State::at_start(Some(&before), "12.0.0-beta.13", None).checked_at,
            None
        );
        // Just updated into it: nothing pending, and the page may say so once.
        let started = State::at_start(Some(&before), "12.0.0-beta.14", Some("12.0.0-beta.14"));
        assert_eq!(started.checked_at, before.checked_at);
        assert_eq!(started.updated.as_deref(), Some("12.0.0-beta.14"));
        assert_eq!((started.phase, started.available), (Phase::Idle, None));
        assert_eq!(
            State::at_start(None, "12.0.0-beta.13", None).checked_at,
            None
        );
    }

    #[test]
    fn the_note_that_the_app_was_updated_is_dropped_once_the_page_has_had_its_time() {
        let home = temp("told");
        let log = Rc::new(RefCell::new(Log::default()));
        let mut state = State::at_start(None, "12.0.0-beta.14", Some("12.0.0-beta.14"));
        state.checked_at = Some(NOW);
        write_state(&home, &state).unwrap();
        let mut engine = Engine::new(
            fake(&home, &log),
            EngineConfig {
                home: home.clone(),
                state,
                waits_for_agents: false,
                poll: Duration::ZERO,
                now: clock,
            },
        );
        assert_eq!(
            read_state(&home).unwrap().updated.as_deref(),
            Some("12.0.0-beta.14")
        );
        engine.done_telling();
        let after = read_state(&home).unwrap();
        assert_eq!(after.updated, None);
        assert!(after.to_json().get("updated").is_none());
        // Nothing else about the state moved.
        assert_eq!(
            (after.current.as_str(), after.checked_at),
            ("12.0.0-beta.14", Some(NOW))
        );
        fs::remove_dir_all(&home).unwrap();
    }

    #[test]
    fn the_pages_requests_are_taken_once_and_removed() {
        let home = temp("requests");
        assert_eq!(take_requests(&home, NOW), Requests::default());
        fs::write(home.join(INSTALL_REQUEST), format!("{{\"at\":{NOW}}}")).unwrap();
        fs::write(
            home.join(CHECK_REQUEST),
            format!("{{\"at\":{}}}", NOW - 1000),
        )
        .unwrap();
        assert_eq!(
            take_requests(&home, NOW),
            Requests {
                install: true,
                check: true,
                cancel: false
            }
        );
        assert_eq!(take_requests(&home, NOW), Requests::default(), "taken once");
        assert!(!home.join(INSTALL_REQUEST).exists() && !home.join(CHECK_REQUEST).exists());

        fs::write(home.join(CANCEL_REQUEST), format!("{{\"at\":{NOW}}}")).unwrap();
        assert_eq!(
            take_requests(&home, NOW),
            Requests {
                install: false,
                check: false,
                cancel: true
            }
        );
        fs::remove_dir_all(&home).unwrap();
    }

    #[test]
    fn a_request_left_behind_long_ago_is_removed_and_never_acted_on() {
        let home = temp("stale");
        let old = NOW - REQUEST_FRESH_MS - 1;
        fs::write(home.join(INSTALL_REQUEST), format!("{{\"at\":{old}}}")).unwrap();
        assert_eq!(take_requests(&home, NOW), Requests::default());
        assert!(!home.join(INSTALL_REQUEST).exists());
        fs::remove_dir_all(&home).unwrap();
    }

    #[test]
    fn a_request_without_a_time_counts_by_its_files_own() {
        let home = temp("mtime");
        fs::write(home.join(CHECK_REQUEST), "{}").unwrap();
        let now = now_ms();
        assert!(take_requests(&home, now).check);
        // The file was written just now; an hour later it is stale.
        fs::write(home.join(CHECK_REQUEST), "not json").unwrap();
        assert!(!take_requests(&home, now + CHECK_EVERY_MS).check);
        fs::remove_dir_all(&home).unwrap();
    }

    #[test]
    fn a_check_that_finds_an_update_downloads_it_in_the_background_and_leaves_it_ready() {
        let home = temp("ready");
        let log = Rc::new(RefCell::new(Log::default()));
        let mut engine = build_engine(&home, fake(&home, &log), false);
        assert_eq!(engine.check(true), Checked::Ready("12.0.0-beta.14".into()));
        assert_eq!(
            log.borrow().events,
            vec!["check", "download 12.0.0-beta.14"]
        );
        let state = read_state(&home).unwrap();
        assert_eq!(state.phase, Phase::Ready);
        assert_eq!(state.available.as_deref(), Some("12.0.0-beta.14"));
        assert_eq!(state.notes.as_deref(), Some("### New\n\n- A thing."));
        assert!(state.downloaded);
        assert_eq!(state.checked_at, Some(NOW));
        assert_eq!(engine.checked_at(), Some(NOW));
        // Nothing was installed and nothing is locked.
        assert!(!update_lock::path(&home).exists());
        fs::remove_dir_all(&home).unwrap();
    }

    #[test]
    fn the_next_check_does_not_download_the_same_version_again() {
        let home = temp("again");
        let log = Rc::new(RefCell::new(Log::default()));
        let mut engine = build_engine(&home, fake(&home, &log), false);
        engine.check(true);
        assert_eq!(engine.check(true), Checked::Ready("12.0.0-beta.14".into()));
        let downloads = log
            .borrow()
            .events
            .iter()
            .filter(|e| e.starts_with("download"))
            .count();
        assert_eq!(downloads, 1);
        fs::remove_dir_all(&home).unwrap();
    }

    #[test]
    fn an_up_to_date_check_says_idle_and_forgets_an_update_that_is_gone() {
        let home = temp("current");
        let log = Rc::new(RefCell::new(Log::default()));
        let mut backend = fake(&home, &log);
        backend.finds = vec![Ok(Some(found("12.0.0-beta.14"))), Ok(None)];
        let mut engine = build_engine(&home, backend, false);
        engine.check(true);
        assert_eq!(engine.check(true), Checked::UpToDate);
        let state = read_state(&home).unwrap();
        assert_eq!(
            (state.phase, state.available, state.notes, state.downloaded),
            (Phase::Idle, None, None, false)
        );
        assert_eq!(state.checked_at, Some(NOW));
        fs::remove_dir_all(&home).unwrap();
    }

    #[test]
    fn a_signature_failure_writes_failed_with_its_code_and_changes_nothing_on_disk() {
        let home = temp("signature");
        let log = Rc::new(RefCell::new(Log::default()));
        let mut backend = fake(&home, &log);
        backend.download = Err(("signature", "the signature does not match"));
        let mut engine = build_engine(&home, backend, false);
        assert_eq!(engine.check(true), Checked::Failed);
        let state = read_state(&home).unwrap();
        assert_eq!(state.phase, Phase::Failed);
        assert_eq!(state.error.as_deref(), Some("signature"));
        assert!(!state.downloaded);
        // The page can still name what it could not install.
        assert_eq!(state.available.as_deref(), Some("12.0.0-beta.14"));
        assert_eq!(state.checked_at, None, "a failed check is not a check made");
        // Asking to install after that tries the download again, and still installs nothing.
        let cancel = AtomicBool::new(false);
        assert_eq!(engine.install(&cancel), Installed::Failed);
        assert!(!log.borrow().events.contains(&"install".to_string()));
        assert!(!update_lock::path(&home).exists(), "no lock was ever taken");
        fs::remove_dir_all(&home).unwrap();
    }

    #[test]
    fn a_check_that_cannot_reach_the_server_says_network_and_keeps_the_last_good_check() {
        let home = temp("network");
        let log = Rc::new(RefCell::new(Log::default()));
        let mut backend = fake(&home, &log);
        backend.finds = vec![Err(("network", "no route"))];
        let mut engine = build_engine(&home, backend, false);
        engine.state.checked_at = Some(NOW - 5000);
        assert_eq!(engine.check(true), Checked::Failed);
        let state = read_state(&home).unwrap();
        assert_eq!(
            (state.phase, state.error.as_deref()),
            (Phase::Failed, Some("network"))
        );
        assert_eq!(state.checked_at, Some(NOW - 5000));
        fs::remove_dir_all(&home).unwrap();
    }

    #[test]
    fn a_check_nobody_asked_for_never_says_failed_and_never_unreadies_a_downloaded_update() {
        // Nothing downloaded: it stays idle, the error noted for the page.
        let home = temp("quiet");
        let log = Rc::new(RefCell::new(Log::default()));
        let mut backend = fake(&home, &log);
        backend.finds = vec![Err(("network", "no route"))];
        let mut engine = build_engine(&home, backend, false);
        assert_eq!(engine.check(false), Checked::Failed);
        let state = read_state(&home).unwrap();
        assert_eq!(
            (state.phase, state.error.as_deref()),
            (Phase::Idle, Some("network"))
        );
        fs::remove_dir_all(&home).unwrap();

        // A downloaded update stays ready through a failed check, whoever asked for it.
        for by_person in [false, true] {
            let home = temp("kept");
            let log = Rc::new(RefCell::new(Log::default()));
            let mut backend = fake(&home, &log);
            backend.finds = vec![
                Ok(Some(found("12.0.0-beta.14"))),
                Err(("network", "no route")),
            ];
            let mut engine = build_engine(&home, backend, false);
            assert_eq!(engine.check(true), Checked::Ready("12.0.0-beta.14".into()));
            assert_eq!(engine.check(by_person), Checked::Failed);
            let state = read_state(&home).unwrap();
            assert_eq!(
                (state.phase, state.downloaded),
                (Phase::Ready, true),
                "{by_person}"
            );
            assert_eq!(state.error, None);
            // And it still installs, without looking again.
            let cancel = AtomicBool::new(false);
            assert_eq!(
                engine.install(&cancel),
                Installed::Replaced("12.0.0-beta.14".into())
            );
            fs::remove_dir_all(&home).unwrap();
        }

        // A download that fails with nothing ready, unattended: idle, with the code and no half-ready version.
        let home = temp("quiet-download");
        let log = Rc::new(RefCell::new(Log::default()));
        let mut backend = fake(&home, &log);
        backend.download = Err(("signature", "no match"));
        let mut engine = build_engine(&home, backend, false);
        assert_eq!(engine.check(false), Checked::Failed);
        let state = read_state(&home).unwrap();
        assert_eq!(
            (
                state.phase,
                state.error.as_deref(),
                state.available.as_deref(),
                state.notes.as_deref(),
                state.downloaded
            ),
            (Phase::Idle, Some("signature"), None, None, false)
        );
        fs::remove_dir_all(&home).unwrap();
    }

    #[test]
    fn a_request_for_an_app_with_no_updater_is_answered_with_an_error_in_update_json() {
        let state = State::updates_off(None, "12.0.0-beta.13");
        assert_eq!(state.current, "12.0.0-beta.13");
        assert_eq!(
            (state.phase, state.error.as_deref()),
            (Phase::Failed, Some("unavailable"))
        );
        let mut before = State::idle("12.0.0-beta.13");
        before.checked_at = Some(NOW);
        before.phase = Phase::Waiting;
        before.waiting_for = Some(2);
        let state = State::updates_off(Some(&before), "12.0.0-beta.13");
        assert_eq!((state.checked_at, state.waiting_for), (Some(NOW), None));
        assert_eq!(state.to_json()["error"], "unavailable");
    }

    #[test]
    fn a_cancel_that_came_before_the_wait_is_forgotten() {
        let home = temp("old-cancel");
        let log = Rc::new(RefCell::new(Log::default()));
        let mut backend = fake(&home, &log);
        backend.running = RefCell::new(vec![1, 0]);
        let mut engine = build_engine(&home, backend, true);
        engine.check(true);
        let cancel = AtomicBool::new(true);
        assert_eq!(
            engine.install(&cancel),
            Installed::Replaced("12.0.0-beta.14".into())
        );
        fs::remove_dir_all(&home).unwrap();
    }

    #[test]
    fn where_running_commands_finish_on_the_old_copy_the_install_goes_at_once_under_the_lock() {
        let home = temp("mac");
        let log = Rc::new(RefCell::new(Log::default()));
        let mut backend = fake(&home, &log);
        backend.running = RefCell::new(vec![2]);
        let mut engine = build_engine(&home, backend, false);
        engine.check(true);
        let cancel = AtomicBool::new(false);
        assert_eq!(
            engine.install(&cancel),
            Installed::Replaced("12.0.0-beta.14".into())
        );
        assert_eq!(
            log.borrow().events,
            vec!["check", "download 12.0.0-beta.14", "install"]
        );
        assert_eq!(read_state(&home).unwrap().phase, Phase::Installing);
        // The lock stays: the new App takes it over and removes it once it has refreshed the install.
        assert!(update_lock::path(&home).exists());
        fs::remove_dir_all(&home).unwrap();
    }

    #[test]
    fn windows_waits_for_the_running_commands_and_says_how_many_until_they_are_done() {
        let home = temp("windows");
        let log = Rc::new(RefCell::new(Log::default()));
        let mut backend = fake(&home, &log);
        backend.running = RefCell::new(vec![2, 2, 1, 0]);
        let mut engine = build_engine(&home, backend, true);
        engine.check(true);
        let cancel = AtomicBool::new(false);
        assert_eq!(
            engine.install(&cancel),
            Installed::Replaced("12.0.0-beta.14".into())
        );
        let waited: Vec<(Phase, Option<usize>)> = log
            .borrow()
            .seen
            .iter()
            .flatten()
            .map(|state| (state.phase, state.waiting_for))
            .collect();
        // The page saw "waiting for 2", then "waiting for 1"; the last looks found none.
        assert!(waited.contains(&(Phase::Waiting, Some(2))), "{waited:?}");
        assert!(waited.contains(&(Phase::Waiting, Some(1))), "{waited:?}");
        assert_eq!(
            log.borrow().events.last().map(String::as_str),
            Some("install")
        );
        let state = read_state(&home).unwrap();
        assert_eq!((state.phase, state.waiting_for), (Phase::Installing, None));
        fs::remove_dir_all(&home).unwrap();
    }

    #[test]
    fn cancelling_the_wait_goes_back_to_ready_and_installs_nothing() {
        let home = temp("cancel");
        let log = Rc::new(RefCell::new(Log::default()));
        let cancel = Arc::new(AtomicBool::new(false));
        let mut backend = fake(&home, &log);
        backend.running = RefCell::new(vec![1]);
        backend.cancel_at_look = Some((2, cancel.clone()));
        let mut engine = build_engine(&home, backend, true);
        engine.check(true);
        assert_eq!(engine.install(&cancel), Installed::Cancelled);
        let state = read_state(&home).unwrap();
        assert_eq!(
            (state.phase, state.waiting_for, state.downloaded),
            (Phase::Ready, None, true)
        );
        assert!(!log.borrow().events.contains(&"install".to_string()));
        assert!(!update_lock::path(&home).exists());
        // The cancel was used up: asking again waits again rather than cancelling at once.
        assert!(!cancel.load(Ordering::SeqCst));
        fs::remove_dir_all(&home).unwrap();
    }

    #[test]
    fn an_install_that_fails_removes_the_lock_and_says_why() {
        let home = temp("install-fails");
        let log = Rc::new(RefCell::new(Log::default()));
        let mut backend = fake(&home, &log);
        backend.install = Err(("install", "the App could not be replaced"));
        let mut engine = build_engine(&home, backend, false);
        engine.check(true);
        let cancel = AtomicBool::new(false);
        assert_eq!(engine.install(&cancel), Installed::Failed);
        let state = read_state(&home).unwrap();
        assert_eq!(
            (state.phase, state.error.as_deref()),
            (Phase::Failed, Some("install"))
        );
        assert!(!update_lock::path(&home).exists());
        fs::remove_dir_all(&home).unwrap();
    }

    #[test]
    fn an_install_with_nothing_downloaded_checks_and_downloads_first_and_ends_up_to_date_when_there_is_none(
    ) {
        let home = temp("late");
        let log = Rc::new(RefCell::new(Log::default()));
        let mut engine = build_engine(&home, fake(&home, &log), false);
        let cancel = AtomicBool::new(false);
        assert_eq!(
            engine.install(&cancel),
            Installed::Replaced("12.0.0-beta.14".into())
        );
        assert_eq!(
            log.borrow().events,
            vec!["check", "download 12.0.0-beta.14", "install"]
        );
        fs::remove_dir_all(&home).unwrap();

        let home = temp("late-none");
        let log = Rc::new(RefCell::new(Log::default()));
        let mut backend = fake(&home, &log);
        backend.finds = vec![Ok(None)];
        let mut engine = build_engine(&home, backend, false);
        assert_eq!(engine.install(&cancel), Installed::UpToDate);
        assert!(!log.borrow().events.contains(&"install".to_string()));
        fs::remove_dir_all(&home).unwrap();
    }
}
