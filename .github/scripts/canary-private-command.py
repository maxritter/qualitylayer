#!/usr/bin/env python3
"""Finite source-free canaries; platform cases are reported separately."""
import hashlib
import json
import os
from pathlib import Path
import signal
import shutil
import subprocess
import sys
import tempfile
import time
from contextlib import nullcontext
from dataclasses import dataclass
from typing import Any

runner = Path(sys.argv[1]).resolve()
results = []
channels = ("GITHUB_ENV", "GITHUB_OUTPUT", "GITHUB_STATE", "GITHUB_STEP_SUMMARY", "GITHUB_PATH")
capabilities = ("ACTIONS_RUNTIME_TOKEN", "ACTIONS_RUNTIME_URL", "ACTIONS_RESULTS_URL", "ACTIONS_CACHE_URL", "ACTIONS_CACHE_SERVICE_V2", "ACTIONS_ID_TOKEN_REQUEST_TOKEN", "ACTIONS_ID_TOKEN_REQUEST_URL", "GH_TOKEN", "GITHUB_TOKEN")
ESCAPED_TEST_NAME = 'quoted"%##[warning]::notice::.test.ts'
ENCRYPTED_TEST_BODY = "// ENCRYPTED_PRIVATE_SOURCE_CANARY\nconst secret = 'ENCRYPTED_PRIVATE_VALUE'\n// third line\n"
FORBIDDEN_PATH_TERMS = (
    "PRIVATE_NAME",
    "PRIVATE_VALUE",
    "PRIVATE_SOURCE",
    "PRIVATE_ENV",
    "PRIVATE_FUNCTION",
    "ENCRYPTED_PRIVATE_SOURCE_CANARY",
    "ENCRYPTED_PRIVATE_VALUE",
    "ENCRYPTED_PRIVATE_CHANGED",
    "SHOULD_NEVER_EXECUTE",
)
PATH_CASE_MODES = (
    "valid", "escaped", "source-only", "source-colocated", "unknown-source",
    "source-non-test", "source-head-fields", "absolute", "unknown", "control",
    "parent", "drift", "running", "changed-head", "malformed", "duplicate",
    "oversized", "symlink", "missing", "stale", "valid-after-malformed",
    "location-assertion", "location-timeout", "location-process", "location-unknown",
    "location-outside", "location-zero", "location-injection", "location-nonpublic",
    "location-utf8", "location-working-drift", "location-ansi", "location-oversized-log",
    "location-symlink-log", "location-hardlink-log", "location-encrypted",
    "location-encrypted-outside", "location-encrypted-filter-changed",
    "location-encrypted-working-drift", "location-encrypted-process-changed", "git-failure",
)


@dataclass(frozen=True)
class CaseSpec:
    shell: str = "bash"
    contract: Any = None
    expected: int = 0
    workspace: Any = None


def workspace_sha(workspace):
    if not (workspace / ".git").exists():
        return "a" * 40
    return subprocess.check_output(["git", "-C", str(workspace), "rev-parse", "HEAD"], stderr=subprocess.DEVNULL, text=True).strip()


def build_case_env(case, nonce, spec):
    keep = ("PATH", "HOME", "SystemDrive", "SystemRoot", "WINDIR", "PATHEXT", "LANG", "PYTHONPATH", "QL_CANARY_TRACE_PATH")
    env = {key: os.environ[key] for key in keep if key in os.environ}
    env.update(RUNNER_TEMP=str(case), QL_CANARY_NONCE=nonce, QL_CANARY_CASE=str(case), QL_CANARY_PYTHON=sys.executable, QL_RELEASE_EXPORTS=json.dumps(spec.contract or {}), PYTHONIOENCODING="utf-8")
    if spec.workspace is not None:
        env.update(GITHUB_WORKSPACE=str(spec.workspace), GITHUB_SHA=workspace_sha(spec.workspace))
    env.update({token: "dummy-canary-capability" for token in capabilities})
    for channel in channels:
        file = case / ("parent-" + channel)
        file.touch()
        env[channel] = str(file)
    return env


def run_case(root, name, body, spec=None):
    spec = spec or CaseSpec()
    if os.environ.get("QL_CANARY_ONLY") and os.environ["QL_CANARY_ONLY"] != name:
        return None
    case = root / name
    case.mkdir()
    nonce = os.urandom(24).hex()
    script = case / ("fixture.ps1" if spec.shell == "pwsh" else "fixture.sh")
    script.write_text(body)
    env = build_case_env(case, nonce, spec)
    completed = subprocess.run([sys.executable, str(runner), spec.shell, str(script)], env=env, capture_output=True, timeout=20)
    public = completed.stdout + completed.stderr
    (case / "public.stdout.private").write_bytes(completed.stdout)
    (case / "public.stderr.private").write_bytes(completed.stderr)
    evidence = {"case": name, "expectedExit": spec.expected, "actualExit": completed.returncode}
    if (case / "descendant-pid").exists() and os.name != "nt":
        pid = int((case / "descendant-pid").read_text())
        state = subprocess.run(["ps", "-p", str(pid), "-o", "pid=,ppid=,pgid=,stat=,lstart="], capture_output=True, text=True)
        evidence["descendantState"] = {"exit": state.returncode, "output": state.stdout}
    (case / "case-result.private.json").write_text(json.dumps(evidence, indent=2))
    assert nonce.encode() not in public, name
    assert completed.returncode == spec.expected, (name, completed.returncode)
    for channel in channels:
        assert nonce not in Path(env[channel]).read_text(), (name, channel)
    if spec.expected != 0:
        assert b'"exitCode":0' not in public, name
    results.append({"case": name, "exitCode": completed.returncode, "nonceAbsentFromPublicChannels": True, "publicOutputSha256": hashlib.sha256(public).hexdigest()})
    return case


def clean_git_env(git_home):
    git_home.mkdir()
    git_environment = {key: value for key, value in os.environ.items() if not key.startswith("GIT_")}
    git_environment.update(HOME=str(git_home), XDG_CONFIG_HOME=str(git_home))
    return git_environment


def init_path_workspace(root, encrypted):
    workspace = root / "public-test-paths"
    tests = workspace / "qualitylayer/tests"
    tests.mkdir(parents=True)
    source = workspace / "qualitylayer/src/nested"
    source.mkdir(parents=True)
    (source / "view.test.tsx").write_text("// synthetic source-colocated test\n")
    (source / "view.ts").write_text("// not a test file\n")
    for name in ("failed.test.ts", "passed.test.tsx", ESCAPED_TEST_NAME, "control\npath.test.ts"):
        (tests / name).write_text("// synthetic source must never become a public diagnostic\n")
    policy = workspace / ".github/scripts/public-source-policy.json"
    policy.parent.mkdir(parents=True)
    policy.write_text(json.dumps({"publicFiles": {"qualitylayer/tests/failed.test.ts": hashlib.sha256((tests / "failed.test.ts").read_bytes()).hexdigest()}}))
    if encrypted:
        (tests / "encrypted.test.ts").write_text(ENCRYPTED_TEST_BODY)
        (workspace / ".gitattributes").write_text("qualitylayer/tests/encrypted.test.ts filter=git-crypt diff=git-crypt\n")
    git_environment = clean_git_env(root / "canary-git-home")
    subprocess.run(["git", "-C", str(workspace), "init", "--quiet"], env=git_environment, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    smudge = None
    if encrypted:
        subprocess.run(["git-crypt", "init"], cwd=workspace, env=git_environment, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        smudge = subprocess.check_output(["git", "-C", str(workspace), "config", "--get", "filter.git-crypt.smudge"], text=True).strip()
    for command in (["add", "."], ["-c", "user.name=Canary", "-c", "user.email=canary@example.invalid", "commit", "--quiet", "-m", "public dummy test paths"]):
        subprocess.run(["git", "-C", str(workspace), *command], env=git_environment, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    if encrypted:
        raw = subprocess.check_output(["git", "-C", str(workspace), "cat-file", "blob", "HEAD:qualitylayer/tests/encrypted.test.ts"])
        assert raw.startswith(b"\x00GITCRYPT\x00") and ENCRYPTED_TEST_BODY.encode() not in raw
    return workspace, tests, smudge


PATH_EXPECTED_FILES = {
    "valid": ["qualitylayer/tests/failed.test.ts"],
    "valid-after-malformed": ["qualitylayer/tests/failed.test.ts"],
    "source-head-fields": ["qualitylayer/tests/failed.test.ts"],
    "escaped": ["qualitylayer/tests/" + ESCAPED_TEST_NAME],
    "source-only": ["qualitylayer/src/nested/view.test.tsx"],
    "source-colocated": ["qualitylayer/src/nested/view.test.tsx", "qualitylayer/tests/failed.test.ts"],
    "location-nonpublic": ["qualitylayer/src/nested/view.test.tsx"],
}
PATH_EXPECTED_LOCATIONS = {
    "location-assertion": [{"file": "qualitylayer/tests/failed.test.ts", "line": 1, "kind": "assertion"}],
    "location-ansi": [{"file": "qualitylayer/tests/failed.test.ts", "line": 1, "kind": "assertion"}],
    "location-timeout": [{"file": "qualitylayer/tests/failed.test.ts", "line": 1, "kind": "timeout"}],
    "location-process": [{"file": "qualitylayer/tests/failed.test.ts", "line": 1, "kind": "process"}],
    "location-unknown": [{"file": "qualitylayer/tests/failed.test.ts", "line": 1, "kind": "unknown"}],
    "location-nonpublic": [{"file": "qualitylayer/src/nested/view.test.tsx", "line": 1, "kind": "unknown"}],
    "location-encrypted": [{"file": "qualitylayer/tests/encrypted.test.ts", "line": 2, "kind": "assertion"}],
}


def expected_path_files(mode):
    if mode in PATH_EXPECTED_FILES:
        return PATH_EXPECTED_FILES[mode]
    if mode.startswith("location-encrypted"):
        return ["qualitylayer/tests/encrypted.test.ts"]
    return ["qualitylayer/tests/failed.test.ts"] if mode.startswith("location-") else []


def assert_path_case_output(case, mode):
    output = (case / "public.stdout.private").read_text()
    metadata = json.loads(output)
    assert set(metadata) == {"failedTestFiles", "failedTestLocations"}
    assert metadata["failedTestLocations"] == PATH_EXPECTED_LOCATIONS.get(mode, [])
    assert all(term not in output for term in FORBIDDEN_PATH_TERMS)
    assert metadata["failedTestFiles"] == expected_path_files(mode)
    assert output.count("\n") == 1
    assert "::notice::" not in output and "##[warning]" not in output
    assert not (case / "public.stderr.private").read_bytes()


def test_path_cases(root, encrypted=False):
    workspace, tests, smudge = init_path_workspace(root, encrypted)
    body = """"$QL_CANARY_PYTHON" - <<'PY'
import json,os,sys,time,subprocess
from pathlib import Path
root=Path(os.environ['GITHUB_WORKSPACE']);folder=root/'qualitylayer/dist/test-runs';folder.mkdir(parents=True,exist_ok=True)
mode=MODE
record={'schema':1,'pid':os.getpid(),'state':'failed','sourceDrift':[],'active':[],'unrun':[],
 'buildSource':{'mode':'private-binary-build-source','digest':'a'*64,'scope':['qualitylayer/src'],'files':1,'bytes':1,'tests':'live-source','dependencies':'borrowed-node-modules'},
 'results':[{'file':'tests/failed.test.ts','code':1,'pass':0,'fail':1,'seconds':.1},{'file':'tests/passed.test.tsx','code':0,'pass':1,'fail':0,'seconds':.1}],
 'cancelToken':os.environ['QL_CANARY_NONCE'],'privateError':os.environ['QL_CANARY_NONCE'],'attachments':[os.environ['QL_CANARY_NONCE']]}
if mode=='escaped':record['results'][0]['file']='tests/'+ESCAPED
elif mode=='source-only':record['results'][0]['file']='src/nested/view.test.tsx'
elif mode=='source-colocated':record['results'].append({'file':'src/nested/view.test.tsx','code':1,'pass':0,'fail':1,'seconds':.1})
elif mode=='unknown-source':record['results'][0]['file']='src/'+os.environ['QL_CANARY_NONCE']+'.test.tsx'
elif mode=='source-non-test':record['results'][0]['file']='src/nested/view.ts'
elif mode=='source-head-fields':record.update(head=os.environ['QL_CANARY_NONCE'],sourceCommit=os.environ['QL_CANARY_NONCE'])
elif mode=='absolute':record['results'][0]['file']='/private/'+os.environ['QL_CANARY_NONCE']+'.test.ts'
elif mode=='unknown':record['results'][0]['file']='tests/'+os.environ['QL_CANARY_NONCE']+'.test.ts'
elif mode=='control':record['results'][0]['file']='tests/control\\npath.test.ts'
elif mode=='parent':record['results'][0]['file']='tests/../tests/failed.test.ts'
elif mode=='drift':record['sourceDrift']=[{'phase':'after-tests','observation':{'paths':[os.environ['QL_CANARY_NONCE']],'total':1}}]
elif mode=='running':record['state']='running'
elif mode=='changed-head':subprocess.run(['git','-C',str(root),'-c','user.name=Canary','-c','user.email=canary@example.invalid','commit','--quiet','--allow-empty','-m','changed source'],env={**os.environ,'HOME':str(root.parent/'canary-git-home'),'XDG_CONFIG_HOME':str(root.parent/'canary-git-home')},check=True)
elif mode=='git-failure':(root/'.git/HEAD').rename(root/'.git/HEAD.private')
path=folder/(str(time.time_ns())+'.json')
if mode=='malformed':path.write_text('{'+os.environ['QL_CANARY_NONCE'])
elif mode=='duplicate':path.write_text(json.dumps(record).replace('"schema": 1','"schema": 1, "schema": 1'))
elif mode=='oversized':path.write_text(json.dumps({**record,'privateError':os.environ['QL_CANARY_NONCE']*32768}))
elif mode=='symlink':
 foreign=Path(os.environ['QL_CANARY_CASE'])/'foreign.json';foreign.write_text(json.dumps(record));path.symlink_to(foreign)
elif mode!='missing':path.write_text(json.dumps(record))
if mode=='stale':os.utime(path,(1,1))
if mode.startswith('location-'):
 kind=mode.removeprefix('location-')
 if kind in ('assertion','ansi') or kind.startswith('encrypted'):print(('\\x1b[31m' if kind=='ansi' else '')+'error: expect(received).toBe(expected) '+os.environ['QL_CANARY_NONCE']+('\\x1b[0m' if kind=='ansi' else ''))
 elif kind=='timeout':print('TimeoutError: '+os.environ['QL_CANARY_NONCE'])
 elif kind=='process':print('exit 1 · signal SIGTERM')
 else:print('PRIVATE_NAME PRIVATE_VALUE PRIVATE_SOURCE PRIVATE_ENV '+os.environ['QL_CANARY_NONCE'])
 line='999' if kind in ('outside','encrypted-outside') else '0' if kind=='zero' else '2' if kind.startswith('encrypted') else '1'
 file='tests/encrypted.test.ts' if kind.startswith('encrypted') else 'src/nested/view.test.tsx' if kind=='nonpublic' else 'tests/'+os.environ['QL_CANARY_NONCE']+'.test.ts' if kind=='injection' else 'tests/failed.test.ts'
 if kind=='nonpublic' or kind.startswith('encrypted'):
  record['results'][0]['file']=file;path.write_text(json.dumps(record))
 print('    at PRIVATE_FUNCTION_'+os.environ['QL_CANARY_NONCE']+' ('+str((root/'qualitylayer'/file).resolve())+':'+line+':2)')
 if kind=='utf8':sys.stdout.flush();os.write(1,bytes([255]))
 if kind=='oversized-log':print('x'*(8*1024*1024+1))
 if kind in ('symlink-log','hardlink-log'):
  log=Path(os.environ['GITHUB_OUTPUT']).parent/'diagnostics.private'
  foreign=Path(os.environ['QL_CANARY_CASE'])/'foreign-private-log'
  if kind=='symlink-log':foreign.write_text('PRIVATE_ENV '+os.environ['QL_CANARY_NONCE']);log.unlink();log.symlink_to(foreign)
  else:os.link(log,foreign)
 if kind=='encrypted-filter-changed':subprocess.run(['git','-C',str(root),'config','filter.git-crypt.smudge','SHOULD_NEVER_EXECUTE'],check=True)
 if kind=='encrypted-process-changed':subprocess.run(['git','-C',str(root),'config','filter.git-crypt.process','SHOULD_NEVER_EXECUTE'],check=True)
 if kind=='encrypted-working-drift':(root/'qualitylayer/tests/encrypted.test.ts').write_text('// ENCRYPTED_PRIVATE_CHANGED '+os.environ['QL_CANARY_NONCE'])
 if kind=='working-drift':(root/'qualitylayer/tests/failed.test.ts').write_text('// changed private body '+os.environ['QL_CANARY_NONCE'])
print(os.environ['QL_CANARY_NONCE']);print(os.environ['QL_CANARY_NONCE'],file=sys.stderr)
sys.exit(EXIT)
PY
"""
    restorers = {
        "location-working-drift": lambda: (tests / "failed.test.ts").write_text("// synthetic source must never become a public diagnostic\n"),
        "location-encrypted-filter-changed": lambda: subprocess.run(["git", "-C", str(workspace), "config", "filter.git-crypt.smudge", smudge], check=True),
        "location-encrypted-process-changed": lambda: subprocess.run(["git", "-C", str(workspace), "config", "--unset", "filter.git-crypt.process"], check=True),
        "location-encrypted-working-drift": lambda: (tests / "encrypted.test.ts").write_text(ENCRYPTED_TEST_BODY),
    }
    exit_codes = {"missing": (127, 1), "git-failure": (127, 1)}
    selected_modes = [m for m in PATH_CASE_MODES if m.startswith("location-encrypted") == encrypted]
    for mode in selected_modes:
        exit_code, expected_code = exit_codes.get(mode, (17, 17))
        script = body.replace("MODE", repr(mode)).replace("ESCAPED", repr(ESCAPED_TEST_NAME)).replace("EXIT", str(exit_code))
        case = run_case(root, "failed-test-paths-" + mode, script, CaseSpec(expected=expected_code, workspace=workspace))
        if case is None:
            continue
        assert_path_case_output(case, mode)
        restorers.get(mode, lambda: None)()
        results[-1]["onlyCurrentHeadTrackedFailedTestPaths"] = True


def init_cockpit_workspace(root, encrypted):
    workspace = root / "cockpit-test-source"
    git_environment = clean_git_env(root / "cockpit-canary-git-home")
    file = "qualitylayer/tests/e2e/cockpit-gate.test.ts"
    test = workspace / file
    test.parent.mkdir(parents=True)
    test.write_text("""import { test, expect, describe } from "bun:test"
describe("PRIVATE_SUITE", () => {
  test(
    "PRIVATE_ASSERTION",
    () => expect(process.env.QL_CANARY_NONCE).toBe("never equal"),
  )
  test(
    "PRIVATE_TIMEOUT",
    async () => { await Bun.sleep(500) },
    20,
  )
})
""")
    subprocess.run(["git", "init", "--quiet"], cwd=workspace, env=git_environment, check=True, capture_output=True)
    if encrypted:
        (workspace / ".gitattributes").write_text(file + " filter=git-crypt diff=git-crypt\n")
        subprocess.run(["git-crypt", "init"], cwd=workspace, env=git_environment, check=True, capture_output=True)
    for command in (["add", "."], ["-c", "user.name=Canary", "-c", "user.email=canary@example.invalid", "commit", "--quiet", "-m", "synthetic case declarations"]):
        subprocess.run(["git", *command], cwd=workspace, env=git_environment, check=True, capture_output=True)
    if encrypted:
        blob = subprocess.check_output(["git", "cat-file", "blob", "HEAD:" + file], cwd=workspace)
        assert blob.startswith(b"\x00GITCRYPT\x00")
    return workspace, git_environment, file


def cockpit_cases(root, encrypted=False, ordinary=False):
    workspace, git_environment, file = init_cockpit_workspace(root, encrypted)
    if ordinary:
        cockpit_runner_case(root, workspace, file)
        return
    code = r'''import json, os, sys, subprocess
from pathlib import Path
from xml.etree.ElementTree import Element, SubElement, tostring
root = Path(os.environ["GITHUB_WORKSPACE"])
directory = Path(os.environ["QL_PRIVATE_COCKPIT_REPORT_DIR"])
file = "tests/e2e/cockpit-gate.test.ts"
nonce = os.environ["QL_CANARY_NONCE"]
identifier = f"2026-01-01T00-00-00-000Z-{os.getpid()}"
report = directory / (identifier + ".xml")
mode = MODE
if mode == "native":
    result = subprocess.run(["bun", "test", "./" + file, "--reporter=junit", "--reporter-outfile", str(report)], cwd=root / "qualitylayer")
    assert result.returncode == 1
else:
    suites = Element("testsuites", name="bun test")
    group = SubElement(suites, "testsuite", name=nonce)
    for line, name, kind in [("4", "PRIVATE_ASSERTION", "AssertionError"), ("8", "PRIVATE_TIMEOUT", "TimeoutError")]:
        if mode == "line" and line == "4": line = "5"
        if mode == "name" and line == "4": name = nonce
        if mode == "unknown" and line == "4": kind = nonce
        case = SubElement(group, "testcase", name=name, line=line, file=("./" + file if mode != "file" else nonce))
        SubElement(case, "failure", type=kind, message=nonce).text = "PRIVATE_FAILURE " + nonce
    body = tostring(suites)
    if mode == "entity": body = b'<!DOCTYPE testsuites [<!ENTITY injected "bad">]>' + body
    if mode == "oversize": body += b" " * (256 * 1024)
    if mode == "wrong-run": report = directory / "unrelated.xml"
    if mode in ("symlink", "hardlink"):
        source = directory.parent / "impostor"
        source.write_bytes(body)
        if mode == "symlink": report.symlink_to(source)
        else: os.link(source, report)
    elif mode != "raw-only":
        report.write_bytes(body)
    if mode == "stale": os.utime(report, (1, 1))
    if mode == "source-drift": (root / "qualitylayer" / file).write_text(nonce)
records = root / "qualitylayer/dist/test-runs"
records.mkdir(parents=True, exist_ok=True)
row = {"file": file, "code": 1, "pass": 0, "fail": 1 if mode == "count" else 2, "seconds": 0.01}
rows = [row]
if mode == "passing-retry": rows.append({**row, "code": 0, "pass": 2, "fail": 0})
if mode == "process-only": row["fail"] = 0
(records / (identifier + ".json")).write_text(json.dumps({"schema":1,"state":"failed","sourceDrift":[],"results":rows}))
print(nonce)
print(f"    at PRIVATE_FUNCTION ({root / 'qualitylayer' / file}:5:2)")
sys.exit(1)
'''
    modes = ["valid", "unknown", "raw-only", "line", "name", "file", "entity", "oversize", "wrong-run", "symlink", "hardlink", "stale", "count", "passing-retry", "process-only", "source-drift"]
    if shutil.which("bun") and subprocess.check_output(["bun", "--version"], text=True).strip() == "1.4.4":
        modes.append("native")
    expected_locations = {
        "valid": [{"file": file, "line": 3, "kind": "assertion"}, {"file": file, "line": 7, "kind": "timeout"}],
        "native": [{"file": file, "line": 3, "kind": "assertion"}, {"file": file, "line": 7, "kind": "timeout"}],
        "unknown": [{"file": file, "line": 3, "kind": "unknown"}, {"file": file, "line": 7, "kind": "timeout"}],
    }
    for mode in modes:
        command = code.replace("MODE", repr(mode), 1)
        case = run_case(root, "cockpit-junit-" + mode, '"$QL_CANARY_PYTHON" - <<\'PY\'\n' + command + '\nPY\n', CaseSpec(expected=1, workspace=workspace))
        if case is None:
            continue
        output = (case / "public.stdout.private").read_text()
        assert json.loads(output) == {"failedTestFiles": [file], "failedTestLocations": expected_locations.get(mode, [])}, (mode, output)
        assert "PRIVATE_" not in output and output.count("\n") == 1
        assert not (case / "public.stderr.private").read_bytes()
        assert not list(case.glob("ql-private-release-*/cockpit-reports-*"))
        if mode == "source-drift":
            subprocess.run(["git", "restore", "--", file], cwd=workspace, env=git_environment, check=True, capture_output=True)

def cockpit_runner_case(root, workspace, file):
    """Exercise the actual sealed runner without building or running product code."""
    assert subprocess.check_output(["bun", "--version"], text=True).strip() == "1.4.4"
    package = workspace / "qualitylayer"
    scripts = package / "scripts"
    scripts.mkdir()
    actual = Path(__file__).resolve().parents[2] / "qualitylayer/scripts"
    runner_files = ("test.ts", "smoke-files.ts", "test-output.ts", "test-reaper.ts", "test-run-record.ts",
                    "test-source-snapshot.ts", "test-tiers.ts", "test-ui-assets.ts", "test-ui-preload.ts")
    for name in runner_files:
        shutil.copyfile(actual / name, scripts / name)
    shutil.copytree(actual / "test-source-snapshot", scripts / "test-source-snapshot")
    (package / "package.json").write_text(json.dumps({
        "scripts": {"test": "bun run scripts/test.ts", "build": "bun run scripts/build.ts"},
    }))
    (scripts / "build.ts").write_text("""import { writeFileSync } from "node:fs"
const output = process.argv[process.argv.indexOf("--out") + 1]
if (!output) throw new Error("Missing fixture binary path")
writeFileSync(output, "#!/bin/sh\\nexit 0\\n", { mode: 0o700 })
""")
    command = """export CI=true QUALITYLAYER_TEST_WORKERS=1 TMPDIR="$RUNNER_TEMP"
cd "$GITHUB_WORKSPACE/qualitylayer"
bun run test tests/e2e/cockpit-gate.test.ts
"""
    case = run_case(root, "cockpit-ordinary-sealed-runner", command, CaseSpec(expected=1, workspace=workspace))
    if case is None:
        return
    output = (case / "public.stdout.private").read_text()
    assert json.loads(output) == {"failedTestFiles": [file], "failedTestLocations": [
        {"file": file, "line": 3, "kind": "assertion"},
        {"file": file, "line": 7, "kind": "timeout"},
    ]}, output
    records = list((package / "dist/test-runs").glob("*.json"))
    assert len(records) == 1
    record = json.loads(records[0].read_text())
    assert record["state"] == "failed" and record["sourceDrift"] == []
    assert record["buildSource"]["mode"] == "private-binary-build-source"
    assert [(row["code"], row["fail"]) for row in record["results"]] == [(1, 2), (1, 2)]
    assert "PRIVATE_" not in output and output.count("\n") == 1
    assert not (case / "public.stderr.private").read_bytes()
    assert not list(case.glob("ql-private-release-*/cockpit-reports-*"))


def run_msys2_cases(root):
    body = 'printf "::error::%s\\n::group::%s\\n" "$QL_CANARY_NONCE" "$QL_CANARY_NONCE"\nprintf "%s\\n" "$QL_CANARY_NONCE" >&2\nfor key in GITHUB_ENV GITHUB_OUTPUT GITHUB_STATE GITHUB_STEP_SUMMARY GITHUB_PATH; do printf "%s\\n" "$QL_CANARY_NONCE" > "${!key}"; done\nfor key in ACTIONS_RUNTIME_TOKEN ACTIONS_RUNTIME_URL ACTIONS_RESULTS_URL ACTIONS_CACHE_URL ACTIONS_CACHE_SERVICE_V2 ACTIONS_ID_TOKEN_REQUEST_TOKEN ACTIONS_ID_TOKEN_REQUEST_URL GH_TOKEN GITHUB_TOKEN; do test -z "${!key-}"; done\n'
    run_case(root, "msys2-private-channels", body, CaseSpec(shell="msys2"))
    run_case(root, "msys2-native-failure-preserved", '"$QL_CANARY_PYTHON" -c "import sys;sys.exit(17)"\n', CaseSpec(shell="msys2", expected=17))
    return "executed actual msys2 cases"


def run_posix_cases(root):
    test_path_cases(root)
    cockpit_cases(root)
    channels_case = """"$QL_CANARY_PYTHON" - <<'PY'
import os,sys
from pathlib import Path
nonce=os.environ['QL_CANARY_NONCE']
print('::error::'+nonce);print('::group::'+nonce);print(nonce,file=sys.stderr)
for key in ['GITHUB_ENV','GITHUB_OUTPUT','GITHUB_STATE','GITHUB_STEP_SUMMARY','GITHUB_PATH']:
 Path(os.environ[key]).write_text(nonce+'\\n')
for key in ['ACTIONS_RUNTIME_TOKEN','ACTIONS_RUNTIME_URL','ACTIONS_RESULTS_URL','ACTIONS_CACHE_URL','ACTIONS_CACHE_SERVICE_V2','ACTIONS_ID_TOKEN_REQUEST_TOKEN','ACTIONS_ID_TOKEN_REQUEST_URL','GH_TOKEN','GITHUB_TOKEN']:
 assert key not in os.environ,key
PY
"""
    run_case(root, "private-channels", channels_case)
    run_case(root, "failure-preserved", 'printf "%s\\n" "$QL_CANARY_NONCE"; exit 17\n', CaseSpec(expected=17))
    run_case(root, "invalid-export-refused", 'printf "digest=%s\\n" "$QL_CANARY_NONCE" >> "$GITHUB_OUTPUT"\n', CaseSpec(contract={"GITHUB_OUTPUT": {"digest": "sha256"}}, expected=1))
    descendant = """"$QL_CANARY_PYTHON" - <<'PY'
import os,subprocess,sys
from pathlib import Path
code='import os,signal,time;from pathlib import Path;signal.signal(signal.SIGTERM,signal.SIG_IGN);Path(os.environ["QL_CANARY_CASE"]+"/descendant-ready").write_text(str(os.getpid()));time.sleep(120)'
child=subprocess.Popen([sys.executable,'-c',code])
Path(os.environ['QL_CANARY_CASE']+'/descendant-pid').write_text(str(child.pid))
import time
deadline=time.monotonic()+3
while not Path(os.environ['QL_CANARY_CASE']+'/descendant-ready').exists():
 if time.monotonic()>deadline:raise RuntimeError('readiness')
 time.sleep(.01)
PY
"""
    case = run_case(root, "shell-exits-term-ignoring-descendant", descendant)
    if case is not None:
        wait_process_absent(int((case / "descendant-pid").read_text()))
        results[-1]["ownedDescendantAbsent"] = True
    return "unrun: requires actual Windows/pwsh"


def wait_process_absent(pid):
    deadline = time.monotonic() + 3
    while subprocess.run(["ps", "-p", str(pid), "-o", "stat="], capture_output=True, text=True).returncode == 0:
        if time.monotonic() >= deadline:
            raise RuntimeError("owned descendant still present")
        time.sleep(.05)


def run_windows_cases(root):
    private_python = '''import os,sys
from pathlib import Path
nonce=os.environ["QL_CANARY_NONCE"]
print("::error::"+nonce);print("::group::"+nonce);print(nonce,file=sys.stderr)
for key in ["GITHUB_ENV","GITHUB_OUTPUT","GITHUB_STATE","GITHUB_STEP_SUMMARY","GITHUB_PATH"]:
 Path(os.environ[key]).write_text(nonce+"\\n")
for key in ["ACTIONS_RUNTIME_TOKEN","ACTIONS_RUNTIME_URL","ACTIONS_RESULTS_URL","ACTIONS_CACHE_URL","ACTIONS_CACHE_SERVICE_V2","ACTIONS_ID_TOKEN_REQUEST_TOKEN","ACTIONS_ID_TOKEN_REQUEST_URL","GH_TOKEN","GITHUB_TOKEN"]:
 assert key not in os.environ,key
'''
    expression = "exec(bytes.fromhex('" + private_python.encode().hex() + "').decode())"
    run_case(root, "powershell-private-channels", '& "$env:QL_CANARY_PYTHON" -c "' + expression + '"\n', CaseSpec(shell="pwsh"))
    run_case(root, "powershell-invalid-export-refused", 'Add-Content -LiteralPath $env:GITHUB_OUTPUT -Value ("digest="+$env:QL_CANARY_NONCE)\n', CaseSpec(shell="pwsh", contract={"GITHUB_OUTPUT": {"digest": "sha256"}}, expected=1))
    run_case(root, "powershell-native-failure-preserved", "cmd.exe /c exit 17\nWrite-Host 'later command succeeds'\n", CaseSpec(shell="pwsh", expected=17))
    # A real Job-object case: source child backgrounds a process, then its parent exits.
    background = 'import os,time;from pathlib import Path;Path(os.environ["QL_CANARY_CASE"]+"/descendant-ready").write_text(str(os.getpid()));time.sleep(120)'
    expression = "exec(bytes.fromhex('" + background.encode().hex() + "').decode())"
    body = '$code="' + expression + '"\n$p=Start-Process -FilePath $env:QL_CANARY_PYTHON -ArgumentList @(\'-c\',$code) -PassThru\n$p.Id | Set-Content -LiteralPath ($env:QL_CANARY_CASE+\'/descendant-pid\')\n$deadline=[DateTime]::UtcNow.AddSeconds(3)\nwhile(!(Test-Path ($env:QL_CANARY_CASE+\'/descendant-ready\'))){if([DateTime]::UtcNow -ge $deadline){throw \'readiness\'};Start-Sleep -Milliseconds 20}\nif([int](Get-Content ($env:QL_CANARY_CASE+\'/descendant-ready\')) -ne $p.Id){throw \'identity\'}\n'
    case = run_case(root, "powershell-parent-exits-background-child", body, CaseSpec(shell="pwsh"))
    if case is not None:
        pid = int((case / "descendant-pid").read_text().strip())
        observed = subprocess.run(["powershell", "-NoProfile", "-Command", f"if(Get-Process -Id {pid} -ErrorAction SilentlyContinue){{exit 1}}"], capture_output=True)
        assert observed.returncode == 0
        results[-1]["ownedDescendantAbsent"] = True
    return "executed on Windows"


def run_posix_path_suite(root, encrypted, error_message, windows_note):
    if os.name == "nt":
        raise RuntimeError(error_message)
    test_path_cases(root, encrypted=encrypted)
    cockpit_cases(root, encrypted=encrypted)
    return windows_note


def run_cockpit_runner_suite(root):
    cockpit_cases(root, encrypted=True, ordinary=True)
    return "unrun: focused sealed Bun runner case"


def run_selected_suite(root, selector):
    suites = {
        ("test-cockpit-runner",): run_cockpit_runner_suite,
        ("test-paths-encrypted",): lambda r: run_posix_path_suite(r, True, "encrypted path canaries require a POSIX runner with git-crypt already installed", "unrun: selected actual encrypted cases only; requires preinstalled git-crypt"),
        ("test-paths",): lambda r: run_posix_path_suite(r, False, "test-paths canaries require a POSIX runner", "unrun: focused POSIX test-path privacy cases only"),
        ("msys2",): run_msys2_cases,
    }
    handler = suites.get(selector)
    if handler is not None:
        return handler(root)
    return run_posix_cases(root) if os.name != "nt" else run_windows_cases(root)


folder = tempfile.mkdtemp(prefix="ql-sealer-source-free-canary-retained-")
print(json.dumps({"retainedPrivateCases": folder}), flush=True)
with nullcontext(folder) as folder:
    windows = run_selected_suite(Path(folder), tuple(sys.argv[2:]))
    print(json.dumps({"platform": sys.platform, "cases": results, "windows": windows, "qualification": "only actual executed cases; not whole release graph"}, indent=2))
