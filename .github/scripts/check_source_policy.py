#!/usr/bin/env python3
"""Keyless raw-blob protection: exact reviewed public bytes, independently private paths."""
import argparse, fnmatch, hashlib, json, os, re, subprocess, sys
POLICY = '.github/scripts/public-source-policy.json'
HEADER = b'\0GITCRYPT\0'
HEX_40 = re.compile(r'[0-9a-f]{40}')
HEX_64 = re.compile(r'[0-9a-f]{64}')
PUBLIC_LICENCE = {'qualitylayer/src/core/licence/address-policy.ts', 'qualitylayer/src/core/licence/mask.ts', 'qualitylayer/src/core/licence/workflow.ts'}
LEGACY_METADATA = {'qualitylayer/package.json', 'qualitylayer/bun.lock', 'qualitylayer/tsconfig.json', 'qualitylayer/biome.json'}
PRIVATE_EXACT = {'.github/hooks/commit-msg', '.github/hooks/pre-commit', '.github/hooks/pre-push', '.github/scripts/verify-promotion-source.sh', '.github/workflows/scripts/verify-authenticode.ps1', '.github/workflows/scripts/windows-sign.ps1', 'docs/agents/models.md', 'docs/agents/operations.md', 'docs/agents/release.md', 'docs/agents/reviews/12.2-public-feedback.json', 'docs/agents/verification.md', 'docs/plans/2026-11-10-local-first-qualitylayer/r2-resource-manifest.md', 'docs/plans/2026-11-10-machines-in-the-app/agents/06-verify.md', 'docs/site/scripts/build-deploy.sh', 'docs/site/scripts/capture-evidence.mjs', 'docs/site/scripts/capture-publish.mjs', 'docs/site/scripts/capture-scenes.mjs', 'docs/site/scripts/capture-source.mjs', 'docs/site/scripts/capture-source.test.mjs', 'docs/site/scripts/check-billing.mjs', 'docs/site/scripts/check-captures.mjs', 'docs/site/scripts/check-captures.test.mjs', 'docs/site/scripts/compile-shared-api.mjs', 'docs/site/scripts/indexnow-submit.mjs', 'docs/site/scripts/record-showcase.mjs', 'docs/site/scripts/test-billing.mjs', 'docs/site/vercel-build-check.sh', 'docs/site/vercel-config.test.ts'}
PRIVATE_PREFIXES = ('qualitylayer/src/core/licence/', 'qualitylayer/src/commercial/licensing/', 'docs/site/api/', 'docs/site/workers/', 'docs/video/', '.github/private-workflows/', 'qualitylayer/artifacts/collaboration-data-model/', 'qualitylayer/scripts/backend-preparation/', 'qualitylayer/tests/backend-preparation/')
GUARDED_PREFIXES = ('qualitylayer/', 'docs/site/api/', 'docs/site/scripts/', 'docs/site/workers/', 'docs/video/')

def require(ok, message):
    if not ok: raise ValueError(message)

def private(path):
    if path in PUBLIC_LICENCE: return False
    return path.startswith(PRIVATE_PREFIXES) or path in PRIVATE_EXACT or path == 'qualitylayer/app/src-tauri/build.rs'

def safe(path):
    if not isinstance(path, str) or not path: return False
    return '\\' not in path and '\0' not in path and all(p not in ('', '.', '..') for p in path.split('/'))

def digest(value):
    return isinstance(value, str) and bool(HEX_64.fullmatch(value))

def git(*args, data=None, allow=False):
    p = subprocess.run(['git', '--no-optional-locks', *args], input=data, capture_output=True)
    if p.returncode and not allow: raise RuntimeError('Git metadata operation failed')
    return p

def no_duplicates(pairs):
    result = dict(pairs)
    require(len(result) == len(pairs), 'Duplicate policy field')
    return result

def read_policy(spec):
    p = git('cat-file', 'blob', spec, allow=True)
    if p.returncode: return None
    require(len(p.stdout) <= 4 * 1024 * 1024, 'Policy byte limit')
    data = json.loads(p.stdout, object_pairs_hook=no_duplicates)
    require(set(data) == {'schema', 'sourceHead', 'reviewManifestSha256', 'publicFiles'} and data['schema'] == 1, 'Invalid source policy schema')
    head = data['sourceHead']
    require(isinstance(head, str) and bool(HEX_40.fullmatch(head)) and digest(data['reviewManifestSha256']), 'Invalid policy source identity')
    public_files = data['publicFiles']
    require(isinstance(public_files, dict) and len(public_files) <= 20000, 'Invalid public member set')
    for path, sha in public_files.items():
        valid = safe(path) and path != POLICY and not private(path) and digest(sha)
        require(valid, 'Public policy names an invalid/private input: ' + str(path))
    return public_files

def tree_files(ref):
    out = {}
    for record in filter(None, git('ls-tree', '-r', '-z', ref).stdout.split(b'\0')):
        meta, path = record.split(b'\t', 1); mode, kind, oid = meta.decode().split()
        out[os.fsdecode(path)] = (mode, kind, oid)
    return out

def index_files():
    out = {}
    for record in filter(None, git('ls-files', '--stage', '-z').stdout.split(b'\0')):
        meta, path = record.split(b'\t', 1); mode, oid, stage = meta.decode().split()
        require(stage == '0', 'Unmerged private index')
        out[os.fsdecode(path)] = (mode, 'blob', oid)
    return out

def patterns(spec):
    raw = git('cat-file', 'blob', spec, allow=True)
    if raw.returncode: return []
    lines = (line.split() for line in raw.stdout.decode('utf8').splitlines())
    return [f[0] for f in lines if f and not f[0].startswith('#') and 'filter=git-crypt' in f[1:]]

def guarded(path, globs):
    return private(path) or path.startswith(GUARDED_PREFIXES) or path == 'scripts/cutover.sh' or any(fnmatch.fnmatchcase(path, p) for p in globs)

class Blobs:
    def __init__(self): self.process = subprocess.Popen(['git', '--no-optional-locks', 'cat-file', '--batch'], stdin=subprocess.PIPE, stdout=subprocess.PIPE)
    def facts(self, oid):
        self.process.stdin.write((oid + '\n').encode()); self.process.stdin.flush()
        row = self.process.stdout.readline().decode().strip().split()
        require(len(row) == 3 and row[1] == 'blob', 'Unreadable raw blob')
        remaining = int(row[2]); h = hashlib.sha256(); prefix = b''
        while remaining:
            part = self.process.stdout.read(min(65536, remaining))
            require(bool(part), 'Truncated raw blob')
            prefix += part[:max(0, 10 - len(prefix))]
            h.update(part); remaining -= len(part)
        require(self.process.stdout.read(1) == b'\n', 'Invalid raw blob framing')
        return prefix == HEADER, h.hexdigest()
    def close(self): self.process.stdin.close(); self.process.wait(timeout=10)

def check_entry(reader, path, entry, public):
    mode, kind, oid = entry
    if kind != 'blob' or mode not in ('100644', '100755'):
        return None, {'path': path, 'reason': 'nonregular-guarded-input'}
    encrypted, raw_sha = reader.facts(oid)
    if public is not None and path in public:
        ok = not private(path) and not encrypted and raw_sha == public[path]
        return 'public', None if ok else {'path': path, 'reason': 'public-bytes-not-reviewed-policy'}
    if public is None and path in LEGACY_METADATA and not private(path):
        return None, None
    return 'private', None if encrypted else {'path': path, 'reason': 'private-or-unclassified-plaintext'}

def is_scannable(path, files, public, globs):
    if path not in files or path == POLICY: return False
    return guarded(path, globs) or bool(public and path in public)

def scan(label, files, changed, public, globs):
    failures = []; counts = {'private': 0, 'public': 0}; reader = Blobs()
    try:
        targets = (p for p in sorted(changed) if is_scannable(p, files, public, globs))
        for path in targets:
            bucket, failure = check_entry(reader, path, files[path], public)
            if bucket: counts[bucket] += 1
            if failure: failures.append(failure)
    finally: reader.close()
    return {'scope': label, 'privateChecked': counts['private'], 'publicChecked': counts['public'], 'failures': failures}

def nul_paths(*args):
    return {os.fsdecode(p) for p in git(*args).stdout.split(b'\0') if p}

def scan_ref(ref, whole_tree):
    public = read_policy(ref + ':' + POLICY); files = tree_files(ref)
    changed = set(files) if whole_tree else nul_paths('diff-tree', '--root', '-m', '-r', '--no-commit-id', '--no-renames', '--name-only', '--diff-filter=AM', '-z', ref)
    return scan(ref, files, changed, public, patterns(ref + ':.gitattributes'))

def main():
    ap = argparse.ArgumentParser(); group = ap.add_mutually_exclusive_group(required=True); group.add_argument('--staged', action='store_true'); group.add_argument('--range'); group.add_argument('--tree'); args = ap.parse_args()
    if args.staged:
        changed = nul_paths('diff', '--cached', '--name-only', '--no-renames', '--diff-filter=AM', '-z', 'HEAD')
        reports = [scan('staged', index_files(), changed, read_policy(':' + POLICY), patterns(':.gitattributes'))]
    else:
        refs = [args.tree] if args.tree else git('rev-list', '--reverse', args.range).stdout.decode().splitlines()
        reports = [scan_ref(ref, bool(args.tree)) for ref in refs]
    result = {'ok': all(not r['failures'] for r in reports), 'reports': reports}; print(json.dumps(result)); return 0 if result['ok'] else 1
if __name__ == '__main__':
    try: sys.exit(main())
    except (ValueError, RuntimeError, OSError, subprocess.SubprocessError) as e: print(json.dumps({'ok': False, 'error': str(e)})); sys.exit(2)
