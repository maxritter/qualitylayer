#!/usr/bin/env python3
"""Copy only the release graph's reviewed export members into a fresh directory."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import stat
import sys
import tempfile

TARGET = r"(?:darwin-arm64|darwin-x64|linux-arm64|linux-x64|win32-x64)"
TARGETS = ("darwin-arm64", "darwin-x64", "linux-arm64", "linux-x64", "win32-x64")

def cli_names():
    return {name + suffix for name in ("qualitylayer-darwin-arm64", "qualitylayer-darwin-x64", "qualitylayer-linux-arm64", "qualitylayer-linux-x64", "qualitylayer-windows-x64.exe", "install.sh", "install.ps1") for suffix in ("", ".sha256")}

def app_names(version, target):
    if target in ("macos-arm64", "macos-x64"):
        arch = target.removeprefix("macos-")
        stem = "QualityLayer-" + version + "-" + target
        return {stem + ".dmg", stem + ".app.tar.gz", stem + ".app.tar.gz.sig", "qualitylayer-darwin-" + arch, "qualitylayer-darwin-" + arch + ".sha256"}
    if target == "windows-x64":
        stem = "QualityLayer-" + version + "-x64-setup.exe"
        return {stem, stem + ".sig", "qualitylayer-windows-x64.exe", "qualitylayer-windows-x64.exe.sha256"}
    if target in ("linux-arm64", "linux-x64"):
        stem = "QualityLayer-" + version + "-" + target + ".AppImage"
        return {stem, stem + ".sig"}
    raise ValueError()

def asset_names(version):
    result = cli_names() | {"latest.json"}
    for target in ("macos-arm64", "macos-x64", "windows-x64", "linux-arm64", "linux-x64"):
        result |= app_names(version, target)
    for target in ("macos-arm64.dmg", "macos-x64.dmg", "x64-setup.exe", "linux-x64.AppImage", "linux-arm64.AppImage"):
        result.add("QualityLayer-" + version + "-" + target + ".sha256")
    return result

def metadata(value, key="", location=()):
    if isinstance(value, dict):
        for name, member in value.items():
            if name.lower() in {"error", "errors", "failure", "stdout", "stderr", "logs", "diagnostics", "transcript", "sourcebody", "sourcecode"} and member not in (None, "", [], {}):
                raise ValueError()
            metadata(member, name, (*location, name))
    elif isinstance(value, list):
        for member in value:
            metadata(member, key, location)
    elif isinstance(value, str):
        if len(value) > 32768:
            raise ValueError()
        # Only the explicitly produced native signature observation is multiline.
        if ("\n" in value or "\r" in value) and location != ("observations", "signature"):
            raise ValueError()
        if re.search(r"(?m)^\s*(?:\d+\s*\||(?:import|export)\s|(?:async\s+)?function\s|pub\s+fn\s|Traceback\b)", value):
            raise ValueError()
        if "-----BEGIN " in value or "PRIVATE KEY" in value:
            raise ValueError()

def allowed(kind, relative, version):
    package = r"QualityLayer-" + re.escape(version) + r"-(?:macos-(?:arm64|x64)(?:\.dmg|\.app\.tar\.gz)|x64-setup\.exe|linux-(?:x64|arm64)\.AppImage)(?:\.(?:sig|sha256))?"
    cli = r"qualitylayer-(?:darwin-(?:arm64|x64)|linux-(?:arm64|x64)|windows-x64\.exe)(?:\.sha256)?"
    if kind == "payload":
        return bool(re.fullmatch(r"(?:manifest|payload-set|provenance)\.json|" + TARGET + r"\.gz|receipts/" + TARGET + r"(?:-native)?\.json|signing/" + TARGET + r"/(?:signature\.txt|verify\.txt|notary\.json|engine\.zip|authenticode\.json|policy\.json)", relative))
    if kind == "payload-signature":
        return relative == "provenance.json.sig"
    if kind in ("cli", "app", "assets"):
        return bool(re.fullmatch(cli + "|" + package + r"|install\.(?:sh|ps1)(?:\.sha256)?|latest\.json", relative))
    if kind == "catalog":
        return relative in ("SHA256SUMS", "SHA256SUMS.sig")
    if kind == "manifest":
        return relative == "candidate.json"
    if kind in ("distribution", "candidate-receipts"):
        return bool(re.fullmatch(r"(?:receipts/)?" + TARGET + r"(?:-native|-distribution)?\.json|evidence/" + TARGET + r"/distribution\.json|distribution-set\.json", relative))
    if kind == "account-acl":
        return relative == "ql-release-account-acls.json"
    return False

def no_symlink_path(path):
    path = Path(os.path.abspath(path))
    at = Path(path.anchor)
    for part in path.parts[1:]:
        at /= part
        try:
            info = at.lstat()
        except FileNotFoundError:
            break
        if (stat.S_ISLNK(info.st_mode) or getattr(info, "st_file_attributes", 0) & getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 1024)) and str(at) not in ("/tmp", "/var"):
            raise ValueError()
    return path.resolve(strict=False)

def digest(path):
    value = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            value.update(block)
    return value.hexdigest()

def declared_evidence(root, entries, expected):
    if not isinstance(entries, list) or len(entries) != len(expected) or {v["path"] for v in entries} != expected:
        raise ValueError()
    for item in entries:
        file = root / item["path"]
        if file.stat().st_size != item["bytes"] or digest(file) != item["sha256"]:
            raise ValueError()

def payload_expected(root, target):
    aggregate = target is None
    targets = (target,) if target else TARGETS
    if any(t not in TARGETS for t in targets):
        raise ValueError()
    expected = {"manifest.json"}
    for target in targets:
        receipt_path = "receipts/" + target + ".json"
        receipt = json.loads((root / receipt_path).read_bytes())
        if receipt.get("status") != "passed" or receipt.get("target") != target:
            raise ValueError()
        native = "receipts/" + target + "-native.json"
        declared_evidence(root, receipt["evidenceFiles"], {native})
        proof = receipt["signing"]
        base = "signing/" + target + "/"
        extra = set()
        if target.startswith("darwin-") and proof.get("policy") == "darwin-developer-id":
            signs = {base + n for n in ("signature.txt", "verify.txt", "notary.json")}
            container = base + "engine.zip"
            notary = proof["notary"]
            if notary.get("status") != "Accepted" or notary.get("containerPath") != container or notary.get("entryPath") != "engram" or digest(root / container) != notary["containerSha256"]:
                raise ValueError()
            extra.add(container)
        elif target == "win32-x64" and proof.get("policy") == "windows-authenticode":
            signs = {base + n for n in ("authenticode.json", "verify.txt")}
        elif (target.startswith("linux-") and proof.get("policy") == "linux-signed-catalog") or (target == "win32-x64" and proof.get("policy") == "windows-unsigned-beta"):
            signs = {base + "policy.json"}
        else:
            raise ValueError()
        declared_evidence(root, proof["evidence"], signs)
        if digest(root / (target + ".gz")) != receipt["compressedSha256"]:
            raise ValueError()
        expected |= {target + ".gz", receipt_path, native} | signs | extra
    if aggregate:
        expected |= {"payload-set.json", "provenance.json"}
    return expected

def distribution_expected(root, targets):
    result = set()
    for target in targets:
        name = "receipts/" + target + ".json"
        receipt = json.loads((root / name).read_bytes())
        if receipt.get("status") != "passed" or receipt.get("target") != target:
            raise ValueError()
        evidence = "evidence/" + target + "/distribution.json"
        declared_evidence(root, receipt["evidenceFiles"], {evidence})
        result |= {name, evidence}
    return result

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--kind", required=True)
    parser.add_argument("--source", required=True)
    parser.add_argument("--destination", required=True)
    parser.add_argument("--version", required=True)
    parser.add_argument("--distribution-set")
    parser.add_argument("--target")
    args = parser.parse_args()
    if args.version != "14.0.0":
        raise ValueError()
    if args.kind not in ("payload", "payload-signature", "cli", "app", "assets", "catalog", "manifest", "distribution", "candidate-receipts", "account-acl"):
        raise ValueError()
    if args.kind not in ("payload", "app", "distribution") and args.target is not None:
        raise ValueError()
    if args.kind in ("payload", "distribution") and args.target is not None and args.target not in TARGETS:
        raise ValueError()
    source = no_symlink_path(args.source)
    destination = no_symlink_path(args.destination)
    if source.is_relative_to(destination) or destination.is_relative_to(source):
        raise ValueError()
    if source.is_symlink() or not source.exists() or destination.exists():
        raise ValueError()
    root = source if source.is_dir() else source.parent
    files = []
    pending = [source]
    while pending:
        entry = pending.pop()
        info = entry.lstat()
        if stat.S_ISLNK(info.st_mode) or getattr(info, "st_file_attributes", 0) & getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 1024):
            raise ValueError()
        if stat.S_ISDIR(info.st_mode):
            pending.extend(sorted(entry.iterdir(), reverse=True))
        else:
            files.append(entry)
    files.sort()
    if not files or len(files) > 200:
        raise ValueError()
    rows = []
    for file in files:
        info = file.lstat()
        relative = file.relative_to(root).as_posix()
        if not stat.S_ISREG(info.st_mode) or not 0 < info.st_size <= 1024**3 or not allowed(args.kind, relative, args.version):
            raise ValueError()
        if file.suffix == ".json" and args.kind not in ("assets", "app", "cli"):
            if info.st_size > 1024 * 1024:
                raise ValueError()
            metadata(json.loads(file.read_bytes()))
        rows.append((file, relative, info))
    if args.kind == "candidate-receipts":
        if not args.distribution_set:
            raise ValueError()
        if any(relative == "distribution-set.json" for _file, relative, _before in rows):
            raise ValueError()
        file = no_symlink_path(args.distribution_set)
        if file.name != "distribution-set.json" or file.is_symlink() or not stat.S_ISREG(file.stat().st_mode) or not 0 < file.stat().st_size <= 1024 * 1024:
            raise ValueError()
        metadata(json.loads(file.read_bytes()))
        rows.append((file, file.name, file.stat()))
    elif args.distribution_set:
        raise ValueError()
    names = {relative for _file, relative, _before in rows}
    expected = cli_names() if args.kind == "cli" else app_names(args.version, args.target) if args.kind == "app" else asset_names(args.version) if args.kind == "assets" else {"SHA256SUMS", "SHA256SUMS.sig"} if args.kind == "catalog" else {"candidate.json"} if args.kind == "manifest" else {"ql-release-account-acls.json"} if args.kind == "account-acl" else {"provenance.json.sig"} if args.kind == "payload-signature" else None
    if args.kind in ("distribution", "candidate-receipts"):
        targets = TARGETS if args.kind == "candidate-receipts" else (args.target,)
        if any(target not in TARGETS for target in targets):
            raise ValueError()
        expected = {name for target in targets for name in ("receipts/" + target + ".json", "evidence/" + target + "/distribution.json")}
        if args.kind == "candidate-receipts":
            expected.add("distribution-set.json")
    if len(names) != len(rows):
        raise ValueError()
    if args.kind == "payload":
        expected = payload_expected(root, args.target)
    if args.kind in ("distribution", "candidate-receipts"):
        expected = distribution_expected(root, targets) | ({"distribution-set.json"} if args.kind == "candidate-receipts" else set())
    if expected is not None and names != expected:
        raise ValueError()
    destination.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    temporary = Path(tempfile.mkdtemp(prefix=".ql-artifact-export-", dir=destination.parent))
    try:
        for file, relative, before in rows:
            target = temporary / relative
            target.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
            descriptor = os.open(file, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
            with os.fdopen(descriptor, "rb") as incoming, target.open("xb") as outgoing:
                opened = os.fstat(incoming.fileno())
                if (before.st_ino, before.st_size, before.st_mtime_ns, before.st_ctime_ns) != (opened.st_ino, opened.st_size, opened.st_mtime_ns, opened.st_ctime_ns):
                    raise ValueError()
                shutil.copyfileobj(incoming, outgoing, 1024 * 1024)
                after = os.fstat(incoming.fileno())
                if (opened.st_ino, opened.st_size, opened.st_mtime_ns, opened.st_ctime_ns) != (after.st_ino, after.st_size, after.st_mtime_ns, after.st_ctime_ns):
                    raise ValueError()
            target.chmod(0o500 if before.st_mode & 0o111 else 0o400)
        if destination.exists() or destination.is_symlink():
            raise ValueError()
        temporary.rename(destination)
    finally:
        if temporary.exists():
            shutil.rmtree(temporary)
    print("Reviewed release artifact members staged.")

if __name__ == "__main__":
    try:
        main()
    except (Exception, KeyboardInterrupt):
        print("Release artifact export refused.", file=sys.stderr)
        sys.exit(1)
