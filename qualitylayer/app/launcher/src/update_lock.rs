//! `<QL home>/update.lock`: while the App replaces itself and its CLI, no new agent command may
//! start. The file holds the pid of the process that is updating. A lock is live only while that
//! process runs and the file is younger than ten minutes, so a crashed updater never blocks agents.

use std::fs;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};

/// How long a lock holds calls back, however long its holder keeps running.
pub const MAX_AGE: Duration = Duration::from_secs(10 * 60);

/// Written to `update.lock` when a Windows installer takes over and exits the old App: the
/// launcher holds new CLI calls back until the new App starts and removes the lock, or until
/// `HANDOVER_MAX_AGE` passes so a failed installer never blocks commands for long.
pub const HANDOVER_MARKER: &str = "handover";
pub const HANDOVER_MAX_AGE: Duration = Duration::from_secs(60);

pub fn path(home: &Path) -> PathBuf {
    home.join("update.lock")
}

/// Whether the lock file content marks a Windows installer handover.
pub fn is_handover_text(text: &str) -> bool {
    text.trim() == HANDOVER_MARKER
}

/// The decision, apart from the file system: `holder` is the pid the file holds, `age` how long
/// ago it was written.
pub fn is_live(holder: Option<u32>, age: Duration, alive: impl Fn(u32) -> bool) -> bool {
    age < MAX_AGE && holder.is_some_and(alive)
}

/// The same decision over raw lock text, supporting both a live holder pid and a bounded Windows
/// installer handover marker.
pub fn is_live_content(text: &str, age: Duration, alive: impl Fn(u32) -> bool) -> bool {
    if is_handover_text(text) {
        return age < HANDOVER_MAX_AGE;
    }
    let holder = text.trim().parse().ok();
    is_live(holder, age, alive)
}

/// Whether the lock file at `lock` is live now.
pub fn is_live_file(lock: &Path) -> bool {
    let Ok(modified) = fs::metadata(lock).and_then(|m| m.modified()) else {
        return false;
    };
    let age = SystemTime::now()
        .duration_since(modified)
        .unwrap_or(Duration::ZERO);
    let Ok(text) = fs::read_to_string(lock) else {
        return false;
    };
    is_live_content(&text, age, pid_alive)
}

#[cfg(unix)]
pub fn pid_alive(pid: u32) -> bool {
    extern "C" {
        fn kill(pid: i32, signal: i32) -> i32;
    }
    const EPERM: i32 = 1;
    let Ok(pid) = i32::try_from(pid) else {
        return false;
    };
    // Signal 0 only asks whether the process exists; a process of another user answers EPERM.
    // SAFETY: `kill` takes two integers and touches no memory.
    unsafe { kill(pid, 0) == 0 || std::io::Error::last_os_error().raw_os_error() == Some(EPERM) }
}

#[cfg(windows)]
pub fn pid_alive(pid: u32) -> bool {
    extern "system" {
        fn OpenProcess(access: u32, inherit: i32, pid: u32) -> *mut core::ffi::c_void;
        fn GetExitCodeProcess(process: *mut core::ffi::c_void, code: *mut u32) -> i32;
        fn CloseHandle(handle: *mut core::ffi::c_void) -> i32;
    }
    const QUERY_LIMITED_INFORMATION: u32 = 0x1000;
    const STILL_ACTIVE: u32 = 259;
    // SAFETY: the handle is only passed to the two calls below and closed; `code` is a live u32.
    unsafe {
        let process = OpenProcess(QUERY_LIMITED_INFORMATION, 0, pid);
        if process.is_null() {
            return false;
        }
        let mut code = 0u32;
        let known = GetExitCodeProcess(process, &mut code) != 0;
        CloseHandle(process);
        known && code == STILL_ACTIVE
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_lock_is_live_while_its_holder_runs_and_it_is_young() {
        let young = Duration::from_secs(30);
        assert!(is_live(Some(7), young, |pid| pid == 7));
        assert!(!is_live(Some(7), young, |_| false), "holder gone");
        assert!(!is_live(None, young, |_| true), "no pid in the file");
        assert!(
            !is_live(Some(7), MAX_AGE, |_| true),
            "ten minutes is too old"
        );
        assert!(is_live(Some(7), MAX_AGE - Duration::from_secs(1), |_| true));
    }

    #[test]
    fn a_handover_lock_is_live_only_until_its_bounded_window_passes() {
        assert!(is_handover_text("handover"));
        assert!(is_handover_text("handover\n"));
        assert!(!is_handover_text("1234"));
        assert!(is_live_content("handover", Duration::from_secs(10), |_| {
            false
        }));
        assert!(is_live_content(
            "handover\n",
            HANDOVER_MAX_AGE - Duration::from_secs(1),
            |_| false
        ));
        assert!(!is_live_content("handover", HANDOVER_MAX_AGE, |_| true));
        assert!(is_live_content("7", Duration::from_secs(10), |pid| pid == 7));
        assert!(!is_live_content("7", Duration::from_secs(10), |_| false));
    }

    #[test]
    fn this_process_is_alive_and_an_ended_one_is_not() {
        assert!(pid_alive(std::process::id()));
        let mut child = std::process::Command::new(std::env::current_exe().unwrap())
            .arg("--list")
            .stdout(std::process::Stdio::null())
            .spawn()
            .unwrap();
        let pid = child.id();
        child.wait().unwrap();
        assert!(!pid_alive(pid));
    }
}
