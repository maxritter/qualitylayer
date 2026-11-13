// A message from QualityLayer into a running agent session, put in the way a person's own message
// from the Conversation view is: pasted into the agent's window, then Enter. The host takes it as
// input and the agent answers it like any other. Nothing here decides whether to send: callers
// check that the session is waiting and that nobody is typing.

import type { Ctx } from "../../ctx.ts"
import { acceptedStopSequence } from "./bind.ts"
import type { RunRecord } from "./contracts.ts"
import { type InputBoundary, LIMITS } from "./protocol.ts"
import { readRun } from "./registry.ts"
import { connectOrRevive } from "./settle.ts"

/** The text as a person would paste it, then Enter: a bracketed paste keeps several lines one message. */
export function typedMessage(text: string): string {
  const clean = text.replaceAll("\x1b", "").replace(/\r\n?/g, "\n").trim()
  return `\x1b[200~${clean}\x1b[201~\r`
}

/** How long the host waits between a pasted message and its Enter. */
export const PASTE_GAP_MS = 200

const PASTE_THEN_ENTER = Buffer.from("\x1b[201~\r")

export function inputBoundaryMatches(run: RunRecord, boundary: InputBoundary): boolean {
  return (
    run.generation === boundary.generation &&
    run.nativeSession === boundary.nativeSession &&
    run.task === boundary.task &&
    acceptedStopSequence(run) === boundary.sequence &&
    !run.runEvents?.at(-1)?.interrupted &&
    !run.waitSince &&
    !run.terminalPrompt &&
    !run.startupPrompt &&
    run.intent?.state !== "paused" &&
    !(run.recovery?.generation === run.generation && run.recovery.state === "cancelled")
  )
}

/**
 * Input as the host writes it: a bracketed paste that ends with Enter becomes the paste, a pause,
 * then Enter, because Cursor's CLI ignores an Enter that arrives with the paste (the message then
 * sits in its input box). Any other input passes as it is.
 */
export function inputSteps(bytes: Uint8Array): (Uint8Array | number)[] {
  const tail = bytes.subarray(bytes.length - PASTE_THEN_ENTER.length)
  if (bytes.length <= PASTE_THEN_ENTER.length || !PASTE_THEN_ENTER.equals(tail)) return [bytes]
  return [bytes.subarray(0, bytes.length - 1), PASTE_GAP_MS, bytes.subarray(bytes.length - 1)]
}

/** Put `text` into the run's session. Throws when the run has no live host of this generation. */
export async function sendToRun(
  ctx: Pick<Ctx, "home">,
  run: RunRecord,
  text: string,
  options: {
    beforeSend?: () => void | Promise<void>
    onWrite?: () => void
    strictFlush?: boolean
    boundary?: InputBoundary
  } = {},
): Promise<void> {
  const bytes = Buffer.from(typedMessage(text))
  if (bytes.length > LIMITS.inputBytes) throw new Error("The message exceeds one input frame")
  const host = await connectOrRevive(ctx.home, run.id)
  try {
    if (
      host.ready.generation !== run.generation ||
      readRun(ctx.home, run.id)?.generation !== run.generation
    )
      throw new Error("stale run generation")
    if (options.boundary && !host.ready.guardedInput)
      throw new Error("This host cannot confirm an idle answer handoff")
    await options.beforeSend?.()
    options.onWrite?.()
    if (options.boundary) {
      const boundary = options.boundary
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("Answer handoff was not confirmed")), 2000)
        const off = host.onFrame((frame) => {
          if (
            frame.type !== "input-result" ||
            frame.generation !== boundary.generation ||
            frame.sequence !== boundary.sequence
          )
            return
          clearTimeout(timer)
          off()
          if (frame.accepted) resolve()
          else reject(new Error("The planner changed before its answers could be sent"))
        })
        host.send({ type: "input", data: bytes, boundary })
      })
    } else host.send({ type: "input", data: bytes })
    // Destroying the socket drops what it has not flushed: end it, and close once it is written.
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () =>
          options.strictFlush
            ? reject(
                new Error(
                  "The request delivery was not confirmed; inspect Terminal before retrying",
                ),
              )
            : resolve(),
        2000,
      )
      host.socket.end(() => {
        clearTimeout(timer)
        resolve()
      })
    })
  } finally {
    host.close()
  }
}
