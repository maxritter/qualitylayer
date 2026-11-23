"""Workspace source-verification and bounded-read helpers for sealed release commands."""
import hashlib
import os
from pathlib import Path
import re
import shlex
import shutil
import stat
import subprocess

COCKPIT_TEST = "qualitylayer/tests/e2e/cockpit-gate.test.ts"
COCKPIT_REPORT_DIR = "QL_PRIVATE_COCKPIT_REPORT_DIR"
HISTORY_TESTS = {
    "qualitylayer/tests/frontend/conversation-history.spec.ts",
    "qualitylayer/tests/frontend/conversation-turns.spec.ts",
}
HISTORY_COMMAND = ".github/private-workflows/ci-commands/d9861aee63b0ad189debdd660a0499df79a3750884be357e15cce66a7b0bde7a.sh"
HISTORY_REPORT_DIR = "QL_PRIVATE_HISTORY_REPORT_DIR"


class _BodyMismatch(Exception):
    pass


def require(ok):
    if not ok:
        raise ValueError()


def git_head(workspace):
    return subprocess.check_output(
        ["git", "-C", str(workspace), "rev-parse", "HEAD"], stderr=subprocess.DEVNULL, timeout=5
    ).decode().strip()


def test_record_directory(workspace):
    directory = workspace
    for part in ("qualitylayer", "dist", "test-runs"):
        directory = directory / part
        valid = not directory.is_symlink() and directory.resolve() == directory
        require(valid and (not directory.exists() or directory.is_dir()))
    return directory


def trusted_git_crypt(workspace):
    try:
        command = subprocess.check_output(
            ["git", "-C", str(workspace), "config", "--get", "filter.git-crypt.smudge"],
            stderr=subprocess.DEVNULL,
            timeout=5,
        ).decode().strip()
        process = subprocess.run(
            ["git", "-C", str(workspace), "config", "--get", "filter.git-crypt.process"],
            capture_output=True,
            timeout=5,
        )
        require(process.returncode in (0, 1) and not process.stdout.strip())
        parts = shlex.split(command)
        require(len(parts) == 2 and Path(parts[0]).name == "git-crypt" and parts[1] == "smudge")
        executable = Path(shutil.which(parts[0]) or parts[0]).resolve(strict=True)
        require(executable.is_file() and executable.stat().st_size <= 16 * 1024 * 1024)
        return (command, str(executable), hashlib.sha256(executable.read_bytes()).hexdigest())
    except Exception:
        return None


def _tracked_test_paths(tree):
    tracked = set()
    for row in filter(None, tree.split(b"\0")):
        metadata, path = row.split(b"\t", 1)
        mode, kind, _oid = metadata.split()
        decoded = path.decode("utf-8")
        is_tracked_test = decoded in HISTORY_TESTS or decoded.endswith((".test.ts", ".test.tsx"))
        if mode in (b"100644", b"100755") and kind == b"blob" and is_tracked_test:
            tracked.add(decoded)
    return tracked


def failure_scope():
    try:
        workspace = Path(os.environ["GITHUB_WORKSPACE"]).resolve(strict=True)
        head = git_head(workspace)
        require(bool(re.fullmatch(r"[a-f0-9]{40}", head)) and os.environ.get("GITHUB_SHA", head) == head)
        tree = subprocess.check_output(
            ["git", "-C", str(workspace), "ls-tree", "-r", "-z", "--full-tree", "HEAD", "--", "qualitylayer/tests", "qualitylayer/src"],
            stderr=subprocess.DEVNULL,
            timeout=5,
        )
        require(len(tree) <= 4 * 1024 * 1024)
        tracked = _tracked_test_paths(tree)
        existing = {path.name for path in test_record_directory(workspace).glob("*.json")}
        require(len(existing) <= 1024)
        return (workspace, head, tracked, existing, trusted_git_crypt(workspace))
    except Exception:
        return None


def json_object(pairs):
    value = dict(pairs)
    require(len(value) == len(pairs))
    return value


def invalid_json_constant(_value):
    raise ValueError()


def _stat_identity(value):
    return (value.st_dev, value.st_ino, value.st_size, value.st_mtime_ns, value.st_nlink)


def read_bounded_regular(path, limit, window=None):
    before = path.lstat()
    require(stat.S_ISREG(before.st_mode) and before.st_nlink == 1 and before.st_size <= limit)
    require(window is None or window[0] <= before.st_mtime <= window[1])
    flags = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_NONBLOCK", 0)
    with os.fdopen(os.open(path, flags), "rb") as source:
        opened = os.fstat(source.fileno())
        content = source.read(limit + 1)
        after = os.fstat(source.fileno())
    expected = _stat_identity(before)
    require(len(content) <= limit and all(_stat_identity(item) == expected for item in (opened, after, path.lstat())))
    return content


def _require_body(ok):
    if not ok:
        raise _BodyMismatch()


def _crypt_options(workspace, crypt, encrypted):
    if not encrypted:
        return []
    _require_body(crypt is not None and trusted_git_crypt(workspace) == crypt)
    # Use only the pre-command admitted existing tool, never a child-supplied filter.
    return ["-c", "filter.git-crypt.smudge=" + shlex.quote(crypt[1]) + " smudge", "-c", "filter.git-crypt.required=true"]


def committed_test_body(scope, file):
    """Validate one committed source against its current working bytes."""
    workspace, head, tracked, _existing, crypt = scope
    environment = {**os.environ, "GIT_ATTR_SOURCE": head}
    try:
        _require_body(file in tracked)
        reference = head + ":" + file
        size = subprocess.check_output(["git", "-C", str(workspace), "cat-file", "-s", reference], stderr=subprocess.DEVNULL, timeout=5)
        _require_body(int(size) <= 2 * 1024 * 1024)
        attribute = subprocess.check_output(["git", "-C", str(workspace), "check-attr", "--source=" + head, "-z", "filter", "--", file], stderr=subprocess.DEVNULL, timeout=5)
        allowed = {(file + "\0filter\0" + name + "\0").encode() for name in ("unspecified", "unset", "git-crypt")}
        _require_body(attribute in allowed)
        encrypted = attribute.endswith(b"git-crypt\0")
        options = _crypt_options(workspace, crypt, encrypted)
        body = subprocess.check_output(["git", "-C", str(workspace), *options, "cat-file", "--filters" if encrypted else "blob", reference], env=environment, stderr=subprocess.DEVNULL, timeout=5)
        _require_body(len(body) <= 2 * 1024 * 1024 and not body.startswith(b"\x00GITCRYPT\x00"))
        working = workspace / file
        _require_body(working.resolve() == working and read_bounded_regular(working, 2 * 1024 * 1024) == body)
        return body
    except _BodyMismatch:
        return None


def committed_test_line_counts(scope, files):
    counts = {}
    for file in files:
        body = committed_test_body(scope, file)
        if body is not None:
            # Preserve the UTF-8 validation without retaining the decoded source.
            body.decode("utf-8", errors="strict")
            counts[file] = body.count(b"\n") + int(bool(body) and not body.endswith(b"\n"))
    return counts
