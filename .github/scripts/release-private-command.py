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

CHANNELS = ("GITHUB_ENV", "GITHUB_OUTPUT", "GITHUB_STATE", "GITHUB_STEP_SUMMARY", "GITHUB_PATH")
CAPABILITIES = ("ACTIONS_RUNTIME_TOKEN", "ACTIONS_RUNTIME_URL", "ACTIONS_RESULTS_URL", "ACTIONS_CACHE_URL", "ACTIONS_CACHE_SERVICE_V2", "ACTIONS_ID_TOKEN_REQUEST_TOKEN", "ACTIONS_ID_TOKEN_REQUEST_URL", "GH_TOKEN", "GITHUB_TOKEN")

def checked(value, kind):
    if not isinstance(value, str) or not value or len(value) > 2048 or any(ord(c) < 32 for c in value):
        raise ValueError()
    if kind == "sha256":
        return bool(re.fullmatch(r"[a-f0-9]{64}", value))
    if kind == "id":
        return bool(re.fullmatch(r"[1-9][0-9]{0,19}", value))
    if kind == "boolean":
        return value in ("true", "false")
    if kind == "version":
        return bool(re.fullmatch(r"(?:1[2-9]|[2-9][0-9]|[1-9][0-9]{2,})\.[0-9]+\.[0-9]+(?:-[A-Za-z0-9.-]+)?", value))
    if kind == "public-url":
        url = urlsplit(value)
        host = url.hostname or ""
        return url.scheme == "https" and not url.username and not url.password and not url.query and not url.fragment and (host == "qualitylayer.dev" or bool(re.fullmatch(r"[a-z0-9.-]+\.(?:vercel\.app|qualitylayer\.dev)", host)))
    if kind == "azure-signing-profile":
        return bool(re.fullmatch(r"/subscriptions/[a-fA-F0-9-]{36}/resourceGroups/[A-Za-z0-9_.()-]{1,90}/providers/Microsoft\.CodeSigning/codeSigningAccounts/[A-Za-z0-9-]{1,63}/certificateProfiles/[A-Za-z0-9-]{1,63}", value))
    if kind == "source-sha":
        return bool(re.fullmatch(r"[a-f0-9]{40}", value))
    if kind == "windows-sign-command":
        command = json.loads(value)
        root = Path(os.environ["RUNNER_TEMP"]).resolve() / "ql-signing"
        executable = root / "microsoft.windows.sdk.buildtools" / "bin" / "10.0.28000.0" / "x64" / "signtool.exe"
        library = root / "microsoft.artifactsigning.client" / "bin" / "x64" / "Azure.CodeSigning.Dlib.dll"
        metadata = root / "metadata.json"
        expected = ['sign', '/v', '/fd', 'SHA256', '/tr', 'http://timestamp.acs.microsoft.com', '/td', 'SHA256', '/d', 'QualityLayer', '/dlib', str(library), '/dmdf', str(metadata), '%1']
        return isinstance(command, dict) and set(command) == {"cmd", "args"} and command["cmd"] == str(executable) and command["args"] == expected
    if kind == "temp-path":
        target = Path(value).resolve()
        temp = Path(os.environ["RUNNER_TEMP"]).resolve()
        return target != temp and temp in target.parents
    return False

class WindowsJob:
    def __init__(self):
        import ctypes
        from ctypes import wintypes
        self.ctypes = ctypes
        self.kernel = ctypes.WinDLL("kernel32", use_last_error=True)
        self.kernel.CreateJobObjectW.argtypes = [ctypes.c_void_p, wintypes.LPCWSTR]
        self.kernel.CreateJobObjectW.restype = wintypes.HANDLE
        self.kernel.SetInformationJobObject.argtypes = [wintypes.HANDLE, ctypes.c_int, ctypes.c_void_p, wintypes.DWORD]
        self.kernel.AssignProcessToJobObject.argtypes = [wintypes.HANDLE, wintypes.HANDLE]
        self.kernel.QueryInformationJobObject.argtypes = [wintypes.HANDLE, ctypes.c_int, ctypes.c_void_p, wintypes.DWORD, ctypes.c_void_p]
        self.kernel.TerminateJobObject.argtypes = [wintypes.HANDLE, wintypes.UINT]
        self.kernel.CloseHandle.argtypes = [wintypes.HANDLE]
        class Limits(ctypes.Structure):
            _fields_ = [("processTime", ctypes.c_int64), ("jobTime", ctypes.c_int64), ("flags", wintypes.DWORD), ("minimum", ctypes.c_size_t), ("maximum", ctypes.c_size_t), ("activeLimit", wintypes.DWORD), ("affinity", ctypes.c_size_t), ("priority", wintypes.DWORD), ("scheduling", wintypes.DWORD)]
        class Extended(ctypes.Structure):
            _fields_ = [("basic", Limits), ("io", ctypes.c_uint64 * 6), ("processMemory", ctypes.c_size_t), ("jobMemory", ctypes.c_size_t), ("peakProcessMemory", ctypes.c_size_t), ("peakJobMemory", ctypes.c_size_t)]
        self.handle = self.kernel.CreateJobObjectW(None, None)
        if not self.handle:
            raise OSError()
        limits = Extended()
        limits.basic.flags = 0x2000  # JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
        if not self.kernel.SetInformationJobObject(self.handle, 9, ctypes.byref(limits), ctypes.sizeof(limits)):
            self.kernel.CloseHandle(self.handle)
            raise OSError()

    def admit(self, child):
        # The child was created suspended: it cannot spawn outside this Job before admission.
        if not self.kernel.AssignProcessToJobObject(self.handle, int(child._handle)):
            child.kill()
            child.wait(timeout=3)
            raise OSError()
        ntdll = self.ctypes.WinDLL("ntdll")
        ntdll.NtResumeProcess.argtypes = [self.ctypes.c_void_p]
        ntdll.NtResumeProcess.restype = self.ctypes.c_long
        if ntdll.NtResumeProcess(int(child._handle)) != 0:
            raise OSError()

    def close(self):
        if not self.handle:
            return
        class Accounting(self.ctypes.Structure):
            _fields_ = [("times", self.ctypes.c_int64 * 4), ("faults", self.ctypes.c_uint32), ("total", self.ctypes.c_uint32), ("active", self.ctypes.c_uint32), ("terminated", self.ctypes.c_uint32)]
        try:
            if not self.kernel.TerminateJobObject(self.handle, 1):
                raise OSError()
            deadline = time.monotonic() + 5
            while True:
                accounting = Accounting()
                if not self.kernel.QueryInformationJobObject(self.handle, 1, self.ctypes.byref(accounting), self.ctypes.sizeof(accounting), None):
                    raise OSError()
                if accounting.active == 0:
                    break
                if time.monotonic() >= deadline:
                    raise TimeoutError()
                time.sleep(0.05)
        finally:
            self.kernel.CloseHandle(self.handle)
            self.handle = None

def kill_owned(child, job):
    if job is not None:
        job.close()
        child.wait(timeout=3)
        return
    # Group liveness is independent of the leader: the shell may already have exited.
    try:
        os.killpg(child.pid, signal.SIGTERM)
    except ProcessLookupError:
        child.wait(timeout=3)
        return
    deadline = time.monotonic() + 1
    while time.monotonic() < deadline:
        try:
            os.killpg(child.pid, 0)
        except ProcessLookupError:
            child.wait(timeout=3)
            return
        time.sleep(0.05)
    # Always send KILL to the remaining group, even when child.wait() would succeed.
    try:
        os.killpg(child.pid, signal.SIGKILL)
    except ProcessLookupError:
        pass
    child.wait(timeout=3)
    deadline = time.monotonic() + 5
    while True:
        try:
            os.killpg(child.pid, 0)
        except ProcessLookupError:
            return
        except PermissionError:
            # Darwin can return EPERM while a killed group is exiting. Inspect OS
            # states; an executing process still fails closed, and E/Z is polled.
            snapshot = subprocess.run(["ps", "-axo", "pgid=,stat="], capture_output=True, text=True, timeout=3)
            if snapshot.returncode != 0:
                raise OSError()
            states = []
            for line in snapshot.stdout.splitlines():
                fields = line.split()
                if len(fields) == 2 and fields[0] == str(child.pid):
                    states.append(fields[1])
            if not states:
                return
            if any(not state.startswith(("E", "Z")) for state in states):
                raise
        if time.monotonic() >= deadline:
            raise TimeoutError()
        time.sleep(0.05)

def main():
    if len(sys.argv) != 3 or sys.argv[1] not in ("bash", "pwsh", "msys2"):
        return 64
    shell, script = sys.argv[1:]
    directory = Path(tempfile.mkdtemp(prefix="ql-private-release-", dir=os.environ["RUNNER_TEMP"]))
    directory.chmod(0o700)
    original = {key: os.environ.get(key) for key in CHANNELS}
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
    contract = json.loads(os.environ.get("QL_RELEASE_EXPORTS", "{}"))
    capability = os.environ.get("QL_RELEASE_CAPABILITIES", "")
    signing_kinds = {"azure-signing-profile", "windows-sign-command"}
    signing_exports = isinstance(contract, dict) and any(isinstance(rules, dict) and signing_kinds.intersection(rules.values()) for rules in contract.values())
    if capability or signing_exports:
        workspace = Path(os.environ["GITHUB_WORKSPACE"]).resolve()
        signing = workspace / ".github/private-workflows/windows-signing"
        stages = {
            "preflight.ps1": ("bed235ca3fc1027c0bacc5d6fea7450a42d6a9bb27b3275e181e5a0c1ddbf32e", "windows-signing-oidc", {"GITHUB_OUTPUT": {"enabled": "boolean"}, "GITHUB_ENV": {"QUALITYLAYER_WINDOWS_SIGNING_PROFILE": "azure-signing-profile"}}),
            "setup.ps1": ("43b3e8db1fcc5b6a9d93036054ffd1038a35faa7febd2734ecee9df728e52990", "", {"GITHUB_ENV": {"QUALITYLAYER_WINDOWS_SIGN_COMMAND": "windows-sign-command"}}),
        }
        selected = Path(script).resolve()
        stage = stages.get(selected.name)
        workflow = os.environ.get("GITHUB_WORKFLOW_REF", "")
        trusted_workflows = ("maxritter/qualitylayer/.github/workflows/release.yml@refs/heads/main", "maxritter/qualitylayer/.github/workflows/release.yml@refs/heads/dev")
        if not stage or selected.parent != signing or hashlib.sha256(selected.read_bytes()).hexdigest() != stage[0] or capability != stage[1] or contract != stage[2] or shell != "pwsh" or os.name != "nt" or os.environ.get("GITHUB_REPOSITORY") != "maxritter/qualitylayer" or os.environ.get("GITHUB_REF") not in ("refs/heads/main", "refs/heads/dev") or workflow not in trusted_workflows:
            raise ValueError()
        if os.environ.get("GITHUB_SHA") != subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=workspace, text=True).strip():
            raise ValueError()
        if os.environ.get("QL_RELEASE_METADATA_CONTROL") == "true":
            raise ValueError()
        for key in ("GH_TOKEN", "GITHUB_TOKEN"):
            environment.pop(key, None)
        if capability:
            for key in ("ACTIONS_ID_TOKEN_REQUEST_TOKEN", "ACTIONS_ID_TOKEN_REQUEST_URL"):
                if key in os.environ:
                    environment[key] = os.environ[key]
    environment.pop("QL_RELEASE_CAPABILITIES", None)
    environment.pop("QL_RELEASE_EXPORTS", None)
    template = Path(script).read_text(encoding="utf-8")
    for name in re.findall(r"@@(QL_EXPR_[0-9]+)@@", template):
        if name not in os.environ:
            raise ValueError()
        template = template.replace("@@" + name + "@@", os.environ[name])
        environment.pop(name, None)
    rendered = directory / ("command.ps1" if shell == "pwsh" else "command.sh")
    rendered.write_text(template, encoding="utf-8")
    rendered.chmod(0o600)
    script = str(rendered)
    contract = json.loads(os.environ.get("QL_RELEASE_EXPORTS", "{}"))
    if not isinstance(contract, dict) or set(contract) - {"GITHUB_ENV", "GITHUB_OUTPUT"}:
        return 64
    executable = shutil.which(shell)
    if not executable:
        return 69
    command = [executable, "--noprofile", "--norc", "-e", "-o", "pipefail", script] if shell == "bash" else [executable, "-NoLogo", "-NoProfile", "-NonInteractive", "-Command", "$ErrorActionPreference='Stop'; . '" + script.replace("'", "''") + "'; if (Test-Path variable:LASTEXITCODE) { exit $LASTEXITCODE }"] if shell == "pwsh" else [executable, script]
    child = None
    job = None
    log = directory / "diagnostics.private"
    try:
        with log.open("xb") as output:
            log.chmod(0o600)
            if os.name == "nt":
                job = WindowsJob()
            child = subprocess.Popen(command, env=environment, stdout=output, stderr=subprocess.STDOUT, start_new_session=os.name != "nt", creationflags=0x00000004 if os.name == "nt" else 0)
            if job is not None:
                job.admit(child)
            for event in (signal.SIGTERM, signal.SIGINT):
                signal.signal(event, lambda _signal, _frame: (_ for _ in ()).throw(InterruptedError()))
            code = child.wait()
        # Freeze all diagnostic/IPC writers before inspecting or forwarding any result.
        kill_owned(child, job)
        child = None
        job = None
        if code != 0:
            print("Private release command failed; diagnostics retained privately on the owned runner.")
            return code if 0 < code < 126 else 1
        exports = []
        for channel, rules in contract.items():
            if not isinstance(rules, dict):
                raise ValueError()
            content = (directory / channel).read_text(encoding="utf-8-sig")
            if len(content) > 32768:
                raise ValueError()
            seen = set()
            for line in content.splitlines():
                key, separator, value = line.partition("=")
                if not separator or key in seen or key not in rules or not checked(value, rules[key]):
                    raise ValueError()
                seen.add(key)
                exports.append((channel, key, value))
        # Never forward state, summaries, PATH, annotations or command output.
        # Only the reviewed scalar contract reaches the actual Actions files.
        for channel, key, value in exports:
            if not original[channel]:
                raise ValueError()
            with Path(original[channel]).open("a", encoding="utf-8") as target:
                target.write(key + "=" + value + "\n")
        digest = hashlib.sha256()
        with log.open("rb") as content:
            for chunk in iter(lambda: content.read(1024 * 1024), b""):
                digest.update(chunk)
        print(json.dumps({"kind": "sealed-release-command", "exitCode": 0, "diagnosticsSha256": digest.hexdigest()}, separators=(",", ":")))
        return 0
    finally:
        if child is not None:
            kill_owned(child, job)
        elif job is not None:
            job.close()

if __name__ == "__main__":
    try:
        result = main()
    except (Exception, KeyboardInterrupt):
        # Exception strings can contain source, commands or private provider output.
        print("Private release command refused; details remain private.")
        sys.exit(1)
    else:
        sys.exit(result)
