#[path = "usage_tray_render.rs"]
mod tray_render;

use crate::poll;
use std::sync::{Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::AppHandle;
#[cfg(target_os = "macos")]
use tray_render::icon;
use tray_render::render;

#[derive(Default)]
struct State {
    server: Option<poll::Server>,
    image: Vec<(String, String)>,
    tooltip: String,
    checked_at: Option<u64>,
    menu: Option<serde_json::Value>,
    refreshing: bool,
    queued: bool,
    queued_force: bool,
    queued_menu: bool,
    failed: bool,
}
static STATE: OnceLock<Mutex<State>> = OnceLock::new();

#[cfg(target_os = "macos")]
pub fn update(app: &AppHandle, server: &poll::Server) {
    if app.tray_by_id("main").is_none() {
        return;
    }
    STATE.get_or_init(Default::default).lock().unwrap().server = Some(server.clone());
    request(app, false, false);
}

pub fn refresh(app: &AppHandle) {
    request(app, true, true);
}

#[cfg(target_os = "macos")]
pub fn settings_changed(app: &AppHandle) {
    request(app, false, false);
}

fn request(app: &AppHandle, force: bool, menu: bool) {
    let server = {
        let mut state = STATE.get_or_init(Default::default).lock().unwrap();
        if state.refreshing {
            state.queued = true;
            state.queued_force |= force;
            state.queued_menu |= menu;
            return;
        }
        let Some(server) = state.server.clone() else {
            return;
        };
        state.refreshing = true;
        server
    };
    let app = app.clone();
    std::thread::spawn(move || {
        let mut force = force;
        let mut menu = menu;
        loop {
            read(&app, &server, force, menu);
            let next = {
                let mut state = STATE.get_or_init(Default::default).lock().unwrap();
                if state.queued {
                    state.queued = false;
                    let force = state.queued_force;
                    state.queued_force = false;
                    let menu = state.queued_menu;
                    state.queued_menu = false;
                    Some((force, menu))
                } else {
                    state.refreshing = false;
                    None
                }
            };
            match next {
                Some(next) => {
                    force = next.0;
                    menu = next.1;
                }
                None => break,
            }
        }
    });
}

fn read(app: &AppHandle, server: &poll::Server, refresh: bool, menu: bool) {
    let path = match (refresh, menu) {
        (true, _) => "/api/usage/display?refresh=1&menu=1",
        (false, true) => "/api/usage/display?menu=1",
        _ => "/api/usage/display",
    };
    let Ok(reply) = poll::get(server, path) else {
        stale_tooltip(app);
        return;
    };
    if reply["ok"] != true {
        stale_tooltip(app);
        return;
    }
    let mut parts = vec![("ql".to_string(), String::new())];
    let mut descriptions = Vec::new();
    if reply["enabled"] == true {
        for item in reply["items"].as_array().into_iter().flatten().take(32) {
            let icon = item["icon"].as_str().unwrap_or("").to_string();
            let text: String = item["text"]
                .as_str()
                .unwrap_or("?")
                .chars()
                .take(64)
                .collect();
            descriptions.push(item["description"].as_str().unwrap_or("").to_string());
            parts.push((icon, text));
        }
    }
    let mut tooltip = String::from("QualityLayer");
    for description in descriptions {
        tooltip.push('\n');
        tooltip.push_str(&description);
    }
    let checked_at = reply["checkedAt"].as_u64();
    {
        let mut state = STATE.get_or_init(Default::default).lock().unwrap();
        state.tooltip = tooltip.clone();
        state.checked_at = checked_at;
        state.failed = false;
        if reply["menu"].is_object() {
            state.menu = Some(reply["menu"].clone());
        }
    }
    let tooltip = aged_tooltip(tooltip, checked_at);
    let app = app.clone();
    let handle = app.clone();
    let _ = app.run_on_main_thread(move || {
        let Some(tray) = handle.tray_by_id("main") else {
            return;
        };
        let changed = STATE.get_or_init(Default::default).lock().unwrap().image != parts;
        if changed {
            if let Some(image) = render(&parts) {
                if tray.set_icon_with_as_template(Some(image), true).is_ok() {
                    STATE.get_or_init(Default::default).lock().unwrap().image = parts;
                }
            }
        }
        let _ = tray.set_tooltip(Some(tooltip));
        #[cfg(target_os = "macos")]
        paint_menu(&handle);
    });
}

fn aged_tooltip(mut text: String, checked_at: Option<u64>) -> String {
    if let Some(at) = checked_at {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as u64;
        text.push_str(&format!(
            "\nChecked {} min ago",
            now.saturating_sub(at) / 60_000
        ));
    }
    text
}

fn stale_tooltip(app: &AppHandle) {
    let mut state = STATE.get_or_init(Default::default).lock().unwrap();
    state.failed = true;
    let text = aged_tooltip(
        format!(
            "{}\nCouldn't refresh usage",
            if state.tooltip.is_empty() {
                "QualityLayer"
            } else {
                &state.tooltip
            }
        ),
        state.checked_at,
    );
    drop(state);
    if let Some(tray) = app.tray_by_id("main") {
        let _ = tray.set_tooltip(Some(text));
    }
    #[cfg(target_os = "macos")]
    paint_menu(app);
}

#[cfg(target_os = "macos")]
extern "C" fn menu_opened() {
    if let Some(app) = crate::APP.get() {
        paint_menu(app);
        request(app, false, true);
    }
}

#[cfg(target_os = "macos")]
extern "C" fn menu_action(id: *const std::ffi::c_char) {
    if id.is_null() {
        return;
    }
    let id = unsafe { std::ffi::CStr::from_ptr(id) };
    if id.to_bytes().len() > 8192 {
        return;
    }
    let Ok(id) = id.to_str() else {
        return;
    };
    if let Some(app) = crate::APP.get() {
        if let Some(place) = id.strip_prefix("place:") {
            if place.is_empty() || place.starts_with("#/") {
                crate::show(app, Some(place));
            }
        } else {
            crate::follow_menu(app, id);
        }
    }
}

#[cfg(target_os = "macos")]
pub fn open_menu(app: &AppHandle) {
    let app = app.clone();
    // Leave the tray event listener before AppKit enters its nested menu tracking loop.
    std::thread::spawn(move || {
        paint_menu(&app);
        if let Some(tray) = app.tray_by_id("main") {
            let _ = tray.with_inner_tray_icon(|inner| {
                unsafe extern "C" {
                    fn ql_usage_menu_open(status: *mut std::ffi::c_void);
                }
                if let Some(status) = inner.ns_status_item() {
                    unsafe {
                        ql_usage_menu_open(&*status as *const _ as *mut std::ffi::c_void);
                    }
                }
            });
        }
    });
}

#[cfg(target_os = "macos")]
pub fn paint_menu(app: &AppHandle) {
    use std::ffi::{c_char, c_void, CString};
    #[repr(C)]
    struct Part {
        icon: *const u8,
        icon_length: usize,
        text: *const c_char,
    }
    unsafe extern "C" {
        fn ql_usage_menu(
            status: *mut c_void,
            json: *const c_char,
            icons: *const Part,
            count: usize,
            opened: extern "C" fn(),
            action: extern "C" fn(*const c_char),
        );
    }
    let (mut model, failed) = {
        let state = STATE.get_or_init(Default::default).lock().unwrap();
        (state.menu.clone(), state.failed)
    };
    let data = model.get_or_insert_with(|| serde_json::json!({"loading":!failed}));
    data["failed"] = serde_json::json!(failed);
    data["actions"] = crate::usage_menu_actions(app);
    let text = model.as_ref().map_or_else(
        || "{\"loading\":true}".to_string(),
        serde_json::Value::to_string,
    );
    if text.len() > 65536 {
        return;
    }
    let Ok(json) = CString::new(text) else {
        return;
    };
    let names: Vec<String> = ["ql".to_string(), "coins".to_string()]
        .into_iter()
        .chain(model.as_ref().into_iter().flat_map(|value| {
            value["rows"]
                .as_array()
                .into_iter()
                .flatten()
                .take(8)
                .map(|row| row["icon"].as_str().unwrap_or("").to_string())
        }))
        .collect();
    if let Some(tray) = app.tray_by_id("main") {
        let _ = tray.with_inner_tray_icon(move |inner| {
            let Some(status) = inner.ns_status_item() else {
                return;
            };
            let parts: Vec<Part> = names
                .iter()
                .map(|name| {
                    let bytes = icon(name);
                    Part {
                        icon: bytes.as_ptr(),
                        icon_length: bytes.len(),
                        text: std::ptr::null(),
                    }
                })
                .collect();
            // The menu retains its copied model and images; Rust owns these inputs until this call returns.
            unsafe {
                ql_usage_menu(
                    &*status as *const _ as *mut c_void,
                    json.as_ptr(),
                    parts.as_ptr(),
                    parts.len(),
                    menu_opened,
                    menu_action,
                );
            }
        });
    }
}

#[cfg(all(test, target_os = "macos"))]
mod tests {
    use super::render;

    #[test]
    fn template_has_real_transparent_pixels_and_bounded_overflow() {
        let image = render(&[
            ("ql".into(), "".into()),
            ("claude-code".into(), "7 %".into()),
            ("codex".into(), "12 %".into()),
        ])
        .expect("AppKit bitmap context");
        assert_eq!(image.height(), 36);
        assert!(image
            .rgba()
            .as_chunks::<4>()
            .0
            .iter()
            .any(|pixel| pixel[3] > 0));
        assert!(image
            .rgba()
            .as_chunks::<4>()
            .0
            .iter()
            .any(|pixel| pixel[3] == 0));
        let many = (0..33)
            .map(|_| ("coins".into(), "≈ $99999.99 at API".into()))
            .collect::<Vec<_>>();
        let overflow = render(&many).expect("overflow image");
        assert!(overflow.width() <= 720);
        assert!(render(&[("ql".into(), "bad\0label".into())]).is_none());
    }
}
