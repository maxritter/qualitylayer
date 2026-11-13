// gate open plan | final · gate decide changes "<remark>" (`wait --for approval` waits and applies)
// (a person's own terminal, outside any agent, also has gate decide approve; the agent has it with
// --asked "<the person's words>" when a message of theirs since the gate opened holds them).
// Thin parsing over core/gate; the chat's `decide` and the Cockpit's button
// end in the same record().

import { detectAgent } from "../../core/agents/detect.ts"
import { chatWorkflowRefusal } from "../../core/chat/task.ts"
import { folderDoc } from "../../core/docs/names.ts"
import * as gate from "../../core/gate/gate.ts"
import { foreignBuildLead } from "../../core/handoff/outside.ts"
import {
  linkOf,
  SEND_REFUSAL,
  sendFinal,
  sendPlan,
  viaOf,
} from "../../core/integrations/approval.ts"
import { recordHandoff } from "../../core/next/implement.ts"
import { missingOf, refused } from "../../core/next/refusal.ts"
import { withTaskComments } from "../../core/planning-comments.ts"
import { inManagedTaskTerminal } from "../../core/run/bind.ts"
import { planPresentation } from "../../core/run/presentation.ts"
import { picksFromRecord } from "../../core/task/picker-completion.ts"
import {
  ASK_REFUSAL,
  approvalAsked,
  approves,
  NOT_AN_APPROVAL,
  responseAsked,
} from "../../core/task/prompts.ts"
import { agentSession } from "../../core/task/question.ts"
import { approvalsOf, approvesInAgent } from "../../core/task/sides.ts"
import { type Ctx, err, ok, type Result } from "../../ctx.ts"
import { needsYou, openInBrowser } from "../browser.ts"
import { taskCockpitUrl } from "./cockpit.ts"
import { requireTask } from "./shared.ts"

export async function gateCmd(ctx: Ctx, args: string[]): Promise<Result<unknown>> {
  const [sub, ...rest] = args
  const task = await requireTask(ctx)
  if (task.ok && task.data.type === "chat") return chatWorkflowRefusal()
  switch (sub) {
    case "open": {
      // The target is a word: `plan` (stored as the Plan's file name) or `final`.
      const word = rest[0]
      const target =
        word === "plan" ? folderDoc("plan") : word === gate.FINAL ? gate.FINAL : undefined
      // `--via github [--asked "<their words>"]`: the Plan, or the change for its final review, is
      // pushed and GitHub's prefilled compare page opens, where the person creates the pull request.
      const viaAt = rest.indexOf("--via")
      const askedAt = rest.indexOf("--asked")
      const via = viaAt >= 0 ? viaOf(rest[viaAt + 1]) : undefined
      const asked = askedAt >= 0 ? rest[askedAt + 1] : undefined
      const extra = (viaAt >= 0 ? 2 : 0) + (askedAt >= 0 ? 2 : 0)
      if (
        target === undefined ||
        rest.length > 1 + extra ||
        via === null ||
        (askedAt >= 0 && viaAt < 0)
      ) {
        return err({
          code: "bad_args",
          message:
            'usage: qualitylayer gate open plan | final [--via github [--asked "<the person\'s words>"]]',
        })
      }
      if (!task.ok) return task
      // The send pushes a branch: the person's act, from their own terminal or in their words.
      if (via !== undefined) {
        const inAgent = agentSession(ctx.env) !== null || detectAgent(ctx.env) !== "unknown"
        const atTerminal = !inAgent && process.stdin.isTTY === true && process.stdout.isTTY === true
        const theirs =
          asked !== undefined &&
          asked.trim() !== "" &&
          (await responseAsked(ctx, task.data, agentSession(ctx.env), asked))
        if (!atTerminal && !theirs) return err({ code: "bad_args", message: SEND_REFUSAL })
      }
      const gated = await gate.open(ctx, task.data, target)
      if (!gated.ok) return gated
      if (via !== undefined) {
        const final = target === gate.FINAL
        const what = final ? "change" : "Plan"
        const sent = final ? await sendFinal(ctx, task.data) : await sendPlan(ctx, task.data)
        // The gate is open all the same: the person can approve in the App while the send waits on them.
        if (!sent.ok) {
          const moves = missingOf(sent.error)
          const wait = "qualitylayer wait --for approval"
          return refused(
            sent.error.message,
            moves.some((m) => m.move === wait)
              ? moves
              : [
                  ...moves,
                  {
                    what: `the person's decision in the App, where the ${what} is open now`,
                    move: wait,
                  },
                ],
          )
        }
        // The person creates the pull request in GitHub's own UI: the page opens where it can.
        const link = linkOf(sent.data)
        const opened = sent.data.url === undefined ? await openInBrowser(ctx.env, link) : false
        return ok({
          ...gated.data,
          sent: {
            via,
            branch: sent.data.branch,
            ...(sent.data.url !== undefined ? { url: sent.data.url } : {}),
            ...(sent.data.compare !== undefined ? { compare: sent.data.compare } : {}),
            revision: sent.data.revision.slice(0, 12),
          },
          message:
            sent.data.url !== undefined
              ? `The ${what} is pushed to ${sent.data.branch}; its pull request follows: ${sent.data.url}. An approving review there by someone else with write access settles it; your own approval goes in the App.${final ? " Comments there come back to you as review feedback." : ""}`
              : `The ${what} is pushed to ${sent.data.branch}. The person creates the pull request on GitHub's prefilled page${opened ? ", open in their browser now" : ""}: ${link}. Give them this link. An approving review there by someone else with write access settles it; their own approval goes in the App.${final ? " Comments there come back to you as review feedback." : ""}`,
          then: "qualitylayer wait --for approval",
        })
      }
      // Where the Plan lives, recorded as it goes to the person: a build started in another
      // checkout (a fresh worktree) copies the Plan from here.
      if (target === folderDoc("plan")) await recordHandoff(ctx, task.data)
      // A comment the person left meanwhile comes back with the reply, before they are told.
      const opened = {
        ...gated,
        data: {
          ...(await withTaskComments(ctx, task.data, gated.data)),
          ...(target === folderDoc("plan")
            ? {
                presentation: planPresentation(
                  inManagedTaskTerminal(ctx, task.data),
                  approvalsOf(task.data),
                  (await gate.readGate(ctx, task.data))?.waitsFor !== undefined,
                ),
              }
            : {}),
        },
      }
      // A human is needed now: make sure they have a window, and say where it is.
      const cockpit = await taskCockpitUrl(ctx, task.data.slug)
      if (approvesInAgent(task.data)) return opened
      if (cockpit === undefined) return opened
      // No App page open: one opens, and the desktop says a gate waits. Never a second page.
      const shown = await needsYou(ctx, cockpit, {
        title: "QualityLayer · needs you",
        body: `${task.data.title}: review ${target}`,
      })
      return {
        ok: true,
        data: {
          ...opened.data,
          app: cockpit,
          cockpit,
          message: `${opened.data.message} Review it in the QualityLayer App${shown === "opened" ? ", now open in the browser" : ""}.`,
        },
      }
    }
    case "decide": {
      if (!task.ok) return task
      // `--asked "<the person's words>"`: the agent records what the person asked for in this chat.
      const askedAt = rest.indexOf("--asked")
      const asked = askedAt >= 0 ? (rest[askedAt + 1] ?? "") : undefined
      const args = askedAt >= 0 ? rest.filter((_, i) => i !== askedAt && i !== askedAt + 1) : rest
      const decision = args[0]
      // A terminal is the person's only outside an agent: an agent can give its own command a
      // terminal, so inside its session a terminal says nothing about who typed.
      const inAgent = agentSession(ctx.env) !== null || detectAgent(ctx.env) !== "unknown"
      const atTerminal = !inAgent && process.stdin.isTTY === true && process.stdout.isTTY === true
      // The build's gates, up to the final Review, are its lead session's: a planner whose build
      // another session took is finished and settles nothing, whatever the person typed in it. A
      // person at a terminal of their own is no session.
      const foreign = atTerminal ? null : await foreignBuildLead(ctx, task.data)
      if (foreign !== null) return err({ code: "not_owner", message: foreign.message })
      // The person's pick of the gate's question in this session's own picker, read from the
      // agent's record, approves as their typed words do; the agent's own words never do.
      if (!atTerminal && (decision === "approve" || decision === "approved"))
        await picksFromRecord(ctx, task.data)
      const currentGate = await gate.readGate(ctx, task.data)
      // The person already decided this gate (in the App or this chat): nothing waits, and the
      // reply says what moves the task on instead of asking for an approval that is given.
      if (
        currentGate !== null &&
        currentGate.decision !== "pending" &&
        currentGate.settled !== true
      )
        return ok({
          decided: currentGate.decision,
          message: `${currentGate.target === "final" ? "The change" : "The Plan"} is already ${currentGate.decision === "approved" ? "approved" : "answered"}${currentGate.by === "cockpit" ? " in the App" : ""}. Run \`qualitylayer wait --for approval\`, which applies it.`,
          already: true,
          then: "qualitylayer wait --for approval",
        })
      const after = currentGate?.opened ?? -Infinity
      // Without a terminal, only words the person typed in this session since the gate opened count.
      const approving = decision === "approve" || decision === "approved"
      // The final gate counts typed approvals from when the App showed it (see approvalFloor).
      const floor =
        approving && currentGate !== null
          ? await gate.approvalFloor(ctx, task.data, currentGate)
          : after
      const theirs =
        asked !== undefined &&
        (approving
          ? await approvalAsked(ctx, task.data, agentSession(ctx.env), asked, floor)
          : await responseAsked(ctx, task.data, agentSession(ctx.env), asked, after))
      if (asked !== undefined && !theirs && !atTerminal)
        return err({
          code: "bad_args",
          message:
            floor === Number.POSITIVE_INFINITY
              ? gate.NOT_SHOWN_YET
              : approving && !approves(asked)
                ? NOT_AN_APPROVAL
                : ASK_REFUSAL,
        })
      if (decision === "approve" || decision === "approved") {
        // Only a person at a terminal of their own may approve from here, or the agent when the
        // person asked for it in this chat, in their own words.
        if (!atTerminal && !theirs) {
          return err({
            code: "bad_args",
            message:
              "Only a person approves a gate. Approve in the QualityLayer App, or type approve in this chat.",
          })
        }
        return gate.record(ctx, task.data, "approved", {
          ...(theirs && asked !== undefined ? { asked } : {}),
        })
      }
      if (decision === "changes") {
        const remark = args.slice(1).join(" ").trim()
        if (
          approvesInAgent(task.data) &&
          !atTerminal &&
          !(await responseAsked(ctx, task.data, agentSession(ctx.env), remark, after))
        )
          return err({ code: "bad_args", message: ASK_REFUSAL })
        if (remark === "") {
          return err({
            code: "bad_args",
            message: 'usage: qualitylayer gate decide changes "<remark>"',
          })
        }
        return gate.record(ctx, task.data, "changes", { remark })
      }
      return err({
        code: "bad_args",
        message: 'usage: qualitylayer gate decide approve | changes "<remark>"',
      })
    }
    default:
      return err({
        code: "bad_args",
        message:
          'usage: qualitylayer gate open plan | final · gate decide changes "<remark>" (wait with qualitylayer wait --for approval)',
      })
  }
}
