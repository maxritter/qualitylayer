#!/usr/bin/env bash
# QualityLayer installer.
#
#   curl -fsSL https://qualitylayer.dev/install.sh | bash
#
# One rule decides what is installed: a machine with a screen (macOS, or Linux with a display,
# and no WSL, container or SSH session) gets the QualityLayer App and its command line; every
# other machine gets the command line alone and opens the App's pages in a browser. The first
# line says what was found. --cli-only and --with-app override the rule.
#
# Everything is downloaded from GitHub Releases. The release's SHA256SUMS is signed
# (SHA256SUMS.sig, `ssh-keygen -Y sign`); the signature is checked against the key built into this
# script, and each download against its signed SHA-256 line, both mandatory, before anything is
# written. The command line then installs itself:
# `qualitylayer install` adds the skill for each installed agent and records every file it wrote
# so `qualitylayer uninstall` can remove exactly those. With the App, the App's own command line
# does this and a small launcher takes the path agents call.
#
# Pilot Shell 11's updater downloads and runs this script with its own flags
# (--auto-update --non-interactive --quiet). --auto-update and --non-interactive
# mean nothing may be asked; --quiet is accepted and ignored.
# QualityLayer installs alongside Pilot Shell. Pilot Shell before 11.0.10 cannot tell that
# QualityLayer is installed and offers this update on every start, so its update also brings
# Pilot Shell to 11.0.10 with Pilot Shell's own installer, pinned by hash. Nothing else of Pilot
# Shell changes.
#
# Environment: VERSION (e.g. 12.0.0; default: the latest stable v12 release),
# QUALITYLAYER_CHANNEL=beta explicitly selects prereleases,
# QUALITYLAYER_RELEASE_BASE and QUALITYLAYER_RELEASE_API (mirrors and tests).
# QUALITYLAYER_RELEASE_SIGNER names another signing key for tests, and counts only when the
# release base is on this machine (a file: or loopback address). QUALITYLAYER_PILOT_INSTALLER and
# QUALITYLAYER_PILOT_INSTALLER_SHA256 name another Pilot Shell installer for tests, and count only
# when that installer is on this machine.

set -euo pipefail

REPO="maxritter/qualitylayer"
CHANNEL="${QUALITYLAYER_CHANNEL:-stable}"
case "$CHANNEL" in stable | beta) ;; *) printf '%s\n' 'QUALITYLAYER_CHANNEL must be stable or beta' >&2; exit 1 ;; esac
RELEASE_BASE="${QUALITYLAYER_RELEASE_BASE:-https://github.com/${REPO}/releases}"
release_list="https://api.github.com/repos/${REPO}/releases/latest"
[ "$CHANNEL" != beta ] || release_list="https://api.github.com/repos/${REPO}/releases?per_page=30"
RELEASE_API="${QUALITYLAYER_RELEASE_API:-$release_list}"
VERSION="${VERSION:-}"
VERSION="${VERSION#v}"

# The only key that may sign a release; the same line is built into `qualitylayer update`.
SIGNER_ID="release@qualitylayer.dev"
SIGNER_NAMESPACE="qualitylayer-release"
SIGNER_KEY="ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOvc89TsfxkzK1lxTNLr/FHwImLq1oUWYmmXQ1iYL2oU"
# A mirror on this machine is a file: address or a loopback host with at most a port. Anything
# between the host and the first slash that is not a port (a `user@` part, a second host) is not.
on_this_machine() {
	case "$1" in
	file://*) return 0 ;;
	http://127.0.0.1 | http://localhost | http://127.0.0.1/* | http://localhost/*) return 0 ;;
	http://127.0.0.1:* | http://localhost:*)
		local rest="${1#http://}"
		local authority="${rest%%/*}"
		case "${authority#*:}" in
		'' | *[!0-9]*) return 1 ;;
		*) return 0 ;;
		esac
		;;
	esac
	return 1
}
if on_this_machine "$RELEASE_BASE" && [ -n "${QUALITYLAYER_RELEASE_SIGNER:-}" ]; then
	# A mirror on this machine may be signed with a test key.
	SIGNER_KEY="$(printf '%s\n' "$QUALITYLAYER_RELEASE_SIGNER" | awk '{print $1 " " $2}')"
fi

# The last Pilot Shell release: the first that stops offering this update once QualityLayer is
# installed. Its installer is fetched from its tag and must match this hash before it runs.
PILOT_VERSION="11.0.10"
PILOT_INSTALLER="https://raw.githubusercontent.com/${REPO}/v${PILOT_VERSION}/install.sh"
PILOT_INSTALLER_SHA256="6612ecec41643122012022872d72c23d2d6f01930959571151ced98b07365794"
if on_this_machine "${QUALITYLAYER_PILOT_INSTALLER:-}" && [ -n "${QUALITYLAYER_PILOT_INSTALLER_SHA256:-}" ]; then
	PILOT_INSTALLER="$QUALITYLAYER_PILOT_INSTALLER"
	PILOT_INSTALLER_SHA256="$QUALITYLAYER_PILOT_INSTALLER_SHA256"
fi

# The installer's own lines match the install screen the binary draws next:
# a blue ◇ per step and an amber ▲ for a failure, coloured only on a terminal.
blue="" amber="" reset=""
if [ -t 1 ] && [ -z "${NO_COLOR:-}" ] && [ "${TERM:-}" != "dumb" ]; then
	blue=$'\033[38;5;74m' amber=$'\033[38;5;214m' reset=$'\033[0m'
fi
say() { printf '%s◇%s  %s\n' "$blue" "$reset" "$*"; }
warn() { printf '%s▲%s  %s\n' "$amber" "$reset" "$*" >&2; }
fail() {
	warn "$@"
	exit 1
}

# --non-interactive runs unattended: nothing is asked and the App is not opened afterwards.
# --auto-update is passed only by Pilot Shell 11's `pilot update`, after its user confirmed the
# update in a terminal: the move is explained, and on a terminal the App opens to finish setup.
ask=yes from_pilot="" cli_only="" with_app=""
for arg in "$@"; do
	case "$arg" in
	--non-interactive) ask="" ;;
	--auto-update) ask="" from_pilot=yes ;;
	--cli-only) cli_only=yes ;;
	--with-app) with_app=yes ;;
	esac
done
[ -z "$cli_only" ] || [ -z "$with_app" ] || fail "--cli-only and --with-app cannot be used together"

case "${HOME:-}" in
/*) ;;
*) fail "HOME must be an absolute path, got: '${HOME:-}'" ;;
esac
[ -d "$HOME" ] || fail "HOME must name an existing directory, got: '$HOME'"
HOME="$(cd -- "$HOME" && pwd -P)"
[ "$HOME" != "/" ] || fail "HOME resolves to the filesystem root; refusing to install."
export HOME

case "$(uname -s)" in
Darwin) os="darwin" ;;
Linux) os="linux" ;;
*) fail "QualityLayer runs on macOS and Linux (on Windows, run install.ps1 in PowerShell)." ;;
esac
case "$(uname -m)" in
arm64 | aarch64) arch="arm64" ;;
x86_64 | amd64) arch="x64" ;;
*) fail "unsupported CPU: $(uname -m)" ;;
esac
# An arm64 Mac running this shell under Rosetta still wants the arm64 binary.
if [ "$os" = "darwin" ] && [ "$arch" = "x64" ] && [ "$(sysctl -n sysctl.proc_translated 2>/dev/null || true)" = "1" ]; then
	arch="arm64"
fi
asset="qualitylayer-${os}-${arch}"

# A variable counts as set unless it is empty, "0" or "false" (the same rule as the CLI's).
is_set() {
	local value="${!1:-}"
	[ -n "$value" ] && [ "$value" != "0" ] && [ "$value" != "false" ]
}

# What kind of machine this is; the CLI's `screenOf` (src/core/platform.ts) gives the same answer.
screen_of() {
	if is_set SSH_CONNECTION || is_set SSH_TTY; then
		echo ssh
	elif [ "$os" = "darwin" ]; then
		echo desktop
	elif is_set WSL_DISTRO_NAME || is_set WSL_INTEROP || uname -r | grep -qi microsoft; then
		echo wsl
	elif [ -e /.dockerenv ] || [ -e /run/.containerenv ] || is_set REMOTE_CONTAINERS || is_set CODESPACES || is_set DEVCONTAINER; then
		echo container
	elif is_set DISPLAY || is_set WAYLAND_DISPLAY; then
		echo desktop
	else
		echo none
	fi
}
screen="$(screen_of)"

use_app=""
{ [ "$screen" = "desktop" ] && [ -z "$cli_only" ]; } && use_app=yes
[ -z "$with_app" ] || use_app=yes

fetch() {
	if command -v curl >/dev/null 2>&1; then
		# The binary is about 100 MB: on a terminal its download shows a bar.
		if [ "${3:-}" = "bar" ] && [ -t 2 ]; then
			curl -fSL --retry 2 --progress-bar -o "$2" "$1"
		else
			curl -fsSL --retry 2 -o "$2" "$1"
		fi
	elif command -v wget >/dev/null 2>&1; then
		wget -q -O "$2" "$1"
	else
		fail "curl or wget is required"
	fi
}

sha256_of() {
	if command -v sha256sum >/dev/null 2>&1; then
		sha256sum "$1" | awk '{print $1}'
	elif command -v shasum >/dev/null 2>&1; then
		shasum -a 256 "$1" | awk '{print $1}'
	else
		fail "sha256sum or shasum is required to verify the download"
	fi
}

mounted=""
work="$(mktemp -d)"
cleanup() {
	if [ -n "$mounted" ]; then hdiutil detach "$mounted" -quiet >/dev/null 2>&1 || true; fi
	rm -rf "${work:?}"
}
trap cleanup EXIT

if [ -z "$VERSION" ]; then
	fetch "$RELEASE_API" "$work/releases.json" || fail "cannot reach the release list at $RELEASE_API"
	pattern='"tag_name": *"v12\.[0-9]+\.[0-9]+"'
	[ "$CHANNEL" != beta ] || pattern='"tag_name": *"v12\.[0-9]+\.[0-9]+(-[A-Za-z0-9.-]+)?"'
	VERSION="$(grep -Eo "$pattern" "$work/releases.json" | head -n 1 | sed 's/.*"v\(.*\)"/\1/' || true)"
	[ -n "$VERSION" ] || fail "no QualityLayer 12 release was found"
fi

# The first line says what was found, as the install screen after it says what was done.
case "$os-$arch" in
darwin-arm64) system="macOS, Apple silicon" ;;
darwin-x64) system="macOS, Intel" ;;
*) system="Linux ${arch}" ;;
esac
case "$screen" in
desktop) where=", with a screen" ;;
ssh) where=" over SSH, no screen" ;;
wsl) where=" in WSL${WSL_DISTRO_NAME:+ (${WSL_DISTRO_NAME})}" ;;
container)
	if is_set REMOTE_CONTAINERS || is_set CODESPACES || is_set DEVCONTAINER; then
		where=" in a dev container"
	else
		where=" in a container"
	fi
	;;
*) where=", no screen" ;;
esac
say "QualityLayer ${VERSION} · ${system}${where}"
if [ -n "$from_pilot" ]; then
	say "Pilot Shell is now QualityLayer. It installs next to Pilot Shell, which keeps working as before."
fi

base="${RELEASE_BASE}/download/v${VERSION}"

# signed_sums: the release's SHA256SUMS and its signature, fetched once, and the signature checked
# against the key built into this script before any line of the sums is trusted.
signed_sums() {
	[ -f "$work/SHA256SUMS.verified" ] && return 0
	command -v ssh-keygen >/dev/null 2>&1 || fail "ssh-keygen is required to verify the release signature; nothing was installed"
	fetch "${base}/SHA256SUMS" "$work/SHA256SUMS" || fail "the release checksums are missing: ${base}/SHA256SUMS; nothing was installed"
	fetch "${base}/SHA256SUMS.sig" "$work/SHA256SUMS.sig" || fail "the release's SHA256SUMS is not signed by QualityLayer: ${base}/SHA256SUMS.sig is missing; nothing was installed"
	printf '%s namespaces="%s" %s\n' "$SIGNER_ID" "$SIGNER_NAMESPACE" "$SIGNER_KEY" >"$work/allowed_signers"
	ssh-keygen -Y verify -f "$work/allowed_signers" -I "$SIGNER_ID" -n "$SIGNER_NAMESPACE" -s "$work/SHA256SUMS.sig" <"$work/SHA256SUMS" >/dev/null 2>&1 ||
		fail "the release's SHA256SUMS is not signed by QualityLayer; nothing was installed"
	: >"$work/SHA256SUMS.verified"
}

# download_verified <file in the release> <where to put it> [what to say when it is missing]:
# the file, checked against its line in the signed SHA256SUMS before anything is installed.
download_verified() {
	local name="$1" dest="$2"
	fetch "${base}/${name}" "$dest" bar || fail "download failed: ${base}/${name}${3:+; $3}"
	signed_sums
	local expected actual
	expected="$(awk -v name="$name" '$2 == name {print $1; exit}' "$work/SHA256SUMS")"
	actual="$(sha256_of "$dest")"
	case "$expected" in
	*[!0-9a-f]* | "") fail "SHA256SUMS holds no checksum for ${name}; nothing was installed" ;;
	esac
	[ "${#expected}" -eq 64 ] || fail "SHA256SUMS holds no checksum for ${name}; nothing was installed"
	[ "$expected" = "$actual" ] || fail "checksum mismatch for ${name} (expected ${expected}, got ${actual}); nothing was installed"
}

# run_install <program> [args]: `install` asks nothing, so it runs the same way with or without
# a terminal, and never reads this script's own stdin under `curl | bash`.
run_install() {
	local program="$1"
	shift
	"$program" install "$@" --non-interactive </dev/null
}

# update_pilot: run by Pilot Shell's update only, once QualityLayer is installed. A Pilot Shell
# older than PILOT_VERSION offers this update on every start; its own installer brings it to
# PILOT_VERSION. A failure here leaves QualityLayer installed and says how to finish by hand.
update_pilot() {
	[ -n "$from_pilot" ] || return 0
	local pilot="$HOME/.pilot/bin/pilot" current
	[ -x "$pilot" ] || return 0
	current="$("$pilot" --version </dev/null 2>/dev/null | awk '{print $NF}' || true)"
	current="${current#v}"
	[[ "$current" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || return 0
	[ "$current" != "$PILOT_VERSION" ] || return 0
	[ "$(printf '%s\n%s\n' "$current" "$PILOT_VERSION" | sort -t. -k1,1n -k2,2n -k3,3n | head -n 1)" = "$current" ] || return 0

	local by_hand="Pilot Shell ${current} will keep offering this update. To stop it, update Pilot Shell yourself: export VERSION=${PILOT_VERSION}; curl -fsSL \"https://raw.githubusercontent.com/${REPO}/v\${VERSION}/install.sh\" | bash"
	say "Updating Pilot Shell ${current} to ${PILOT_VERSION}, which knows QualityLayer is installed"
	if ! fetch "$PILOT_INSTALLER" "$work/pilot-install.sh"; then
		warn "Could not download Pilot Shell's installer. $by_hand"
		return 0
	fi
	local actual
	actual="$(sha256_of "$work/pilot-install.sh")"
	if [ "$actual" != "$PILOT_INSTALLER_SHA256" ]; then
		warn "Pilot Shell's installer does not match its pinned checksum, so it was not run. $by_hand"
		return 0
	fi
	if ! VERSION="$PILOT_VERSION" bash "$work/pilot-install.sh" --auto-update --non-interactive --quiet </dev/null; then
		warn "Pilot Shell's update did not finish. $by_hand"
		return 0
	fi
	say "Pilot Shell ${PILOT_VERSION} is installed and keeps working next to QualityLayer"
}

if [ -z "$use_app" ]; then
	say "Downloading QualityLayer ${VERSION} (${asset})"
	download_verified "$asset" "$work/qualitylayer"
	say "Checksum verified (SHA-256)"
	chmod 755 "$work/qualitylayer"
	run_install "$work/qualitylayer" ${cli_only:+--cli-only}
	update_pilot
	case "$screen" in
	wsl) say "No App inside WSL: links open in your Windows browser." ;;
	container) say "No App here: open the link your agent prints. VS Code forwards the port for you, whatever number it picks." ;;
	ssh) say "No App here. To review from your computer, forward the port (ssh -L 41888:127.0.0.1:41888 <this machine>) and open the link your agent prints." ;;
	none) say "No screen here: open the link your agent prints in a browser that can reach this machine." ;;
	*) say "Command line only. Add --with-app to install the App as well." ;;
	esac
	exit 0
fi

apps="$HOME/Applications"
# A Mac lists its apps in /Applications: the App goes there when this user may write to it (an
# administrator can, without a password), else to ~/Applications. Tests name another folder.
system_apps="${QUALITYLAYER_APPLICATIONS:-/Applications}"
if [ "$os" = "darwin" ] && [ -d "$system_apps" ] && [ -w "$system_apps" ]; then
	apps="$system_apps"
fi
case "$apps" in
"$HOME"/*) apps_shown="~${apps#"$HOME"}" ;;
*) apps_shown="$apps" ;;
esac
if [ "$os" = "darwin" ]; then
	package="QualityLayer-${VERSION}-macos-${arch}.dmg"
else
	package="QualityLayer-${VERSION}-linux-${arch}.AppImage"
fi
say "Downloading the QualityLayer App ${VERSION} (${package})"
download_verified "$package" "$work/package" "this release has no App for this machine; add --cli-only to install the command line alone"
say "Checksum verified (SHA-256)"

new="$apps/.${package%%-*}.new"
if [ "$os" = "darwin" ]; then
	mkdir -p "$work/volume"
	# hdiutil warns on stderr that `attach` is deprecated on new macOS; only a failure is shown.
	hdiutil attach -nobrowse -readonly -noverify -mountpoint "$work/volume" "$work/package" >/dev/null 2>"$work/hdiutil.err" || fail "could not open the disk image ($(tr '\n' ' ' <"$work/hdiutil.err")); nothing was installed"
	mounted="$work/volume"
	app="$(find "$work/volume" -maxdepth 1 -name '*.app' -print -quit)"
	[ -n "$app" ] || fail "the disk image holds no app; nothing was installed"
	mkdir -p "$apps"
	rm -rf "${new:?}"
	ditto "$app" "$new"
	rm -rf "${apps:?}/QualityLayer.app"
	mv "$new" "$apps/QualityLayer.app"
	hdiutil detach "$mounted" -quiet >/dev/null 2>&1 || true
	mounted=""
	app_path="$apps/QualityLayer.app"
	app_cli="$app_path/Contents/MacOS/qualitylayer-cli"
	app_open="$app_path"
	say "Installed QualityLayer.app in $apps_shown"
else
	mkdir -p "$apps"
	chmod 755 "$work/package"
	mv "$work/package" "$new"
	mv "$new" "$apps/QualityLayer.AppImage"
	app_open="$apps/QualityLayer.AppImage"
	# The App's command line comes out of the image without mounting it (no FUSE needed).
	(cd "$work" && "$app_open" --appimage-extract 'usr/share/qualitylayer/*' >/dev/null 2>&1) || fail "could not unpack the AppImage"
	app_path="$work/squashfs-root/usr/share/qualitylayer"
	app_cli="$app_path/qualitylayer-cli"
	[ -x "$app_cli" ] || fail "the AppImage holds no command line"
	say "Installed QualityLayer.AppImage in ~/Applications"
fi

run_install "$app_cli" --app "$app_path"

# One App in one place: a copy an earlier install left in ~/Applications goes once the App in
# /Applications is the one the command line runs.
if [ "$os" = "darwin" ] && [ "$apps" != "$HOME/Applications" ] && [ -d "$HOME/Applications/QualityLayer.app" ]; then
	rm -rf "${HOME:?}/Applications/QualityLayer.app"
	say "Removed the older copy in ~/Applications"
fi

update_pilot

# On a terminal the App opens at once, to finish setting up; an unattended update never opens a
# window. Pilot Shell's update was confirmed by its user, so it opens the App too, or says where it is.
if { [ -n "$ask" ] || [ -n "$from_pilot" ]; } && [ -t 1 ]; then
	say "Opening the QualityLayer App…"
	if [ "$os" = "darwin" ]; then
		open "$app_open" >/dev/null 2>&1 || true
	else
		(nohup "$app_open" >/dev/null 2>&1 &)
	fi
elif [ -n "$from_pilot" ]; then
	say "Open QualityLayer from ${apps_shown} to finish setting up."
fi
