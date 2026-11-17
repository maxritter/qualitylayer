export type ZipEntry = { name: string; bytes: Uint8Array }

export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
  }
  return (crc ^ 0xffffffff) >>> 0
}

/** Small local downloads use stored ZIP entries: no executable, dependency or temporary archive. */
export function zip(entries: ZipEntry[], maximum: number): Uint8Array {
  if (entries.length === 0 || entries.length > 256) throw new Error("Invalid export archive size")
  const names = new Set<string>()
  const encoded = entries.map((entry) => {
    if (
      !/^[a-z0-9][a-z0-9._/-]{0,180}$/i.test(entry.name) ||
      entry.name.split("/").some((part) => !part || part === "." || part === "..")
    )
      throw new Error("Invalid export archive filename")
    const key = entry.name.toLowerCase()
    if (names.has(key)) throw new Error("Duplicate export archive filename")
    names.add(key)
    return { ...entry, filename: new TextEncoder().encode(entry.name), crc: crc32(entry.bytes) }
  })
  const size = encoded.reduce(
    (total, entry) => total + 30 + 46 + entry.filename.length * 2 + entry.bytes.length,
    22,
  )
  if (size > maximum) throw new Error("Export exceeds the download size limit")
  const output = new Uint8Array(size),
    view = new DataView(output.buffer)
  let at = 0
  const word = (value: number) => {
    view.setUint16(at, value, true)
    at += 2
  }
  const long = (value: number) => {
    view.setUint32(at, value, true)
    at += 4
  }
  const bytes = (value: Uint8Array) => {
    output.set(value, at)
    at += value.length
  }
  const offsets: number[] = []
  for (const entry of encoded) {
    offsets.push(at)
    long(0x04034b50)
    word(20)
    word(0x800)
    word(0)
    word(0)
    word(0x21)
    long(entry.crc)
    long(entry.bytes.length)
    long(entry.bytes.length)
    word(entry.filename.length)
    word(0)
    bytes(entry.filename)
    bytes(entry.bytes)
  }
  const central = at
  for (const [index, entry] of encoded.entries()) {
    long(0x02014b50)
    word(20)
    word(20)
    word(0x800)
    word(0)
    word(0)
    word(0x21)
    long(entry.crc)
    long(entry.bytes.length)
    long(entry.bytes.length)
    word(entry.filename.length)
    word(0)
    word(0)
    word(0)
    word(0)
    long(0)
    long(offsets[index] ?? 0)
    bytes(entry.filename)
  }
  const centralSize = at - central
  long(0x06054b50)
  word(0)
  word(0)
  word(encoded.length)
  word(encoded.length)
  long(centralSize)
  long(central)
  word(0)
  return output
}
