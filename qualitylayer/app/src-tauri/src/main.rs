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

mod app_routing;
mod app_selftest;
mod app_tray;
mod app_window;
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

pub(crate) use app_routing::page_address;
#[cfg(target_os = "macos")]
pub(crate) use app_routing::show;
pub use app_tray::refresh_tray_from_state;
#[cfg(target_os = "macos")]
pub(crate) use app_tray::{follow_menu, usage_menu_actions};
pub(crate) use app_window::{check_for_updates, install_update};

use qualitylayer_launcher::{private_files, quality_layer_home, say_err};
use std::sync::atomic::Ordering;
use std::sync::OnceLock;
use tauri::{AppHandle, Manager};
use tauri_plugin_deep_link::DeepLinkExt;

/// The running App, for the parts that tell the tray something from a thread of their own (the
/// update sequence, when `update.json` changes).
pub(crate) static APP: OnceLock<AppHandle> = OnceLock::new();

fn run_early_mode(app: &mut tauri::App, options: &app_routing::Options) -> tauri::Result<bool> {
    if options.self_test {
        if let Some(action) = &options.lifecycle_test {
            app_selftest::run_lifecycle_test(app, action)?;
            return Ok(true);
        }
    }
    if options.quit {
        app_window::exit_with_reason(app.handle(), 0, app_window::EXIT_USER);
        return Ok(true);
    }
    // On Windows the installer starts the new App with the old one's arguments, so a start
    // that has just been updated also carries `--update`: it is a normal start.
    if options.update && !update::is_restart_by_installer(app.handle()) {
        app_window::run_cli_update(app, options.relaunch.clone());
        return Ok(true);
    }
    Ok(false)
}

fn register_deep_links(app: &tauri::App, open: Option<&str>) {
    // The window opens where `--open` says; a link that follows moves it by itself.
    let started = open.and_then(app_routing::hash_of);
    *app.state::<app_routing::Wanted>().0.lock().unwrap() = started;
    let handle = app.handle().clone();
    app.deep_link().on_open_url(move |event| {
        for url in event.urls() {
            app_routing::follow(&handle, url.as_str());
        }
    });
    // A link that started the App: on macOS the system delivers it as an event, elsewhere
    // as the one argument.
    if let Ok(Some(urls)) = app.deep_link().get_current() {
        for url in urls {
            app_routing::follow(app.handle(), url.as_str());
        }
    }
}

fn setup_app(app: &mut tauri::App, options: app_routing::Options) -> tauri::Result<()> {
    // Linux and Windows registrations follow the App's place, which a move or an AppImage
    // changes: register at every start. macOS reads the scheme from the bundle.
    #[cfg(any(target_os = "linux", windows))]
    if let Err(error) = app.deep_link().register_all() {
        say_err!("QualityLayer: cannot register qualitylayer:// links: {error}");
    }
    if run_early_mode(app, &options)? {
        return Ok(());
    }
    register_deep_links(app, options.open.as_deref());
    app_window::build_main_window(app, &options)?;
    // The self-test is a short run of the window alone: no tray, no polling.
    if !options.self_test {
        match app_tray::build_tray(app) {
            Ok(state) => {
                app.manage(state);
                app.state::<app_tray::TrayUp>()
                    .0
                    .store(true, Ordering::SeqCst);
            }
            Err(error) => say_err!("QualityLayer: no tray icon: {error}"),
        }
    }
    let _ = APP.set(app.handle().clone());
    app_window::spawn_startup_open(
        app.handle().clone(),
        app_window::WatchMode {
            watch: !options.self_test,
            watch_server: options.self_test && options.watch_server,
            background: options.self_test && options.background,
        },
    );
    Ok(())
}

fn main() {
    // Before anything makes a folder or file under the home, or starts the server.
    private_files();
    // Before anything reads the home: an App the Windows installer started has the user's own
    // environment, and takes the home of the App it replaces from the note that one left.
    update::adopt_home_of_installer();
    let options = app_routing::options();
    app_routing::wait_for_predecessor();
    let mut context = tauri::generate_context!();
    // Windows knows the App's notifications by the identifier the installer registered; the one
    // below is for this home alone.
    notify::remember_bundle_id(&context.config().identifier);
    let name = app_routing::instance_name(
        &context.config().identifier,
        quality_layer_home().as_deref(),
    );
    context.config_mut().identifier = name;
    tauri::Builder::default()
        // First: a second launch never reaches the rest; it hands its arguments over and ends.
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            app_routing::handle_arguments(app, &args)
        }))
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_notification::init())
        .on_window_event(app_window::on_window_event)
        .manage(app_routing::Wanted::default())
        .manage(app_tray::Notified::default())
        .manage(app_tray::TrayUp::default())
        .setup(move |app| {
            setup_app(app, options)?;
            Ok(())
        })
        .build(context)
        .expect("the QualityLayer App failed to start")
        .run(|app, event| {
            if matches!(event, tauri::RunEvent::Exit) {
                app_window::on_exit(app_window::EXIT_REASON.load(Ordering::SeqCst));
            }
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Reopen { .. } = event {
                app_window::reopened(app);
            }
            #[cfg(not(target_os = "macos"))]
            let _ = (app, event);
        });
}
