#!/usr/bin/env python3
"""Validate a one-release authority receipt without changing check outcomes."""
import hashlib
import json
import os
from pathlib import Path
import re
import sys

DEFERRED = {"normal-ci", "source-ui", "full-regression", "security-scan", "supply-chain", "sonar-qlty", "agent-matrix", "benchmarks"}
RETAINED = {"source-confidentiality", "artifact-inventory", "artifact-hashes", "platform-signatures", "macos-notarization", "catalog-signature", "native-install-upgrade", "installed-candidate-authority"}
PROFILES = {
    "14.0.0": ("Max 2026-11-12 13:07 UTC", "14.0.1", DEFERRED, RETAINED),
    "14.1.0": (
        "Max 2026-11-15 explicit 14.1.0 CI exception",
        "14.1.1",
        DEFERRED,
        RETAINED | {"real-agent-workflow", "question-answer-stop-resume"},
    ),
}

def main():
    raw = os.environ.get("INSTALLED_RECEIPT", "")
    if not raw:
        return 2
    if len(raw.encode()) > 16384:
        raise ValueError()
    outer = json.loads(raw)
    receipt = outer.get("releaseException", outer)
    if receipt.get("kind") != "release14-minimum-authorization" or type(receipt.get("schema")) is not int or receipt.get("schema") != 1:
        return 2
    if set(receipt) != {"schema", "kind", "version", "sourceCommit", "authority", "followupVersion", "deferred", "retained"}:
        raise ValueError()
    version = os.environ.get("INPUT_VERSION")
    profile = PROFILES.get(version)
    if os.environ.get("GITHUB_EVENT_NAME") != "workflow_dispatch" or profile is None:
        raise ValueError()
    authority, followup, deferred_checks, retained_checks = profile
    source = os.environ.get("RELEASE_SOURCE_SHA", "")
    if not re.fullmatch(r"[a-f0-9]{40}", source) or receipt.get("version") != version or receipt.get("sourceCommit") != source:
        raise ValueError()
    if receipt.get("authority") != authority or receipt.get("followupVersion") != followup:
        raise ValueError()
    retained = receipt.get("retained")
    if not isinstance(retained, list) or len(retained) != len(retained_checks) or any(not isinstance(item, str) for item in retained) or set(retained) != retained_checks:
        raise ValueError()
    if not isinstance(receipt.get("deferred"), dict) or set(receipt["deferred"]) != deferred_checks:
        raise ValueError()
    for row in receipt["deferred"].values():
        if not isinstance(row, dict) or set(row) != {"state", "evidence"} or row.get("state") not in ("failed", "cancelled", "unrun", "stale") or not isinstance(row.get("evidence"), str):
            raise ValueError()
        if not re.fullmatch(r"(?:github-(?:run|job):[1-9][0-9]{0,19}|(?:local-receipt-)?sha256:[a-f0-9]{64}|source-compatible:[a-f0-9]{40}|not-run)", row["evidence"]):
            raise ValueError()
    canonical = (json.dumps(receipt, sort_keys=True, separators=(",", ":")) + "\n").encode()
    catalog = os.environ.get("RELEASE_CATALOG")
    manifest = os.environ.get("RELEASE_MANIFEST")
    if bool(catalog) != bool(manifest):
        raise ValueError()
    if catalog and manifest:
        # Caller must first run the existing production signature/candidate verifier.
        # This additionally binds actual latest.json bytes to its exact signed checksum.
        entries = []
        for line in Path(catalog).read_text().splitlines():
            match = re.fullmatch(r"([a-f0-9]{64}) [ *](.+)", line)
            if match and match[2] == "latest.json":
                entries.append(match[1])
        body = Path(manifest).read_bytes()
        if len(body) > 1024 * 1024 or len(entries) != 1 or entries[0] != hashlib.sha256(body).hexdigest():
            raise ValueError()
        actual = json.loads(body).get("releaseAuthorization")
        if (json.dumps(actual, sort_keys=True, separators=(",", ":")) + "\n").encode() != canonical:
            raise ValueError()
    private = Path(os.environ["RUNNER_TEMP"]) / "release14-authorization.json"
    private.write_bytes(canonical)
    private.chmod(0o600)
    # The caller records this as deferred authority, never as a successful test.
    print(json.dumps({"authorized": True, "version": version, "sourceCommit": source, "authorizationSha256": hashlib.sha256(canonical).hexdigest(), "deferredChecks": sorted(deferred_checks)}, separators=(",", ":")))
    return 0

if __name__ == "__main__":
    try:
        result = main()
    except (Exception, KeyboardInterrupt):
        print("Release exception receipt rejected.", file=sys.stderr)
        sys.exit(1)
    else:
        sys.exit(result)
