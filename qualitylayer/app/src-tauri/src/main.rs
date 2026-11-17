//! The QualityLayer App: a window over the local review server. It never owns the server or an
//! agent's task: it asks its bundled CLI for the server (`app ensure`) and shows the page.
//! Closing the window leaves the server and agents running; user quit follows the onQuit setting. A
//! `qualitylayer://` link, from the browser, Slack or `--open`, takes the one running App to its
//! place; a second launch hands its link to the first and ends. Closing the window keeps the App in
//! the menu bar or tray, where it tells what waits and notifies when a person can act (a Plan or a
//! review waits, a task stops or ships, an agent asks). Updates keep agents running.
//! Once a day it looks for an update and downloads it; the page installs it.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
// println!/eprintln!/dbg! panic when the stream is closed, and a panic aborts this process: write
// with `say!`/`say_err!` (qualitylayer_launcher::out) instead.
#![deny(clippy::print_stdout, clippy::print_stderr, clippy::dbg_macro)]

mod cli;
mod downloads;
mod external;
mod links;
mod liveness;
mod notify;
mod page;
mod poll;
mod tray;
mod update;
mod update_flow;
mod usage_tray;
mod zoom;

use links::Link;
use qualitylayer_launcher::{private_files, quality_layer_home, say, say_err, update_lock};
use std::path::Path;
use std::sync::atomic::{AtomicBool, AtomicU8, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};
#[cfg(not(target_os = "macos"))]
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::webview::NewWindowResponse;
#[cfg(not(target_os = "macos"))]
use tauri::Wry;
use tauri::{AppHandle, Manager, Url, WebviewUrl, WebviewWindowBuilder, Window, WindowEvent};
use tauri_plugin_deep_link::DeepLinkExt;

/// How long `--self-test` waits for the page before it fails.
const SELF_TEST_SECONDS: u64 = 30;

const EXIT_USER: u8 = 1;
const EXIT_UPDATE: u8 = 2;
const EXIT_FAILURE: u8 = 3;
static EXIT_REASON: AtomicU8 = AtomicU8::new(0);

fn exit_with_reason(app: &AppHandle, code: i32, reason: u8) {
    EXIT_REASON.store(reason, Ordering::SeqCst);
    app.exit(code);
}

fn user_quit(reason: u8) -> bool {
    reason == 0 || reason == EXIT_USER
}

fn quit_stops_runs(home: &Path) -> bool {
    let config = home.join("config.json");
    if std::fs::metadata(&config).map_or(true, |m| m.len() > 64 * 1024) {
        return false;
    }
    std::fs::read(config)
        .ok()
        .and_then(|bytes| serde_json::from_slice::<serde_json::Value>(&bytes).ok())
        .is_some_and(|config| config["onQuit"] == "stop")
}

fn record_quit_failure(home: &Path, message: &str) {
    use std::io::Write;
    let path = home.join("app-quit-failure.json");
    // The CLI's per-run failures are more useful than a second generic native failure.
    if path.exists() {
        return;
    }
    let mut options = std::fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    if let Ok(mut file) = options.open(path) {
        let at = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_or(0, |d| d.as_millis());
        let saved = serde_json::json!({"at":at,"reason":"app-quit","failures":[{"run":"app","message":message.chars().take(4096).collect::<String>()}]});
        let _ = writeln!(file, "{saved}");
    }
}

fn on_exit(reason: u8) {
    downloads::cleanup();
    if !user_quit(reason) {
        return;
    }
    let Some(home) = quality_layer_home() else {
        return;
    };
    if !quit_stops_runs(&home) {
        return;
    }
    if let Err(message) = cli::stop_agent_runs() {
        record_quit_failure(&home, &message);
    }
}

/// The window's title carries the self-test's report out of the page: the page may not call native
/// commands, and a title change is all it can say. Runs in the server's page only. Once the page
/// has rendered, every later change of its place is reported too (`--wait-for-link` waits for one).
const SELF_TEST_SCRIPT: &str = r#"
(() => {
  if (location.protocol !== "http:") return;
  if (new URL(location.href).searchParams.has("tour")) {
    const until = Date.now() + 25000;
    const skip = () => {
      if (!new URL(location.href).searchParams.has("tour")) return;
      const button = document.querySelector('[data-testid="tour"] button.skip');
      if (button && !button.disabled && button.getClientRects().length && getComputedStyle(button).visibility !== "hidden") {
        button.click();
        return;
      }
      if (Date.now() < until) setTimeout(skip, 100);
    };
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", skip, { once: true });
    else skip();
    return;
  }
  const deadline = Date.now() + 25000;
  let shownAt = null;
  let settledPage = null;
  const tasksOnPage = () =>
    [...document.querySelectorAll('[data-testid="task-item"], [data-testid="rail-task"]')].map((item) => (item.dataset.title ?? item.textContent).trim());
  // A machine's page framed by this one (`ui/machines`): choose it, read through the relay what it
  // says waits there (it only says so once it is signed in and rendered), and come back to this
  // computer as Open QualityLayer does. A page without machines reports as it always did.
  let machine = null;
  let machineStep = 0;
  let machineSince = null;
  let machineChosenAt = null;
  // How far a machine's page that stayed silent came, from the marks the page keeps on its frame
  // (`ui/machines/MachineFrames.tsx`): `loaded` its load events, `asked` the times this page asked it
  // what waits, `heard` the messages its window sent, `refused` those of them that were no message of
  // a machine's page and where the last came from. `waitedMs` is how long it was looked at.
  //   loaded 0: its page or something the page needs never finished loading.
  //   loaded, heard 0: the page loaded and its shell never ran: a refused or cut-off answer, a script
  //     that failed, or a page that stands before its shell (no key, no licence).
  //   heard with refused: it spoke and this page did not accept the words (the origin is named).
  //   heard, nothing refused and no count: it spoke, but never of what waits.
  const frameMarks = (frame) => {
    const data = frame ? frame.dataset : {};
    return { loaded: Number(data.loaded || 0), asked: Number(data.asked || 0), heard: Number(data.heard || 0), refused: data.refused || null, waitedMs: machineChosenAt === null ? null : Date.now() - machineChosenAt };
  };
  const machinesRead = () =>
    (typeof performance.getEntriesByType === "function" ? performance.getEntriesByType("resource") : [])
      .some((entry) => entry.responseEnd > 0 && new URL(entry.name, location.href).pathname === "/api/machines");
  const machineOver = () => {
    if (machineStep === 3) return true;
    const frame = document.querySelector('iframe[data-machine]');
    const layer = document.querySelector('[data-testid="machine-frames"]');
    if (machineStep === 0) {
      if (machineSince === null) machineSince = Date.now();
      if (!frame) {
        // Machines that have no page yet: wait while one is still connecting; one that ended
        // otherwise is reported with its state and reason, so a failed connection is not silent.
        const waiting = document.querySelector('[data-testid=machines-waiting]');
        const states = waiting ? (waiting.dataset.states || '') : '';
        if (states.split('|').some((one) => one.split(':')[1] === 'connecting')) return false;
        if (states !== '') {
          machine = { id: states.split(':')[0], needsYou: null, shown: false, back: false, states: states };
          machineStep = 3;
          return true;
        }
        // The list was read and names no machine; an older page never reads one.
        if (machinesRead() || Date.now() - machineSince > 1500) machineStep = 3;
        return machineStep === 3;
      }
      machine = { id: frame.dataset.machine, needsYou: null, shown: false, back: false };
      // Single quotes: a double quote before `#` would end this Rust raw string.
      location.hash = '#/machine/' + machine.id + '/';
      machineStep = 1;
      machineChosenAt = Date.now();
      return false;
    }
    if (machineStep === 1) {
      const count = frame ? frame.dataset.needsYou : undefined;
      if (layer && layer.dataset.chosen === machine.id && count !== undefined) {
        machine.shown = true;
        machine.needsYou = Number(count);
        location.hash = '#/';
        machineStep = 2;
      }
      return false;
    }
    if (!layer || layer.dataset.chosen === undefined) {
      machine.back = true;
      machineStep = 3;
    }
    return machineStep === 3;
  };
  const tick = () => {
    // Rendered: the review UI, or the page a moved Pilot Shell install opens at, drawn outside it.
    const shell = document.querySelector('[data-testid="shell"]');
    const tasks = tasksOnPage();
    // A page that asks for a licence or a fresh link instead of the review UI: say so at once.
    const blocked = document.querySelector('[data-testid="blocked"]');
    if (blocked) {
      document.title = "ql-selftest:" + JSON.stringify({ ready: false, blocked: blocked.textContent.trim(), tasks, hash: location.hash });
      return;
    }
    // The first-start page, once it has read what it found: its text is the report. A window title
    // is cut at 1000 characters, which would leave a report that is no longer JSON, so the report
    // keeps the heading and the start of each step, and stays below that.
    const setup = document.querySelector('[data-testid="setup"][data-ready="true"]');
    if (setup) {
      const words = (text) => text.replace(/\s+/g, " ").trim();
      const agents = setup.querySelector('[data-testid="agents-step"]');
      const checks = [...(agents?.querySelectorAll('[data-agent]') ?? [])];
      const error = agents?.querySelector('[role="alert"]');
      const settled = agents?.querySelector('[aria-busy="false"]') &&
        (error || (checks.length > 0 && checks.every((check) =>
          /: (Available|Not installed|Out of date|Needs attention)[,.]/.test(check.getAttribute('aria-label') ?? ''))));
      if (!settled && Date.now() <= deadline) {
        setTimeout(tick, 100);
        return;
      }
      const steps = [...setup.querySelectorAll(".q-onb-st")].map((step) => {
        if (step === agents && settled && !error) {
          return checks.map((check) => {
            const name = (check.getAttribute('aria-label') ?? '').split(':')[0];
            return words(name + ' ' + (check.getAttribute('data-version') ?? ''));
          }).join(' | ').slice(0, 160);
        }
        return words(step.innerText).slice(0, 160);
      });
      const text = [words(setup.innerText.split("\n")[0]), ...steps].join(" | ").slice(0, 800);
      document.title = "ql-selftest:" + JSON.stringify({ ready: Boolean(settled), tasks, hash: location.hash, setup: text });
      return;
    }
    if (shell && shownAt === null) shownAt = Date.now();
    // Rendered: the shell stands, and the task list has arrived or has stayed empty for a moment.
    let done = shell && (tasks.length > 0 || Date.now() - shownAt > 3000);
    const home = ['', '#', '#/', '#/home'].includes(location.hash);
    if (done && home) {
      const completed = (typeof performance.getEntriesByType === "function" ? performance.getEntriesByType("resource") : [])
        .filter((entry) => entry.responseEnd > 0)
        .map((entry) => {
          const resource = new URL(entry.name, location.href);
          return resource.origin === location.origin ? resource.pathname : "";
        });
      done = ["/api/config", "/api/agent-runs"].every((path) => completed.includes(path));
    }
    if (new URL(location.href).searchParams.has("tour") || document.querySelector('[data-testid="tour"]')) return;
    // A look at a machine that has begun goes on to its end, whatever the page shows meanwhile: the
    // address is the machine's then, not Home, and this computer's list may be out of sight.
    if (machineStep > 0 && machineStep < 3 && Date.now() <= deadline) {
      machineOver();
      setTimeout(tick, 100);
      return;
    }
    if (!done) settledPage = null;
    if (done && home && settledPage !== location.href) {
      settledPage = location.href;
      setTimeout(tick, 100);
      return;
    }
    // Machines are looked at from Home only: a task's own page reports at once, as it always did.
    if (done && home && !machineOver() && Date.now() <= deadline) {
      setTimeout(tick, 100);
      return;
    }
    if (done || Date.now() > deadline) {
      // A machine whose page never said what waits: how far the look at it came.
      // Only once the time is up: on the way (the hash is the machine's, not Home) the report is
      // written too, and the look goes on after it.
      let said = machine;
      if (machine && !machine.back && !machine.states && Date.now() > deadline) {
        const layer = document.querySelector('[data-testid=machine-frames]');
        const frame = document.querySelector('iframe[data-machine]');
        said = { ...machine, stopped: { step: machineStep, chosen: layer ? (layer.dataset.chosen || null) : 'no layer', frame: frame ? frame.getAttribute('src') : null, ...frameMarks(frame), waiting: (document.querySelector('[data-testid=machines-waiting]') || { dataset: {} }).dataset.states || null } };
      }
      document.title = "ql-selftest:" + JSON.stringify({ ready: Boolean(done), tasks, hash: location.hash, ...(said ? { machine: said } : {}) });
      if (done) {
        window.addEventListener("hashchange", () => {
          document.title = "ql-selftest:" + JSON.stringify({ ready: true, tasks: tasksOnPage(), hash: location.hash });
        });
      }
      return;
    }
    setTimeout(tick, 100);
  };
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", tick, { once: true });
  } else {
    tick();
  }
})();
"#;

fn self_test_report_changed(
    report: Option<&serde_json::Value>,
    last_ready_route: &mut Option<String>,
) -> bool {
    let Some(route) = report
        .filter(|value| value["ready"] == true)
        .and_then(|value| value["hash"].as_str())
    else {
        return true;
    };
    let route = match route {
        "" | "#" | "#/" | "#/home" => "#/",
        other => other,
    };
    if last_ready_route.as_deref() == Some(route) {
        return false;
    }
    *last_ready_route = Some(route.to_owned());
    true
}

/// Run in the page once it is back on a restarted server (`--click-step`): click an enabled step tab
/// other than the one that is open, wait until that tab is the selected one, the page's place has
/// moved and its content has stopped changing, and say through the title which step it was, the
/// place it moved from and to, and what the content says. The tabs may draw after the report of the
/// return, so they are looked for until the deadline. A page with no other enabled step by then says
/// `clicked: false`: a click on the tab already open would pass whether or not a click works.
const CLICK_STEP_SCRIPT: &str = r#"
(() => {
  const deadline = Date.now() + 10000;
  const start = location.hash;
  const content = () => (document.querySelector("main")?.innerText ?? "").trim();
  const say = (clicked, step) => {
    document.title = "ql-selftest:" + JSON.stringify({
      ready: true, clicked, step, from: start, hash: location.hash, text: content().slice(0, 600),
    });
  };
  const tabs = () =>
    [...document.querySelectorAll('[data-testid="step-tabs-row"] [role="tab"]')].filter(
      (tab) => tab.getAttribute("aria-disabled") !== "true" && tab.getAttribute("aria-selected") !== "true",
    );
  let target = null;
  let last = null;
  let steady = 0;
  const tick = () => {
    if (target === null) {
      target = tabs()[0] ?? null;
      target?.click();
    } else if (target.getAttribute("aria-selected") === "true" && location.hash !== start && content() !== "") {
      // The content has to stay the same for three looks: a page still loading is not the step shown.
      steady = content() === last ? steady + 1 : 0;
      last = content();
      if (steady >= 3) return say(true, target.textContent.trim());
    }
    if (Date.now() > deadline) return say(false, target ? target.textContent.trim() : "");
    setTimeout(tick, 100);
  };
  tick();
})();
"#;

/// The hash route a link or a notification named, until the window has been sent there: a link that
/// arrives while the page is still loading is kept here, and the page opens there. Empty is Home.
/// None means no place is named, and a window that is shown again stays where the person left it.
#[derive(Default)]
struct Wanted(Mutex<Option<String>>);

/// How long after a notification the App still takes the App being opened again (macOS: a click on
/// the notification; Windows and Linux: a click on one that has left the screen, which starts the
/// program again) to the place the notification named.
const NOTICE_CLICK_SECONDS: u64 = 300;

/// Where the latest notification led, and when it was shown.
#[derive(Default)]
struct Notified(Mutex<Option<(String, Instant)>>);

/// The place of a notification shown `elapsed` ago, while a click on it still counts.
fn place_of_recent(notified: Option<(String, Duration)>) -> Option<String> {
    notified
        .filter(|(_, elapsed)| *elapsed < Duration::from_secs(NOTICE_CLICK_SECONDS))
        .map(|(route, _)| route)
}

/// The place of the latest notification if it is recent, used up by this look.
fn take_recent_notice(app: &AppHandle) -> Option<String> {
    let notified = app.state::<Notified>().0.lock().unwrap().take();
    place_of_recent(notified.map(|(route, at)| (route, at.elapsed())))
}

/// What the tray menu says now, so a menu is built again only when a line changed: what waits (from
/// the last poll), the line about the system's notification switch, and where each line leads.
#[derive(Default)]
struct TrayState {
    summary: Mutex<poll::Summary>,
    /// The notification line, in the menu only while the system has something to ask or point to.
    notify: Mutex<Option<notify::TrayItem>>,
    /// Where the lines of the last menu lead, by position: the ids of its items are `line-<n>`.
    targets: Mutex<Vec<tray::Target>>,
    built: Mutex<Option<(Vec<tray::Line>, Option<notify::TrayItem>)>>,
}

/// The running App, for the parts that tell the tray something from a thread of their own (the
/// update sequence, when `update.json` changes).
static APP: OnceLock<AppHandle> = OnceLock::new();

/// Whether the native tray was built.
#[derive(Default)]
struct TrayUp(AtomicBool);

struct Options {
    self_test: bool,
    lifecycle_test: Option<String>,
    /// With `--self-test`: report once rendered, then wait for a link to move the window and report
    /// again before ending.
    wait_for_link: bool,
    /// With `--self-test`: watch the server as the real App does (`liveness.rs`), so that a server
    /// killed under the window is started again and the window comes back to the same page.
    watch_server: bool,
    /// With `--self-test --wait-for-link`: once the window has come back after the server was
    /// started again, click a step on the page and report whether it rendered.
    click_step: bool,
    /// With `--self-test --watch-server`: also run the poll of the server and the update watch, the
    /// loops a real App runs while it idles.
    background: bool,
    open: Option<String>,
    /// `--update`: check for an update, ask, install, start the new App, and end. No window.
    update: bool,
    /// The arguments the App starts with after an update: these, without `--update`.
    relaunch: Vec<String>,
    /// `--quit`: the running App does what its tray's Quit does; with none running, nothing starts.
    quit: bool,
}

fn options() -> Options {
    let mut args = std::env::args().skip(1);
    let mut options = Options {
        self_test: false,
        lifecycle_test: None,
        wait_for_link: false,
        watch_server: false,
        click_step: false,
        background: false,
        open: None,
        update: false,
        relaunch: Vec::new(),
        quit: false,
    };
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--self-test" => options.self_test = true,
            "--self-test-lifecycle" => {
                options.lifecycle_test = args.next();
            }
            "--wait-for-link" => options.wait_for_link = true,
            "--watch-server" => options.watch_server = true,
            "--click-step" => options.click_step = true,
            "--background" => options.background = true,
            "--quit" => options.quit = true,
            "--open" => {
                options.open = args.next();
                options.relaunch.push(arg);
                options.relaunch.extend(options.open.clone());
                continue;
            }
            "--update" => {
                options.update = true;
                continue;
            }
            _ => {}
        }
        options.relaunch.push(arg);
    }
    options
}

/// The hash a link takes the window to; empty is the home page, none is the update link.
fn hash_of(link: &str) -> Option<String> {
    match links::parse(link) {
        Link::Route(hash) => Some(hash),
        Link::Home => Some(String::new()),
        Link::Update => None,
    }
}

/// Where a start with no link of its own goes: the setup page until `install --app` has run (it writes `app.json`),
/// else nowhere in particular (empty: the page the person left off at).
fn first_route(home: &Path) -> &'static str {
    if !home.join("app.json").is_file() {
        "#/setup"
    } else {
        ""
    }
}

/// Where the first load of the page goes: to the place a link named, which is then forgotten, else
/// to `first`, where the install still needs the person.
fn start_route(wanted: &mut Option<String>, first: &str) -> String {
    match wanted.take() {
        Some(route) if !route.is_empty() => route,
        _ => first.to_string(),
    }
}

/// The page's fragment a window that is brought forward is sent to, if any. `named` is the place a
/// link or a notification just named (empty is Home); `wanted` also keeps one that came while the
/// page was still loading. A named place is used once, as the window is sent there: after that, a
/// plain reopen (the Dock, the tray's "Open QualityLayer") sends it nowhere and the page stays where
/// the person left it. Until `page_up`, the page is not the server's yet and `open_window` takes the
/// place instead.
fn fragment_to_show(
    wanted: &mut Option<String>,
    named: Option<&str>,
    page_up: bool,
) -> Option<String> {
    if let Some(place) = named {
        *wanted = Some(place.to_string());
    }
    if !page_up {
        return None;
    }
    wanted.take().map(|place| {
        // Home is the route `#/`: dropping the fragment alone leaves the page where it was.
        let route = place.trim_start_matches('#');
        if route.is_empty() { "/" } else { route }.to_string()
    })
}

/// The address the window opens: the server's page (which signs the window in), with `?updated=`
/// when this start has just updated the App, then the place.
fn page_address(base: &str, route: &str, updated: Option<&str>) -> Result<Url, String> {
    let mut url = Url::parse(base).map_err(|error| format!("bad page address: {error}"))?;
    if let Some(version) = updated {
        url.query_pairs_mut().append_pair("updated", version);
    }
    // The place is the fragment: `route` is empty or `#/…`.
    url.set_fragment(Some(route.trim_start_matches('#')).filter(|route| !route.is_empty()));
    Ok(url)
}

/// What a link or a notification named between `start_route` taking the place and the server's page
/// replacing the loading page: the place to go to now that the page is up, which is then forgotten.
fn settle_after_navigation(wanted: &mut Option<String>) -> Option<String> {
    fragment_to_show(wanted, None, true)
}

/// Start the server through the CLI, then take the window there; with `watch`, the tray starts
/// looking at what waits and the updates are looked after. `updated` is the version this start has
/// just updated to, which the page says once. Runs off the main thread: the CLI call may wait for
/// the server to come up.
fn open_window(
    app: AppHandle,
    watch: bool,
    watch_server: bool,
    background: bool,
    updated: Option<String>,
) {
    let ensured = match cli::ensure() {
        Ok(ensured) => ensured,
        Err(reason) => return fail(&app, &reason),
    };
    // The window may go to this server, and to no other address of this machine.
    external::allow_port(ensured.port);
    let first = quality_layer_home().map_or("", |home| first_route(&home));
    let route = start_route(&mut app.state::<Wanted>().0.lock().unwrap(), first);
    let url = match page_address(&ensured.url, &route, updated.as_deref()) {
        Ok(url) => url,
        Err(reason) => return fail(&app, &reason),
    };
    if let Some(window) = app.get_webview_window("main") {
        if let Err(error) = window.navigate(url.clone()) {
            return fail(&app, &format!("cannot show the page: {error}"));
        }
        // A link that came after the place was taken above, while the loading page was still the
        // window's, was kept for a page that was not up: it is this page's now, once, and not a
        // place that a plain reopen would go to later.
        let late = settle_after_navigation(&mut app.state::<Wanted>().0.lock().unwrap());
        if let Some(fragment) = late {
            let mut place = url;
            place.set_fragment(Some(&fragment));
            if let Err(error) = window.navigate(place) {
                return fail(&app, &format!("cannot show the page: {error}"));
            }
        }
    }
    let (handover, started) = std::sync::mpsc::channel();
    if watch || watch_server {
        liveness::start(app.clone(), &ensured, handover);
    }
    if watch {
        ask_first_start(app.clone());
    }
    // `--background` runs the same two loops in a self-test, which has no tray and never asks the
    // system for notifications: the idle proof then covers the poll and the update watch too.
    if watch || background {
        update::watch(app.clone());
        zoom::watch(app.clone());
        keep_watch(app, ensured.server(), started);
    }
}

/// What the tray menu says waits, and the notifications for what is new. The first poll only
/// learns what already waits; a server the watch (`liveness.rs`) started again comes in over
/// `started` and is read from the next round on.
fn keep_watch(
    app: AppHandle,
    first: poll::Server,
    started: std::sync::mpsc::Receiver<poll::Server>,
) {
    std::thread::spawn(move || {
        let mut server = Some(first);
        let mut seen = poll::Seen::default();
        loop {
            while let Ok(replacement) = started.try_recv() {
                server = Some(replacement);
            }
            let (next, news, summary) = poll::round(server.take(), &mut seen);
            server = next;
            // A server that was started again may answer on another port: the window may follow it.
            if let Some(server) = &server {
                external::allow_port(server.port);
                #[cfg(target_os = "macos")]
                usage_tray::update(&app, server);
            }
            for notice in &news {
                announce(&app, notice);
            }
            if let Some(summary) = summary {
                show_waiting(&app, &summary);
            }
            // The person may change the switch in the system's settings at any time.
            refresh_notify(&app);
            std::thread::sleep(poll::INTERVAL);
        }
    });
}

/// A native notification; a click on it brings the window to the place it names. On macOS the click
/// arrives as the App being opened again (`reopened`); on Windows and Linux it calls back here.
fn announce(app: &AppHandle, notice: &poll::Notice) {
    let focused = app
        .get_webview_window("main")
        .is_some_and(|window| window.is_focused().unwrap_or(false));
    let Some(home) = quality_layer_home() else {
        return;
    };
    if !poll::should_announce(&home, &notice.key, focused) {
        return;
    }
    *app.state::<Notified>().0.lock().unwrap() = Some((notice.route.clone(), Instant::now()));
    poll::record(notice);
    let (handle, route) = (app.clone(), notice.route.clone());
    notify::deliver(app, &notice.title, &notice.body, move || {
        // The click is answered here: a later plain reopen is not another one.
        handle.state::<Notified>().0.lock().unwrap().take();
        show(&handle, Some(&route))
    });
}

/// What the page said through its title (`page.rs`): its own title and the dock badge, or a
/// notification of the live status, shown natively. The window keeps the page's plain title, never
/// the message.
fn heard(app: &AppHandle, window: &tauri::WebviewWindow, title: &str) {
    match page::read(title) {
        Some(page::Said::Title { title, badge }) => {
            let _ = window.set_title(&title);
            // Windows has no badge count; the title says the same there.
            let _ = window.set_badge_count(badge);
        }
        Some(page::Said::Notify(notices)) => {
            for notice in notices {
                if notice.silent {
                    if let Some(home) = quality_layer_home() {
                        poll::remember(&home, &notice.key);
                    }
                    continue;
                }
                announce(
                    app,
                    &poll::Notice {
                        key: notice.key,
                        title: notice.title,
                        body: notice.body,
                        route: notice.route,
                        switch: poll::Switch::NeedsYou,
                    },
                );
            }
        }
        None => {}
    }
}

/// The first start asks the system for permission to notify, once; a person who has answered is
/// never asked again by the system, so a later start only reads the answer.
fn ask_first_start(app: AppHandle) {
    std::thread::spawn(move || {
        if notify::authorization() == notify::Authorization::NotDetermined {
            notify::request();
        }
        refresh_notify(&app);
    });
}

/// Read the system's notification switch into the tray menu: a line to turn notifications on or to
/// open the system's settings, and none once they are allowed.
fn refresh_notify(app: &AppHandle) {
    let Some(state) = app.try_state::<TrayState>() else {
        return;
    };
    *state.notify.lock().unwrap() = notify::tray_item(notify::authorization());
    rebuild_tray(app);
}

/// The line's own action: ask while the system has not been asked, else open its settings.
fn follow_notify(app: &AppHandle) {
    let app = app.clone();
    std::thread::spawn(move || {
        match notify::authorization() {
            notify::Authorization::NotDetermined => {
                notify::request();
            }
            notify::Authorization::Denied => notify::open_settings(),
            notify::Authorization::Authorized => {}
        }
        refresh_notify(&app);
    });
}

/// Put what waits into the tray menu.
fn show_waiting(app: &AppHandle, summary: &poll::Summary) {
    let Some(state) = app.try_state::<TrayState>() else {
        return;
    };
    *state.summary.lock().unwrap() = summary.clone();
    rebuild_tray(app);
}

/// For the parts that run on threads of their own: `update.json` changed, so the menu may need its
/// "Update ready" line.
pub fn refresh_tray_from_state() {
    if let Some(app) = APP.get() {
        rebuild_tray(app);
    }
}

/// The version that waits to be installed, from `update.json`.
fn update_ready() -> Option<String> {
    update_flow::ready_version(&quality_layer_home()?)
}

/// Build the menu again when a line of it changed: what waits, the notification line, or an update
/// that is ready. A menu that is open is left alone while nothing changes.
fn rebuild_tray(app: &AppHandle) {
    let Some(state) = app.try_state::<TrayState>() else {
        return;
    };
    let lines = tray::lines(&state.summary.lock().unwrap(), update_ready().as_deref());
    let item = *state.notify.lock().unwrap();
    if state.built.lock().unwrap().as_ref() == Some(&(lines.clone(), item)) {
        return;
    }
    #[cfg(target_os = "macos")]
    {
        *state.built.lock().unwrap() = Some((lines, item));
        usage_tray::paint_menu(app);
    }
    #[cfg(not(target_os = "macos"))]
    match build_menu(app, &lines, item) {
        Ok(menu) => {
            *state.targets.lock().unwrap() = lines.iter().map(|line| line.target.clone()).collect();
            if let Some(tray) = app.tray_by_id("main") {
                let _ = tray.set_menu(Some(menu));
                #[cfg(target_os = "macos")]
                usage_tray::paint_menu(app);
            }
            *state.built.lock().unwrap() = Some((lines, item));
        }
        Err(error) => say_err!("QualityLayer: cannot build the tray menu: {error}"),
    }
}

/// The tray menu: the name, a line for each thing that waits (no glyphs), the notification line while
/// the system has something to say about it, and the App's own items.
#[cfg(not(target_os = "macos"))]
fn build_menu(
    app: &AppHandle,
    lines: &[tray::Line],
    notify_item: Option<notify::TrayItem>,
) -> tauri::Result<Menu<Wry>> {
    let item = |id: &str, text: &str, enabled: bool, keys: Option<&str>| {
        MenuItem::with_id(app, id, text, enabled, keys)
    };
    let menu = Menu::new(app)?;
    menu.append(&item("header", "QualityLayer", false, None)?)?;
    for (n, line) in lines.iter().enumerate() {
        let enabled = line.target != tray::Target::Nothing;
        menu.append(&item(&format!("line-{n}"), &line.text, enabled, None)?)?;
    }
    menu.append(&PredefinedMenuItem::separator(app)?)?;
    if let Some(notify_item) = notify_item {
        menu.append(&item("notify", notify_item.label(), true, None)?)?;
    }
    menu.append(&item(
        "open",
        "Open QualityLayer",
        true,
        Some("CmdOrCtrl+O"),
    )?)?;
    menu.append(&item("update", "Check for updates…", true, None)?)?;
    menu.append(&item("settings", "Settings…", true, Some("CmdOrCtrl+,"))?)?;
    menu.append(&PredefinedMenuItem::separator(app)?)?;
    menu.append(&item(
        "quit",
        "Quit QualityLayer",
        true,
        Some("CmdOrCtrl+Q"),
    )?)?;
    Ok(menu)
}

/// The menu bar or tray icon with its menu. The lines about what waits start out as "Nothing waits
/// for you"; the poll fills them.
fn build_tray(app: &tauri::App) -> tauri::Result<TrayState> {
    let handle = app.handle();
    let lines = tray::lines(&poll::Summary::default(), None);
    #[cfg(not(target_os = "macos"))]
    let menu = build_menu(handle, &lines, None)?;
    let mut tray = TrayIconBuilder::with_id("main").tooltip("QualityLayer");
    #[cfg(target_os = "macos")]
    {
        tray = tray.on_tray_icon_event(|tray, event| {
            if matches!(
                event,
                tauri::tray::TrayIconEvent::Click {
                    button: tauri::tray::MouseButton::Left | tauri::tray::MouseButton::Right,
                    button_state: tauri::tray::MouseButtonState::Up,
                    ..
                }
            ) {
                usage_tray::open_menu(tray.app_handle());
            }
        });
    }
    #[cfg(not(target_os = "macos"))]
    {
        tray = tray
            .menu(&menu)
            .on_menu_event(|app, event| follow_menu(app, event.id().as_ref()));
    }
    if let Some(icon) = handle.default_window_icon() {
        tray = tray.icon(icon.clone());
    }
    tray.build(handle)?;
    #[cfg(target_os = "macos")]
    usage_tray::paint_menu(handle);
    Ok(TrayState {
        targets: Mutex::new(lines.iter().map(|line| line.target.clone()).collect()),
        built: Mutex::new(Some((lines, None))),
        ..TrayState::default()
    })
}

fn follow_menu(app: &AppHandle, id: &str) {
    match id {
        "usage-open" => show(app, Some("#/settings/usage")),
        "usage-refresh" => usage_tray::refresh(app),
        // Open QualityLayer is this computer's: with a machine in front it returns here.
        "open" => show(app, Some(tray::HOME_PLACE)),
        "notify" => follow_notify(app),
        "settings" => show(app, Some("#/settings")),
        "update" => check_for_updates(app, true),
        "quit" => exit_with_reason(app, 0, EXIT_USER),
        line => {
            let Some(n) = line
                .strip_prefix("line-")
                .and_then(|n| n.parse::<usize>().ok())
            else {
                return;
            };
            let target = app
                .try_state::<TrayState>()
                .and_then(|state| state.targets.lock().unwrap().get(n).cloned());
            match target {
                Some(tray::Target::Place(place)) => show(app, Some(&place)),
                Some(tray::Target::Update) => show(app, Some(tray::UPDATE_PLACE)),
                Some(tray::Target::Nothing) | None => {}
            }
        }
    }
}

#[cfg(target_os = "macos")]
fn usage_menu_actions(app: &AppHandle) -> serde_json::Value {
    let state = app.try_state::<TrayState>();
    let lines = state
        .as_ref()
        .map(|state| tray::lines(&state.summary.lock().unwrap(), update_ready().as_deref()))
        .unwrap_or_default();
    let mut actions: Vec<serde_json::Value> = lines
        .iter()
        .filter_map(|line| {
            let id = match &line.target {
                tray::Target::Place(place) => format!("place:{place}"),
                tray::Target::Update => format!("place:{}", tray::UPDATE_PLACE),
                tray::Target::Nothing => return None,
            };
        Some(serde_json::json!({"id":id,"label":line.text.chars().take(180).collect::<String>()}))
        })
        .collect();
    if !actions.is_empty() {
        actions.push(serde_json::json!({"separator":true}));
    }
    if let Some(notice) = state.and_then(|state| *state.notify.lock().unwrap()) {
        actions.push(serde_json::json!({"id":"notify","label":notice.label()}));
    }
    actions.extend([
        serde_json::json!({"id":"open","label":"Open QualityLayer","key":"o"}),
        serde_json::json!({"id":"settings","label":"Settings…","key":","}),
        serde_json::json!({"id":"update","label":"Check for updates…"}),
        serde_json::json!({"separator":true}),
        serde_json::json!({"id":"quit","label":"Quit QualityLayer","key":"q"}),
    ]);
    serde_json::Value::Array(actions)
}

/// Closing the window hides it; the App stays in the tray until Quit.
fn on_window_event(window: &Window, event: &WindowEvent) {
    if let WindowEvent::CloseRequested { api, .. } = event {
        api.prevent_close();
        let _ = window.hide();
    }
}

/// macOS opens the App again for a click on its notification or its dock icon: to the place of a
/// recent notification, else the window only shows and the page stays where the person left it.
#[cfg(target_os = "macos")]
fn reopened(app: &AppHandle) {
    show(app, take_recent_notice(app).as_deref());
}

/// Open a web link from the page in the system browser.
fn open_in_browser(url: &Url) {
    if let Err(reason) = external::open(url) {
        say_err!("QualityLayer: {reason}");
    }
}

fn fail(app: &AppHandle, reason: &str) {
    say_err!("QualityLayer: {reason}");
    exit_with_reason(app, 1, EXIT_FAILURE);
}

/// An explicit destination leaves the tour without rewriting unrelated raw query fields.
fn page_for_named_place(mut page: Url, fragment: Option<&str>) -> Option<Url> {
    let fragment = fragment?;
    if page.query_pairs().any(|(key, _)| key == "tour") {
        let query = page.query().unwrap_or_default().to_string();
        let mut decoded = page.query_pairs();
        let remaining = query
            .split('&')
            .filter(|field| field.is_empty() || decoded.next().is_none_or(|(key, _)| key != "tour"))
            .collect::<Vec<_>>()
            .join("&");
        page.set_query((!remaining.is_empty()).then_some(remaining.as_str()));
    }
    page.set_fragment(Some(fragment));
    Some(page)
}

/// Bring the one window forward. With a `place` that a link or a notification named, the page also
/// goes there once it is showing (before that, `open_window` takes it there); with none, the page
/// stays where it is.
fn show(app: &AppHandle, place: Option<&str>) {
    let window = app.get_webview_window("main");
    if let Some(window) = &window {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
    let page = window
        .as_ref()
        .and_then(|window| window.url().ok())
        .filter(|page| page.scheme() == "http");
    let fragment = fragment_to_show(
        &mut app.state::<Wanted>().0.lock().unwrap(),
        place,
        page.is_some(),
    );
    let page = page.and_then(|page| page_for_named_place(page, fragment.as_deref()));
    if let (Some(window), Some(page)) = (window, page) {
        let _ = window.navigate(page);
    }
}

/// Install the update, as the person asked on the page (or on the command line): the one that was
/// downloaded in the background. The App ends when the new one is starting; running agent commands
/// go on, and the new App opens the page where this one was. A failure is written to `update.json`
/// for the page to say.
fn install_update(app: &AppHandle) {
    let handle = app.clone();
    std::thread::spawn(move || match update::install_now(&handle) {
        Ok(true) => exit_with_reason(&handle, 0, EXIT_UPDATE),
        Ok(false) => {}
        Err(reason) => say_err!("QualityLayer: {reason}"),
    });
}

/// Look for an update now (the tray's "Check for updates…", the `qualitylayer://update` link, the
/// page's "Check now"). With `show_page` the window goes first to where the page says what the check
/// finds: the version, when it was made, and "Restart and update" when one is ready; the page
/// follows `update.json` as the check goes on.
fn check_for_updates(app: &AppHandle, show_page: bool) {
    if show_page {
        show(app, Some(tray::UPDATE_PLACE));
    }
    let handle = app.clone();
    std::thread::spawn(move || {
        update::check(&handle, true);
    });
}

/// A `qualitylayer://` link, from the system or from `--open`.
fn follow(app: &AppHandle, link: &str) {
    match links::parse(link) {
        Link::Update => check_for_updates(app, true),
        Link::Route(hash) => show(app, Some(&hash)),
        Link::Home => show(app, Some("")),
    }
}

/// What a second launch asked of this App: its links, an update, or just to be seen.
fn handle_arguments(app: &AppHandle, args: &[String]) {
    let mut asked = false;
    let mut args = args.iter().skip(1);
    while let Some(arg) = args.next() {
        let link = match arg.as_str() {
            // The App is running, and the person is looking at it: the update is theirs to start,
            // from the page's sheet. (A cold `--update` start installs at once, below.)
            "--update" => {
                check_for_updates(app, true);
                asked = true;
                continue;
            }
            "--open" => args.next(),
            // A script's way to the tray's Quit, which no script can open.
            "--quit" => return follow_menu(app, "quit"),
            other if other.starts_with("qualitylayer://") => Some(arg),
            _ => continue,
        };
        if let Some(link) = link {
            follow(app, link);
            asked = true;
        }
    }
    // A plain second launch: on Windows and Linux that is also a click on a notification that has
    // left the screen, so a recent one takes the window to its place, as on macOS.
    if !asked {
        show(app, take_recent_notice(app).as_deref());
    }
}

/// An App started by an update waits for the one that installed it to end: two Apps would
/// otherwise meet at the single-instance lock, and the new one would hand over to the old.
fn wait_for_predecessor() {
    let Some(pid) = std::env::var("QUALITYLAYER_AFTER_PID")
        .ok()
        .and_then(|pid| pid.parse::<u32>().ok())
    else {
        return;
    };
    for _ in 0..100 {
        if !update_lock::pid_alive(pid) {
            return;
        }
        std::thread::sleep(Duration::from_millis(100));
    }
}

/// One App per QualityLayer home: each home (another user, another `QUALITYLAYER_HOME`, a test) has
/// its own single-instance lock, so an App never hands its links to one of a different home.
fn instance_name(identifier: &str, home: Option<&Path>) -> String {
    let Some(home) = home else {
        return identifier.to_string();
    };
    // FNV-1a: a short, stable name for the home's path.
    let hash = home
        .to_string_lossy()
        .bytes()
        .fold(0xcbf2_9ce4_8422_2325u64, |hash, byte| {
            (hash ^ u64::from(byte)).wrapping_mul(0x0100_0000_01b3)
        });
    format!("{identifier}.h{hash:016x}")
}

#[cfg(any(test, all(windows, feature = "test-updater")))]
fn native_debug_arguments(
    port: Option<&str>,
    home: Option<&std::path::Path>,
    profile: Option<&std::path::Path>,
    temporary: &std::path::Path,
) -> Result<Option<String>, &'static str> {
    let Some(port) = port else { return Ok(None) };
    if port.is_empty() || !port.bytes().all(|byte| byte.is_ascii_digit()) {
        return Err("native debugger port must be numeric");
    }
    let port = port
        .parse::<u16>()
        .ok()
        .filter(|port| *port != 0)
        .ok_or("native debugger port is out of range")?;
    let temporary = temporary
        .canonicalize()
        .map_err(|_| "temporary root is unavailable")?;
    let home = home
        .and_then(|home| home.canonicalize().ok())
        .filter(|home| home != &temporary && home.starts_with(&temporary))
        .ok_or("native debugger needs a private temporary home")?;
    let profile = profile
        .and_then(|profile| profile.canonicalize().ok())
        .filter(|profile| profile == &home.join("native-webview2"))
        .ok_or("native debugger needs its exact private WebView2 profile")?;
    if !profile.is_dir() {
        return Err("native debugger profile is not a directory");
    }
    // Match Wry's default switches because additional_browser_args replaces them.
    Ok(Some(format!("--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection --autoplay-policy=no-user-gesture-required --remote-debugging-port={port} --remote-debugging-address=127.0.0.1")))
}

fn main() {
    // Before anything makes a folder or file under the home, or starts the server.
    private_files();
    // Before anything reads the home: an App the Windows installer started has the user's own
    // environment, and takes the home of the App it replaces from the note that one left.
    update::adopt_home_of_installer();
    let options = options();
    wait_for_predecessor();
    let self_test = options.self_test;
    let wait_for_link = options.wait_for_link;
    let watch_server = options.watch_server;
    let click_step = options.click_step;
    let background = options.background;
    let mut context = tauri::generate_context!();
    // Windows knows the App's notifications by the identifier the installer registered; the one
    // below is for this home alone.
    notify::remember_bundle_id(&context.config().identifier);
    let name = instance_name(
        &context.config().identifier,
        quality_layer_home().as_deref(),
    );
    context.config_mut().identifier = name;
    tauri::Builder::default()
        // First: a second launch never reaches the rest; it hands its arguments over and ends.
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            handle_arguments(app, &args)
        }))
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_notification::init())
        .on_window_event(on_window_event)
        .manage(Wanted::default())
        .manage(Notified::default())
        .manage(TrayUp::default())
        .setup(move |app| {
            // Linux and Windows registrations follow the App's place, which a move or an AppImage
            // changes: register at every start. macOS reads the scheme from the bundle.
            #[cfg(any(target_os = "linux", windows))]
            if let Err(error) = app.deep_link().register_all() {
                say_err!("QualityLayer: cannot register qualitylayer:// links: {error}");
            }
            if options.self_test {
                if let Some(action) = &options.lifecycle_test {
                    let home = std::env::var_os("QUALITYLAYER_HOME")
                        .map(std::path::PathBuf::from)
                        .and_then(|p| p.canonicalize().ok());
                    let roots = [std::env::temp_dir(), std::path::PathBuf::from("/tmp")];
                    let isolated = home.as_ref().is_some_and(|home| {
                        roots
                            .iter()
                            .filter_map(|p| p.canonicalize().ok())
                            .any(|root| home != &root && home.starts_with(root))
                    });
                    if !isolated {
                        fail(
                            app.handle(),
                            "native lifecycle test needs an explicit temporary QUALITYLAYER_HOME",
                        );
                        return Ok(());
                    }
                    if action == "close" {
                        let window = WebviewWindowBuilder::new(
                            app,
                            "main",
                            WebviewUrl::External(Url::parse("about:blank").unwrap()),
                        )
                        .title("QualityLayer lifecycle fixture")
                        .build()?;
                        window.close()?;
                        let handle = app.handle().clone();
                        std::thread::spawn(move || {
                            std::thread::sleep(Duration::from_millis(300));
                            let check = handle.clone();
                            let _ = handle.run_on_main_thread(move || {
                                let hidden =
                                    check.get_webview_window("main").is_some_and(|window| {
                                        window.is_visible().is_ok_and(|visible| !visible)
                                    });
                                say!("{}", serde_json::json!({"closeHidden":hidden}));
                                exit_with_reason(&check, if hidden { 0 } else { 1 }, EXIT_FAILURE);
                            });
                        });
                    } else {
                        let reason = match action.as_str() {
                            "user" => EXIT_USER,
                            "update" => EXIT_UPDATE,
                            "failure" => EXIT_FAILURE,
                            "unset" => 0,
                            _ => EXIT_FAILURE,
                        };
                        exit_with_reason(app.handle(), 0, reason);
                    }
                    return Ok(());
                }
            }
            if options.quit {
                exit_with_reason(app.handle(), 0, EXIT_USER);
                return Ok(());
            }
            // On Windows the installer starts the new App with the old one's arguments, so a start
            // that has just been updated also carries `--update`: it is a normal start.
            if options.update && !update::is_restart_by_installer(app.handle()) {
                // The command line asked for the update: no window, no question. What it finds and
                // does is in `update.json` and on stderr, which the command prints from.
                #[cfg(target_os = "macos")]
                app.set_activation_policy(tauri::ActivationPolicy::Accessory);
                let handle = app.handle().clone();
                std::thread::spawn(move || {
                    let code = match update::setup(&handle, options.relaunch)
                        .and_then(|()| update::install_now(&handle))
                    {
                        // Replaced: the new App starts once this one has gone.
                        Ok(_) => 0,
                        Err(reason) => {
                            say_err!("QualityLayer: {reason}");
                            1
                        }
                    };
                    exit_with_reason(&handle, code, EXIT_UPDATE);
                });
                return Ok(());
            }
            // The window opens where `--open` says; a link that follows moves it by itself.
            let started = options.open.as_deref().and_then(hash_of);
            *app.state::<Wanted>().0.lock().unwrap() = started;
            let handle = app.handle().clone();
            app.deep_link().on_open_url(move |event| {
                for url in event.urls() {
                    follow(&handle, url.as_str());
                }
            });
            // A link that started the App: on macOS the system delivers it as an event, elsewhere
            // as the one argument.
            if let Ok(Some(urls)) = app.deep_link().get_current() {
                for url in urls {
                    follow(app.handle(), url.as_str());
                }
            }
            let mut window =
                WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
                    .title("QualityLayer")
                    // File bytes belong to the App's DOM paste/drop handlers, not Tauri events.
                    .disable_drag_drop_handler()
                    .on_download(downloads::handle)
                    .inner_size(1280.0, 860.0)
                    .min_inner_size(900.0, 600.0)
                    // The window shows the App's own page. A link to the web, from the page or
                    // as a new window (`Add to Slack`), opens in the system browser instead.
                    .on_navigation(|url| match external::for_navigation(url) {
                        external::Place::Window => true,
                        external::Place::Browser => {
                            open_in_browser(url);
                            false
                        }
                        external::Place::Refuse => false,
                    })
                    .on_new_window(|url, _features| {
                        if external::for_new_window(&url) == external::Place::Browser {
                            open_in_browser(&url);
                        }
                        NewWindowResponse::Deny
                    });
            #[cfg(all(windows, feature = "test-updater"))]
            {
                let port = std::env::var("QUALITYLAYER_NATIVE_DEBUG_PORT").ok();
                let home = std::env::var_os("QUALITYLAYER_HOME").map(std::path::PathBuf::from);
                let profile =
                    std::env::var_os("WEBVIEW2_USER_DATA_FOLDER").map(std::path::PathBuf::from);
                if let Some(arguments) = native_debug_arguments(
                    port.as_deref(),
                    home.as_deref(),
                    profile.as_deref(),
                    &std::env::temp_dir(),
                )
                .map_err(std::io::Error::other)?
                {
                    window = window
                        .additional_browser_args(&arguments)
                        .data_directory(profile.unwrap());
                }
            }
            if self_test {
                let first = Arc::new(AtomicBool::new(true));
                let last_ready_route = Arc::new(Mutex::new(None::<String>));
                // Set by the first report that says the page rendered: the deadline below is for that.
                let rendered = Arc::new(AtomicBool::new(false));
                let rendered_seen = rendered.clone();
                // `--click-step`: the click is made once, by the report that follows the window's return.
                let to_click = Arc::new(AtomicBool::new(click_step));
                // The WebView keeps its storage in the account's own Library whatever HOME says:
                // a self-test keeps none, so no run sees what another left.
                window = window
                    .incognito(true)
                    .initialization_script(SELF_TEST_SCRIPT)
                    .on_document_title_changed(move |window, title| {
                        let Some(report) = title.strip_prefix("ql-selftest:") else {
                            return;
                        };
                        let parsed = serde_json::from_str::<serde_json::Value>(report);
                        // A restart deliberately reports the same place before its click probe.
                        if wait_for_link
                            && !watch_server
                            && !self_test_report_changed(
                                parsed.as_ref().ok(),
                                &mut last_ready_route.lock().unwrap(),
                            )
                        {
                            return;
                        }
                        say!("{report}");
                        let ready = parsed.as_ref().is_ok_and(|r| r["ready"] == true);
                        if ready {
                            rendered_seen.store(true, Ordering::SeqCst);
                        }
                        // Waiting for a link: the first report says the page rendered, the next
                        // one says where a link took the window.
                        if wait_for_link && ready && first.swap(false, Ordering::SeqCst) {
                            return;
                        }
                        if click_step && ready {
                            // The click's own report ends the run; a report of the page's own
                            // (it moved to the step the click opened) is not the end.
                            if let Some(clicked) =
                                parsed.as_ref().ok().and_then(|r| r["clicked"].as_bool())
                            {
                                exit_with_reason(
                                    window.app_handle(),
                                    if clicked { 0 } else { 1 },
                                    EXIT_FAILURE,
                                );
                            } else if to_click.swap(false, Ordering::SeqCst) {
                                let _ = window.eval(CLICK_STEP_SCRIPT);
                            }
                            return;
                        }
                        exit_with_reason(
                            window.app_handle(),
                            if ready { 0 } else { 1 },
                            EXIT_FAILURE,
                        );
                    });
                let handle = app.handle().clone();
                std::thread::spawn(move || {
                    std::thread::sleep(Duration::from_secs(SELF_TEST_SECONDS));
                    // A run that waits for a link or a restart is long once the page is up.
                    if !rendered.load(Ordering::SeqCst) {
                        fail(&handle, "the page did not render in time");
                    }
                });
            } else {
                window = window.on_document_title_changed(|window, title| {
                    heard(window.app_handle(), &window, &title)
                });
            }
            window.build()?;
            // Settings › Appearance › Text size, from the first (loading) page on.
            zoom::apply_saved(app.handle());
            // The self-test is a short run of the window alone: no tray, no polling.
            if !self_test {
                match build_tray(app) {
                    Ok(state) => {
                        app.manage(state);
                        app.state::<TrayUp>().0.store(true, Ordering::SeqCst);
                    }
                    Err(error) => say_err!("QualityLayer: no tray icon: {error}"),
                }
            }
            let _ = APP.set(app.handle().clone());
            let handle = app.handle().clone();
            std::thread::spawn(move || {
                // A newer or moved App brings the install along before it shows the server; a start
                // that has just updated says so to the page, once.
                let updated = update::after_start(&handle);
                if let Err(reason) = update::setup(&handle, Vec::new()) {
                    say_err!("QualityLayer: updates are off: {reason}");
                }
                open_window(
                    handle,
                    !self_test,
                    self_test && watch_server,
                    self_test && background,
                    updated,
                )
            });
            Ok(())
        })
        .build(context)
        .expect("the QualityLayer App failed to start")
        .run(|app, event| {
            if matches!(event, tauri::RunEvent::Exit) {
                on_exit(EXIT_REASON.load(Ordering::SeqCst));
            }
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Reopen { .. } = event {
                reopened(app);
            }
            #[cfg(not(target_os = "macos"))]
            let _ = (app, event);
        });
}

#[cfg(test)]
mod tests {
    #[test]
    fn explicit_native_places_leave_the_tour_and_preserve_other_raw_query_fields() {
        let current = tauri::Url::parse(
            "http://127.0.0.1:19999/?in=app&tour=3&opaque=a%20b&tour&empty=&flag&&encoded=%2F#/",
        )
        .unwrap();
        for place in ["/task/project~task/01-plan.md", "/", "/settings/updates"] {
            let target = super::page_for_named_place(current.clone(), Some(place)).unwrap();
            assert_eq!(target.fragment(), Some(place));
            assert_eq!(
                target.query(),
                Some("in=app&opaque=a%20b&empty=&flag&&encoded=%2F")
            );
            assert_eq!(target.origin(), current.origin());
            assert_eq!(target.path(), current.path());
        }
    }

    #[test]
    fn explicit_places_remove_encoded_tour_keys_but_not_other_query_names() {
        let current =
            tauri::Url::parse("http://127.0.0.1:19999/?%74our=2&&keep=%26x%3D1&tour=&TOUR=stay#/")
                .unwrap();
        let target = super::page_for_named_place(current, Some("/task/example")).unwrap();
        assert_eq!(target.query(), Some("&keep=%26x%3D1&TOUR=stay"));
        assert!(!target.query_pairs().any(|(key, _)| key == "tour"));
    }

    #[test]
    fn plain_reopen_leaves_the_current_tour_and_ordinary_links_keep_their_query() {
        let tour = tauri::Url::parse("http://127.0.0.1:19999/?in=app&tour=3#/").unwrap();
        assert!(super::page_for_named_place(tour, None).is_none());
        let ordinary = tauri::Url::parse("http://127.0.0.1:19999/?in=app&opaque=a%20b#/").unwrap();
        let target = super::page_for_named_place(ordinary, Some("/task/example")).unwrap();
        assert_eq!(target.query(), Some("in=app&opaque=a%20b"));
    }

    #[test]
    fn self_test_link_reports_canonicalize_only_home_aliases() {
        use serde_json::json;
        let mut route = None;
        assert!(super::self_test_report_changed(
            Some(&json!({"ready":true,"hash":""})),
            &mut route
        ));
        for alias in ["#/", "#", "#/home"] {
            assert!(!super::self_test_report_changed(
                Some(&json!({"ready":true,"hash":alias})),
                &mut route
            ));
        }
        assert!(super::self_test_report_changed(
            Some(&json!({"ready":true,"hash":"#/task/example"})),
            &mut route
        ));
    }

    #[test]
    fn self_test_link_reports_require_a_changed_ready_route_but_keep_failures() {
        use serde_json::json;
        let mut route = None;
        assert!(super::self_test_report_changed(
            Some(&json!({"ready":true,"hash":"#/"})),
            &mut route
        ));
        assert!(!super::self_test_report_changed(
            Some(&json!({"ready":true,"hash":"#/","tasks":["example"]})),
            &mut route
        ));
        assert!(super::self_test_report_changed(
            Some(&json!({"ready":false,"hash":"#/","blocked":"No licence"})),
            &mut route
        ));
        assert!(super::self_test_report_changed(None, &mut route));
        assert!(super::self_test_report_changed(
            Some(&json!({"ready":true,"hash":"#/task/example"})),
            &mut route
        ));
    }

    #[test]
    fn native_debugger_requires_bounded_port_and_exact_temporary_profile() {
        use super::native_debug_arguments;
        let temporary = std::env::temp_dir();
        let home = temporary.join(format!("ql-native-debugger-{}", std::process::id()));
        let profile = home.join("native-webview2");
        std::fs::create_dir_all(&profile).unwrap();
        let arguments =
            |port| native_debug_arguments(Some(port), Some(&home), Some(&profile), &temporary);
        assert_eq!(
            native_debug_arguments(None, None, None, &temporary),
            Ok(None)
        );
        assert!(arguments("57047")
            .unwrap()
            .unwrap()
            .ends_with("--remote-debugging-port=57047 --remote-debugging-address=127.0.0.1"));
        for invalid in [
            "",
            "0",
            "65536",
            "-1",
            "9222 --remote-debugging-address=0.0.0.0",
            "localhost:9222",
        ] {
            assert!(arguments(invalid).is_err(), "{invalid}");
        }
        assert!(
            native_debug_arguments(Some("9222"), Some(&temporary), Some(&profile), &temporary)
                .is_err()
        );
        assert!(
            native_debug_arguments(Some("9222"), Some(&home), Some(&home), &temporary).is_err()
        );
        assert!(native_debug_arguments(Some("9222"), None, Some(&profile), &temporary).is_err());
        #[cfg(unix)]
        {
            let alias = home.join("wrong-profile");
            std::os::unix::fs::symlink(&profile, &alias).unwrap();
            // Canonical aliases to the exact isolated profile are harmless.
            assert!(
                native_debug_arguments(Some("9222"), Some(&home), Some(&alias), &temporary).is_ok()
            );
        }
        std::fs::remove_dir_all(&home).unwrap();
    }
    use super::*;

    #[test]
    fn quit_reason_only_stops_on_user_or_native_termination() {
        assert!(user_quit(0)); // Cmd-Q, Dock Quit and logout arrive at Exit without a programmatic reason.
        assert!(user_quit(EXIT_USER));
        assert!(!user_quit(EXIT_UPDATE));
        assert!(!user_quit(EXIT_FAILURE));
    }

    #[test]
    fn quit_setting_and_failure_record_use_an_explicit_temporary_home() {
        let home = std::env::temp_dir().join(format!("ql-native-quit-{}", std::process::id()));
        std::fs::create_dir_all(&home).unwrap();
        assert!(!quit_stops_runs(&home));
        std::fs::write(home.join("config.json"), r#"{"onQuit":"keep"}"#).unwrap();
        assert!(!quit_stops_runs(&home));
        std::fs::write(home.join("config.json"), r#"{"onQuit":"stop"}"#).unwrap();
        assert!(quit_stops_runs(&home));
        record_quit_failure(&home, "synthetic bounded CLI failure");
        let path = home.join("app-quit-failure.json");
        let saved: serde_json::Value =
            serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
        assert_eq!(saved["reason"], "app-quit");
        assert_eq!(saved["failures"][0]["run"], "app");
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(
                std::fs::metadata(&path).unwrap().permissions().mode() & 0o777,
                0o600
            );
        }
        std::fs::remove_dir_all(home).unwrap();
    }

    #[test]
    fn a_home_of_its_own_gets_a_single_instance_name_of_its_own() {
        let id = "dev.qualitylayer.app";
        assert_eq!(instance_name(id, None), id);
        let one = instance_name(id, Some(Path::new("/tmp/a/.qualitylayer")));
        let two = instance_name(id, Some(Path::new("/tmp/b/.qualitylayer")));
        assert_ne!(one, two);
        assert_eq!(
            one,
            instance_name(id, Some(Path::new("/tmp/a/.qualitylayer")))
        );
        assert!(one.starts_with("dev.qualitylayer.app.h"));
        // Short enough for a unix socket path and a D-Bus name.
        assert!(one.len() < 60);
    }

    #[test]
    fn a_start_with_no_link_goes_where_the_install_still_needs_a_person() {
        let dir = std::env::temp_dir().join(format!("ql-first-route-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();

        // Not an App install yet: setup.
        assert_eq!(first_route(&dir), "#/setup");
        // An App install: the page the person left off at.
        std::fs::write(dir.join("app.json"), "{}").unwrap();
        assert_eq!(first_route(&dir), "");
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn a_link_names_a_hash_and_the_update_link_none() {
        assert_eq!(
            hash_of("qualitylayer://task/x~y").as_deref(),
            Some("#/task/x~y")
        );
        assert_eq!(
            hash_of("qualitylayer://task/x?token=1").as_deref(),
            Some("")
        );
        assert_eq!(hash_of("qualitylayer://update"), None);
    }

    #[test]
    fn a_reopen_with_no_place_named_leaves_the_page_where_it_is() {
        let mut wanted = None;
        assert_eq!(fragment_to_show(&mut wanted, None, true), None);
        assert_eq!(wanted, None);
    }

    #[test]
    fn a_place_a_notification_named_is_shown_once() {
        let mut wanted = None;
        assert_eq!(
            fragment_to_show(&mut wanted, Some("#/task/x/plan"), true).as_deref(),
            Some("/task/x/plan")
        );
        // The Dock click, or the tray's "Open QualityLayer", that comes next.
        assert_eq!(fragment_to_show(&mut wanted, None, true), None);
        assert_eq!(wanted, None);
    }

    #[test]
    fn the_trays_open_quality_layer_goes_to_this_computers_home_and_names_it_once() {
        let mut wanted = None;
        // `#/` is the route of this computer's Home: it takes a window that shows a machine back here.
        assert_eq!(
            fragment_to_show(&mut wanted, Some(tray::HOME_PLACE), true).as_deref(),
            Some("/")
        );
        assert_eq!(fragment_to_show(&mut wanted, None, true), None);
        assert_eq!(links::parse("qualitylayer://"), Link::Home);
    }

    #[test]
    fn a_machine_link_takes_the_window_to_the_machine_and_its_place() {
        assert_eq!(
            hash_of("qualitylayer://machine/gpu-box/task/p~billing/01-plan.md").as_deref(),
            Some("#/machine/gpu-box/task/p~billing/01-plan.md")
        );
        assert_eq!(
            hash_of("qualitylayer://machine/gpu-box").as_deref(),
            Some("#/machine/gpu-box/")
        );
        // A link that names no machine or a place that is none opens Home, never a made-up place.
        assert_eq!(hash_of("qualitylayer://machine/../x").as_deref(), Some(""));
    }

    #[test]
    fn a_link_to_home_still_goes_home() {
        for home in ["", "#/"] {
            let mut wanted = None;
            assert_eq!(
                fragment_to_show(&mut wanted, Some(home), true).as_deref(),
                Some("/"),
                "{home:?}"
            );
            assert_eq!(fragment_to_show(&mut wanted, None, true), None, "{home:?}");
        }
    }

    #[test]
    fn a_place_named_while_the_page_loads_waits_until_it_is_up() {
        let mut wanted = None;
        // The loading page is not the server's: nothing to move yet, the place is kept.
        assert_eq!(fragment_to_show(&mut wanted, Some("#/task/x"), false), None);
        assert_eq!(wanted.as_deref(), Some("#/task/x"));
        // A plain show while it still loads keeps it too.
        assert_eq!(fragment_to_show(&mut wanted, None, false), None);
        assert_eq!(wanted.as_deref(), Some("#/task/x"));
        // The place the person last named wins over an older one that never got shown.
        assert_eq!(
            fragment_to_show(&mut wanted, Some("#/settings"), true).as_deref(),
            Some("/settings")
        );
        assert_eq!(wanted, None);
    }

    #[test]
    fn the_first_start_goes_where_a_link_named_and_then_forgets_it() {
        let mut wanted = Some("#/task/x/plan".to_string());
        assert_eq!(start_route(&mut wanted, "#/setup"), "#/task/x/plan");
        assert_eq!(wanted, None);
        // The page is up now: a plain reopen leaves it on that task.
        assert_eq!(fragment_to_show(&mut wanted, None, true), None);
    }

    #[test]
    fn a_start_with_no_link_or_only_a_home_link_goes_where_the_install_needs_a_person() {
        for named in [None, Some(String::new())] {
            let mut wanted = named.clone();
            assert_eq!(start_route(&mut wanted, "#/setup"), "#/setup", "{named:?}");
            assert_eq!(wanted, None, "{named:?}");
        }
        let mut wanted = None;
        assert_eq!(start_route(&mut wanted, ""), "");
    }

    #[test]
    fn a_link_that_arrives_while_the_window_is_being_taken_to_the_page_does_not_stick() {
        // The start took the place (none); then a link named one while the loading page still showed.
        let mut wanted = Some("#/task/x/02-plan.md".to_string());
        assert_eq!(start_route(&mut Some(String::new()), ""), "");
        assert_eq!(fragment_to_show(&mut wanted, Some("#/task/y"), false), None);
        assert_eq!(wanted.as_deref(), Some("#/task/y"));
        // The page is up: the link's place is used once...
        assert_eq!(
            settle_after_navigation(&mut wanted).as_deref(),
            Some("/task/y")
        );
        // ...and the next plain reopen (the Dock, the tray's "Open QualityLayer") stays where it is.
        assert_eq!(wanted, None);
        assert_eq!(fragment_to_show(&mut wanted, None, true), None);
        // Nothing came meanwhile: nothing to do.
        assert_eq!(settle_after_navigation(&mut None), None);
    }

    #[test]
    fn a_reopen_soon_after_a_notification_goes_to_its_place_and_a_late_one_does_not() {
        let route = "#/task/x~y/02-plan.md".to_string();
        let soon = Some((route.clone(), Duration::from_secs(20)));
        assert_eq!(place_of_recent(soon).as_deref(), Some(route.as_str()));
        let late = Some((route, Duration::from_secs(NOTICE_CLICK_SECONDS)));
        assert_eq!(place_of_recent(late), None);
        assert_eq!(place_of_recent(None), None);
    }

    #[test]
    fn the_page_opens_where_the_route_says_and_says_once_that_it_was_updated() {
        let base = "http://127.0.0.1:41888/pair/abc?in=app";
        // No place, no update: the pairing address as it is.
        assert_eq!(page_address(base, "", None).unwrap().as_str(), base);
        // A place is the fragment.
        assert_eq!(
            page_address(base, "#/task/x~y/02-plan.md", None)
                .unwrap()
                .as_str(),
            format!("{base}#/task/x~y/02-plan.md")
        );
        // An update adds the query, beside the pairing's own, and keeps the place.
        assert_eq!(
            page_address(base, "#/settings", Some("12.0.0-beta.14"))
                .unwrap()
                .as_str(),
            "http://127.0.0.1:41888/pair/abc?in=app&updated=12.0.0-beta.14#/settings"
        );
        assert_eq!(
            page_address(base, "", Some("12.0.0-beta.14"))
                .unwrap()
                .query(),
            Some("in=app&updated=12.0.0-beta.14")
        );
        assert!(page_address("not a url", "", None).is_err());
    }
}
