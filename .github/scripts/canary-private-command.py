#!/usr/bin/env python3
"""Finite source-free canaries; platform cases are reported separately."""
import hashlib
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import tempfile
import time
from contextlib import nullcontext

runner = Path(sys.argv[1]).resolve()
results = []
channels = ("GITHUB_ENV", "GITHUB_OUTPUT", "GITHUB_STATE", "GITHUB_STEP_SUMMARY", "GITHUB_PATH")
capabilities = ("ACTIONS_RUNTIME_TOKEN", "ACTIONS_RUNTIME_URL", "ACTIONS_RESULTS_URL", "ACTIONS_CACHE_URL", "ACTIONS_CACHE_SERVICE_V2", "ACTIONS_ID_TOKEN_REQUEST_TOKEN", "ACTIONS_ID_TOKEN_REQUEST_URL", "GH_TOKEN", "GITHUB_TOKEN")

def run_case(root, name, body, shell="bash", contract=None, expected=0):
    if os.environ.get("QL_CANARY_ONLY") and os.environ["QL_CANARY_ONLY"] != name:
        return None
    case = root / name
    case.mkdir()
    nonce = os.urandom(24).hex()
    script = case / ("fixture.ps1" if shell == "pwsh" else "fixture.sh")
    script.write_text(body)
    env = {key: os.environ[key] for key in ("PATH", "HOME", "SystemRoot", "WINDIR", "PATHEXT", "LANG", "PYTHONPATH", "QL_CANARY_TRACE_PATH") if key in os.environ}
    env.update(RUNNER_TEMP=str(case), QL_CANARY_NONCE=nonce, QL_CANARY_CASE=str(case), QL_CANARY_PYTHON=sys.executable, QL_RELEASE_EXPORTS=json.dumps(contract or {}))
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

folder = tempfile.mkdtemp(prefix="ql-sealer-source-free-canary-retained-")
print(json.dumps({"retainedPrivateCases": folder}), flush=True)
with nullcontext(folder) as folder:
    root = Path(folder)
    if sys.argv[2:] == ["msys2"]:
        body = 'printf "::error::%s\\n::group::%s\\n" "$QL_CANARY_NONCE" "$QL_CANARY_NONCE"\nprintf "%s\\n" "$QL_CANARY_NONCE" >&2\nfor key in GITHUB_ENV GITHUB_OUTPUT GITHUB_STATE GITHUB_STEP_SUMMARY GITHUB_PATH; do printf "%s\\n" "$QL_CANARY_NONCE" > "${!key}"; done\nfor key in ACTIONS_RUNTIME_TOKEN ACTIONS_RUNTIME_URL ACTIONS_RESULTS_URL ACTIONS_CACHE_URL ACTIONS_CACHE_SERVICE_V2 ACTIONS_ID_TOKEN_REQUEST_TOKEN ACTIONS_ID_TOKEN_REQUEST_URL GH_TOKEN GITHUB_TOKEN; do test -z "${!key-}"; done\n'
        run_case(root, "msys2-private-channels", body, shell="msys2")
        run_case(root, "msys2-native-failure-preserved", '"$QL_CANARY_PYTHON" -c "import sys;sys.exit(17)"\n', shell="msys2", expected=17)
        windows = "executed actual msys2 cases"
    elif os.name != "nt":
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
