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

runner = Path(sys.argv[1]).resolve()
results = []
channels = ("GITHUB_ENV", "GITHUB_OUTPUT", "GITHUB_STATE", "GITHUB_STEP_SUMMARY", "GITHUB_PATH")
capabilities = ("ACTIONS_RUNTIME_TOKEN", "ACTIONS_RUNTIME_URL", "ACTIONS_RESULTS_URL", "ACTIONS_CACHE_URL", "ACTIONS_CACHE_SERVICE_V2", "ACTIONS_ID_TOKEN_REQUEST_TOKEN", "ACTIONS_ID_TOKEN_REQUEST_URL", "GH_TOKEN", "GITHUB_TOKEN")

def run_case(root, name, body, shell="bash", contract=None, expected=0, workspace=None):
    if os.environ.get("QL_CANARY_ONLY") and os.environ["QL_CANARY_ONLY"] != name:
        return None
    case = root / name
    case.mkdir()
    nonce = os.urandom(24).hex()
    script = case / ("fixture.ps1" if shell == "pwsh" else "fixture.sh")
    script.write_text(body)
    env = {key: os.environ[key] for key in ("PATH", "HOME", "SystemDrive", "SystemRoot", "WINDIR", "PATHEXT", "LANG", "PYTHONPATH", "QL_CANARY_TRACE_PATH") if key in os.environ}
    env.update(RUNNER_TEMP=str(case), QL_CANARY_NONCE=nonce, QL_CANARY_CASE=str(case), QL_CANARY_PYTHON=sys.executable, QL_RELEASE_EXPORTS=json.dumps(contract or {}), PYTHONIOENCODING="utf-8")
    if workspace is not None:
        env["GITHUB_WORKSPACE"] = str(workspace)
        env["GITHUB_SHA"] = subprocess.check_output(["git", "-C", str(workspace), "rev-parse", "HEAD"], stderr=subprocess.DEVNULL, text=True).strip() if (workspace / ".git").exists() else "a" * 40
    for channel in channels:
        file = case / ("parent-" + channel)
        file.touch()
        env[channel] = str(file)
    for token in capabilities:
        env[token] = "dummy-canary-capability"
    completed = subprocess.run([sys.executable, str(runner), shell, str(script)], env=env, capture_output=True, timeout=20)
    public = completed.stdout + completed.stderr
    (case / "public.stdout.private").write_bytes(completed.stdout)
    (case / "public.stderr.private").write_bytes(completed.stderr)
    evidence = {"case": name, "expectedExit": expected, "actualExit": completed.returncode}
    if (case / "descendant-pid").exists() and os.name != "nt":
        pid = int((case / "descendant-pid").read_text())
        state = subprocess.run(["ps", "-p", str(pid), "-o", "pid=,ppid=,pgid=,stat=,lstart="], capture_output=True, text=True)
        evidence["descendantState"] = {"exit": state.returncode, "output": state.stdout}
    (case / "case-result.private.json").write_text(json.dumps(evidence, indent=2))
    assert nonce.encode() not in public, name
    assert completed.returncode == expected, (name, completed.returncode)
    for channel in channels:
        assert nonce not in Path(env[channel]).read_text(), (name, channel)
    if expected != 0:
        assert b'"exitCode":0' not in public, name
    row = {"case": name, "exitCode": completed.returncode, "nonceAbsentFromPublicChannels": True, "publicOutputSha256": hashlib.sha256(public).hexdigest()}
    results.append(row)
    return case

def test_path_cases(root, encrypted=False):
    workspace = root / "public-test-paths"
    tests = workspace / "qualitylayer/tests"
    tests.mkdir(parents=True)
    source = workspace / "qualitylayer/src/nested"
    source.mkdir(parents=True)
    (source / "view.test.tsx").write_text("// synthetic source-colocated test\n")
    (source / "view.ts").write_text("// not a test file\n")
    escaped = 'quoted"%##[warning]::notice::.test.ts'
    for name in ("failed.test.ts", "passed.test.tsx", escaped, "control\npath.test.ts"):
        (tests / name).write_text("// synthetic source must never become a public diagnostic\n")
    policy = workspace / ".github/scripts/public-source-policy.json"
    policy.parent.mkdir(parents=True)
    policy.write_text(json.dumps({"publicFiles": {"qualitylayer/tests/failed.test.ts": hashlib.sha256((tests / "failed.test.ts").read_bytes()).hexdigest()}}))
    encrypted_body = "// ENCRYPTED_PRIVATE_SOURCE_CANARY\nconst secret = 'ENCRYPTED_PRIVATE_VALUE'\n// third line\n"
    if encrypted:
        (tests / "encrypted.test.ts").write_text(encrypted_body)
        (workspace / ".gitattributes").write_text("qualitylayer/tests/encrypted.test.ts filter=git-crypt diff=git-crypt\n")
    git_home = root / "canary-git-home"
    git_home.mkdir()
    git_environment = {key: value for key, value in os.environ.items() if not key.startswith("GIT_")}
    git_environment.update(HOME=str(git_home), XDG_CONFIG_HOME=str(git_home))
    subprocess.run(["git", "-C", str(workspace), "init", "--quiet"], env=git_environment, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    if encrypted:
        subprocess.run(["git-crypt", "init"], cwd=workspace, env=git_environment, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        smudge = subprocess.check_output(["git", "-C", str(workspace), "config", "--get", "filter.git-crypt.smudge"], text=True).strip()
    for command in (["add", "."], ["-c", "user.name=Canary", "-c", "user.email=canary@example.invalid", "commit", "--quiet", "-m", "public dummy test paths"]):
        subprocess.run(["git", "-C", str(workspace), *command], env=git_environment, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    if encrypted:
        raw = subprocess.check_output(["git", "-C", str(workspace), "cat-file", "blob", "HEAD:qualitylayer/tests/encrypted.test.ts"])
        assert raw.startswith(b"\x00GITCRYPT\x00") and encrypted_body.encode() not in raw
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
    for mode in ("valid", "escaped", "source-only", "source-colocated", "unknown-source", "source-non-test", "source-head-fields", "absolute", "unknown", "control", "parent", "drift", "running", "changed-head", "malformed", "duplicate", "oversized", "symlink", "missing", "stale", "valid-after-malformed", "location-assertion", "location-timeout", "location-process", "location-unknown", "location-outside", "location-zero", "location-injection", "location-nonpublic", "location-utf8", "location-working-drift", "location-ansi", "location-oversized-log", "location-symlink-log", "location-hardlink-log", "location-encrypted", "location-encrypted-outside", "location-encrypted-filter-changed", "location-encrypted-working-drift", "location-encrypted-process-changed", "git-failure"):
        if mode.startswith("location-encrypted") != encrypted:
            continue
        exit_code = 127 if mode in ("missing", "git-failure") else 17
        script = body.replace("MODE", repr(mode)).replace("ESCAPED", repr(escaped)).replace("EXIT", str(exit_code))
        case = run_case(root, "failed-test-paths-" + mode, script, expected=exit_code if exit_code < 126 else 1, workspace=workspace)
        if case is None:
            continue
        output = (case / "public.stdout.private").read_text()
        metadata = json.loads(output)
        expected = ["qualitylayer/tests/" + (escaped if mode == "escaped" else "failed.test.ts")] if mode in ("valid", "escaped", "valid-after-malformed") else []
        if mode.startswith("location-"):
            expected = ["qualitylayer/tests/encrypted.test.ts"] if mode.startswith("location-encrypted") else ["qualitylayer/src/nested/view.test.tsx"] if mode == "location-nonpublic" else ["qualitylayer/tests/failed.test.ts"]
        if mode == "source-only":
            expected = ["qualitylayer/src/nested/view.test.tsx"]
        elif mode == "source-colocated":
            expected = ["qualitylayer/src/nested/view.test.tsx", "qualitylayer/tests/failed.test.ts"]
        elif mode == "source-head-fields":
            expected = ["qualitylayer/tests/failed.test.ts"]
        assert set(metadata) == {"failedTestFiles", "failedTestLocations"}
        location = [{"file": "qualitylayer/tests/failed.test.ts", "line": 1, "kind": "assertion" if mode == "location-ansi" else mode.removeprefix("location-")}] if mode in ("location-assertion", "location-timeout", "location-process", "location-unknown", "location-ansi") else []
        if mode == "location-nonpublic":
            location = [{"file": "qualitylayer/src/nested/view.test.tsx", "line": 1, "kind": "unknown"}]
        elif mode == "location-encrypted":
            location = [{"file": "qualitylayer/tests/encrypted.test.ts", "line": 2, "kind": "assertion"}]
        assert metadata["failedTestLocations"] == location
        assert all(term not in output for term in ("PRIVATE_NAME", "PRIVATE_VALUE", "PRIVATE_SOURCE", "PRIVATE_ENV", "PRIVATE_FUNCTION", "ENCRYPTED_PRIVATE_SOURCE_CANARY", "ENCRYPTED_PRIVATE_VALUE", "ENCRYPTED_PRIVATE_CHANGED", "SHOULD_NEVER_EXECUTE"))
        assert metadata["failedTestFiles"] == expected
        assert output.count("\n") == 1
        assert "::notice::" not in output and "##[warning]" not in output
        assert not (case / "public.stderr.private").read_bytes()
        if mode == "location-working-drift":
            (tests / "failed.test.ts").write_text("// synthetic source must never become a public diagnostic\n")
        if mode == "location-encrypted-filter-changed":
            subprocess.run(["git", "-C", str(workspace), "config", "filter.git-crypt.smudge", smudge], check=True)
        if mode == "location-encrypted-process-changed":
            subprocess.run(["git", "-C", str(workspace), "config", "--unset", "filter.git-crypt.process"], check=True)
        if mode == "location-encrypted-working-drift":
            (tests / "encrypted.test.ts").write_text(encrypted_body)
        results[-1]["onlyCurrentHeadTrackedFailedTestPaths"] = True

def cockpit_cases(root, encrypted=False, ordinary=False):
    workspace = root / "cockpit-test-source"
    git_home = root / "cockpit-canary-git-home"
    git_home.mkdir()
    git_environment = {key: value for key, value in os.environ.items() if not key.startswith("GIT_")}
    git_environment.update(HOME=str(git_home), XDG_CONFIG_HOME=str(git_home))
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
    for mode in modes:
        command = code.replace("MODE", repr(mode), 1)
        case = run_case(root, "cockpit-junit-" + mode, '"$QL_CANARY_PYTHON" - <<\'PY\'\n' + command + '\nPY\n', expected=1, workspace=workspace)
        if case is None:
            continue
        output = (case / "public.stdout.private").read_text()
        locations = []
        if mode in ("valid", "unknown", "native"):
            locations = [{"file": file, "line": 3, "kind": "unknown" if mode == "unknown" else "assertion"}, {"file": file, "line": 7, "kind": "timeout"}]
        assert json.loads(output) == {"failedTestFiles": [file], "failedTestLocations": locations}, (mode, output)
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
    case = run_case(root, "cockpit-ordinary-sealed-runner", command, expected=1, workspace=workspace)
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

folder = tempfile.mkdtemp(prefix="ql-sealer-source-free-canary-retained-")
print(json.dumps({"retainedPrivateCases": folder}), flush=True)
with nullcontext(folder) as folder:
    root = Path(folder)
    if sys.argv[2:] == ["test-cockpit-runner"]:
        cockpit_cases(root, encrypted=True, ordinary=True)
        windows = "unrun: focused sealed Bun runner case"
    elif sys.argv[2:] == ["test-paths-encrypted"]:
        if os.name == "nt":
            raise RuntimeError("encrypted path canaries require a POSIX runner with git-crypt already installed")
        test_path_cases(root, encrypted=True)
        cockpit_cases(root, encrypted=True)
        windows = "unrun: selected actual encrypted cases only; requires preinstalled git-crypt"
    elif sys.argv[2:] == ["test-paths"]:
        if os.name == "nt":
            raise RuntimeError("test-paths canaries require a POSIX runner")
        test_path_cases(root)
        cockpit_cases(root)
        windows = "unrun: focused POSIX test-path privacy cases only"
    elif sys.argv[2:] == ["msys2"]:
        body = 'printf "::error::%s\\n::group::%s\\n" "$QL_CANARY_NONCE" "$QL_CANARY_NONCE"\nprintf "%s\\n" "$QL_CANARY_NONCE" >&2\nfor key in GITHUB_ENV GITHUB_OUTPUT GITHUB_STATE GITHUB_STEP_SUMMARY GITHUB_PATH; do printf "%s\\n" "$QL_CANARY_NONCE" > "${!key}"; done\nfor key in ACTIONS_RUNTIME_TOKEN ACTIONS_RUNTIME_URL ACTIONS_RESULTS_URL ACTIONS_CACHE_URL ACTIONS_CACHE_SERVICE_V2 ACTIONS_ID_TOKEN_REQUEST_TOKEN ACTIONS_ID_TOKEN_REQUEST_URL GH_TOKEN GITHUB_TOKEN; do test -z "${!key-}"; done\n'
        run_case(root, "msys2-private-channels", body, shell="msys2")
        run_case(root, "msys2-native-failure-preserved", '"$QL_CANARY_PYTHON" -c "import sys;sys.exit(17)"\n', shell="msys2", expected=17)
        windows = "executed actual msys2 cases"
    elif os.name != "nt":
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
        run_case(root, "failure-preserved", 'printf "%s\\n" "$QL_CANARY_NONCE"; exit 17\n', expected=17)
        run_case(root, "invalid-export-refused", 'printf "digest=%s\\n" "$QL_CANARY_NONCE" >> "$GITHUB_OUTPUT"\n', contract={"GITHUB_OUTPUT": {"digest": "sha256"}}, expected=1)
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
        pid = int((case / "descendant-pid").read_text())
        deadline = time.monotonic() + 3
        while True:
            observed = subprocess.run(["ps", "-p", str(pid), "-o", "stat="], capture_output=True, text=True)
            if observed.returncode != 0:
                break
            if time.monotonic() >= deadline:
                raise RuntimeError("owned descendant still present")
            time.sleep(.05)
        results[-1]["ownedDescendantAbsent"] = True
        windows = "unrun: requires actual Windows/pwsh"
    else:
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
        run_case(root, "powershell-private-channels", '& "$env:QL_CANARY_PYTHON" -c "' + expression + '"\n', shell="pwsh")
        run_case(root, "powershell-invalid-export-refused", 'Add-Content -LiteralPath $env:GITHUB_OUTPUT -Value ("digest="+$env:QL_CANARY_NONCE)\n', shell="pwsh", contract={"GITHUB_OUTPUT": {"digest": "sha256"}}, expected=1)
        run_case(root, "powershell-native-failure-preserved", "cmd.exe /c exit 17\nWrite-Host 'later command succeeds'\n", shell="pwsh", expected=17)
        # A real Job-object case: source child backgrounds a process, then its parent exits.
        background = 'import os,time;from pathlib import Path;Path(os.environ["QL_CANARY_CASE"]+"/descendant-ready").write_text(str(os.getpid()));time.sleep(120)'
        expression = "exec(bytes.fromhex('" + background.encode().hex() + "').decode())"
        body = '$code="' + expression + '"\n$p=Start-Process -FilePath $env:QL_CANARY_PYTHON -ArgumentList @(\'-c\',$code) -PassThru\n$p.Id | Set-Content -LiteralPath ($env:QL_CANARY_CASE+\'/descendant-pid\')\n$deadline=[DateTime]::UtcNow.AddSeconds(3)\nwhile(!(Test-Path ($env:QL_CANARY_CASE+\'/descendant-ready\'))){if([DateTime]::UtcNow -ge $deadline){throw \'readiness\'};Start-Sleep -Milliseconds 20}\nif([int](Get-Content ($env:QL_CANARY_CASE+\'/descendant-ready\')) -ne $p.Id){throw \'identity\'}\n'
        case = run_case(root, "powershell-parent-exits-background-child", body, shell="pwsh")
        pid = int((case / "descendant-pid").read_text().strip())
        observed = subprocess.run(["powershell", "-NoProfile", "-Command", f"if(Get-Process -Id {pid} -ErrorAction SilentlyContinue){{exit 1}}"], capture_output=True)
        assert observed.returncode == 0
        results[-1]["ownedDescendantAbsent"] = True
        windows = "executed on Windows"
    print(json.dumps({"platform": sys.platform, "cases": results, "windows": windows, "qualification": "only actual executed cases; not whole release graph"}, indent=2))
