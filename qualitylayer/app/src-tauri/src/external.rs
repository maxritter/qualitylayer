//! Links from the page that leave the App: "Add to Slack", the docs, a pull request. The window
//! shows the local server and nothing else, so a link to the web, or a `window.open` to it, opens in
//! the system browser, which is also where a person's own sessions are (Slack's install link works
//! only in the browser that started it).

use std::process::{Command, Stdio};
use std::sync::Mutex;
use tauri::Url;

/// The ports of the local server this App has shown: the window may go to these on this machine, and
/// to no other port.
static PORTS: Mutex<Vec<u16>> = Mutex::new(Vec::new());

/// The window may go to the server on `port` (it changes when the server is started again).
pub fn allow_port(port: u16) {
    let mut ports = PORTS.lock().unwrap_or_else(|p| p.into_inner());
    if !ports.contains(&port) {
        ports.push(port);
    }
}

fn allowed_ports() -> Vec<u16> {
    PORTS.lock().unwrap_or_else(|p| p.into_inner()).clone()
}

/// Where a link from the page goes.
#[derive(Debug, PartialEq, Eq)]
pub enum Place {
    /// Stays in the App's window.
    Window,
    /// Opens in the system browser (or mail program).
    Browser,
    /// Goes nowhere.
    Refuse,
}

/// A host that is this machine.
fn is_loopback(url: &Url) -> bool {
    let Some(host) = url.host_str() else {
        return false;
    };
    // An IPv6 host comes bracketed.
    let bare = host.trim_start_matches('[').trim_end_matches(']');
    match bare.parse::<std::net::IpAddr>() {
        Ok(ip) => ip.is_loopback(),
        Err(_) => host == "localhost",
    }
}

/// Whether the address is the App itself: its bundled page, or the local server's own origin, on
/// one of `ports`. Another port of this machine is another program.
fn is_the_app(url: &Url, ports: &[u16]) -> bool {
    match url.scheme() {
        "tauri" | "about" => true,
        // Windows serves the bundled page from tauri.localhost.
        "http" | "https" if url.host_str() == Some("tauri.localhost") => true,
        "http" => {
            is_loopback(url)
                && url
                    .port()
                    .is_some_and(|port| ports.contains(&port) || is_a_machines_port(url, port))
        }
        _ => false,
    }
}

/// The ports on which the local server serves the pages of the machines it reaches over ssh
/// (`server/machines/store.ts`). They are the App too: its page frames them, and a frame's
/// navigation must not be refused while the list of machines is still being read. The server
/// frames them as `127.0.0.1` and by no other name.
const MACHINE_PORTS: std::ops::RangeInclusive<u16> = 41940..=41999;

fn is_a_machines_port(url: &Url, port: u16) -> bool {
    url.host_str() == Some("127.0.0.1") && MACHINE_PORTS.contains(&port)
}

/// The web or an e-mail address: what a person's own browser or mail program takes. A `mailto:` that
/// attaches a file is refused: a link must not choose what leaves this machine.
fn is_for_the_system(url: &Url) -> bool {
    match url.scheme() {
        "https" => {
            url.host().is_some() && !is_loopback(url) && url.host_str() != Some("tauri.localhost")
        }
        "mailto" => !url
            .query_pairs()
            .any(|(key, _)| key.to_ascii_lowercase().contains("attach")),
        _ => false,
    }
}

fn navigation_in(url: &Url, ports: &[u16]) -> Place {
    if is_the_app(url, ports) {
        Place::Window
    } else if is_for_the_system(url) {
        Place::Browser
    } else {
        Place::Refuse
    }
}

/// A navigation inside the window: the App's own addresses stay, a web link goes to the browser.
pub fn for_navigation(url: &Url) -> Place {
    navigation_in(url, &allowed_ports())
}

fn download_in(url: &Url, ports: &[u16]) -> bool {
    let origin = if url.scheme() == "blob" {
        // ExportCard creates a Blob in the App, not in the opaque artifact iframe.
        if url.query().is_some() || url.fragment().is_some() {
            return false;
        }
        let Ok(origin) = Url::parse(url.path()) else {
            return false;
        };
        origin
    } else {
        url.clone()
    };
    let plain_http =
        origin.scheme() == "http" && origin.username().is_empty() && origin.password().is_none();
    plain_http && is_loopback(&origin) && is_the_app(&origin, ports)
}

/// Downloads have their own gate; a Blob is still never an allowed window navigation.
pub fn for_download(url: &Url) -> bool {
    download_in(url, &allowed_ports())
}

/// A new window the page asked for (`window.open`, `target="_blank"`): the App never opens a second
/// window, so a web link goes to the browser and anything else is refused.
pub fn for_new_window(url: &Url) -> Place {
    if is_for_the_system(url) {
        Place::Browser
    } else {
        Place::Refuse
    }
}

/// The program and arguments that open `url` for the person. The program is named by its full
/// path, so nothing a person's search path finds first is run instead, and no shell is involved:
/// the address is one argument whatever it holds. `system_root` is Windows' own folder.
fn open_command(os: &str, url: &str, system_root: Option<&str>) -> (String, Vec<String>) {
    match os {
        "macos" => ("/usr/bin/open".to_string(), vec![url.to_string()]),
        "windows" => (
            format!(
                "{}\\System32\\rundll32.exe",
                system_root.unwrap_or("C:\\Windows").trim_end_matches('\\')
            ),
            vec!["url.dll,FileProtocolHandler".to_string(), url.to_string()],
        ),
        _ => ("/usr/bin/xdg-open".to_string(), vec![url.to_string()]),
    }
}

/// Open the address in the system browser.
pub fn open(url: &Url) -> Result<(), String> {
    let root = std::env::var("SystemRoot").ok();
    let (program, args) = open_command(std::env::consts::OS, url.as_str(), root.as_deref());
    let mut command = Command::new(program);
    command
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        // The App has no console, so the child must not open one.
        command.creation_flags(0x0800_0000);
    }
    command.spawn().map(|_| ()).map_err(|error| {
        format!(
            "cannot open {} in the browser: {error}",
            url.host_str().unwrap_or("the link")
        )
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    const PORTS: &[u16] = &[41888];

    fn url(text: &str) -> Url {
        Url::parse(text).unwrap()
    }

    fn nav(text: &str) -> Place {
        navigation_in(&url(text), PORTS)
    }

    #[test]
    fn downloads_accept_only_trusted_app_origins_and_nonopaque_blobs() {
        for link in [
            "blob:http://127.0.0.1:41888/owned",
            "blob:http://localhost:41888/owned",
            "blob:http://[::1]:41888/owned",
            "blob:http://127.0.0.1:41940/owned",
        ] {
            assert!(download_in(&url(link), PORTS), "{link}");
            assert_eq!(navigation_in(&url(link), PORTS), Place::Refuse);
        }
        assert!(download_in(
            &url("http://127.0.0.1:41888/attachment?id=owned"),
            PORTS
        ));
        for link in [
            "blob:null/opaque",
            "blob:https://example.com/owned",
            "blob:http://127.0.0.1:9999/owned",
            "blob:http://user@127.0.0.1:41888/owned",
            "blob:http://127.0.0.1.evil.test:41888/owned",
            "blob:tauri://localhost/owned",
            "blob:http://127.0.0.1:41888/owned?changed",
            "data:application/pdf;base64,AA==",
            "file:///tmp/export.pdf",
        ] {
            assert!(!download_in(&url(link), PORTS), "{link}");
        }
    }

    #[test]
    fn add_to_slack_and_other_web_links_open_in_the_system_browser() {
        for link in [
            "https://qualitylayer.dev/api/team/slack/start",
            "https://docs.qualitylayer.dev/team",
            "https://github.com/maxritter/pilot-shell/pull/412",
            "mailto:help@qualitylayer.dev",
            "mailto:help@qualitylayer.dev?subject=Hello&body=Text",
        ] {
            assert_eq!(for_new_window(&url(link)), Place::Browser, "{link}");
            assert_eq!(nav(link), Place::Browser, "{link}");
        }
    }

    #[test]
    fn the_apps_own_pages_stay_in_the_window() {
        for link in [
            "http://127.0.0.1:41888/pair/abc?in=app",
            "http://127.0.0.1:41888/#/task/x~y/02-plan.md",
            "http://localhost:41888/",
            "http://[::1]:41888/",
            "tauri://localhost/index.html",
            "http://tauri.localhost/index.html",
            "about:blank",
            "about:srcdoc",
        ] {
            assert_eq!(nav(link), Place::Window, "{link}");
        }
    }

    #[test]
    fn only_the_servers_own_origin_is_the_app_not_any_other_port_of_this_machine() {
        for link in [
            "http://127.0.0.1:9999/",
            "http://127.0.0.1/",
            "http://localhost:3000/",
            "https://127.0.0.1:41888/",
            "https://localhost:9999/",
        ] {
            assert_eq!(nav(link), Place::Refuse, "{link}");
            assert_eq!(for_new_window(&url(link)), Place::Refuse, "{link}");
        }
        // A server started again on another port is the App once its port is allowed.
        assert_eq!(
            navigation_in(&url("http://127.0.0.1:41999/"), &[41888, 41999]),
            Place::Window
        );
        allow_port(41777);
        allow_port(41777);
        assert_eq!(
            for_navigation(&url("http://127.0.0.1:41777/")),
            Place::Window
        );
        assert_eq!(allowed_ports().iter().filter(|p| **p == 41777).count(), 1);
    }

    #[test]
    fn a_machines_page_stays_in_the_window_before_any_port_was_recorded() {
        for link in [
            "http://127.0.0.1:41940/?in=machine&parent=http%3A%2F%2F127.0.0.1%3A41888",
            "http://127.0.0.1:41999/#/task/x~y",
        ] {
            assert_eq!(navigation_in(&url(link), &[]), Place::Window, "{link}");
            // A machine's page is framed, never opened as a window of its own.
            assert_eq!(for_new_window(&url(link)), Place::Refuse, "{link}");
        }
        for link in [
            "http://127.0.0.1:41939/",
            "http://127.0.0.1:42000/",
            "https://127.0.0.1:41940/",
            "http://localhost:41940/",
            "http://[::1]:41940/",
            "http://example.com:41940/",
            "http://127.0.0.1.example.com:41940/",
        ] {
            assert_eq!(navigation_in(&url(link), &[]), Place::Refuse, "{link}");
        }
    }

    #[test]
    fn a_page_cannot_open_a_second_window_on_the_app_or_a_file_or_a_script() {
        for link in [
            "http://127.0.0.1:41888/api/tasks",
            "tauri://localhost/index.html",
            "file:///etc/passwd",
            "javascript:alert(1)",
            "ftp://example.test/x",
            "http://example.test/plain-http",
            "data:text/html,<script>1</script>",
            "blob:http://127.0.0.1:41888/abc",
        ] {
            assert_eq!(for_new_window(&url(link)), Place::Refuse, "{link}");
        }
        for link in [
            "file:///etc/passwd",
            "javascript:alert(1)",
            "http://example.test/",
            "data:text/html,<script>1</script>",
            "blob:http://127.0.0.1:41888/abc",
        ] {
            assert_eq!(nav(link), Place::Refuse, "{link}");
        }
    }

    #[test]
    fn a_mail_link_that_attaches_a_file_is_refused() {
        for link in [
            "mailto:a@b.test?attach=/etc/passwd",
            "mailto:a@b.test?subject=x&attachment=/Users/me/.ssh/id_rsa",
            "mailto:a@b.test?Attach=C:\\secret.txt",
        ] {
            assert_eq!(for_new_window(&url(link)), Place::Refuse, "{link}");
            assert_eq!(nav(link), Place::Refuse, "{link}");
        }
    }

    #[test]
    fn a_look_alike_host_is_not_the_app() {
        for link in [
            "https://127.0.0.1.evil.test/",
            "https://localhost.evil.test/",
            "https://tauri.localhost.evil.test/",
        ] {
            assert_eq!(nav(link), Place::Browser, "{link}");
        }
    }

    #[test]
    fn each_system_opens_an_address_with_a_program_named_by_its_full_path_and_no_shell_sees_it() {
        let link = "https://qualitylayer.dev/a?b=1&c=$(x)";
        assert_eq!(
            open_command("macos", link, None),
            ("/usr/bin/open".to_string(), vec![link.to_string()])
        );
        assert_eq!(
            open_command("linux", link, None),
            ("/usr/bin/xdg-open".to_string(), vec![link.to_string()])
        );
        let windows = vec!["url.dll,FileProtocolHandler".to_string(), link.to_string()];
        assert_eq!(
            open_command("windows", link, Some("D:\\Win")),
            (
                "D:\\Win\\System32\\rundll32.exe".to_string(),
                windows.clone()
            )
        );
        assert_eq!(
            open_command("windows", link, None),
            ("C:\\Windows\\System32\\rundll32.exe".to_string(), windows)
        );
        // Unknown systems use the freedesktop way.
        assert_eq!(open_command("freebsd", link, None).0, "/usr/bin/xdg-open");
    }
}
