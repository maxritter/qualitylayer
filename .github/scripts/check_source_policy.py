#!/usr/bin/env python3
"""Keyless raw-blob protection: exact reviewed public bytes, independently private paths."""
import argparse, fnmatch, hashlib, json, os, subprocess, sys
POLICY = '.github/scripts/public-source-policy.json'
HEADER = b'\0GITCRYPT\0'
PUBLIC_LICENCE = {'qualitylayer/src/core/licence/address-policy.ts', 'qualitylayer/src/core/licence/mask.ts', 'qualitylayer/src/core/licence/workflow.ts'}
LEGACY_METADATA = {'qualitylayer/package.json', 'qualitylayer/bun.lock', 'qualitylayer/tsconfig.json', 'qualitylayer/biome.json'}
PRIVATE_EXACT = {'.github/hooks/commit-msg', '.github/hooks/pre-commit', '.github/hooks/pre-push', '.github/scripts/verify-promotion-source.sh', '.github/workflows/scripts/verify-authenticode.ps1', '.github/workflows/scripts/windows-sign.ps1', 'docs/agents/models.md', 'docs/agents/operations.md', 'docs/agents/release.md', 'docs/agents/reviews/12.2-public-feedback.json', 'docs/agents/verification.md', 'docs/plans/2026-11-10-local-first-qualitylayer/r2-resource-manifest.md', 'docs/plans/2026-11-10-machines-in-the-app/agents/06-verify.md', 'docs/site/scripts/build-deploy.sh', 'docs/site/scripts/capture-evidence.mjs', 'docs/site/scripts/capture-publish.mjs', 'docs/site/scripts/capture-scenes.mjs', 'docs/site/scripts/capture-source.mjs', 'docs/site/scripts/capture-source.test.mjs', 'docs/site/scripts/check-billing.mjs', 'docs/site/scripts/check-captures.mjs', 'docs/site/scripts/check-captures.test.mjs', 'docs/site/scripts/compile-shared-api.mjs', 'docs/site/scripts/indexnow-submit.mjs', 'docs/site/scripts/record-showcase.mjs', 'docs/site/scripts/test-billing.mjs', 'docs/site/vercel-build-check.sh', 'docs/site/vercel-config.test.ts'}
def private(path):
    if path in PUBLIC_LICENCE: return False
    return path.startswith(('qualitylayer/src/core/licence/', 'qualitylayer/src/commercial/licensing/', 'docs/site/api/', 'docs/site/workers/', 'docs/video/', '.github/private-workflows/', 'qualitylayer/artifacts/collaboration-data-model/', 'qualitylayer/scripts/backend-preparation/', 'qualitylayer/tests/backend-preparation/')) or path in PRIVATE_EXACT or path == 'qualitylayer/app/src-tauri/build.rs'
def safe(path):
    return isinstance(path, str) and path and '\\' not in path and '\0' not in path and all(p not in ('', '.', '..') for p in path.split('/'))
def digest(value): return isinstance(value, str) and len(value) == 64 and all(c in '0123456789abcdef' for c in value)
def git(*args, data=None, allow=False):
    p = subprocess.run(['git', '--no-optional-locks', *args], input=data, capture_output=True)
    if p.returncode and not allow: raise RuntimeError('Git metadata operation failed')
    return p

def no_duplicates(pairs):
    result = {}
    for k, v in pairs:
        if k in result: raise ValueError('Duplicate policy field')
        result[k] = v
    return result

def read_policy(spec):
    p = git('cat-file', 'blob', spec, allow=True)
    if p.returncode: return None
    if len(p.stdout) > 4 * 1024 * 1024: raise ValueError('Policy byte limit')
    data = json.loads(p.stdout, object_pairs_hook=no_duplicates)
    if set(data) != {'schema', 'sourceHead', 'reviewManifestSha256', 'publicFiles'} or data['schema'] != 1: raise ValueError('Invalid source policy schema')
    if not isinstance(data['sourceHead'], str) or len(data['sourceHead']) != 40 or any(c not in '0123456789abcdef' for c in data['sourceHead']) or not digest(data['reviewManifestSha256']): raise ValueError('Invalid policy source identity')
    if not isinstance(data['publicFiles'], dict) or len(data['publicFiles']) > 20000: raise ValueError('Invalid public member set')
    for path, sha in data['publicFiles'].items():
        if not safe(path) or path == POLICY or private(path) or not digest(sha): raise ValueError('Public policy names an invalid/private input: ' + str(path))
    return data['publicFiles']

def tree_files(ref):
    out = {}
    for record in git('ls-tree', '-r', '-z', ref).stdout.split(b'\0'):
        if not record: continue
        meta, path = record.split(b'\t', 1); mode, kind, oid = meta.decode().split()
        out[os.fsdecode(path)] = (mode, kind, oid)
    return out

def index_files():
    out = {}
    for record in git('ls-files', '--stage', '-z').stdout.split(b'\0'):
        if not record: continue
        meta, path = record.split(b'\t', 1); mode, oid, stage = meta.decode().split()
        if stage != '0': raise ValueError('Unmerged private index')
        out[os.fsdecode(path)] = (mode, 'blob', oid)
    return out

def patterns(spec):
    raw = git('cat-file', 'blob', spec, allow=True)
    if raw.returncode: return []
    found = []
    for line in raw.stdout.decode('utf8').splitlines():
        fields = line.split()
        if fields and not fields[0].startswith('#') and 'filter=git-crypt' in fields[1:]: found.append(fields[0])
    return found

def guarded(path, globs):
    return private(path) or path.startswith(('qualitylayer/', 'docs/site/api/', 'docs/site/scripts/', 'docs/site/workers/', 'docs/video/')) or path == 'scripts/cutover.sh' or any(fnmatch.fnmatchcase(path, p) for p in globs)

class Blobs:
    def __init__(self): self.process = subprocess.Popen(['git', '--no-optional-locks', 'cat-file', '--batch'], stdin=subprocess.PIPE, stdout=subprocess.PIPE)
    def facts(self, oid):
        self.process.stdin.write((oid + '\n').encode()); self.process.stdin.flush()
        row = self.process.stdout.readline().decode().strip().split()
        if len(row) != 3 or row[1] != 'blob': raise ValueError('Unreadable raw blob')
        remaining = int(row[2]); h = hashlib.sha256(); prefix = b''
        while remaining:
            part = self.process.stdout.read(min(65536, remaining))
            if not part: raise ValueError('Truncated raw blob')
            if len(prefix) < 10: prefix += part[:10 - len(prefix)]
            h.update(part); remaining -= len(part)
        if self.process.stdout.read(1) != b'\n': raise ValueError('Invalid raw blob framing')
        return prefix == HEADER, h.hexdigest()
    def close(self): self.process.stdin.close(); self.process.wait(timeout=10)

def scan(label, files, changed, public, globs):
    failures = []; checked_private = 0; checked_public = 0; reader = Blobs()
    try:
        for path in sorted(changed):
            if path not in files: continue
            if path == POLICY: continue # Strict metadata-only schema validated separately; no self-hash.
            if not guarded(path, globs) and not(public and path in public): continue
            mode, kind, oid = files[path]
            if kind != 'blob' or mode not in ('100644', '100755'):
                failures.append({'path': path, 'reason': 'nonregular-guarded-input'}); continue
            encrypted, raw_sha = reader.facts(oid)
            if public is not None and path in public:
                checked_public += 1
                if private(path) or encrypted or raw_sha != public[path]: failures.append({'path': path, 'reason': 'public-bytes-not-reviewed-policy'})
            elif public is None and path in LEGACY_METADATA and not private(path): continue
            else:
                checked_private += 1
                if not encrypted: failures.append({'path': path, 'reason': 'private-or-unclassified-plaintext'})
    finally: reader.close()
    return {'scope': label, 'privateChecked': checked_private, 'publicChecked': checked_public, 'failures': failures}

def main():
    ap = argparse.ArgumentParser(); group = ap.add_mutually_exclusive_group(required=True); group.add_argument('--staged', action='store_true'); group.add_argument('--range'); group.add_argument('--tree'); args = ap.parse_args(); reports = []
    if args.staged:
        public = read_policy(':' + POLICY); files = index_files(); changed = set(os.fsdecode(p) for p in git('diff', '--cached', '--name-only', '--no-renames', '--diff-filter=AM', '-z', 'HEAD').stdout.split(b'\0') if p)
        reports.append(scan('staged', files, changed, public, patterns(':.gitattributes')))
    else:
        refs = [args.tree] if args.tree else git('rev-list', '--reverse', args.range).stdout.decode().splitlines()
        for ref in refs:
            public = read_policy(ref + ':' + POLICY); files = tree_files(ref)
            changed = set(files) if args.tree else set(os.fsdecode(p) for p in git('diff-tree', '--root', '-m', '-r', '--no-commit-id', '--no-renames', '--name-only', '--diff-filter=AM', '-z', ref).stdout.split(b'\0') if p)
            reports.append(scan(ref, files, changed, public, patterns(ref + ':.gitattributes')))
    result = {'ok': all(not r['failures'] for r in reports), 'reports': reports}; print(json.dumps(result)); return 0 if result['ok'] else 1
if __name__ == '__main__':
    try: sys.exit(main())
    except (ValueError, RuntimeError, OSError, subprocess.SubprocessError) as e: print(json.dumps({'ok': False, 'error': str(e)})); sys.exit(2)
