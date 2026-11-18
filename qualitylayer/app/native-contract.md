# The QualityLayer App's native contract

This page describes what the native App and its launcher are allowed to do, which crates they
use, and how they are configured. The Rust sources here (`src-tauri/src/`, `launcher/src/`) and
the `Cargo.lock` files, runtime configuration (`src-tauri/tauri.conf.json`), operating-system
permissions and Windows install/uninstall hooks are published. The complete construction inputs
remain private: the Cargo manifests, `src-tauri/build.rs`, and the packaging, signing and
notarization pipeline. Max makes the official build. The same repository retains private construction inputs as
ciphertext. Focused checks use a public-only workspace that omits them; in that workspace,
`cargo build --manifest-path app/src-tauri/Cargo.toml` stops at the missing manifest.
A test in the private tree checks that this page matches those files.

## What the native code does

- **App** (`QualityLayer`): a window over the local review server. It starts nothing on its own.
  It asks its bundled CLI for the server (`qualitylayer app ensure`) and shows that loopback page.
  It is also a tray icon with a menu of what waits, a dock badge, native notifications, `qualitylayer://`
  links, the window's text size and App updates. Closing the window leaves the server and agents
  running.
- **Launcher** (`qualitylayer-launcher`): the program agents call at `<QL home>/bin/qualitylayer`.
  It finds the CLI inside the App and hands every call over unchanged: arguments, input, working
  directory, environment and exit code. Before that it removes Bun preload and debug switches,
  which could inject code into the CLI. It waits while `update.lock` says the App is replacing
  itself, and it writes `launcher-problem.json` at most once a day when a hook finds the CLI
  missing.
- **The page reaches no native command.** The window capability (`capabilities/default.json`)
  covers only the `main` window and grants no permissions, and `withGlobalTauri` is off.
  Everything the page asks for goes through the local server. The page's title is the only
  signal it sends back: the window title, the dock badge, and the `ql-notify:` notification lines.
  The page's Content-Security-Policy comes from the local server, not Tauri (`csp` is `null`).
- **Processes it starts**: the bundled CLI (`qualitylayer-cli`), the downloaded update's own
  install step, `ps` on macOS or `powershell` on Windows to find running CLI copies before an
  update (Linux reads `/proc`), and the system browser for links that leave the App.
- **Network**: the loopback server, using the key that `app ensure` returns, and the update feed.
  Nothing else.
- **Files**: inside the QualityLayer home. It reads `app.json`, and from `config.json` the quit
  behaviour and text size. It writes `update.json`, `update.lock`, `notified.json`,
  `notifications.log`, `app-quit-failure.json` and the WebView2 profile on Windows. The
  `crash.log` entry goes through the CLI. During an update, a `.restart-home` note sits beside the
  App's own programs.

## System permissions

These are all the permissions the App asks the operating system for:

- **Notifications**: on macOS the first start asks once, through `UNUserNotificationCenter`, for
  alerts and sound. Later starts only read the person's answer. Windows and Linux have no
  notification permission to ask for.
- **Link handler**: the App registers the `qualitylayer://` scheme. macOS takes it from the bundle.
  Windows and Linux register it again at every start, because the App's location can change.
- **Code-signing exceptions on macOS**: the three entitlements under Identity and configuration.
  The App asks for no other entitlement: no camera, microphone, contacts, location, accessibility,
  Apple Events, keychain or login item.
- **Administrator approval on Windows**: only the optional Defender repair asks for it (see
  Windows installer). The App itself installs and runs per user.
- **Plugin permissions for the page**: none. Tauri plugin and core permissions are granted only
  through capabilities, and the only capability grants nothing (see What the native code does).
  The notification, updater, deep-link and single-instance plugins run from Rust only.

## Identity and configuration

- Product `QualityLayer`, identifier `dev.qualitylayer.app`, main binary `QualityLayer`.
- Version: each release stamps its own version into the build.
- Links: the `qualitylayer://` scheme (deep link). A second start hands its link to the running App
  (single instance). A link only navigates to a place the CLI would name (see `src-tauri/src/links.rs`).
- Updates: feed `https://qualitylayer.dev/app/latest.json`. The beta channel adds `?channel=beta`.
  Every download is verified against this minisign public key before the person installs it:
  `dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IDRDRkU0MzYwQkVBMEQ0NTkKUldSWjFLQytZRVArVExucVRNcXVDRnJmMjQrWWpvV09hU1MwMi9RZ1ZiRk5jK3U1UVMxWlovOXkK`.
  A test-only build feature, `test-updater`, reads the feed and key from
  `QUALITYLAYER_UPDATE_ENDPOINT` and `QUALITYLAYER_UPDATE_PUBKEY` and checks a waiting install every
  second. Release builds do not include it.
- Bundle: the App ships two sidecar programs next to itself, `qualitylayer-cli` and
  `qualitylayer-launcher`, plus its icons. It is built as a DMG on macOS, an NSIS installer on
  Windows and an AppImage on Linux.
- macOS: needs 12.0 or later and runs with the hardened runtime and `entitlements.plist`, which
  covers every executable in the bundle:
  `com.apple.security.cs.allow-jit` and `com.apple.security.cs.allow-unsigned-executable-memory`
  (Bun's JIT and FFI) and `com.apple.security.cs.disable-library-validation` (the pinned memory
  engine loads from the user's cache). DYLD injection stays forbidden.
- Build step: on macOS the build compiles `src/usage_icon.m` (Objective-C, ARC) for the usage
  icon in the menu bar and links `AppKit`. Tauri's build step then generates the App context from
  the configuration above.

## Windows installer

The App installs per user (`currentUser`). Only the optional Windows Defender repair asks for
administrator approval. The installer hooks do this:

- **After install**: copy `windows/repair-defender.ps1` into the install folder as
  `QualityLayer-Windows-Repair.ps1`. Unless the installer runs without shortcuts or as an update,
  add the Start-menu shortcut `QualityLayer - Repair Windows launch`, which runs the repair with
  `-Launch`. Only an interactive first install runs the repair once with `-Automatic`, never an
  update, a passive install or a silent install.
- **Before uninstall**: if the repair's record `.qualitylayer-asr.json` exists and the uninstall is
  interactive and not part of an update, run the repair with `-Remove` to undo its Defender
  exception.
- **After uninstall**: outside an update, remove the shortcut. Also remove the helper and the
  install folder, unless the record is still there, so a declined clean-up can run later with `-Remove`.

The repair always runs through the native Windows PowerShell (through `Sysnative` from the 32-bit
installer) with `-ExecutionPolicy Bypass` for that one process. The device's execution policy is
never changed. What the repair does is in `src-tauri/windows/repair-defender.ps1`.

## Dependencies

These are the direct dependencies, with their requirements as the manifests state them. The
published `src-tauri/Cargo.lock` and `launcher/Cargo.lock` pin every crate, direct and transitive,
to an exact version and checksum. The launcher
has no dependencies.

| Crate | Requirement | Features | Used by | Purpose |
| --- | --- | --- | --- | --- |
| `tauri` | `2` | `tray-icon` | App | Window, tray, lifecycle |
| `serde_json` | `1` | | App | Reads the CLI's JSON answers and the settings file |
| `tauri-plugin-notification` | `2` | | App | Notifications and their permission on Windows and Linux |
| `tauri-plugin-updater` | `2.14.1` | | App | Signed App updates from the feed above |
| `rfd` | `0.17.2` | | App | Opens the native Save dialog for exports |
| `notify-rust` | `4.11` | | App | Windows and Linux notifications that report a click |
| `qualitylayer-launcher` | `12.0.0-beta.11` | | App | The QualityLayer home and the update lock, shared with the launcher |
| `tauri-plugin-single-instance` | `2.5.2` | `deep-link` | App | One running App; a second start hands over its link |
| `tauri-plugin-deep-link` | `2.6.1` | | App | The `qualitylayer://` scheme |
| `block2` | `0.6` | | App on macOS | Objective-C blocks for the notification center |
| `objc2` | `0.6` | | App on macOS | Objective-C runtime calls |
| `objc2-foundation` | `0.3` | no defaults; `NSString`, `NSError` | App on macOS | Foundation strings and errors |
| `objc2-user-notifications` | `0.3` | no defaults; `block2`, `UNUserNotificationCenter`, `UNNotificationSettings`, `UNNotificationRequest`, `UNNotificationContent`, `UNNotificationTrigger` | App on macOS | Asks for notification permission and shows notifications |
| `tauri-build` | `2` | | App build | Generates the App context from its configuration |
| `cc` | `1` | | App build | Compiles the macOS usage icon |
| `semver` | `1` | | App tests | Orders versions in the no-downgrade update test |
