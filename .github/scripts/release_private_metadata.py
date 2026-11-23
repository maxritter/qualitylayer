"""Failure-metadata extraction from test-run records, logs, and Playwright history reports."""
import hashlib
import json
import math
from pathlib import Path
import re
import subprocess
import sys
import time
import unicodedata

_SCRIPTS_DIR = str(Path(__file__).resolve().parent)
if _SCRIPTS_DIR not in sys.path:
    sys.path.insert(0, _SCRIPTS_DIR)

from release_private_cockpit import cockpit_failure_locations
from release_private_source import (
    COCKPIT_TEST,
    HISTORY_COMMAND,
    HISTORY_REPORT_DIR,
    HISTORY_TESTS,
    committed_test_body,
    committed_test_line_counts,
    git_head,
    invalid_json_constant,
    json_object,
    read_bounded_regular,
    require,
    test_record_directory,
)

RECORD_STATES = ("passed", "failed", "interrupted", "incomplete")
BUILD_MODES = ("private-binary-build-source", "provided-runtime")
HEADER_LINE_RE = re.compile(r"──── (?:FAIL )?(?:tests|src)/[^\r\n]+ ────")
ANSI_RE = re.compile(r"\x1b\[[0-9;]*m")
KIND_PATTERNS = (
    (re.compile(r"(?:^|\n)(?:TimeoutError:|error: Test [^\n]* timed out after [0-9]+ ?ms)"), "timeout"),
    (re.compile(r"(?:^|\n)(?:AssertionError:|error: expect\()"), "assertion"),
    (re.compile(r"(?:^|\n)exit -?[0-9]+ · signal (?:SIG[A-Z0-9]+|[1-9][0-9]*)\s*(?:\n|$)"), "process"),
)


def test_run_record(path, window):
    content = read_bounded_regular(path, 1024 * 1024, window)
    record = json.loads(content, object_pairs_hook=json_object, parse_constant=invalid_json_constant)
    require(isinstance(record, dict) and type(record.get("schema")) is int and record["schema"] == 1)
    require(record.get("state") in RECORD_STATES and record.get("sourceDrift") == [])
    require(isinstance(record.get("results"), list))
    build = record.get("buildSource")
    if build is not None:
        require(isinstance(build, dict) and build.get("mode") in BUILD_MODES and build.get("tests") == "live-source")
    return record


def _validate_result_path(file, tracked):
    require(isinstance(file, str) and file.startswith(("tests/", "src/")))
    require(len(file) <= 1024 and "\\" not in file)
    require(all(part not in ("", ".", "..") for part in file.split("/")))
    require(all(unicodedata.category(char) not in ("Cc", "Cf", "Zl", "Zp") for char in file))
    require("qualitylayer/" + file in tracked)


def _validate_result_row(row, tracked):
    require(isinstance(row, dict))
    file = row.get("file")
    _validate_result_path(file, tracked)
    require(all(type(row.get(key)) is int for key in ("code", "pass", "fail")))
    require(row["pass"] >= 0 and row["fail"] >= 0)
    seconds = row.get("seconds")
    require(type(seconds) in (int, float) and math.isfinite(seconds) and seconds >= 0)
    require("signal" not in row or isinstance(row["signal"], str))
    return file


def _collect_record_failures(path, window, tracked, failed, cockpit):
    record = test_run_record(path, window)
    require(len(record["results"]) <= 2048)
    relative_cockpit = COCKPIT_TEST.removeprefix("qualitylayer/")
    last_cockpit = None
    for row in record["results"]:
        file = _validate_result_row(row, tracked)
        if file == relative_cockpit:
            last_cockpit = row
        failed_row = row["code"] != 0 or row["fail"] > 0 or row.get("signal")
        if record["state"] != "passed" and failed_row:
            failed.add("qualitylayer/" + file)
    # The reporter is replaced on a retry. File-level failures have no case line.
    is_cockpit_failure = (
        record["state"] == "failed"
        and last_cockpit is not None
        and last_cockpit["code"] != 0
        and last_cockpit["fail"] > 0
    )
    if is_cockpit_failure and re.fullmatch(r"[0-9TZ-]{20,64}", path.stem):
        cockpit[path.stem] = last_cockpit["fail"]


def failed_test_paths(scope, window):
    try:
        require(scope is not None)
        workspace, head, tracked, existing, _crypt = scope
        tracked = tracked - HISTORY_TESTS
        require(git_head(workspace) == head)
        records = [path for path in test_record_directory(workspace).glob("*.json") if path.name not in existing]
        require(len(records) <= 32)
        failed, cockpit = set(), {}
        for path in records:
            _collect_record_failures(path, window, tracked, failed, cockpit)
        require(len(failed) <= 2048)
        return sorted(failed), cockpit
    except Exception:
        return [], {}


def _classify_failure_kind(nearby):
    for pattern, kind in KIND_PATTERNS:
        if pattern.search(nearby):
            return kind
    return "unknown"


def _scan_frame_line(line, context, workspace, counts, found):
    for file, maximum in counts.items():
        relative = file.removeprefix("qualitylayer/")
        paths = (str(workspace / file), "./" + relative, relative, file)
        pattern = r"(?:^|[\s(])(?:" + "|".join(re.escape(path) for path in paths) + r"):([1-9][0-9]{0,8})(?::[1-9][0-9]{0,8})?\)?\s*$"
        frame = re.search(pattern, line)
        if frame is None or int(frame[1]) > maximum:
            continue
        found.add((file, int(frame[1]), _classify_failure_kind("\n".join(context))))
        require(len(found) <= 256)


def failed_test_locations(scope, files, log):
    try:
        require(scope is not None and bool(files) and len(files) <= 64 and log is not None)
        content = read_bounded_regular(log, 8 * 1024 * 1024)
        counts = committed_test_line_counts(scope, [file for file in files if file != COCKPIT_TEST])
        workspace, head, _tracked, _existing, _crypt = scope
        found, context = set(), []
        clean = ANSI_RE.sub("", content.decode("utf-8", errors="strict"))
        for line in clean.splitlines():
            if len(line) > 16 * 1024:
                context = []
                continue
            if HEADER_LINE_RE.fullmatch(line):
                context = []
            # Bun stacks may contain names/values; only the independently validated location escapes.
            context = (context + [line])[-16:]
            _scan_frame_line(line, context, workspace, counts, found)
        require(git_head(workspace) == head)
        return [{"file": file, "line": line, "kind": kind} for file, line, kind in sorted(found)]
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
    require(directory.resolve() == directory)
    report = json.loads(read_bounded_regular(directory / "results.json", 8192, window), object_pairs_hook=json_object)
    require(isinstance(report, dict) and set(report) == {"failures"})
    rows = report["failures"]
    require(isinstance(rows, list) and len(rows) <= 32)
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
        require(git_head(scope[0]) == scope[1])
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
    ordered = sorted(locations, key=lambda row: (row["file"], row["line"], row["kind"])) if len(locations) <= 256 else []
    metadata = {"failedTestFiles": files, "failedTestLocations": ordered}
    # Keep exact JSON values without allowing tracked filenames to become Actions commands.
    return json.dumps(metadata, ensure_ascii=True, separators=(",", ":")).replace("::", "\\u003a\\u003a").replace("#", "\\u0023").replace("%", "\\u0025")
