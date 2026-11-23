// licence status | activate <key> | activate --key-env ENV | activate --key-stdin | deactivate | portal
// None of these is gated: a machine without a licence must be able to get one.

import { activate, deactivate, status } from "../../core/licence/verify.ts"
import { PORTAL_URL } from "../../core/licensing-client/links.ts"
import { type Ctx, err, ok, type Result } from "../../ctx.ts"

function open(url: string): void {
  const command =
    process.platform === "darwin"
      ? ["open"]
      : process.platform === "win32"
        ? ["rundll32.exe", "url.dll,FileProtocolHandler"]
        : ["xdg-open"]
  try {
    // The browser shows its own window: on Windows it must not start hidden.
    Bun.spawn([...command, url], {
      stdio: ["ignore", "ignore", "ignore"],
      windowsHide: false,
    }).unref()
  } catch {
    // no launcher: the printed URL is enough
  }
}

const badArgs = (message: string) => err({ code: "bad_args", message })

async function readStdin(): Promise<string> {
  return process.stdin.isTTY ? "" : await Bun.stdin.text()
}

/**
 * `activate --key-stdin`: the key arrives on standard input, so it is in no argument list and in no
 * variable, and it is stored as a typed key is. This is how another computer activates this one
 * over ssh.
 */
async function activateFromStdin(
  ctx: Ctx,
  rest: string[],
  stdin: () => Promise<string>,
): Promise<Result<unknown>> {
  if (rest.some((arg) => arg !== "--key-stdin"))
    return badArgs("--key-stdin is the key's one source: give no key and no --key-env beside it")
  const key = (await stdin()).trim()
  if (key === "") return badArgs("standard input was empty: pipe the licence key into the command")
  if (/[\r\n]/.test(key)) return badArgs("standard input must hold the licence key on one line")
  const activated = await activate(ctx, key, undefined, { stored: true })
  if (!activated.ok) return activated
  return ok({ ...activated.data, message: `Activated: ${activated.data.tier}.` })
}

/** `activate <key>` and `activate --key-env ENV_NAME`. */
async function activateTyped(ctx: Ctx, rest: string[]): Promise<Result<unknown>> {
  const position = rest.indexOf("--key-env")
  const keyEnv = position >= 0 ? rest[position + 1] : undefined
  if (position >= 0 && (keyEnv === undefined || !/^[A-Z_][A-Z0-9_]{0,80}$/.test(keyEnv)))
    return badArgs("--key-env needs an environment variable name")
  const key = keyEnv !== undefined ? (ctx.env.get(keyEnv) ?? "") : (rest[0] ?? "")
  if (keyEnv !== undefined && key.trim() === "")
    return badArgs(`Set ${keyEnv} before activating; its value is never stored.`)
  const activated = await activate(ctx, key, undefined, { keyEnv })
  if (!activated.ok) return activated
  return ok({ ...activated.data, message: `Activated: ${activated.data.tier}.` })
}

async function licenceStatus(ctx: Ctx): Promise<Result<unknown>> {
  const info = await status(ctx)
  let message: string
  if (info.state !== "active") {
    message = `Not licensed (${info.state.replaceAll("_", " ")}). Licences: ${info.buy}`
  } else if (info.tier === "trial") {
    message = `Trial: ${info.daysLeft} day(s) left. Licences: ${info.buy}`
  } else {
    message = `Licensed (${info.tier})${info.email !== "" ? ` to ${info.email}` : ""}.`
  }
  return ok({ ...info, message })
}

async function licenceDeactivate(ctx: Ctx): Promise<Result<unknown>> {
  const done = await deactivate(ctx)
  if (!done.ok) return done
  return ok({ ...done.data, message: "This machine's activation was released." })
}

function licencePortal(rest: string[]): Result<unknown> {
  if (!rest.includes("--no-open")) open(PORTAL_URL)
  return ok({ url: PORTAL_URL, message: `Manage the subscription at ${PORTAL_URL}` })
}

export async function licenceCmd(
  ctx: Ctx,
  args: string[],
  stdin: () => Promise<string> = readStdin,
): Promise<Result<unknown>> {
  const [sub, ...rest] = args
  if (sub === undefined || sub === "status") return licenceStatus(ctx)
  if (sub === "activate") {
    return rest.includes("--key-stdin")
      ? activateFromStdin(ctx, rest, stdin)
      : activateTyped(ctx, rest)
  }
  if (sub === "deactivate") return licenceDeactivate(ctx)
  if (sub === "portal") return licencePortal(rest)
  return err({
    code: "bad_args",
    message:
      "usage: qualitylayer licence status | activate <key> | activate --key-env ENV_NAME | activate --key-stdin | deactivate | portal",
  })
}
