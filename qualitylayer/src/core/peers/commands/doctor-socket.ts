import { existsSync } from "node:fs"
import { createServer } from "node:net"
import { join } from "node:path"
import { windows } from "../../platform.ts"
import { unlinkQuiet } from "../base.ts"
import { defaultSocketDir, dirIsAllowlisted } from "../claude.ts"
import type { AddCheck } from "./doctor.ts"
export function unixSocketProbe(dir: string): Promise<string | null> {
  const path = join(dir, `.qualitylayer-doctor-${process.pid}.sock`)
  return new Promise((resolve) => {
    const server = createServer()
    server.on("error", (cause) => resolve(cause.message))
    server.listen(path, () => {
      server.close()
      unlinkQuiet(path)
      resolve(null)
    })
  })
}

export async function reportSocket(add: AddCheck): Promise<void> {
  const sockDir = defaultSocketDir()
  add(
    dirIsAllowlisted(sockDir) ? "ok" : "warn",
    `socket folder: ${sockDir}${existsSync(sockDir) ? "" : " (does not exist yet)"}`,
  )
  if (windows || existsSync(sockDir)) {
    const error = await unixSocketProbe(sockDir)
    add(
      error ? "fail" : "ok",
      (windows ? "Named-pipe" : "Unix-socket") +
        " bind" +
        (error ? `: unavailable (${error})` : ""),
    )
  } else add("warn", "Unix-socket bind not tested; the socket folder is absent")
}
