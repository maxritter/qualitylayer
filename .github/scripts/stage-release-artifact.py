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
VALID_KINDS = ("payload", "payload-signature", "cli", "app", "assets", "catalog", "manifest", "distribution", "candidate-receipts", "account-acl")
VERSION_RE = re.compile(r"(?:1[2-9]|[2-9][0-9]|[1-9][0-9]{2,})\.[0-9]+\.[0-9]+(?:-[A-Za-z0-9.-]+)?")
CODE_SNIPPET_RE = re.compile(r"(?m)^\s*(?:\d+\s*\||(?:import|export)\s|(?:async\s+)?function\s|pub\s+fn\s|Traceback\b)")
FORBIDDEN_METADATA_KEYS = {"error", "errors", "failure", "stdout", "stderr", "logs", "diagnostics", "transcript", "sourcebody", "sourcecode"}
ALLOWED_EXACT = {
    "payload-signature": {"provenance.json.sig"},
    "catalog": {"SHA256SUMS", "SHA256SUMS.sig"},
    "manifest": {"candidate.json"},
    "account-acl": {"ql-release-account-acls.json"},
}
PAYLOAD_RE = re.compile(r"(?:manifest|payload-set|provenance)\.json|" + TARGET + r"\.gz|receipts/" + TARGET + r"(?:-native)?\.json|signing/" + TARGET + r"/(?:signature\.txt|verify\.txt|notary\.json|engine\.zip|authenticode\.json|policy\.json)")
DISTRIBUTION_RE = re.compile(r"(?:receipts/)?" + TARGET + r"(?:-native|-distribution)?\.json|evidence/" + TARGET + r"/distribution\.json|distribution-set\.json")


def require(ok):
    if not ok:
        raise ValueError()


def is_link_or_reparse(info):
    reparse = getattr(info, "st_file_attributes", 0) & getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 1024)
    return stat.S_ISLNK(info.st_mode) or bool(reparse)


def cli_names():
    return {name + suffix for name in ("qualitylayer-darwin-arm64", "qualitylayer-darwin-x64", "qualitylayer-linux-arm64", "qualitylayer-linux-x64", "qualitylayer-windows-x64.exe", "install.sh", "install.ps1") for suffix in ("", ".sha256")}


def app_names(version, target):
    macos = lambda arch: {
        f"QualityLayer-{version}-macos-{arch}.dmg",
        f"QualityLayer-{version}-macos-{arch}.app.tar.gz",
        f"QualityLayer-{version}-macos-{arch}.app.tar.gz.sig",
        f"qualitylayer-darwin-{arch}",
        f"qualitylayer-darwin-{arch}.sha256",
    }
    linux = lambda arch: {
        f"QualityLayer-{version}-linux-{arch}.AppImage",
        f"QualityLayer-{version}-linux-{arch}.AppImage.sig",
    }
    builders = {
        "macos-arm64": lambda: macos("arm64"),
        "macos-x64": lambda: macos("x64"),
        "windows-x64": lambda: {
            f"QualityLayer-{version}-x64-setup.exe",
            f"QualityLayer-{version}-x64-setup.exe.sig",
            "qualitylayer-windows-x64.exe",
            "qualitylayer-windows-x64.exe.sha256",
        },
        "linux-arm64": lambda: linux("arm64"),
        "linux-x64": lambda: linux("x64"),
    }
    builder = builders.get(target)
    require(builder is not None)
    return builder()


def asset_names(version):
    result = cli_names() | {"latest.json"}
    for target in ("macos-arm64", "macos-x64", "windows-x64", "linux-arm64", "linux-x64"):
        result |= app_names(version, target)
    result |= {f"QualityLayer-{version}-{t}.sha256" for t in ("macos-arm64.dmg", "macos-x64.dmg", "x64-setup.exe", "linux-x64.AppImage", "linux-arm64.AppImage")}
    return result


def validate_metadata_string(value, location):
    require(len(value) <= 32768)
    # Only the explicitly produced native signature observation is multiline.
    require(location == ("observations", "signature") or ("\n" not in value and "\r" not in value))
    require(not CODE_SNIPPET_RE.search(value))
    require("-----BEGIN " not in value and "PRIVATE KEY" not in value)


def validate_metadata_dict(value, location):
    for name, member in value.items():
        require(name.lower() not in FORBIDDEN_METADATA_KEYS or member in (None, "", [], {}))
        metadata(member, name, (*location, name))


def metadata(value, key="", location=()):
    handlers = {
        dict: lambda: validate_metadata_dict(value, location),
        list: lambda: [metadata(member, key, location) for member in value],
        str: lambda: validate_metadata_string(value, location),
    }
    handler = handlers.get(type(value))
    if handler is not None:
        handler()


def allowed(kind, relative, version):
    exact = ALLOWED_EXACT.get(kind)
    if exact is not None:
        return relative in exact
    package = r"QualityLayer-" + re.escape(version) + r"-(?:macos-(?:arm64|x64)(?:\.dmg|\.app\.tar\.gz)|x64-setup\.exe|linux-(?:x64|arm64)\.AppImage)(?:\.(?:sig|sha256))?"
    cli = r"qualitylayer-(?:darwin-(?:arm64|x64)|linux-(?:arm64|x64)|windows-x64\.exe)(?:\.sha256)?"
    patterns = {
        "payload": PAYLOAD_RE,
        "cli": re.compile(cli + "|" + package + r"|install\.(?:sh|ps1)(?:\.sha256)?|latest\.json"),
        "app": re.compile(cli + "|" + package + r"|install\.(?:sh|ps1)(?:\.sha256)?|latest\.json"),
        "assets": re.compile(cli + "|" + package + r"|install\.(?:sh|ps1)(?:\.sha256)?|latest\.json"),
        "distribution": DISTRIBUTION_RE,
        "candidate-receipts": DISTRIBUTION_RE,
    }
    pattern = patterns.get(kind)
    return bool(pattern and pattern.fullmatch(relative))


def lstat_or_none(path):
    try:
        return path.lstat()
    except FileNotFoundError:
        return None


def no_symlink_path(path):
    path = Path(os.path.abspath(path))
    at = Path(path.anchor)
    for part in path.parts[1:]:
        at /= part
        info = lstat_or_none(at)
        if info is None:
            break
        require(str(at) in ("/tmp", "/var") or not is_link_or_reparse(info))
    return path.resolve(strict=False)


def digest(path):
    value = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            value.update(block)
    return value.hexdigest()


def declared_evidence(root, entries, expected):
    require(isinstance(entries, list) and len(entries) == len(expected) and {v["path"] for v in entries} == expected)
    for item in entries:
        file = root / item["path"]
        require(file.stat().st_size == item["bytes"] and digest(file) == item["sha256"])


def darwin_signing_expected(root, base, proof):
    signs = {base + n for n in ("signature.txt", "verify.txt", "notary.json")}
    container = base + "engine.zip"
    notary = proof["notary"]
    valid_notary = (
        notary.get("status") == "Accepted"
        and notary.get("containerPath") == container
        and notary.get("entryPath") == "engram"
        and digest(root / container) == notary["containerSha256"]
    )
    require(valid_notary)
    return signs, {container}


def signing_expected(root, target, proof):
    base = "signing/" + target + "/"
    family = target.split("-", 1)[0]
    rules = {
        ("darwin", "darwin-developer-id"): lambda: darwin_signing_expected(root, base, proof),
        ("win32", "windows-authenticode"): lambda: ({base + n for n in ("authenticode.json", "verify.txt")}, set()),
        ("linux", "linux-signed-catalog"): lambda: ({base + "policy.json"}, set()),
        ("win32", "windows-unsigned-beta"): lambda: ({base + "policy.json"}, set()),
    }
    handler = rules.get((family, proof.get("policy")))
    require(handler is not None)
    return handler()


def target_payload_expected(root, target):
    receipt_path = "receipts/" + target + ".json"
    receipt = json.loads((root / receipt_path).read_bytes())
    require(receipt.get("status") == "passed" and receipt.get("target") == target)
    native = "receipts/" + target + "-native.json"
    declared_evidence(root, receipt["evidenceFiles"], {native})
    proof = receipt["signing"]
    signs, extra = signing_expected(root, target, proof)
    declared_evidence(root, proof["evidence"], signs)
    require(digest(root / (target + ".gz")) == receipt["compressedSha256"])
    return {target + ".gz", receipt_path, native} | signs | extra


def payload_expected(root, target):
    aggregate = target is None
    targets = (target,) if target else TARGETS
    require(all(t in TARGETS for t in targets))
    expected = {"manifest.json"}
    for item in targets:
        expected |= target_payload_expected(root, item)
    if aggregate:
        expected |= {"payload-set.json", "provenance.json"}
    return expected


def distribution_expected(root, targets):
    result = set()
    for target in targets:
        name = "receipts/" + target + ".json"
        receipt = json.loads((root / name).read_bytes())
        require(receipt.get("status") == "passed" and receipt.get("target") == target)
        evidence = "evidence/" + target + "/distribution.json"
        declared_evidence(root, receipt["evidenceFiles"], {evidence})
        result |= {name, evidence}
    return result

def validate_args(args):
    require(bool(VERSION_RE.fullmatch(args.version)))
    require(args.kind in VALID_KINDS)
    require(args.target is None or args.kind in ("payload", "app", "distribution"))
    require(args.kind not in ("payload", "distribution") or args.target is None or args.target in TARGETS)


def expand_entry(entry, pending, files):
    info = entry.lstat()
    require(not is_link_or_reparse(info))
    if stat.S_ISDIR(info.st_mode):
        pending.extend(sorted(entry.iterdir(), reverse=True))
    else:
        files.append(entry)


def collect_files(source):
    files = []
    pending = [source]
    while pending:
        expand_entry(pending.pop(), pending, files)
    files.sort()
    require(0 < len(files) <= 200)
    return files


def inspect_one_file(file, root, kind, version):
    info = file.lstat()
    relative = file.relative_to(root).as_posix()
    require(stat.S_ISREG(info.st_mode) and 0 < info.st_size <= 1024**3 and allowed(kind, relative, version))
    if file.suffix == ".json" and kind not in ("assets", "app", "cli"):
        require(info.st_size <= 1024 * 1024)
        inspected = file.read_bytes()
        metadata(json.loads(inspected))
        return (file, relative, info), hashlib.sha256(inspected).hexdigest()
    return (file, relative, info), digest(file)


def inspect_files(files, root, kind, version):
    rows = []
    digests = {}
    for file in files:
        row, sha = inspect_one_file(file, root, kind, version)
        digests[row[1]] = sha
        rows.append(row)
    return rows, digests


def attach_distribution_set(rows, digests, args):
    if args.kind != "candidate-receipts":
        require(not args.distribution_set)
        return
    require(bool(args.distribution_set))
    require(all(relative != "distribution-set.json" for _file, relative, _before in rows))
    file = no_symlink_path(args.distribution_set)
    info = file.stat()
    require(file.name == "distribution-set.json" and not file.is_symlink())
    require(stat.S_ISREG(info.st_mode) and 0 < info.st_size <= 1024 * 1024)
    inspected = file.read_bytes()
    metadata(json.loads(inspected))
    digests[file.name] = hashlib.sha256(inspected).hexdigest()
    rows.append((file, file.name, info))


def expected_names(root, args):
    fixed = {
        "cli": cli_names,
        "app": lambda: app_names(args.version, args.target),
        "assets": lambda: asset_names(args.version),
        "catalog": lambda: {"SHA256SUMS", "SHA256SUMS.sig"},
        "manifest": lambda: {"candidate.json"},
        "account-acl": lambda: {"ql-release-account-acls.json"},
        "payload-signature": lambda: {"provenance.json.sig"},
        "payload": lambda: payload_expected(root, args.target),
    }
    builder = fixed.get(args.kind)
    if builder is not None:
        return builder()
    targets = TARGETS if args.kind == "candidate-receipts" else (args.target,)
    require(all(target in TARGETS for target in targets))
    extra = {"distribution-set.json"} if args.kind == "candidate-receipts" else set()
    return distribution_expected(root, targets) | extra


def open_identity(info):
    return (info.st_dev, info.st_ino, stat.S_IFMT(info.st_mode), info.st_size, info.st_mtime_ns)


def full_identity(info):
    return (info.st_dev, info.st_ino, info.st_mode, info.st_size, info.st_mtime_ns, info.st_ctime_ns)


def copy_staged_file(file, target, before, expected_digest):
    target.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    descriptor = os.open(file, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
    with os.fdopen(descriptor, "rb") as incoming, target.open("xb") as outgoing:
        opened = os.fstat(incoming.fileno())
        # Windows path stat reports creation time as ctime; fstat reports change time.
        require(open_identity(before) == open_identity(opened))
        copied = hashlib.sha256()
        for block in iter(lambda: incoming.read(1024 * 1024), b""):
            outgoing.write(block)
            copied.update(block)
        require(copied.hexdigest() == expected_digest)
        require(full_identity(opened) == full_identity(os.fstat(incoming.fileno())))
    require(full_identity(before) == full_identity(file.lstat()))
    target.chmod(0o500 if before.st_mode & 0o111 else 0o400)


def stage_rows(rows, digests, destination):
    destination.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    temporary = Path(tempfile.mkdtemp(prefix=".ql-artifact-export-", dir=destination.parent))
    try:
        for file, relative, before in rows:
            copy_staged_file(file, temporary / relative, before, digests[relative])
        require(not destination.exists() and not destination.is_symlink())
        temporary.rename(destination)
    finally:
        if temporary.exists():
            shutil.rmtree(temporary)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--kind", required=True)
    parser.add_argument("--source", required=True)
    parser.add_argument("--destination", required=True)
    parser.add_argument("--version", required=True)
    parser.add_argument("--distribution-set")
    parser.add_argument("--target")
    args = parser.parse_args()
    validate_args(args)
    source = no_symlink_path(args.source)
    destination = no_symlink_path(args.destination)
    require(not source.is_relative_to(destination) and not destination.is_relative_to(source))
    require(not source.is_symlink() and source.exists() and not destination.exists())
    root = source if source.is_dir() else source.parent
    files = collect_files(source)
    rows, inspected_digests = inspect_files(files, root, args.kind, args.version)
    attach_distribution_set(rows, inspected_digests, args)
    names = {relative for _file, relative, _before in rows}
    require(len(names) == len(rows))
    require(names == expected_names(root, args))
    stage_rows(rows, inspected_digests, destination)
    print("Reviewed release artifact members staged.")


def report_refusal(error):
    safe_types = {"ValueError", "KeyError", "TypeError", "OSError", "FileNotFoundError", "PermissionError", "JSONDecodeError", "KeyboardInterrupt", "RuntimeError", "OverflowError"}
    category = type(error).__name__ if type(error).__name__ in safe_types else "OtherError"
    code = getattr(error, "errno", 0)
    code = code if type(code) is int and -(2**31) <= code < 2**31 else 0
    line = 0
    trace = error.__traceback__
    while trace is not None:
        if trace.tb_frame.f_code.co_filename == __file__:
            line = trace.tb_lineno
        trace = trace.tb_next
    print(f"Release artifact export refused (type={category}, line={line}, errno={code}).", file=sys.stderr)


if __name__ == "__main__":
    try:
        main()
    except (Exception, KeyboardInterrupt) as error:
        report_refusal(error)
        sys.exit(1)
