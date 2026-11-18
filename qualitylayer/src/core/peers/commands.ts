import type { Args } from "./commands/arguments.ts"
import { cmdAwait } from "./commands/await.ts"
import { cmdDown, cmdRestart, cmdShim, cmdUp } from "./commands/bridge.ts"
import { cmdBuddy } from "./commands/buddy.ts"
import { cmdBudget } from "./commands/budget.ts"
import { cmdClaim, cmdPause, cmdRelease, cmdResume } from "./commands/claims.ts"
import { cmdClaims } from "./commands/claims-view.ts"
import { cmdSend } from "./commands/delivery.ts"
import { cmdDoctor } from "./commands/doctor.ts"
import { cmdInstallHook } from "./commands/hooks.ts"
import { cmdAck, cmdInbox, cmdReceipt } from "./commands/inbox.ts"
import { cmdList } from "./commands/list.ts"
import { cmdGc } from "./commands/maintenance.ts"
import { cmdReply } from "./commands/reply.ts"
import { cmdAsk, cmdDispatch } from "./commands/requests.ts"
import { cmdHookReconcile, cmdSessionHook } from "./commands/session-hook.ts"
import { cmdStatus } from "./commands/status.ts"
import { cmdTopic } from "./commands/topics.ts"
import { cmdWait } from "./commands/wait.ts"
import { nativeRegistrationCommand } from "./native.ts"

export { ResolveError } from "./codex.ts"
export type { Args } from "./commands/arguments.ts"
export { cmdAwait } from "./commands/await.ts"
export { cmdDown, cmdRestart, cmdShim, cmdUp } from "./commands/bridge.ts"
export { gcBridgeState } from "./commands/bridge-retention.ts"
export { cmdBuddy } from "./commands/buddy.ts"
export { cmdBudget } from "./commands/budget.ts"
export { cmdClaim, cmdPause, cmdRelease, cmdResume } from "./commands/claims.ts"
export { cmdClaims } from "./commands/claims-view.ts"
export { cmdSend } from "./commands/delivery.ts"
export { cmdDoctor } from "./commands/doctor.ts"
export { cmdInstallHook, hookCommand } from "./commands/hooks.ts"
export { cmdAck, cmdInbox, cmdReceipt } from "./commands/inbox.ts"
export { cmdList } from "./commands/list.ts"
export { cmdGc } from "./commands/maintenance.ts"
export { cmdReply } from "./commands/reply.ts"
export { requestEnvelope } from "./commands/request-format.ts"
export { capPeerState, cleanupExpiredRequests } from "./commands/request-retention.ts"
export { cmdAsk, cmdDispatch } from "./commands/requests.ts"
export { cmdHookReconcile, cmdSessionHook } from "./commands/session-hook.ts"
export { cmdStatus } from "./commands/status.ts"
export { cmdTopic } from "./commands/topics.ts"
export { cmdWait } from "./commands/wait.ts"
export const COMMANDS: Record<string, (args: Args) => Promise<number>> = {
  "native-register": nativeRegistrationCommand,
  list: cmdList,
  send: cmdSend,
  ask: cmdAsk,
  dispatch: cmdDispatch,
  await: cmdAwait,
  reply: cmdReply,
  inbox: cmdInbox,
  ack: cmdAck,
  receipt: cmdReceipt,
  wait: cmdWait,
  shim: cmdShim,
  up: cmdUp,
  down: cmdDown,
  restart: cmdRestart,
  budget: cmdBudget,
  buddy: cmdBuddy,
  gc: cmdGc,
  "session-hook": cmdSessionHook,
  "hook-reconcile": cmdHookReconcile,
  "install-hook": cmdInstallHook,
  doctor: cmdDoctor,
  topic: cmdTopic,
  status: cmdStatus,
  claim: cmdClaim,
  release: cmdRelease,
  claims: cmdClaims,
  pause: cmdPause,
  resume: cmdResume,
}
