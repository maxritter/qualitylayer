//! The launcher through its public entry point: the built binary, an app.json, and a CLI that
//! says how it was called. Each test is a plausible wrong launcher it rejects.

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Command, Output, Stdio};

struct World {
    root: PathBuf,
    home: PathBuf,
}

impl World {
    fn new(name: &str) -> World {
        let root = std::env::temp_dir().join(format!("ql-launcher-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        let home = root.join("ql-home");
        fs::create_dir_all(&home).unwrap();
        World { root, home }
    }

    /// app.json naming the echo CLI, as `install --app` writes it.
    fn point_at_echo(&self) {
        let cli = echo_cli();
        let json = json_string(&cli.to_string_lossy());
        fs::write(
            self.home.join("app.json"),
            format!("{{\"cli\": {json}, \"version\": \"12.0.0\"}}"),
        )
        .unwrap();
    }

    fn launcher(&self) -> Command {
        let mut command = Command::new(env!("CARGO_BIN_EXE_qualitylayer-launcher"));
        command.env("QUALITYLAYER_HOME", &self.home);
        // The standard install places are this world's own, empty unless a test fills them: a
        // development machine's installed App is never found.
        command.env("QUALITYLAYER_APP_SEARCH", self.root.join("no-app"));
        command
    }
}

impl Drop for World {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.root);
    }
}

/// A JSON string for `text`, escaping what a Windows path carries.
fn json_string(text: &str) -> String {
    format!("\"{}\"", text.replace('\\', "\\\\").replace('"', "\\\""))
}

/// The echo example, built next to the test binaries by `cargo test`.
fn echo_cli() -> PathBuf {
    let deps = std::env::current_exe()
        .unwrap()
        .parent()
        .unwrap()
        .to_path_buf();
    deps.parent()
        .unwrap()
        .join("examples")
        .join(format!("echo_cli{}", std::env::consts::EXE_SUFFIX))
}

fn run(mut command: Command, input: &[u8]) -> Output {
    let mut child = command
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    child.stdin.take().unwrap().write_all(input).unwrap();
    child.wait_with_output().unwrap()
}

fn listing(dir: &Path) -> Vec<String> {
    let mut names = Vec::new();
    let mut stack = vec![dir.to_path_buf()];
    while let Some(next) = stack.pop() {
        for entry in fs::read_dir(&next).unwrap() {
            let path = entry.unwrap().path();
            names.push(path.display().to_string());
            if path.is_dir() {
                stack.push(path);
            }
        }
    }
    names.sort();
    names
}

#[test]
fn arguments_input_and_exit_code_arrive_unchanged() {
    let world = World::new("forward");
    world.point_at_echo();
    let mut command = world.launcher();
    command
        .args(["next", "two words", "say \"hi\"", "it's", "ünï ✓", ""])
        .env("QL_ECHO_EXIT", "7");
    let input = "héllo ✓ wörld\r\nsecond line".as_bytes();

    let out = run(command, input);

    assert_eq!(out.status.code(), Some(7));
    let stdout = String::from_utf8(out.stdout).unwrap();
    let wanted = [
        "arg:next",
        "arg:two words",
        "arg:say \"hi\"",
        "arg:it's",
        "arg:ünï ✓",
        "arg:",
    ];
    assert!(stdout.starts_with(&wanted.join("\n")), "{stdout}");
    assert!(
        stdout.ends_with("stdin:héllo ✓ wörld\r\nsecond line"),
        "{stdout}"
    );
    assert_eq!(String::from_utf8(out.stderr).unwrap(), "echo-err");
}

#[test]
fn the_working_directory_and_environment_are_the_callers() {
    let world = World::new("cwd");
    world.point_at_echo();
    let mut command = world.launcher();
    command.current_dir(&world.root).env("QL_ECHO_VAR", "kept");

    let stdout = String::from_utf8(run(command, b"").stdout).unwrap();

    let here = fs::canonicalize(&world.root).unwrap();
    let reported = stdout.lines().find_map(|l| l.strip_prefix("cwd:")).unwrap();
    assert_eq!(fs::canonicalize(reported).unwrap(), here);
    assert!(stdout.contains("env:kept"), "{stdout}");
}

#[test]
fn runtime_switches_are_removed_before_the_cli_starts() {
    let world = World::new("runtime-environment");
    world.point_at_echo();
    for name in [
        "BUN_OPTIONS",
        "BUN_BE_BUN",
        "BUN_INSPECT",
        "BUN_INSPECT_CONNECT_TO",
        "BUN_JSC_useDollarVM",
        "NODE_OPTIONS",
        "DYLD_INSERT_LIBRARIES",
        "LD_PRELOAD",
    ] {
        // Empty loader variables are observable without loading code into the Rust fixture.
        let value = if matches!(name, "DYLD_INSERT_LIBRARIES" | "LD_PRELOAD") {
            ""
        } else {
            "injection-switch"
        };
        let mut command = world.launcher();
        command
            .env(name, value)
            .env("QL_ECHO_READ_ENV", name)
            .env("QL_ECHO_VAR", "kept");
        let out = run(command, b"payload");
        assert!(out.status.success());
        let stdout = String::from_utf8(out.stdout).unwrap();
        assert!(stdout.contains("read-env:None\n"), "{name}: {stdout}");
        assert!(stdout.ends_with("env:kept\nstdin:payload"), "{stdout}");
    }
    // The fixture detects an unfiltered environment: absence cannot pass by construction.
    let mut control = Command::new(echo_cli());
    control
        .env("BUN_OPTIONS", "injection-switch")
        .env("QL_ECHO_READ_ENV", "BUN_OPTIONS");
    let stdout = String::from_utf8(run(control, b"").stdout).unwrap();
    assert!(
        stdout.contains("read-env:Some(\"injection-switch\")"),
        "{stdout}"
    );
}

#[test]
fn colour_preferences_are_forwarded_without_conflicting_switches() {
    let world = World::new("colour-environment");
    world.point_at_echo();
    for force in [None, Some(""), Some("0"), Some("1")] {
        let mut command = world.launcher();
        command
            .env_remove("FORCE_COLOR")
            .env("NO_COLOR", "1")
            .env("QL_ECHO_READ_ENV", "NO_COLOR");
        if let Some(value) = force {
            command.env("FORCE_COLOR", value);
        }
        let out = run(command, b"");
        assert!(out.status.success());
        let stdout = String::from_utf8(out.stdout).unwrap();
        let expected = if matches!(force, Some("0" | "1")) {
            "read-env:None"
        } else {
            "read-env:Some(\"1\")"
        };
        assert!(stdout.contains(expected), "{force:?}: {stdout}");
    }
}

#[test]
fn input_bytes_that_are_not_text_pass_through() {
    let world = World::new("bytes");
    world.point_at_echo();

    let out = run(world.launcher(), &[0xff, 0x00, 0xfe, b'\n']);

    assert!(out.stdout.ends_with(&[b':', 0xff, 0x00, 0xfe, b'\n']));
}

#[test]
fn without_quality_layer_home_the_home_directory_is_used() {
    let world = World::new("home");
    let dot = world.root.join(".qualitylayer");
    fs::create_dir_all(&dot).unwrap();
    let cli = json_string(&echo_cli().to_string_lossy());
    fs::write(dot.join("app.json"), format!("{{\"cli\": {cli}}}")).unwrap();
    let mut command = Command::new(env!("CARGO_BIN_EXE_qualitylayer-launcher"));
    command
        .env_remove("QUALITYLAYER_HOME")
        .env("HOME", &world.root)
        .env("USERPROFILE", &world.root);

    let out = run(command, b"");

    assert_eq!(out.status.code(), Some(0));
    assert!(String::from_utf8(out.stdout).unwrap().contains("stdin:"));
}

#[test]
fn a_missing_app_json_says_how_to_repair_it() {
    let world = World::new("nopointer");
    let out = run(world.launcher(), b"");

    assert_eq!(out.status.code(), Some(127));
    let pointer = world.home.join("app.json");
    assert_eq!(
        String::from_utf8(out.stderr).unwrap().trim_end(),
        format!(
            "qualitylayer: the QualityLayer App was not found at {}. Open the App once to repair this.",
            pointer.display()
        )
    );
}

#[test]
fn without_app_json_the_app_in_its_standard_place_answers_and_nothing_is_written() {
    let world = World::new("standardplace");
    let mut command = world.launcher();
    command
        .env("QUALITYLAYER_APP_SEARCH", echo_cli())
        .arg("status");
    let before = listing(&world.home);

    let out = run(command, b"");

    assert_eq!(
        out.status.code(),
        Some(0),
        "{:?}",
        String::from_utf8_lossy(&out.stderr)
    );
    assert!(String::from_utf8_lossy(&out.stdout).contains("status"));
    assert_eq!(listing(&world.home), before);
}

#[test]
fn a_cli_that_is_not_a_file_says_the_same() {
    let world = World::new("nocli");
    let missing = world.root.join("gone").join("qualitylayer-cli");
    fs::write(
        world.home.join("app.json"),
        format!("{{\"cli\": {}}}", json_string(&missing.to_string_lossy())),
    )
    .unwrap();

    let out = run(world.launcher(), b"");

    assert_eq!(out.status.code(), Some(127));
    let message = String::from_utf8(out.stderr).unwrap();
    assert!(
        message.starts_with("qualitylayer: the QualityLayer App was not found at "),
        "{message}"
    );
    assert!(
        message.contains(&missing.display().to_string()),
        "{message}"
    );
}

#[test]
fn a_call_writes_nothing() {
    let world = World::new("nowrite");
    world.point_at_echo();
    let before = listing(&world.root);
    run(world.launcher(), b"input");
    assert_eq!(listing(&world.root), before);

    // The repair message path writes nothing either.
    fs::remove_file(world.home.join("app.json")).unwrap();
    let before = listing(&world.root);
    run(world.launcher(), b"");
    assert_eq!(listing(&world.root), before);
}

const NOTICE: &str = "QualityLayer is updating, continuing in a moment";

/// Hold the update lock the way the App's updater does: the holder's pid, written now.
fn hold_lock(world: &World, pid: u32) -> PathBuf {
    let lock = world.home.join("update.lock");
    fs::write(&lock, pid.to_string()).unwrap();
    lock
}

/// The pid of a process that has already ended.
fn dead_pid() -> u32 {
    let mut child = Command::new(echo_cli())
        .stdin(Stdio::null())
        .spawn()
        .unwrap();
    let pid = child.id();
    child.wait().unwrap();
    pid
}

#[test]
fn a_live_update_lock_holds_a_call_back_until_it_is_released() {
    use std::io::{BufRead, BufReader};
    let world = World::new("locked");
    world.point_at_echo();
    let lock = hold_lock(&world, std::process::id());
    let mut child = world
        .launcher()
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    let mut stderr = BufReader::new(child.stderr.take().unwrap());

    // The notice arrives while the lock is held, and the call has not run.
    let mut notice = String::new();
    stderr.read_line(&mut notice).unwrap();
    assert_eq!(notice.trim_end(), NOTICE);
    assert!(child.try_wait().unwrap().is_none());
    fs::remove_file(&lock).unwrap();

    let mut rest = String::new();
    std::io::Read::read_to_string(&mut stderr, &mut rest).unwrap();
    let out = child.wait_with_output().unwrap();
    assert_eq!(out.status.code(), Some(0));
    assert!(String::from_utf8(out.stdout).unwrap().contains("stdin:"));
    // Once: the notice is not repeated while the call waits, and the CLI's own stderr follows.
    assert_eq!(rest, "echo-err");
}

#[test]
fn a_stale_update_lock_does_not_make_a_call_wait() {
    let world = World::new("stale");
    world.point_at_echo();

    // The holder is gone.
    hold_lock(&world, dead_pid());
    let out = run(world.launcher(), b"");
    assert_eq!(String::from_utf8(out.stderr).unwrap(), "echo-err");

    // The holder runs but the lock is older than ten minutes.
    let lock = hold_lock(&world, std::process::id());
    let old = std::time::SystemTime::now() - std::time::Duration::from_secs(11 * 60);
    fs::File::options()
        .write(true)
        .open(&lock)
        .unwrap()
        .set_modified(old)
        .unwrap();
    let out = run(world.launcher(), b"");
    assert_eq!(String::from_utf8(out.stderr).unwrap(), "echo-err");

    // A lock the launcher cannot read the pid of is not live either.
    fs::write(&lock, "not a pid").unwrap();
    let out = run(world.launcher(), b"");
    assert_eq!(String::from_utf8(out.stderr).unwrap(), "echo-err");
    // None of this deleted the lock: that is the updater's job.
    assert!(lock.exists());
}

// ---------------------------------------------------------------- hooks never stand in the way

const PROBLEM_FILE: &str = "launcher-problem.json";

fn today() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs()
        / 86_400
}

fn point_at(world: &World, cli: &Path) {
    fs::write(
        world.home.join("app.json"),
        format!("{{\"cli\": {}}}", json_string(&cli.to_string_lossy())),
    )
    .unwrap();
}

/// A hook the agent runs when the App's command line is gone: nothing on either stream and exit 0,
/// so the agent shows no "hook error" for it; the problem is written down for the person instead.
#[test]
fn a_hook_without_the_app_is_silent_and_says_so_in_a_file() {
    let world = World::new("hook-gone");
    let missing = world.root.join("gone").join("qualitylayer-cli.exe");
    point_at(&world, &missing);
    let mut command = world.launcher();
    command.args(["hook", "activity"]);

    let out = run(command, br#"{"session_id":"s"}"#);

    assert_eq!(out.status.code(), Some(0));
    assert!(out.stdout.is_empty(), "{:?}", out.stdout);
    assert!(out.stderr.is_empty(), "{:?}", out.stderr);
    let note = fs::read_to_string(world.home.join(PROBLEM_FILE)).unwrap();
    assert!(note.contains("\"day\":"), "{note}");
    assert!(note.contains("was not found"), "{note}");
    assert!(
        note.contains(&json_string(&missing.to_string_lossy())),
        "{note}"
    );
    assert!(note.contains("\"call\":\"hook activity\""), "{note}");
}

#[test]
fn every_hook_event_is_silent_when_app_json_is_missing_too() {
    let world = World::new("hook-nopointer");
    for sub in ["prompt", "activity", "ask", "live", "stop"] {
        let mut command = world.launcher();
        command.args(["hook", sub]);
        let out = run(command, b"{}");
        assert_eq!(out.status.code(), Some(0), "hook {sub}");
        assert!(out.stdout.is_empty() && out.stderr.is_empty(), "hook {sub}");
    }
}

/// The peers board's session start hook is an agent's hook too: Codex shows "Hook failed" for it
/// when it exits 127 (2026-10-12), so it is silent and exits 0 like the rest.
#[test]
fn the_peers_session_hook_is_silent_without_the_app_but_other_peers_calls_are_not() {
    let world = World::new("hook-peers");
    let mut hook = world.launcher();
    hook.args(["peers", "session-hook", "--source", "codex"]);
    let out = run(hook, b"{}");
    assert_eq!(out.status.code(), Some(0));
    assert!(out.stdout.is_empty() && out.stderr.is_empty());
    let mut typed = world.launcher();
    typed.args(["peers", "list"]);
    assert_eq!(run(typed, b"").status.code(), Some(127));
}

#[test]
fn the_problem_is_written_down_once_a_day() {
    let world = World::new("hook-daily");
    let file = world.home.join(PROBLEM_FILE);
    let hook = |world: &World| {
        let mut command = world.launcher();
        command.args(["hook", "activity"]);
        run(command, b"{}")
    };

    // Written today: the second call leaves the file as it is.
    hook(&world);
    let first = fs::read_to_string(&file).unwrap();
    fs::write(
        &file,
        first.replace("\"call\":\"hook activity\"", "\"call\":\"kept\""),
    )
    .unwrap();
    hook(&world);
    assert!(fs::read_to_string(&file).unwrap().contains("\"kept\""));

    // Written yesterday: the next call records it again.
    let yesterday = today() - 1;
    fs::write(
        &file,
        format!(
            "{{\"day\":{yesterday},\"at\":0,\"reason\":\"old\",\"path\":\"x\",\"call\":\"kept\"}}"
        ),
    )
    .unwrap();
    hook(&world);
    let now = fs::read_to_string(&file).unwrap();
    assert!(now.contains(&format!("\"day\":{}", today())), "{now}");
    assert!(!now.contains("\"old\""), "{now}");
}

#[test]
fn a_hook_never_creates_the_home_it_writes_into() {
    let world = World::new("hook-nohome");
    fs::remove_dir_all(&world.home).unwrap();
    let mut command = world.launcher();
    command.args(["hook", "activity"]);

    let out = run(command, b"{}");

    assert_eq!(out.status.code(), Some(0));
    assert!(out.stdout.is_empty() && out.stderr.is_empty());
    assert!(!world.home.exists());
}

/// A person typing `qualitylayer ...` is told what is wrong, with a failing exit code, and the
/// launcher still writes nothing.
#[test]
fn a_typed_command_keeps_the_repair_message_and_exit_code() {
    let world = World::new("typed");
    let missing = world.root.join("gone").join("qualitylayer-cli.exe");
    point_at(&world, &missing);
    for args in [vec!["status"], vec![], vec!["next", "hook"], vec!["hooks"]] {
        let mut command = world.launcher();
        command.args(&args);
        let out = run(command, b"");
        assert_eq!(out.status.code(), Some(127), "{args:?}");
        let message = String::from_utf8(out.stderr).unwrap();
        assert!(
            message.starts_with("qualitylayer: the QualityLayer App was not found at "),
            "{args:?}: {message}"
        );
        assert!(
            message.contains("Open the App once to repair this."),
            "{message}"
        );
        assert!(!world.home.join(PROBLEM_FILE).exists(), "{args:?}");
    }
}

/// With the CLI in place a hook is forwarded like every other call: its output and exit code count.
#[test]
fn a_hook_with_the_cli_present_is_forwarded_unchanged() {
    let world = World::new("hook-forward");
    world.point_at_echo();
    let mut command = world.launcher();
    command.args(["hook", "prompt"]).env("QL_ECHO_EXIT", "3");

    let out = run(command, b"{\"prompt\":\"x\"}");

    assert_eq!(out.status.code(), Some(3));
    let stdout = String::from_utf8(out.stdout).unwrap();
    assert!(stdout.starts_with("arg:hook\narg:prompt\n"), "{stdout}");
    assert!(!world.home.join(PROBLEM_FILE).exists());
}

/// The agent writes its JSON to a hook's input; a hook that exits before reading it would hand the
/// agent a broken pipe, so the launcher reads the input to the end first.
#[test]
fn a_silent_hook_still_takes_the_agents_whole_input() {
    let world = World::new("hook-drain");
    let big = vec![b'x'; 4 * 1024 * 1024];
    let mut command = world.launcher();
    command.args(["hook", "activity"]);

    let out = run(command, &big);

    assert_eq!(out.status.code(), Some(0));
}

/// A CLI that is there but cannot be started (blocked, no permission) is no different for a hook.
#[cfg(unix)]
#[test]
fn a_hook_whose_cli_cannot_start_is_silent_and_a_typed_command_says_why() {
    use std::os::unix::fs::PermissionsExt;
    let world = World::new("hook-blocked");
    let cli = world.root.join("qualitylayer-cli");
    fs::write(&cli, "#!/bin/sh\n").unwrap();
    fs::set_permissions(&cli, fs::Permissions::from_mode(0o644)).unwrap();
    point_at(&world, &cli);

    let mut hook = world.launcher();
    hook.args(["hook", "live"]);
    let out = run(hook, b"{}");
    assert_eq!(out.status.code(), Some(0));
    assert!(out.stdout.is_empty() && out.stderr.is_empty());
    let note = fs::read_to_string(world.home.join(PROBLEM_FILE)).unwrap();
    assert!(note.contains("could not be started"), "{note}");

    let mut typed = world.launcher();
    typed.arg("status");
    let out = run(typed, b"");
    assert_eq!(out.status.code(), Some(126));
    assert!(String::from_utf8(out.stderr)
        .unwrap()
        .contains("cannot run"));
}

/// A Windows installer handover lock (`handover`) holds CLI calls back until the new App removes it.
#[test]
fn a_handover_update_lock_holds_a_call_back_until_it_is_released() {
    let world = World::new("handover-lock");
    world.point_at_echo();
    let lock = world.home.join("update.lock");
    fs::write(&lock, "handover").unwrap();
    let releaser = lock.clone();
    let release = std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_millis(350));
        let _ = fs::remove_file(releaser);
    });

    let started = std::time::Instant::now();
    let mut command = world.launcher();
    command.arg("status");
    let out = run(command, b"");
    release.join().unwrap();

    assert_eq!(out.status.code(), Some(0));
    assert!(started.elapsed() >= std::time::Duration::from_millis(250));
    assert!(String::from_utf8(out.stderr)
        .unwrap()
        .contains("QualityLayer is updating"));
    assert!(String::from_utf8(out.stdout)
        .unwrap()
        .contains("arg:status"));
}
