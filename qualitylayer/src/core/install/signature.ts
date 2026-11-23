// The release's SHA256SUMS is signed with `ssh-keygen -Y sign -n qualitylayer-release` and
// published as SHA256SUMS.sig. install.sh and install.ps1 check it with `ssh-keygen -Y verify`;
// `qualitylayer update` checks the same signature here: Ed25519 over the SSHSIG structure
// (PROTOCOL.sshsig in OpenSSH), against the public key compiled in below.

import { createHash, createPublicKey, verify } from "node:crypto"

/** The only key that may sign a release. install.sh and install.ps1 carry the same line. */
export const RELEASE_SIGNER =
  "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOvc89TsfxkzK1lxTNLr/FHwImLq1oUWYmmXQ1iYL2oU release@qualitylayer.dev"
export const RELEASE_NAMESPACE = "qualitylayer-release"

const MAGIC = new TextEncoder().encode("SSHSIG")
// The DER prefix that turns a raw 32-byte Ed25519 key into an SPKI public key.
const ED25519_SPKI = Buffer.from("302a300506032b6570032100", "hex")

/** A reader over SSH wire data: big-endian uint32 lengths before each string. */
class Wire {
  private at = 0
  constructor(private readonly data: Uint8Array) {}

  string(): Uint8Array {
    if (this.at + 4 > this.data.length) throw new Error("truncated")
    const length = new DataView(this.data.buffer, this.data.byteOffset).getUint32(this.at)
    this.at += 4
    if (this.at + length > this.data.length) throw new Error("truncated")
    const out = this.data.subarray(this.at, this.at + length)
    this.at += length
    return out
  }

  uint32(): number {
    if (this.at + 4 > this.data.length) throw new Error("truncated")
    const value = new DataView(this.data.buffer, this.data.byteOffset).getUint32(this.at)
    this.at += 4
    return value
  }

  take(count: number): Uint8Array {
    if (this.at + count > this.data.length) throw new Error("truncated")
    const out = this.data.subarray(this.at, this.at + count)
    this.at += count
    return out
  }

  get done(): boolean {
    return this.at === this.data.length
  }
}

const text = (bytes: Uint8Array) => new TextDecoder().decode(bytes)

/** SSH wire encoding of strings, concatenated. */
function wire(...parts: Uint8Array[]): Buffer {
  return Buffer.concat(
    parts.map((part) => {
      const length = Buffer.alloc(4)
      length.writeUInt32BE(part.length)
      return Buffer.concat([length, part])
    }),
  )
}

/** The raw Ed25519 key of an `ssh-ed25519 <base64> [comment]` line. */
function rawKeyOf(line: string): Uint8Array {
  const [type, base64] = line.trim().split(/\s+/)
  if (type !== "ssh-ed25519" || base64 === undefined) throw new Error("not an ssh-ed25519 key")
  const blob = new Wire(Buffer.from(base64, "base64"))
  if (text(blob.string()) !== "ssh-ed25519") throw new Error("not an ssh-ed25519 key")
  const raw = blob.string()
  if (raw.length !== 32 || !blob.done) throw new Error("bad key")
  return raw
}

type ParsedSshSig = {
  signedBy: Uint8Array
  namespace: Uint8Array
  reserved: Uint8Array
  algorithm: "sha256" | "sha512"
  rawSig: Uint8Array
}

function parseSshSig(armoredSignature: string): ParsedSshSig | null {
  const match =
    /^-----BEGIN SSH SIGNATURE-----\r?\n([A-Za-z0-9+/=\r\n]+?)\r?\n-----END SSH SIGNATURE-----\s*$/.exec(
      armoredSignature.trim(),
    )
  if (match?.[1] === undefined) return null
  const blob = new Wire(Buffer.from(match[1].replace(/\s+/g, ""), "base64"))
  if (text(blob.take(6)) !== "SSHSIG" || blob.uint32() !== 1) return null
  const signedBy = blob.string()
  const namespace = blob.string()
  const reserved = blob.string()
  const algorithm = text(blob.string())
  const signature = new Wire(blob.string())
  const validOuter =
    blob.done &&
    text(namespace) === RELEASE_NAMESPACE &&
    reserved.length === 0 &&
    (algorithm === "sha256" || algorithm === "sha512")
  if (!validOuter || text(signature.string()) !== "ssh-ed25519") return null
  const rawSig = signature.string()
  return rawSig.length === 64 && signature.done
    ? { signedBy, namespace, reserved, algorithm, rawSig }
    : null
}

/**
 * Whether `armoredSignature` (the contents of a `.sig` file) is `publicKey`'s SSHSIG over
 * `message` in the release namespace. A malformed signature or key is a plain false.
 */
export function verifyReleaseSignature(
  message: Uint8Array,
  armoredSignature: string,
  publicKey: string = RELEASE_SIGNER,
): boolean {
  try {
    const parsed = parseSshSig(armoredSignature)
    if (parsed === null) return false
    const allowed = rawKeyOf(publicKey)
    if (!Buffer.from(parsed.signedBy).equals(wire(Buffer.from("ssh-ed25519"), allowed)))
      return false
    const signed = Buffer.concat([
      MAGIC,
      wire(
        parsed.namespace,
        parsed.reserved,
        Buffer.from(parsed.algorithm),
        createHash(parsed.algorithm).update(message).digest(),
      ),
    ])
    const key = createPublicKey({
      key: Buffer.concat([ED25519_SPKI, allowed]),
      format: "der",
      type: "spki",
    })
    return verify(null, signed, key, parsed.rawSig)
  } catch {
    return false
  }
}
