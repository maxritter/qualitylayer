//! The program agents call at `<QL home>/bin/qualitylayer`. It reads `<QL home>/app.json` (or, when
//! that is gone, looks in the App's standard install place), finds the CLI inside the QualityLayer
//! App and hands every call over: arguments, input, working
//! directory, user configuration and the exit code pass through. Bun preload/debug switches are
//! removed before starting the CLI. It opens no window and reads no
//! network. It writes no file, except for one case: an agent's hook (`qualitylayer hook ...`) that
//! finds the App missing exits 0 in silence and leaves a note in `launcher-problem.json`, at most
//! once a day; a command a person types keeps its message and its failing exit code.

// println!/eprintln!/dbg! panic when the stream is closed, and a panic aborts this process: write
// with `say!`/`say_err!` (qualitylayer_launcher::out) instead.
#![deny(clippy::print_stdout, clippy::print_stderr, clippy::dbg_macro)]

mod json_cli;

use json_cli::parse_cli;
use qualitylayer_launcher::{private_files, problem, quality_layer_home, say_err, update_lock};
use std::io::IsTerminal;
use std::path::{Path, PathBuf};
use std::process::{exit, Command};
use std::time::{Duration, Instant, SystemTime};
use std::{env, fs, thread};

/// Whether an agent's hook is calling, not a person typing: `qualitylayer hook <event>`, or the
/// session start hook that attaches the session to the peers board (`qualitylayer peers session-hook`).
fn is_hook_call() -> bool {
    let mut args = env::args_os().skip(1);
    match args.next() {
        Some(first) if first == "hook" => true,
        Some(first) if first == "peers" => {
            args.next().is_some_and(|second| second == "session-hook")
        }
        _ => false,
    }
}

/// A hook that cannot reach the App stands in nobody's way: the agent shows a "hook error" for a
/// nonzero exit or any text on stderr, once per tool call. So nothing is printed and the exit code
/// is 0; the agent's input is read first, so it never meets a closed pipe, and the problem goes
/// into a small file (once a day) for `qualitylayer doctor` and the App to show.
fn hook_stays_silent(home: Option<&Path>, reason: &str, at: &Path) -> ! {
    if !std::io::stdin().is_terminal() {
        let _ = std::io::copy(&mut std::io::stdin().lock(), &mut std::io::sink());
    }
    if let Some(home) = home {
        let call: Vec<String> = env::args_os()
            .skip(1)
            .take(2)
            .map(|part| part.to_string_lossy().into_owned())
            .collect();
        problem::record(home, SystemTime::now(), reason, at, &call.join(" "));
    }
    exit(0)
}

fn not_found(home: Option<&Path>, at: &Path) -> ! {
    if is_hook_call() {
        hook_stays_silent(home, "the QualityLayer App was not found", at)
    }
    say_err!(
        "qualitylayer: the QualityLayer App was not found at {}. Open the App once to repair this.",
        at.display()
    );
    exit(127)
}

fn cannot_run(home: &Path, cli: &Path, cause: std::io::Error) -> ! {
    if is_hook_call() {
        hook_stays_silent(Some(home), "the QualityLayer App could not be started", cli)
    }
    say_err!("qualitylayer: cannot run {}: {cause}", cli.display());
    exit(126)
}

/// Unix: this process becomes the CLI.
#[cfg(unix)]
fn forward(home: &Path, cli: &Path) -> ! {
    use std::os::unix::process::CommandExt;
    let mut command = Command::new(cli);
    command.args(env::args_os().skip(1));
    qualitylayer_launcher::cli_environment::protect(&mut command);
    cannot_run(home, cli, command.exec())
}

/// Windows: the CLI runs with this process's handles, and its exit code is ours.
#[cfg(windows)]
fn forward(home: &Path, cli: &Path) -> ! {
    let mut command = Command::new(cli);
    command.args(env::args_os().skip(1));
    qualitylayer_launcher::cli_environment::protect(&mut command);
    match command.status() {
        Ok(status) => exit(status.code().unwrap_or(1)),
        Err(cause) => cannot_run(home, cli, cause),
    }
}

/// Where an installed App keeps its CLI, for when app.json is gone: the standard install places of
/// each platform. `QUALITYLAYER_APP_SEARCH` (paths joined like PATH) replaces them, for tests.
fn standard_places() -> Vec<PathBuf> {
    if let Some(search) = env::var_os("QUALITYLAYER_APP_SEARCH") {
        return env::split_paths(&search).collect();
    }
    let mut places = Vec::new();
    if cfg!(target_os = "macos") {
        places.push(PathBuf::from(
            "/Applications/QualityLayer.app/Contents/MacOS/qualitylayer-cli",
        ));
        if let Some(user) = env::var_os("HOME") {
            places.push(
                PathBuf::from(user)
                    .join("Applications/QualityLayer.app/Contents/MacOS/qualitylayer-cli"),
            );
        }
    } else if cfg!(windows) {
        if let Some(local) = env::var_os("LOCALAPPDATA") {
            places.push(PathBuf::from(local).join(r"QualityLayer\qualitylayer-cli.exe"));
        }
    } else {
        places.push(PathBuf::from("/usr/bin/qualitylayer-cli"));
        places.push(PathBuf::from("/opt/QualityLayer/qualitylayer-cli"));
    }
    places
}

/// The CLI app.json names, or, when app.json is gone or names a CLI that is not there, the first
/// standard install place that holds one. The launcher writes no file: the App writes app.json
/// again the next time it opens.
fn find_cli(pointer: &Path) -> Result<PathBuf, PathBuf> {
    let named = fs::read_to_string(pointer)
        .ok()
        .and_then(|text| parse_cli(&text))
        .map(PathBuf::from);
    if let Some(cli) = named.as_ref().filter(|cli| cli.is_file()) {
        return Ok(cli.clone());
    }
    standard_places()
        .into_iter()
        .find(|place| place.is_file())
        .ok_or_else(|| named.unwrap_or_else(|| pointer.to_path_buf()))
}

fn main() {
    private_files();
    let Some(home) = quality_layer_home() else {
        if is_hook_call() {
            hook_stays_silent(None, "", Path::new(""))
        }
        say_err!("qualitylayer: no home directory to find the QualityLayer App from");
        exit(127)
    };
    // The CLI may be mid-replacement: while the App updates, a call starts only afterwards.
    wait_while_updating(&update_lock::path(&home));
    match find_cli(&home.join("app.json")) {
        Ok(cli) => forward(&home, &cli),
        Err(missing) => not_found(Some(&home), &missing),
    }
}

/// Hold the call back while the updater's lock is live, for at most the lock's own lifetime.
fn wait_while_updating(lock: &Path) {
    let started = Instant::now();
    let mut told = false;
    while update_lock::is_live_file(lock) && started.elapsed() < update_lock::MAX_AGE {
        if !told {
            say_err!("QualityLayer is updating, continuing in a moment");
            told = true;
        }
        thread::sleep(Duration::from_millis(250));
    }
}

#[cfg(test)]
mod tests {
    use super::parse_cli;

    #[test]
    fn reads_the_cli_whatever_the_key_order_and_spacing() {
        let json = "{\n  \"version\" : \"12.2.0\",\n  \"cli\" :  \"/Apps/QualityLayer.app/Contents/MacOS/qualitylayer-cli\"\n}";
        assert_eq!(
            parse_cli(json).as_deref(),
            Some("/Apps/QualityLayer.app/Contents/MacOS/qualitylayer-cli")
        );
    }

    #[test]
    fn unescapes_a_windows_path() {
        let json = r#"{"cli": "C:\\Users\\Zoë\\AppData\\qualitylayer-cli.exe", "version": "1"}"#;
        assert_eq!(
            parse_cli(json).as_deref(),
            Some(r"C:\Users\Zoë\AppData\qualitylayer-cli.exe")
        );
        assert_eq!(
            parse_cli(r#"{"cli": "/a/\u00e9/\ud83d\ude00"}"#).as_deref(),
            Some("/a/é/😀")
        );
    }

    #[test]
    fn ignores_a_cli_that_is_not_the_top_level_key() {
        assert_eq!(parse_cli(r#"{"other": {"cli": "/nested"}}"#), None);
        assert_eq!(parse_cli(r#"{"version": "cli"}"#), None);
        assert_eq!(parse_cli("not json"), None);
    }
}
