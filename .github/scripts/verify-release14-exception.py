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

RECEIPT_FIELDS = {
    "schema",
    "kind",
    "version",
    "sourceCommit",
    "authority",
    "followupVersion",
    "deferred",
    "retained",
}
DEFERRED_STATES = ("failed", "cancelled", "unrun", "stale")
EVIDENCE_PATTERN = re.compile(
    r"(?:github-(?:run|job):[1-9][0-9]{0,19}|(?:local-receipt-)?sha256:[a-f0-9]{64}|source-compatible:[a-f0-9]{40}|not-run)"
)


def parse_receipt(raw):
    if len(raw.encode()) > 16384:
        raise ValueError()
    outer = json.loads(raw)
    receipt = outer.get("releaseException", outer)
    is_valid_kind = receipt.get("kind") == "release14-minimum-authorization"
    is_valid_schema = type(receipt.get("schema")) is int and receipt.get("schema") == 1
    if not (is_valid_kind and is_valid_schema):
        return None
    if set(receipt) != RECEIPT_FIELDS:
        raise ValueError()
    return receipt


def validate_deferred(deferred, deferred_checks):
    if not isinstance(deferred, dict) or set(deferred) != deferred_checks:
        raise ValueError()
    for row in deferred.values():
        valid_row = (
            isinstance(row, dict)
            and set(row) == {"state", "evidence"}
            and row.get("state") in DEFERRED_STATES
            and isinstance(row.get("evidence"), str)
        )
        if not valid_row or not EVIDENCE_PATTERN.fullmatch(row["evidence"]):
            raise ValueError()


def validate_receipt(receipt, version, source, profile):
    authority, followup, deferred_checks, retained_checks = profile
    if not re.fullmatch(r"[a-f0-9]{40}", source):
        raise ValueError()
    expected = {
        "version": version,
        "sourceCommit": source,
        "authority": authority,
        "followupVersion": followup,
    }
    if any(receipt.get(field) != value for field, value in expected.items()):
        raise ValueError()
    retained = receipt.get("retained")
    valid_retained = (
        isinstance(retained, list)
        and len(retained) == len(retained_checks)
        and all(isinstance(item, str) for item in retained)
        and set(retained) == retained_checks
    )
    if not valid_retained:
        raise ValueError()
    validate_deferred(receipt.get("deferred"), deferred_checks)


def verify_manifest_binding(catalog, manifest, canonical):
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


def main():
    raw = os.environ.get("INSTALLED_RECEIPT", "")
    if not raw:
        return 2
    receipt = parse_receipt(raw)
    if receipt is None:
        return 2
    version = os.environ.get("INPUT_VERSION")
    profile = PROFILES.get(version)
    if os.environ.get("GITHUB_EVENT_NAME") != "workflow_dispatch" or profile is None:
        raise ValueError()
    source = os.environ.get("RELEASE_SOURCE_SHA", "")
    validate_receipt(receipt, version, source, profile)
    canonical = (json.dumps(receipt, sort_keys=True, separators=(",", ":")) + "\n").encode()
    catalog = os.environ.get("RELEASE_CATALOG")
    manifest = os.environ.get("RELEASE_MANIFEST")
    if bool(catalog) != bool(manifest):
        raise ValueError()
    if catalog and manifest:
        verify_manifest_binding(catalog, manifest, canonical)
    private = Path(os.environ["RUNNER_TEMP"]) / "release14-authorization.json"
    private.write_bytes(canonical)
    private.chmod(0o600)
    # The caller records this as deferred authority, never as a successful test.
    deferred_checks = profile[2]
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
