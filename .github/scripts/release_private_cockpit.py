"""Cockpit JUnit failure-location extraction from committed source declarations."""
import json
from pathlib import Path
import re
import sys
import xml.etree.ElementTree as ET

_SCRIPTS_DIR = str(Path(__file__).resolve().parent)
if _SCRIPTS_DIR not in sys.path:
    sys.path.insert(0, _SCRIPTS_DIR)

from release_private_source import (
    COCKPIT_TEST,
    committed_test_body,
    git_head,
    read_bounded_regular,
    require,
)

PRIVATE_POINT_RE = re.compile(r"(let )?point = ([1-9]|1[0-6]) // ql:private-test-point")
FAILURE_KINDS = {"TimeoutError": "timeout", "AssertionError": "assertion"}


def cockpit_declarations(source):
    lines = source.split("\n")
    declarations = {}
    for line, text in enumerate(lines[:-1], 1):
        if text != "  test(":
            continue
        literal = re.fullmatch(r'    ("[^"\\\r\n]+"),', lines[line])
        require(literal is not None)
        # Bun reports the title token's line for this multiline call.
        declarations[line + 1] = (line, json.loads(literal[1]))
    unique_names = len({name for _, name in declarations.values()}) == len(declarations)
    require(0 < len(declarations) <= 32 and unique_names)
    return declarations


def _valid_point_sequence(points):
    for index, (_, match) in enumerate(points, 1):
        if match is None or int(match[2]) != index or bool(match[1]) != (index == 1):
            return False
    return True


def cockpit_private_points(source, declarations):
    """Accept one committed case with a bounded ordered set of opaque source markers."""
    lines = source.split("\n")
    titles = sorted(declarations)
    found = {}
    for title, end in zip(titles, titles[1:] + [len(lines) + 1]):
        points = [
            (line, PRIVATE_POINT_RE.fullmatch(text.strip()))
            for line, text in enumerate(lines[title:end - 1], title + 1)
            if "// ql:private-test-point" in text
        ]
        if not points:
            continue
        if found or not _valid_point_sequence(points):
            return {}
        found = {(title, f"QLPrivateTestPoint{index}"): line for index, (line, _) in enumerate(points, 1)}
    return found


def _parse_cockpit_case(case, paths, declarations, seen, private_points):
    title_line = case.get("line", "")
    require(bool(re.fullmatch(r"[1-9][0-9]{0,5}", title_line)))
    line = int(title_line)
    declaration = declarations.get(line)
    require(line not in seen and declaration is not None)
    require(declaration[1] == case.get("name") and case.get("file") in paths)
    seen.add(line)
    failures = case.findall("failure")
    require(len(failures) <= 1)
    if not failures:
        return None
    failure_type = failures[0].get("type")
    kind = FAILURE_KINDS.get(failure_type, "unknown")
    return (private_points.get((line, failure_type), declaration[0]), kind)


def cockpit_report_locations(text, paths, declarations, failed_count, private_points):
    require("<!" not in text)
    tree = ET.fromstring(text)
    cases = list(tree.iter("testcase"))
    require(tree.tag == "testsuites" and tree.get("name") == "bun test" and len(cases) == len(declarations))
    seen, found = set(), set()
    for case in cases:
        location = _parse_cockpit_case(case, paths, declarations, seen, private_points)
        if location is not None:
            found.add(location)
    require(len(found) == failed_count)
    return found


def cockpit_failure_locations(scope, reports, directory, window):
    """Read Bun's private case records, with lines drawn only from committed source."""
    if not reports or directory is None:
        return []
    try:
        workspace, head, _tracked, _existing, _crypt = scope
        require(not directory.is_symlink() and directory.resolve() == directory)
        body = committed_test_body(scope, COCKPIT_TEST)
        require(body is not None)
        source = body.decode("utf-8", errors="strict")
        declarations = cockpit_declarations(source)
        private_points = cockpit_private_points(source, declarations)
        relative = COCKPIT_TEST.removeprefix("qualitylayer/")
        paths = (str(workspace / COCKPIT_TEST), relative, "./" + relative)
        found = set()
        for identifier, failed_count in reports.items():
            path = directory / (identifier + ".xml")
            if path.exists():
                text = read_bounded_regular(path, 256 * 1024, window).decode("utf-8", errors="strict")
                found.update(cockpit_report_locations(text, paths, declarations, failed_count, private_points))
        require(git_head(workspace) == head)
        return [{"file": COCKPIT_TEST, "line": line, "kind": kind} for line, kind in sorted(found)]
    except Exception:
        return []
