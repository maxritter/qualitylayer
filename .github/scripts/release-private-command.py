#!/usr/bin/env python3
"""Run a release command with private diagnostics and explicit scalar exports."""
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import signal
import subprocess
import sys
import tempfile
import time
from urllib.parse import urlsplit

_SCRIPTS_DIR = str(Path(__file__).resolve().parent)
if _SCRIPTS_DIR not in sys.path:
    sys.path.insert(0, _SCRIPTS_DIR)

from release_private_metadata import (
    failure_metadata,
    history_failure_locations,
    history_report_directory,
)
from release_private_process import WindowsJob, kill_owned
from release_private_source import (
    COCKPIT_REPORT_DIR,
    COCKPIT_TEST,
    HISTORY_COMMAND,
    HISTORY_REPORT_DIR,
    HISTORY_TESTS,
    failure_scope,
    require,
)

CHANNELS = ("GITHUB_ENV", "GITHUB_OUTPUT", "GITHUB_STATE", "GITHUB_STEP_SUMMARY", "GITHUB_PATH")
CAPABILITIES = (
    "ACTIONS_RUNTIME_TOKEN",
    "ACTIONS_RUNTIME_URL",
    "ACTIONS_RESULTS_URL",
    "ACTIONS_CACHE_URL",
    "ACTIONS_CACHE_SERVICE_V2",
    "ACTIONS_ID_TOKEN_REQUEST_TOKEN",
    "ACTIONS_ID_TOKEN_REQUEST_URL",
    "GH_TOKEN",
    "GITHUB_TOKEN",
)
SIGNING_KINDS = {"azure-signing-profile", "windows-sign-command"}
SIGNING_STAGES = {
    "preflight.ps1": (
        "bed235ca3fc1027c0bacc5d6fea7450a42d6a9bb27b3275e181e5a0c1ddbf32e",
        "windows-signing-oidc",
        {"GITHUB_OUTPUT": {"enabled": "boolean"}, "GITHUB_ENV": {"QUALITYLAYER_WINDOWS_SIGNING_PROFILE": "azure-signing-profile"}},
    ),
    "setup.ps1": (
        "43b3e8db1fcc5b6a9d93036054ffd1038a35faa7febd2734ecee9df728e52990",
        "",
        {"GITHUB_ENV": {"QUALITYLAYER_WINDOWS_SIGNING_COMMAND": "windows-sign-command"}},
    ),
}
TRUSTED_SIGNING_WORKFLOWS = (
    "maxritter/qualitylayer/.github/workflows/release.yml@refs/heads/main",
    "maxritter/qualitylayer/.github/workflows/release.yml@refs/heads/dev",
)
REGEX_KINDS = {
    "sha256": re.compile(r"[a-f0-9]{64}"),
    "id": re.compile(r"[1-9][0-9]{0,19}"),
    "version": re.compile(r"(?:1[2-9]|[2-9][0-9]|[1-9][0-9]{2,})\.[0-9]+\.[0-9]+(?:-[A-Za-z0-9.-]+)?"),
    "azure-signing-profile": re.compile(
        r"/subscriptions/[a-fA-F0-9-]{36}/resourceGroups/[A-Za-z0-9_.()-]{1,90}"
        r"/providers/Microsoft\.CodeSigning/codeSigningAccounts/[A-Za-z0-9-]{1,63}"
        r"/certificateProfiles/[A-Za-z0-9-]{1,63}"
    ),
    "source-sha": re.compile(r"[a-f0-9]{40}"),
}
PUBLIC_HOST_RE = re.compile(r"[a-z0-9.-]+\.(?:vercel\.app|qualitylayer\.dev)")


def _valid_public_url(value):
    url = urlsplit(value)
    host = url.hostname or ""
    clean_parts = not (url.username or url.password or url.query or url.fragment)
    valid_host = host == "qualitylayer.dev" or bool(PUBLIC_HOST_RE.fullmatch(host))
    return url.scheme == "https" and clean_parts and valid_host


def _valid_windows_sign_command(value):
    command = json.loads(value)
    root = Path(os.environ["RUNNER_TEMP"]).resolve() / "ql-signing"
    executable = root / "microsoft.windows.sdk.buildtools" / "bin" / "10.0.28000.0" / "x64" / "signtool.exe"
    library = root / "microsoft.artifactsigning.client" / "bin" / "x64" / "Azure.CodeSigning.Dlib.dll"
    metadata = root / "metadata.json"
    expected = [
        "sign", "/v", "/fd", "SHA256", "/tr", "http://timestamp.acs.microsoft.com",
        "/td", "SHA256", "/d", "QualityLayer", "/dlib", str(library), "/dmdf", str(metadata), "%1",
    ]
    return (
        isinstance(command, dict)
        and set(command) == {"cmd", "args"}
        and command["cmd"] == str(executable)
        and command["args"] == expected
    )


def _valid_temp_path(value):
    target = Path(value).resolve()
    temp = Path(os.environ["RUNNER_TEMP"]).resolve()
    return target != temp and temp in target.parents


CUSTOM_VALIDATORS = {
    "boolean": lambda value: value in ("true", "false"),
    "public-url": _valid_public_url,
    "windows-sign-command": _valid_windows_sign_command,
    "temp-path": _valid_temp_path,
}


def checked(value, kind):
    require(isinstance(value, str) and bool(value))
    require(len(value) <= 2048 and all(ord(char) >= 32 for char in value))
    pattern = REGEX_KINDS.get(kind)
    if pattern is not None:
        return bool(pattern.fullmatch(value))
    validator = CUSTOM_VALIDATORS.get(kind)
    return validator(value) if validator is not None else False


def _prepare_environment(directory):
    environment = dict(os.environ)
    for key in CHANNELS:
        private = directory / key
        private.touch(mode=0o600)
        environment[key] = str(private)
    for key in CAPABILITIES:
        environment.pop(key, None)
    if os.environ.get("QL_RELEASE_METADATA_CONTROL") == "true":
        for key in ("GH_TOKEN", "GITHUB_TOKEN"):
            if key in os.environ:
                environment[key] = os.environ[key]
    return environment


def _has_signing_exports(contract):
    return isinstance(contract, dict) and any(
        isinstance(rules, dict) and SIGNING_KINDS.intersection(rules.values()) for rules in contract.values()
    )


def _admit_signing_stage(shell, script, contract, environment):
    capability = os.environ.get("QL_RELEASE_CAPABILITIES", "")
    if not capability and not _has_signing_exports(contract):
        return
    workspace = Path(os.environ["GITHUB_WORKSPACE"]).resolve()
    selected = Path(script).resolve()
    stage = SIGNING_STAGES.get(selected.name)
    require(stage is not None and selected.parent == workspace / ".github/private-workflows/windows-signing")
    require(hashlib.sha256(selected.read_bytes()).hexdigest() == stage[0])
    require(capability == stage[1] and contract == stage[2] and shell == "pwsh" and os.name == "nt")
    require(os.environ.get("GITHUB_REPOSITORY") == "maxritter/qualitylayer")
    require(os.environ.get("GITHUB_REF") in ("refs/heads/main", "refs/heads/dev"))
    require(os.environ.get("GITHUB_WORKFLOW_REF", "") in TRUSTED_SIGNING_WORKFLOWS)
    head = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=workspace, text=True).strip()
    require(os.environ.get("GITHUB_SHA") == head and os.environ.get("QL_RELEASE_METADATA_CONTROL") != "true")
    for key in ("GH_TOKEN", "GITHUB_TOKEN"):
        environment.pop(key, None)
    if capability:
        for key in ("ACTIONS_ID_TOKEN_REQUEST_TOKEN", "ACTIONS_ID_TOKEN_REQUEST_URL"):
            if key in os.environ:
                environment[key] = os.environ[key]


def _render_script(script, shell, directory, environment):
    template = Path(script).read_text(encoding="utf-8")
    for name in re.findall(r"@@(QL_EXPR_[0-9]+)@@", template):
        require(name in os.environ)
        template = template.replace("@@" + name + "@@", os.environ[name])
        environment.pop(name, None)
    rendered = directory / ("command.ps1" if shell == "pwsh" else "command.sh")
    rendered.write_text(template, encoding="utf-8")
    rendered.chmod(0o600)
    return str(rendered)


def _build_command(shell, executable, script):
    if shell == "bash":
        return [executable, "--noprofile", "--norc", "-e", "-o", "pipefail", script]
    if shell == "pwsh":
        pwsh_body = "$ErrorActionPreference='Stop'; . '" + script.replace("'", "''") + "'; if (Test-Path variable:LASTEXITCODE) { exit $LASTEXITCODE }"
        return [executable, "-NoLogo", "-NoProfile", "-NonInteractive", "-Command", pwsh_body]
    return [executable, script]


def _collect_channel_exports(channel, rules, directory):
    require(isinstance(rules, dict))
    content = (directory / channel).read_text(encoding="utf-8-sig")
    require(len(content) <= 32768)
    seen = set()
    rows = []
    for line in content.splitlines():
        key, separator, value = line.partition("=")
        require(bool(separator) and key not in seen and key in rules and checked(value, rules[key]))
        seen.add(key)
        rows.append((channel, key, value))
    return rows


def _forward_exports(contract, directory, original):
    exports = []
    for channel, rules in contract.items():
        exports.extend(_collect_channel_exports(channel, rules, directory))
    # Never forward state, summaries, PATH, annotations or command output.
    # Only the reviewed scalar contract reaches the actual Actions files.
    for channel, key, value in exports:
        require(bool(original[channel]))
        with Path(original[channel]).open("a", encoding="utf-8") as target:
            target.write(key + "=" + value + "\n")


def _file_sha256(path):
    digest = hashlib.sha256()
    with path.open("rb") as content:
        for chunk in iter(lambda: content.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _execute_sealed(command, environment, log):
    child = None
    job = None
    try:
        with log.open("xb") as output:
            log.chmod(0o600)
            if os.name == "nt":
                job = WindowsJob()
            child = subprocess.Popen(
                command,
                env=environment,
                stdout=output,
                stderr=subprocess.STDOUT,
                start_new_session=os.name != "nt",
                creationflags=0x00000004 if os.name == "nt" else 0,
            )
            if job is not None:
                job.admit(child)
            for event in (signal.SIGTERM, signal.SIGINT):
                signal.signal(event, lambda _signal, _frame: (_ for _ in ()).throw(InterruptedError()))
            code = child.wait()
        # Freeze all diagnostic/IPC writers before inspecting or forwarding any result.
        kill_owned(child, job)
        child = None
        job = None
        return code
    finally:
        if child is not None:
            kill_owned(child, job)
        elif job is not None:
            job.close()


def main():
    if len(sys.argv) != 3 or sys.argv[1] not in ("bash", "pwsh", "msys2"):
        return 64
    shell, script = sys.argv[1:]
    directory = Path(tempfile.mkdtemp(prefix="ql-private-release-", dir=os.environ["RUNNER_TEMP"]))
    directory.chmod(0o700)
    original = {key: os.environ.get(key) for key in CHANNELS}
    environment = _prepare_environment(directory)
    contract = json.loads(os.environ.get("QL_RELEASE_EXPORTS", "{}"))
    _admit_signing_stage(shell, script, contract, environment)
    environment.pop("QL_RELEASE_CAPABILITIES", None)
    environment.pop("QL_RELEASE_EXPORTS", None)
    scope = failure_scope()
    history_reports = history_report_directory(scope, shell, script, directory, environment)
    script = _render_script(script, shell, directory, environment)
    if not isinstance(contract, dict) or set(contract) - {"GITHUB_ENV", "GITHUB_OUTPUT"}:
        return 64
    executable = shutil.which(shell)
    if not executable:
        return 69
    command = _build_command(shell, executable, script)
    log = directory / "diagnostics.private"
    report_directory = tempfile.TemporaryDirectory(prefix="cockpit-reports-", dir=directory)
    cockpit_reports = Path(report_directory.name).resolve()
    environment[COCKPIT_REPORT_DIR] = str(cockpit_reports)
    started = time.time()
    try:
        code = _execute_sealed(command, environment, log)
        if code != 0:
            print(failure_metadata(scope, started, log, cockpit_reports, history_reports))
            return code if 0 < code < 126 else 1
        _forward_exports(contract, directory, original)
        print(json.dumps({"kind": "sealed-release-command", "exitCode": 0, "diagnosticsSha256": _file_sha256(log)}, separators=(",", ":")))
        return 0
    finally:
        report_directory.cleanup()


if __name__ == "__main__":
    try:
        result = main()
    except (Exception, KeyboardInterrupt):
        # Exception strings can contain source, commands or private provider output.
        print("Private release command refused; details remain private.")
        sys.exit(1)
    else:
        sys.exit(result)
