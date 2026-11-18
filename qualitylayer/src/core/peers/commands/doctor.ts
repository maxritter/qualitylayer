import { warnVersions } from "../base.ts"
import { type Args, flag, out } from "./arguments.ts"
import { reportHooks } from "./doctor-hooks.ts"
import { reportSocket } from "./doctor-socket.ts"
import { reportThreads } from "./doctor-threads.ts"
import { reportTools } from "./doctor-tools.ts"
export type AddCheck = (status: string, text: string) => void
export async function cmdDoctor(args: Args): Promise<number> {
  warnVersions()
  const lines: string[] = []
  const checks: { status: string; message: string }[] = []
  const add = (status: string, text: string) => {
    lines.push(`${status.padEnd(5)} ${text}`)
    checks.push({ status, message: text })
  }
  reportTools(add)
  await reportSocket(add)
  await reportThreads(add)
  reportHooks(add)
  out(
    flag(args, "json")
      ? JSON.stringify({
          status: "doctor",
          ok: !checks.some((check) => check.status === "fail"),
          checks,
        })
      : lines.join("\n"),
  )
  return 0
}
