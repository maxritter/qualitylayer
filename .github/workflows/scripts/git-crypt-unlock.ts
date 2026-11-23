// Unlock a git-crypt checkout without git-crypt, in one process.
//
//   bun git-crypt-unlock.ts <key file>     unlock the repository in the current directory
//   bun git-crypt-unlock.ts filter         (run by git) the filter for every encrypted file
//
// `git-crypt unlock` checks out every encrypted file through its own smudge filter, one process per
// file. On a Windows runner, under msys2, that is three to seven minutes for this repository. Here
// git talks to one long-running filter process (gitattributes "filter.<driver>.process") that
// decrypts and encrypts exactly as git-crypt does: AES-256-CTR, the nonce is the first 12 bytes of
// the plaintext's HMAC-SHA1, and every file is checked against that nonce after decryption.
import { createCipheriv, createDecipheriv, createHmac, timingSafeEqual } from "node:crypto"
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"

const HEADER = Buffer.from("\0GITCRYPT\0", "latin1")
const NONCE_LEN = 12

type Key = { aes: Buffer; hmac: Buffer }
type KeyEntry = Key & { version: number }
type KeyEntryDraft = { version: number; aes: Buffer | null; hmac: Buffer | null }

function ensure(ok: unknown, message: string): asserts ok {
  if (!ok) throw new Error(message)
}

class KeyReader {
  at = 0
  constructor(readonly data: Buffer) {}
  get done(): boolean {
    return this.at >= this.data.length
  }
  take(length: number): Buffer {
    ensure(this.at + length <= this.data.length, "truncated git-crypt key file")
    const value = this.data.subarray(this.at, this.at + length)
    this.at += length
    return value
  }
  u32(): number {
    return this.take(4).readUInt32BE(0)
  }
}

const KEY_FIELD_HANDLERS: Record<number, [number, (entry: KeyEntryDraft, raw: Buffer) => void]> = {
  1: [4, (entry, raw) => { entry.version = raw.readUInt32BE(0) }],
  3: [32, (entry, raw) => { entry.aes = Buffer.from(raw) }],
  5: [64, (entry, raw) => { entry.hmac = Buffer.from(raw) }],
}

function skipKeyHeaderFields(reader: KeyReader): void {
  for (let field = reader.u32(); field !== 0; field = reader.u32()) {
    const length = reader.u32()
    ensure(field === 1 || (field & 1) !== 1, `unknown critical key header field ${field}`)
    reader.take(length)
  }
}

function applyKeyField(entry: KeyEntryDraft, field: number, length: number, reader: KeyReader): void {
  const handler = KEY_FIELD_HANDLERS[field]
  if (handler && handler[0] === length) {
    handler[1](entry, reader.take(length))
    return
  }
  ensure((field & 1) !== 1, `unknown critical key entry field ${field}`)
  reader.take(length)
}

function readKeyEntry(reader: KeyReader): KeyEntry {
  const entry: KeyEntryDraft = { version: 0, aes: null, hmac: null }
  for (let field = reader.u32(); field !== 0; field = reader.u32()) {
    applyKeyField(entry, field, reader.u32(), reader)
  }
  ensure(entry.aes !== null && entry.hmac !== null, "incomplete git-crypt key entry")
  return { version: entry.version, aes: entry.aes, hmac: entry.hmac }
}

/** The newest key entry of a git-crypt key file (format version 2). */
function loadKey(path: string): Key {
  const reader = new KeyReader(readFileSync(path))
  ensure(reader.take(12).equals(Buffer.from("\0GITCRYPTKEY", "latin1")), "not a git-crypt key file")
  ensure(reader.u32() === 2, "unsupported git-crypt key file version")
  skipKeyHeaderFields(reader)
  let newest: KeyEntry | null = null
  while (!reader.done) {
    const entry = readKeyEntry(reader)
    if (newest === null || entry.version > newest.version) newest = entry
  }
  ensure(newest !== null, "the git-crypt key file holds no key")
  return newest
}

function ctr(key: Key, nonce: Buffer, decrypt: boolean) {
  const iv = Buffer.concat([nonce, Buffer.alloc(4)])
  return decrypt ? createDecipheriv("aes-256-ctr", key.aes, iv) : createCipheriv("aes-256-ctr", key.aes, iv)
}

function encrypt(key: Key, plain: Buffer): Buffer {
  const nonce = createHmac("sha1", key.hmac).update(plain).digest().subarray(0, NONCE_LEN)
  const cipher = ctr(key, nonce, false)
  return Buffer.concat([HEADER, nonce, cipher.update(plain), cipher.final()])
}

function decrypt(key: Key, stored: Buffer, path: string): Buffer {
  // git-crypt leaves a file that is not encrypted (committed before the attribute) as it is.
  if (stored.length < HEADER.length + NONCE_LEN || !stored.subarray(0, HEADER.length).equals(HEADER))
    return stored
  const nonce = stored.subarray(HEADER.length, HEADER.length + NONCE_LEN)
  const decipher = ctr(key, nonce, true)
  const plain = Buffer.concat([decipher.update(stored.subarray(HEADER.length + NONCE_LEN)), decipher.final()])
  const check = createHmac("sha1", key.hmac).update(plain).digest().subarray(0, NONCE_LEN)
  ensure(timingSafeEqual(check, nonce), `${path}: the git-crypt key does not match`)
  return plain
}

// ---- git's long-running filter protocol (pkt-line) ----

class Packets {
  private buffer = Buffer.alloc(0)
  private reader = Bun.stdin.stream().getReader()
  private async fill(length: number): Promise<boolean> {
    while (this.buffer.length < length) {
      const { value, done } = await this.reader.read()
      if (done) return false
      this.buffer = Buffer.concat([this.buffer, Buffer.from(value)])
    }
    return true
  }
  /** One packet's payload, null for a flush packet, undefined at the end of input. */
  async read(): Promise<Buffer | null | undefined> {
    if (!(await this.fill(4))) return undefined
    const length = Number.parseInt(this.buffer.subarray(0, 4).toString("latin1"), 16)
    if (length === 0) {
      this.buffer = this.buffer.subarray(4)
      return null
    }
    ensure(await this.fill(length), "truncated packet")
    const payload = this.buffer.subarray(4, length)
    this.buffer = this.buffer.subarray(length)
    return payload
  }
  async lines(): Promise<string[] | undefined> {
    const lines: string[] = []
    for (let pkt = await this.read(); pkt !== null; pkt = await this.read()) {
      if (pkt === undefined) return lines.length ? lines : undefined
      lines.push(pkt.toString("utf8").replace(/\n$/, ""))
    }
    return lines
  }
  async content(): Promise<Buffer> {
    const parts: Buffer[] = []
    for (let pkt = await this.read(); pkt !== null; pkt = await this.read()) {
      ensure(pkt !== undefined, "content ended without a flush packet")
      parts.push(Buffer.from(pkt))
    }
    return Buffer.concat(parts)
  }
}

const out: Buffer[] = []
const packet = (payload: Buffer | string) => {
  const data = typeof payload === "string" ? Buffer.from(payload, "utf8") : payload
  out.push(Buffer.from((data.length + 4).toString(16).padStart(4, "0"), "latin1"), data)
}
const flush = () => out.push(Buffer.from("0000", "latin1"))
async function send(): Promise<void> {
  const data = Buffer.concat(out.splice(0))
  await Bun.write(Bun.stdout, data)
}

async function negotiateFilter(input: Packets): Promise<void> {
  const hello = await input.lines()
  ensure(hello?.[0] === "git-filter-client" && hello.includes("version=2"), "not a git filter client")
  packet("git-filter-server\n")
  packet("version=2\n")
  flush()
  await send()
  const offered = (await input.lines()) ?? []
  for (const cap of ["clean", "smudge"].filter((name) => offered.includes(`capability=${name}`)))
    packet(`capability=${cap}\n`)
  flush()
  await send()
}

async function handleFilterRequest(key: Key, request: string[], content: Buffer): Promise<void> {
  const command = request.find((line) => line.startsWith("command="))?.slice(8)
  const path = request.find((line) => line.startsWith("pathname="))?.slice(9) ?? "?"
  let result: Buffer
  try {
    result = command === "smudge" ? decrypt(key, content, path) : encrypt(key, content)
  } catch (error) {
    console.error(String(error))
    packet("status=error\n")
    flush()
    await send()
    return
  }
  packet("status=success\n")
  flush()
  for (let at = 0; at < result.length; at += 65516) packet(result.subarray(at, at + 65516))
  flush()
  flush()
  await send()
}

async function filter(key: Key): Promise<void> {
  const input = new Packets()
  await negotiateFilter(input)
  for (let request = await input.lines(); request !== undefined; request = await input.lines()) {
    await handleFilterRequest(key, request, await input.content())
  }
}

function git(args: string[], input?: string): string {
  const run = Bun.spawnSync(["git", ...args], { stdin: input === undefined ? "ignore" : Buffer.from(input), stderr: "inherit" })
  ensure(run.exitCode === 0, `git ${args.join(" ")} failed`)
  return run.stdout.toString()
}

function listEncryptedFiles(): string[] {
  const files = git(["ls-files", "-z"]).split("\0").filter(Boolean)
  const attributes = git(["check-attr", "-z", "--stdin", "filter"], `${files.join("\0")}\0`).split("\0")
  const encrypted: string[] = []
  for (let i = 0; i + 2 < attributes.length; i += 3)
    if (attributes[i + 2] === "git-crypt") encrypted.push(attributes[i] as string)
  return encrypted
}

async function unlock(keyPath: string): Promise<void> {
  loadKey(keyPath)
  const gitDir = resolve(git(["rev-parse", "--git-dir"]).trim())
  mkdirSync(join(gitDir, "git-crypt", "keys"), { recursive: true })
  const stored = join(gitDir, "git-crypt", "keys", "default")
  copyFileSync(keyPath, stored)
  const script = resolve(import.meta.path).replaceAll("\\", "/")
  const bun = process.execPath.replaceAll("\\", "/")
  git(["config", "filter.git-crypt.process", `"${bun}" "${script}" filter "${stored.replaceAll("\\", "/")}"`])
  git(["config", "filter.git-crypt.required", "true"])
  const encrypted = listEncryptedFiles()
  encrypted.forEach((file) => rmSync(file, { force: true }))
  const list = join(gitDir, "git-crypt", "unlock-paths")
  writeFileSync(list, `${encrypted.join("\0")}\0`)
  git(["checkout", "--pathspec-from-file", list, "--pathspec-file-nul", "--"])
  rmSync(list)
  const stillEncrypted = encrypted.find((file) => readFileSync(file).subarray(0, HEADER.length).equals(HEADER))
  ensure(!stillEncrypted, `${stillEncrypted} is still encrypted`)
  const dirty = git(["status", "--porcelain"]).trim()
  ensure(dirty === "", `the checkout is not clean after unlocking:\n${dirty}`)
  console.log(`Repository unlocked: ${encrypted.length} encrypted files`)
}

if (process.argv[2] === "filter") await filter(loadKey(process.argv[3] as string))
else if (process.argv[2]) await unlock(process.argv[2])
else {
  console.error("usage: bun git-crypt-unlock.ts <key file>")
  process.exit(1)
}
