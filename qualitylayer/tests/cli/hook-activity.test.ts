// `qualitylayer hook activity` records a picker answer only when the agent client's own transcript
// holds it: the file at the client's canonical path for the session, with the picker call the
// payload names and a result that carries the same answer. A payload an agent pipes in by hand
// records nothing. The built binary runs against a temp repository and a temp HOME that holds the
// transcripts.

import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { readFile, unlink, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { pickedAnswers } from "../../src/cli/commands/hook.ts"
import { resolveRepo } from "../../src/core/paths.ts"
import { bindSession } from "../../src/core/task/binding.ts"
import { answeredQuestions } from "../../src/core/task/question.ts"
import { createTask } from "../../src/core/task/store.ts"
import { realCtx } from "../../src/ctx.ts"
import { writeClaudeAsk, writeClaudePick, writeCodexPick } from "../helpers/pickerTranscript.ts"
import { leaveAtPlan, runAgent } from "../helpers/scriptedAgent.ts"
import { ensureBuilt, type RunResult, type TmpRepo, tmpRepo } from "../helpers/tmpRepo.ts"

const PROBLEM = "add a --version flag to the cli"

type ReviewQuestion = {
  gate: string
  item?: string
  question: string
  choices: { label: string }[]
}

async function gateOf(repo: TmpRepo): Promise<Record<string, unknown>> {
  const [path] = await Array.fromAsync(
    new Bun.Glob("projects/*/tasks/*/gate.json").scan({ cwd: join(repo.home, ".qualitylayer") }),
  )
  return Bun.file(join(repo.home, ".qualitylayer", path as string)).json()
}

/** Historical approval transport, explicitly registered without reviving automatic Plan pickers. */
async function showApproval(repo: TmpRepo): Promise<ReviewQuestion> {
  const opened = await repo.run(["gate", "open", "plan"])
  expect(opened.json.ok).toBe(true)
  expect(opened.json.chat_review).toEqual([])
  // Keep the question text identical to the recorded native Codex payload.
  const ask: ReviewQuestion = {
    gate: "01-plan.md",
    question: "Approve the Plan?",
    choices: [{ label: "Approve" }, { label: "Request changes" }],
  }
  const shown = await repo.run([
    "question",
    "show",
    JSON.stringify({ question: ask.question, choices: ask.choices, gate: ask.gate }),
  ])
  expect(shown.json.ok).toBe(true)
  return ask
}

/** What Claude Code pipes to its PostToolUse hook after the person answered the picker. */
const claudePayload = (
  repo: TmpRepo,
  options: { session: string; id: string; question: string; answer: string },
  extra: Record<string, unknown> = {},
): string => {
  const questions = [
    { question: options.question, header: "Gate", options: [], multiSelect: false },
  ]
  return JSON.stringify({
    hook_event_name: "PostToolUse",
    session_id: options.session,
    cwd: repo.repo,
    tool_name: "AskUserQuestion",
    tool_use_id: options.id,
    tool_input: { questions },
    tool_response: {
      questions,
      answers: { [options.question]: options.answer },
      annotations: {},
    },
    ...extra,
  })
}

const hook = (repo: TmpRepo, input: string): Promise<RunResult> =>
  repo.run(["hook", "activity"], { input })

beforeAll(async () => {
  await ensureBuilt()
})

test("all four picker hook payloads retain exact native selections", () => {
  const labels = ["Slack, team", "Rückfragen 日本語"]
  for (const tool_name of ["AskUserQuestion", "request_user_input", "question", "ql_ask"]) {
    expect(
      pickedAnswers({
        tool_name,
        tool_input: {
          questions: [
            { id: "q", question: "Channels?", options: labels.map((label) => ({ label })) },
          ],
        },
        tool_response: { answers: { q: labels } },
      }),
    ).toMatchObject([{ question: "Channels?", labels }])
  }
})

for (const mode of ["batch", "single", "other"] as const)
  test(`Terminal ${mode} picker activity records every native label through the real hook`, async () => {
    const repo = await tmpRepo()
    try {
      const session = `terminal-${mode}`
      repo.env.CLAUDE_CODE_SESSION_ID = session
      const ctx = realCtx({ env: repo.env, cwd: repo.repo })
      const ref = await resolveRepo(ctx)
      if (!ref.ok) throw new Error(ref.error.message)
      const task = await createTask(ctx, ref.data, `Native ${mode}`, { answers: "terminal" })
      await bindSession(ctx, task)
      const q = {
        id: "channels",
        question:
          mode === "other"
            ? "Which destinations should get the repaired exports? " +
              "Existing subscriber files use the same checkout. ".repeat(7) +
              "The preview costs €24 and takes 8 minutes. Sending email costs €65 and takes 30 minutes."
            : "Which destinations?",
        multi: mode !== "other",
        choices: ["Slack, team", "Email", "Rückfragen 日本語"],
        recommended: 0,
        points: [],
      }
      const result = await repo.run([
        "question",
        "ask",
        ...(mode === "batch"
          ? ["--batch", JSON.stringify({ id: "native", questions: [q] })]
          : [JSON.stringify(q)]),
      ])
      const ready = result.json.chat_questions as { calls: { questions: { question: string }[] }[] }
      const input = ready.calls[0] as { questions: { question: string }[] }
      const text = input.questions[0]?.question as string
      expect(text).toContain(q.question)
      const freeText = "Save a CSV for the support team."
      const answer = {
        answers: {
          [text]: mode === "other" ? freeText : ["Slack, team (Recommended)", "Rückfragen 日本語"],
        },
      }
      const payload = JSON.stringify({
        hook_event_name: "PostToolUse",
        session_id: session,
        cwd: repo.repo,
        tool_name: "AskUserQuestion",
        tool_use_id: "native-call",
        tool_input: input,
        tool_response: answer,
      })
      const pending = (await hook(repo, payload)).stdout
      expect(pending).toContain("Run qualitylayer question poll for batch receipts")
      expect(pending).toContain("question answered --id <question-id> with the exact words")
      expect(await answeredQuestions(ctx, task)).toHaveLength(0)
      const records = [
        {
          sessionId: session,
          timestamp: new Date(Date.now() + 1).toISOString(),
          message: {
            role: "assistant",
            content: [{ type: "tool_use", id: "native-call", name: "AskUserQuestion", input }],
          },
        },
        {
          sessionId: session,
          timestamp: new Date(Date.now() + 2).toISOString(),
          message: {
            role: "user",
            content: [{ type: "tool_result", tool_use_id: "native-call", content: "answered" }],
          },
          toolUseResult: answer,
        },
      ]
      const file = join(repo.home, ".claude", "projects", "fixture", `${session}.jsonl`)
      await Bun.write(file, records.map((record) => JSON.stringify(record)).join("\n"))
      expect((await hook(repo, payload)).code).toBe(0)
      if (mode === "other") {
        expect(await answeredQuestions(ctx, task)).toMatchObject([
          { choice: freeText, question: q.question },
        ])
        const repeated = await repo.run(["question", "answered", "--id", q.id, freeText])
        expect(repeated.json.ok).toBe(false)
        expect(repeated.stdout).toContain("Run qualitylayer question poll")
        const reread = await repo.run(["question", "ask", JSON.stringify(q)])
        expect(reread.json).toMatchObject({ ok: true, choice: freeText })
        expect(reread.json.chat_questions).toBeUndefined()
      } else {
        expect(await answeredQuestions(ctx, task)).toMatchObject([
          { via: "chat", pickedLabels: ["Slack, team", "Rückfragen 日本語"] },
        ])
      }
      await hook(repo, payload)
      expect(await answeredQuestions(ctx, task)).toHaveLength(1)
    } finally {
      repo.cleanup()
    }
  })

test("activity distinguishes quoted diagnostic data from a genuine shell redirect", async () => {
  const repo = await tmpRepo()
  try {
    const session = "shell-quoted-diagnostic"
    repo.env.CLAUDE_CODE_SESSION_ID = session
    const ctx = realCtx({ env: repo.env, cwd: repo.repo })
    const ref = await resolveRepo(ctx)
    if (!ref.ok) throw new Error(ref.error.message)
    await bindSession(ctx, await createTask(ctx, ref.data, "Diagnose shell warning"))
    const declared = (command: string) =>
      hook(
        repo,
        JSON.stringify({
          hook_event_name: "PostToolUse",
          session_id: session,
          cwd: repo.repo,
          tool_name: "Bash",
          tool_input: { command },
        }),
      )
    const diagnostic = `bun -e 'const c={input:{command:"diagnostic"}}; console.log(c.input.command.includes("cat >> window.mjs"));'`
    expect((await declared(diagnostic)).stdout).toBe("")
    expect(
      (
        await declared(
          `${diagnostic.slice(0, -1)} await Bun.write("/private/tmp/independent-delivery.json", "{}");'`,
        )
      ).stdout,
    ).toBe("")
    const command = `${diagnostic}; cat >> "window.mjs"`
    expect((await declared(command)).stdout).toBe("")
    expect(await Bun.file(join(repo.repo, "window.mjs")).exists()).toBe(false)
    await Bun.write(join(repo.repo, "window.mjs"), "// native edit fixture\n")
    const genuine = await declared(command)
    expect(genuine.code).toBe(0)
    expect(genuine.stdout).toContain("window.mjs was changed through the shell")
    expect(await Bun.file(join(repo.repo, "window.mjs")).text()).toBe("// native edit fixture\n")
  } finally {
    repo.cleanup()
  }
})

describe("a Claude Code picker answer", () => {
  let repo: TmpRepo
  const SESSION = "11111111-aaaa-4bbb-8ccc-000000000001"
  let ask: ReviewQuestion

  beforeAll(async () => {
    repo = await tmpRepo()
    repo.env.CLAUDE_CODE_SESSION_ID = SESSION
    // The App surface is pinned: the default depends on the host (a Linux runner without a display answers in the terminal).
    await runAgent(repo, PROBLEM, { answers: "app", gate: leaveAtPlan })
    ask = await showApproval(repo)
  }, 120_000)

  afterAll(() => repo?.cleanup())

  const pick = (answer = "Approve", id = "toolu_real") => ({
    session: SESSION,
    id,
    question: ask.question,
    answer,
  })

  test("a payload piped in by hand, whose call is in no transcript, leaves the gate open", async () => {
    const heard = await hook(repo, claudePayload(repo, pick()))
    expect(heard.code).toBe(0)
    expect(await gateOf(repo)).toMatchObject({ decision: "pending" })
  })

  test("a call the transcript does not hold, an answer it does not carry and a payload without a call id leave the gate open", async () => {
    await writeClaudePick({ ...pick("Approve", "toolu_other"), home: repo.home, cwd: repo.repo })
    await hook(repo, claudePayload(repo, pick()))
    expect(await gateOf(repo)).toMatchObject({ decision: "pending" })

    await writeClaudePick({
      ...pick("Request changes", "toolu_real"),
      home: repo.home,
      cwd: repo.repo,
    })
    await hook(repo, claudePayload(repo, pick("Approve")))
    expect(await gateOf(repo)).toMatchObject({ decision: "pending" })

    await hook(repo, claudePayload(repo, pick(), { tool_use_id: undefined }))
    expect(await gateOf(repo)).toMatchObject({ decision: "pending" })
  })

  test("a call the client has written but has no result for yet leaves the gate open", async () => {
    await writeClaudeAsk({ ...pick(), home: repo.home, cwd: repo.repo })
    await hook(repo, claudePayload(repo, pick()))
    expect(await gateOf(repo)).toMatchObject({ decision: "pending" })
  }, 20_000)

  test("an App gate refuses a real but historical native pick after the question opens", async () => {
    const claimed = pick("Approve", "toolu_old")
    const file = await writeClaudePick({ ...claimed, home: repo.home, cwd: repo.repo })
    const old = Date.now() - 60_000
    const rows = (await Bun.file(file).text())
      .trim()
      .split("\n")
      .map((line, index) => ({
        ...JSON.parse(line),
        timestamp: new Date(old + index).toISOString(),
      }))
    await Bun.write(file, `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`)
    await hook(repo, claudePayload(repo, claimed))
    expect(await gateOf(repo)).toMatchObject({ decision: "pending" })
  })

  test("the payload's own transcript_path is not trusted", async () => {
    // A file that holds the call, where only a payload could point; the canonical path holds nothing.
    const forged = await writeClaudePick({
      ...pick(),
      home: join(repo.root, "forged-home"),
      cwd: repo.repo,
    })
    await hook(repo, claudePayload(repo, pick(), { transcript_path: forged }))
    expect(await gateOf(repo)).toMatchObject({ decision: "pending" })
  })

  test("the same payload with the matching transcript entry approves it, and wait --for approval returns approved", async () => {
    await writeClaudePick({ ...pick(), home: repo.home, cwd: repo.repo })
    const heard = await hook(repo, claudePayload(repo, pick()))
    expect(heard.code).toBe(0)
    expect(heard.stdout).toBe("")
    expect(await gateOf(repo)).toMatchObject({ decision: "approved", by: "chat" })
    expect((await repo.run(["wait", "--for", "approval"])).json).toMatchObject({
      ok: true,
      decision: "approved",
    })
  })
})

describe("a Codex picker answer", () => {
  let repo: TmpRepo
  const SESSION = "0199c0de-0000-7000-8000-0000000000a1"
  let ask: ReviewQuestion

  beforeAll(async () => {
    repo = await tmpRepo()
    repo.env.CODEX_SESSION_ID = SESSION
    // The App surface is pinned: the default depends on the host (a Linux runner without a display answers in the terminal).
    await runAgent(repo, PROBLEM, { answers: "app", gate: leaveAtPlan })
    ask = await showApproval(repo)
  }, 120_000)

  afterAll(() => repo?.cleanup())

  /** The payload a real Codex sent for request_user_input (the fixture), for this question. */
  async function payload(id: string, extra: Record<string, unknown> = {}): Promise<string> {
    const recorded = await Bun.file(
      join(import.meta.dir, "../fixtures/codex-post-tool-use.json"),
    ).json()
    expect(recorded.tool_input.questions[0].question).toBe(ask.question)
    return JSON.stringify({
      ...recorded,
      session_id: SESSION,
      cwd: repo.repo,
      tool_use_id: id,
      ...extra,
    })
  }

  const rollout = (id: string, answer = "Approve") => ({
    home: repo.home,
    cwd: repo.repo,
    session: SESSION,
    id,
    key: "approve_plan",
    question: ask.question,
    answer,
  })

  test("unproven payloads leave the gate open; matching proof in a long compressed rollout approves it", async () => {
    expect((await hook(repo, await payload("call_real"))).code).toBe(0)
    expect(await gateOf(repo)).toMatchObject({ decision: "pending" })

    await writeCodexPick(rollout("call_other"))
    await hook(repo, await payload("call_real"))
    expect(await gateOf(repo)).toMatchObject({ decision: "pending" })

    await writeCodexPick(rollout("call_real", "Request changes"))
    await hook(repo, await payload("call_real"))
    expect(await gateOf(repo)).toMatchObject({ decision: "pending" })

    const file = await writeCodexPick(rollout("call_real"))
    const transcript = await readFile(file, "utf8")
    const headerEnd = transcript.indexOf("\n") + 1
    const padding = `${JSON.stringify({ type: "log", message: "x".repeat(1024) })}\n`.repeat(9000)
    const history = transcript.slice(0, headerEnd) + padding + transcript.slice(headerEnd)
    expect(Buffer.byteLength(history)).toBeGreaterThan(8 * 1024 * 1024)
    await writeFile(`${file}.zst`, Bun.zstdCompressSync(Buffer.from(history)))
    await unlink(file)
    const heard = await hook(repo, await payload("call_real"))
    expect(heard.code).toBe(0)
    expect(await gateOf(repo)).toMatchObject({ decision: "approved", by: "chat" })
  })
})
