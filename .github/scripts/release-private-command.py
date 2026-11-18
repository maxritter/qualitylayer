#!/usr/bin/env python3
"""Run a release command with private diagnostics and explicit scalar exports."""
import hashlib
import json
import math
import os
from pathlib import Path
import re
import shutil
import shlex
import signal
import stat
import subprocess
import sys
import tempfile
import time
import unicodedata
import xml.etree.ElementTree as ET
from urllib.parse import urlsplit

CHANNELS = ("GITHUB_ENV", "GITHUB_OUTPUT", "GITHUB_STATE", "GITHUB_STEP_SUMMARY", "GITHUB_PATH")
CAPABILITIES = ("ACTIONS_RUNTIME_TOKEN", "ACTIONS_RUNTIME_URL", "ACTIONS_RESULTS_URL", "ACTIONS_CACHE_URL", "ACTIONS_CACHE_SERVICE_V2", "ACTIONS_ID_TOKEN_REQUEST_TOKEN", "ACTIONS_ID_TOKEN_REQUEST_URL", "GH_TOKEN", "GITHUB_TOKEN")
COCKPIT_TEST = "qualitylayer/tests/e2e/cockpit-gate.test.ts"
COCKPIT_REPORT_DIR = "QL_PRIVATE_COCKPIT_REPORT_DIR"
HISTORY_TESTS = {"qualitylayer/tests/frontend/conversation-history.spec.ts", "qualitylayer/tests/frontend/conversation-turns.spec.ts"}
HISTORY_COMMAND = ".github/private-workflows/ci-commands/d9861aee63b0ad189debdd660a0499df79a3750884be357e15cce66a7b0bde7a.sh"
HISTORY_REPORT_DIR = "QL_PRIVATE_HISTORY_REPORT_DIR"

def test_record_directory(workspace):
    directory = workspace
    for part in ("qualitylayer", "dist", "test-runs"):
        directory = directory / part
        if directory.is_symlink() or directory.resolve() != directory or (directory.exists() and not directory.is_dir()):
            raise ValueError()
    return directory

def trusted_git_crypt(workspace):
    try:
        command = subprocess.check_output(["git", "-C", str(workspace), "config", "--get", "filter.git-crypt.smudge"], stderr=subprocess.DEVNULL, timeout=5).decode().strip()
        process = subprocess.run(["git", "-C", str(workspace), "config", "--get", "filter.git-crypt.process"], capture_output=True, timeout=5)
        if process.returncode not in (0, 1) or process.stdout.strip():
            return None
        parts = shlex.split(command)
        if len(parts) != 2 or Path(parts[0]).name != "git-crypt" or parts[1] != "smudge":
            return None
        executable = Path(shutil.which(parts[0]) or parts[0]).resolve(strict=True)
        if not executable.is_file() or executable.stat().st_size > 16 * 1024 * 1024:
            return None
        return (command, str(executable), hashlib.sha256(executable.read_bytes()).hexdigest())
    except Exception:
        return None

def failure_scope():
    try:
        workspace = Path(os.environ["GITHUB_WORKSPACE"]).resolve(strict=True)
        head = subprocess.check_output(["git", "-C", str(workspace), "rev-parse", "HEAD"], stderr=subprocess.DEVNULL, timeout=5).decode().strip()
        if not re.fullmatch(r"[a-f0-9]{40}", head) or os.environ.get("GITHUB_SHA", head) != head:
            return None
        tree = subprocess.check_output(["git", "-C", str(workspace), "ls-tree", "-r", "-z", "--full-tree", "HEAD", "--", "qualitylayer/tests", "qualitylayer/src"], stderr=subprocess.DEVNULL, timeout=5)
        if len(tree) > 4 * 1024 * 1024:
            return None
        tracked = set()
        for row in tree.split(b"\0"):
            if row:
                metadata, path = row.split(b"\t", 1)
                mode, kind, _oid = metadata.split()
                path = path.decode("utf-8")
                if mode in (b"100644", b"100755") and kind == b"blob" and (path in HISTORY_TESTS or path.endswith((".test.ts", ".test.tsx"))):
                    tracked.add(path)
        existing = {path.name for path in test_record_directory(workspace).glob("*.json")}
        return (workspace, head, tracked, existing, trusted_git_crypt(workspace)) if len(existing) <= 1024 else None
    except Exception:
        return None

def json_object(pairs):
    value = dict(pairs)
    if len(value) != len(pairs):
        raise ValueError()
    return value

def invalid_json_constant(_value):
    raise ValueError()

def read_bounded_regular(path, limit, window=None):
    before = path.lstat()
    if not stat.S_ISREG(before.st_mode) or before.st_nlink != 1 or before.st_size > limit:
        raise ValueError()
    if window is not None and not window[0] <= before.st_mtime <= window[1]:
        raise ValueError()
    with os.fdopen(os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_NONBLOCK", 0)), "rb") as source:
        opened = os.fstat(source.fileno())
        content = source.read(limit + 1)
        after = os.fstat(source.fileno())
    def identity(value):
        return (value.st_dev, value.st_ino, value.st_size, value.st_mtime_ns, value.st_nlink)
    if len(content) > limit or any(identity(value) != identity(before) for value in (opened, after, path.lstat())):
        raise ValueError()
    return content

def test_run_record(path, window):
    content = read_bounded_regular(path, 1024 * 1024, window)
    record = json.loads(content, object_pairs_hook=json_object, parse_constant=invalid_json_constant)
    if not isinstance(record, dict) or type(record.get("schema")) is not int or record["schema"] != 1 or record.get("state") not in ("passed", "failed", "interrupted", "incomplete") or record.get("sourceDrift") != [] or not isinstance(record.get("results"), list):
        raise ValueError()
    build = record.get("buildSource")
    if build is not None and (not isinstance(build, dict) or build.get("mode") not in ("private-binary-build-source", "provided-runtime") or build.get("tests") != "live-source"):
        raise ValueError()
    return record

def failed_test_paths(scope, window):
    try:
        if scope is None:
            return [], {}
        workspace, head, tracked, existing, _crypt = scope
        tracked = tracked - HISTORY_TESTS
        current = subprocess.check_output(["git", "-C", str(workspace), "rev-parse", "HEAD"], stderr=subprocess.DEVNULL, timeout=5).decode().strip()
        if current != head:
            return [], {}
        records = [path for path in test_record_directory(workspace).glob("*.json") if path.name not in existing]
        if len(records) > 32:
            return [], {}
        failed = set()
        cockpit = {}
        relative = COCKPIT_TEST.removeprefix("qualitylayer/")
        for path in records:
            record = test_run_record(path, window)
            last_cockpit = None
            if len(record["results"]) > 2048:
                return [], {}
            for row in record["results"]:
                file = row.get("file") if isinstance(row, dict) else None
                if not isinstance(file, str) or not file.startswith(("tests/", "src/")) or len(file) > 1024 or "\\" in file or any(part in ("", ".", "..") for part in file.split("/")) or any(unicodedata.category(char) in ("Cc", "Cf", "Zl", "Zp") for char in file) or "qualitylayer/" + file not in tracked or any(type(row.get(key)) is not int for key in ("code", "pass", "fail")) or row["pass"] < 0 or row["fail"] < 0 or type(row.get("seconds")) not in (int, float) or not math.isfinite(row["seconds"]) or row["seconds"] < 0 or ("signal" in row and not isinstance(row["signal"], str)):
                    return [], {}
                if file == relative:
                    last_cockpit = row
                if record["state"] != "passed" and (row["code"] != 0 or row["fail"] > 0 or row.get("signal")):
                    failed.add("qualitylayer/" + file)
            # The reporter is replaced on a retry. File-level failures have no case line.
            if record["state"] == "failed" and last_cockpit and last_cockpit["code"] != 0 and last_cockpit["fail"] > 0 and re.fullmatch(r"[0-9TZ-]{20,64}", path.stem):
                cockpit[path.stem] = last_cockpit["fail"]
        return (sorted(failed), cockpit) if len(failed) <= 2048 else ([], {})
    except Exception:
        return [], {}

def committed_test_body(scope, file):
    """Validate one committed source against its current working bytes."""
    workspace, head, tracked, _existing, crypt = scope
    environment = {**os.environ, "GIT_ATTR_SOURCE": head}
    if file not in tracked:
        return None
    reference = head + ":" + file
    size = subprocess.check_output(["git", "-C", str(workspace), "cat-file", "-s", reference], stderr=subprocess.DEVNULL, timeout=5)
    if int(size) > 2 * 1024 * 1024:
        return None
    attribute = subprocess.check_output(["git", "-C", str(workspace), "check-attr", "--source=" + head, "-z", "filter", "--", file], stderr=subprocess.DEVNULL, timeout=5)
    if attribute not in ((file + "\0filter\0" + name + "\0").encode() for name in ("unspecified", "unset", "git-crypt")):
        return None
    encrypted = attribute.endswith(b"git-crypt\0")
    options = []
    if encrypted:
        if crypt is None or trusted_git_crypt(workspace) != crypt:
            return None
        # Use only the pre-command admitted existing tool, never a child-supplied filter.
        options = ["-c", "filter.git-crypt.smudge=" + shlex.quote(crypt[1]) + " smudge", "-c", "filter.git-crypt.required=true"]
    body = subprocess.check_output(["git", "-C", str(workspace), *options, "cat-file", "--filters" if encrypted else "blob", reference], env=environment, stderr=subprocess.DEVNULL, timeout=5)
    if len(body) > 2 * 1024 * 1024 or body.startswith(b"\x00GITCRYPT\x00"):
        return None
    working = workspace / file
    if working.resolve() != working or read_bounded_regular(working, 2 * 1024 * 1024) != body:
        return None
    return body

def committed_test_line_counts(scope, files):
    counts = {}
    for file in files:
        body = committed_test_body(scope, file)
        if body is not None:
            # Preserve the UTF-8 validation without retaining the decoded source.
            body.decode("utf-8", errors="strict")
            counts[file] = body.count(b"\n") + int(bool(body) and not body.endswith(b"\n"))
    return counts

def cockpit_declarations(source):
    lines = source.split("\n")
    declarations = {}
    for line, text in enumerate(lines[:-1], 1):
        if text != "  test(":
            continue
        literal = re.fullmatch(r'    ("[^"\\\r\n]+"),', lines[line])
        if literal is None:
            raise ValueError()
        # Bun reports the title token's line for this multiline call.
        declarations[line + 1] = (line, json.loads(literal[1]))
    if not declarations or len(declarations) > 32 or len({name for _, name in declarations.values()}) != len(declarations):
        raise ValueError()
    return declarations

def cockpit_report_locations(text, paths, declarations, failed_count):
    if "<!" in text:
        raise ValueError()
    tree = ET.fromstring(text)
    cases = list(tree.iter("testcase"))
    if tree.tag != "testsuites" or tree.get("name") != "bun test" or len(cases) != len(declarations):
        raise ValueError()
    seen, found = set(), set()
    for case in cases:
        title_line = case.get("line", "")
        if not re.fullmatch(r"[1-9][0-9]{0,5}", title_line):
            raise ValueError()
        line = int(title_line)
        declaration = declarations.get(line)
        if line in seen or declaration is None or declaration[1] != case.get("name") or case.get("file") not in paths:
            raise ValueError()
        seen.add(line)
        failures = case.findall("failure")
        if len(failures) > 1:
            raise ValueError()
        if failures:
            kind = {"TimeoutError": "timeout", "AssertionError": "assertion"}.get(failures[0].get("type"), "unknown")
            found.add((declaration[0], kind))
    if len(found) != failed_count:
        raise ValueError()
    return found

def cockpit_failure_locations(scope, reports, directory, window):
    """Read Bun's private case records, with static declarations as the sole source of lines."""
    if not reports or directory is None:
        return []
    try:
        workspace, head, _tracked, _existing, _crypt = scope
        if directory.is_symlink() or directory.resolve() != directory:
            return []
        body = committed_test_body(scope, COCKPIT_TEST)
        if body is None:
            return []
        declarations = cockpit_declarations(body.decode("utf-8", errors="strict"))
        relative = COCKPIT_TEST.removeprefix("qualitylayer/")
        paths = (str(workspace / COCKPIT_TEST), relative, "./" + relative)
        found = set()
        for identifier, failed_count in reports.items():
            path = directory / (identifier + ".xml")
            if path.exists():
                text = read_bounded_regular(path, 256 * 1024, window).decode("utf-8", errors="strict")
                found.update(cockpit_report_locations(text, paths, declarations, failed_count))
        current = subprocess.check_output(["git", "-C", str(workspace), "rev-parse", "HEAD"], stderr=subprocess.DEVNULL, timeout=5).decode().strip()
        return [{"file": COCKPIT_TEST, "line": line, "kind": kind} for line, kind in sorted(found)] if current == head else []
    except Exception:
        return []

def failed_test_locations(scope, files, log):
    try:
        if scope is None or not files or len(files) > 64 or log is None:
            return []
        content = read_bounded_regular(log, 8 * 1024 * 1024)
        counts = committed_test_line_counts(scope, [file for file in files if file != COCKPIT_TEST])
        workspace, head, _tracked, _existing, _crypt = scope
        found, context = set(), []
        clean = re.sub(r"\x1b\[[0-9;]*m", "", content.decode("utf-8", errors="strict"))
        for line in clean.splitlines():
            if len(line) > 16 * 1024:
                context = []
                continue
            if re.fullmatch(r"──── (?:FAIL )?(?:tests|src)/[^\r\n]+ ────", line):
                context = []
            # Bun stacks may contain names/values; only the independently validated location escapes.
            context = (context + [line])[-16:]
            for file, maximum in counts.items():
                relative = file.removeprefix("qualitylayer/")
                paths = (str(workspace / file), "./" + relative, relative, file)
                frame = re.search(r"(?:^|[\s(])(?:" + "|".join(re.escape(path) for path in paths) + r"):([1-9][0-9]{0,8})(?::[1-9][0-9]{0,8})?\)?\s*$", line)
                if frame is None or int(frame[1]) > maximum:
                    continue
                nearby = "\n".join(context)
                kind = "timeout" if re.search(r"(?:^|\n)(?:TimeoutError:|error: Test [^\n]* timed out after [0-9]+ ?ms)", nearby) else "assertion" if re.search(r"(?:^|\n)(?:AssertionError:|error: expect\()", nearby) else "process" if re.search(r"(?:^|\n)exit -?[0-9]+ · signal (?:SIG[A-Z0-9]+|[1-9][0-9]*)\s*(?:\n|$)", nearby) else "unknown"
                found.add((file, int(frame[1]), kind))
                if len(found) > 256:
                    return []
        current = subprocess.check_output(["git", "-C", str(workspace), "rev-parse", "HEAD"], stderr=subprocess.DEVNULL, timeout=5).decode().strip()
        return [{"file": file, "line": line, "kind": kind} for file, line, kind in sorted(found)] if current == head else []
    except Exception:
        return []

def history_report_directory(scope, shell, script, directory, environment):
    environment.pop(HISTORY_REPORT_DIR, None)
    if scope is None or shell != "bash":
        return None
    path = Path(script).resolve()
    if path != scope[0] / HISTORY_COMMAND or hashlib.sha256(path.read_bytes()).hexdigest() != path.stem:
        return None
    report = directory / "history-reports"
    report.mkdir(mode=0o700)
    environment[HISTORY_REPORT_DIR] = str(report)
    return report

def read_history_rows(directory, window):
    if directory.resolve() != directory:
        raise ValueError()
    report = json.loads(read_bounded_regular(directory / "results.json", 8192, window), object_pairs_hook=json_object)
    if not isinstance(report, dict) or set(report) != {"failures"}:
        raise ValueError()
    rows = report["failures"]
    if not isinstance(rows, list) or len(rows) > 32:
        raise ValueError()
    return rows

def allowed_history_location(row, declarations):
    if not isinstance(row, dict) or set(row) != {"file", "line", "kind"}:
        return False
    line = row["line"]
    valid_line = type(line) is int and line in declarations.get(row["file"], ())
    return valid_line and row["kind"] in ("assertion", "timeout", "process", "unknown")

def history_failure_locations(scope, directory, window):
    if scope is None or directory is None:
        return []
    try:
        current = subprocess.check_output(["git", "-C", str(scope[0]), "rev-parse", "HEAD"], stderr=subprocess.DEVNULL, timeout=5).decode().strip()
        if current != scope[1]:
            return []
        rows = read_history_rows(directory, window)
        declarations = {}
        for file in HISTORY_TESTS:
            body = committed_test_body(scope, file)
            if body is not None:
                declarations[file] = {number for number, line in enumerate(body.decode().splitlines(), 1) if line.lstrip().startswith("test(")}
        return rows if all(allowed_history_location(row, declarations) for row in rows) else []
    except (OSError, ValueError, TypeError, subprocess.SubprocessError):
        return []

def failure_metadata(scope, started, log=None, cockpit_reports=None, history_reports=None):
    window = (started, time.time())
    files, reports = failed_test_paths(scope, window)
    locations = failed_test_locations(scope, files, log) + cockpit_failure_locations(scope, reports, cockpit_reports, window)
    history = history_failure_locations(scope, history_reports, window)
    files = sorted(set(files) | {row["file"] for row in history})
    locations.extend(history)
    metadata = {"failedTestFiles": files, "failedTestLocations": sorted(locations, key=lambda row: (row["file"], row["line"], row["kind"])) if len(locations) <= 256 else []}
    # Keep exact JSON values without allowing tracked filenames to become Actions commands.
    return json.dumps(metadata, ensure_ascii=True, separators=(",", ":")).replace("::", "\\u003a\\u003a").replace("#", "\\u0023").replace("%", "\\u0025")

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
    scope = failure_scope()
    history_reports = history_report_directory(scope, shell, script, directory, environment)
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
    report_directory = tempfile.TemporaryDirectory(prefix="cockpit-reports-", dir=directory)
    cockpit_reports = Path(report_directory.name).resolve()
    environment[COCKPIT_REPORT_DIR] = str(cockpit_reports)
    started = time.time()
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
            print(failure_metadata(scope, started, log, cockpit_reports, history_reports))
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
        try:
            if child is not None:
                kill_owned(child, job)
            elif job is not None:
                job.close()
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
