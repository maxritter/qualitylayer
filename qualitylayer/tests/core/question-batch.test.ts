// A task's question batches: which steps may ask, how large a batch is, how many batches a
// step asks, Your calls (`late`), the `finding` link and the batch's title and ahead line.
import { expect, test } from "bun:test"
import { join } from "node:path"
import { questionCmd } from "../../src/cli/commands/question.ts"
import { resolveRepo } from "../../src/core/paths.ts"
import { bindSession } from "../../src/core/task/binding.ts"
import { chatQuestions } from "../../src/core/task/chat-questions.ts"
import { advance } from "../../src/core/task/machine.ts"
import { answeredQuestions } from "../../src/core/task/question.ts"
import { answerBatch, askBatch, readBatch } from "../../src/core/task/question-batch.ts"
import { readSessionProof } from "../../src/core/task/session-proof.ts"
import { createTask, patchReadme, type Task } from "../../src/core/task/store.ts"
import { memCtx } from "../helpers/memCtx.ts"

async function world() {
  const mem = memCtx({
    env: {
      HOME: "/home/test",
      CLAUDE_CODE_SESSION_ID: "session-a",
      QUALITYLAYER_NO_COCKPIT: "1",
    },
  })
  const repo = await resolveRepo(mem.ctx)
  if (!repo.ok) throw new Error("no repo")
  const task = await createTask(mem.ctx, repo.data, "batch rules")
  await bindSession(mem.ctx, task)
  return { ...mem, task }
}
const member = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  question: `Choose ${id}?`,
  choices: [{ label: "Yes" }, { label: "No" }],
  recommended: 0,
  points: [1],
  ...extra,
})
const members = (n: number, prefix = "m") =>
  Array.from({ length: n }, (_, i) => member(`${prefix}${i + 1}`))
const at = (task: Task, stage: Task["stage"]): Task => ({ ...task, stage })

test("multi recommendations echo as an array in ask and show while stored compatibility stays scalar", async () => {
  const w = await world()
  const batch = {
    id: "recommendations",
    questions: [member("channels", { multi: true, recommended: [0, 1] })],
  }
  const asked = await questionCmd(w.ctx, ["ask", "--batch", JSON.stringify(batch)])
  expect(asked).toMatchObject({
    ok: true,
    data: { batch: { questions: [{ recommended: [0, 1] }] } },
  })
  const shown = await questionCmd(w.ctx, ["show", "recommendations"])
  expect(shown).toMatchObject({
    ok: true,
    data: { batch: { questions: [{ recommended: [0, 1] }] } },
  })
  const saved = await readBatch(w.ctx, w.task)
  expect(saved?.questions[0]).toMatchObject({ recommended: 0, recommendedChoices: [0, 1] })
})

async function nativeWorld() {
  const w = await world()
  await patchReadme(w.ctx, w.task, { answers: "terminal" })
  w.task.answers = "terminal"
  await askBatch(
    w.ctx,
    w.task,
    {
      id: "native",
      title: "Channels",
      questions: [
        member("channels", {
          question: "Which channels?",
          multi: true,
          choices: ["Slack, team", "Email", "Webhook"],
        }),
        member("frequency"),
        member("tone"),
      ],
    },
    { agent: "claude-code" },
  )
  return w
}

async function nativeProof(
  w: Awaited<ReturnType<typeof nativeWorld>>,
  id: string,
  answers: string[],
  callId = "native-call",
  age = 1,
) {
  const q = (await readBatch(w.ctx, w.task))?.questions.find((q) => q.id === id)
  if (!q) throw new Error("no question")
  const ready = await chatQuestions(w.ctx, [q], { agent: "claude-code" })
  const input = ready.calls[0] as { questions: { question: string }[] }
  const text = input.questions[0]?.question as string
  const rows = [
    {
      sessionId: "session-a",
      timestamp: new Date(q.asked + age).toISOString(),
      message: {
        role: "assistant",
        content: [{ type: "tool_use", id: callId, name: "AskUserQuestion", input }],
      },
    },
    {
      sessionId: "session-a",
      timestamp: new Date(q.asked + age + 1).toISOString(),
      message: {
        role: "user",
        content: [{ type: "tool_result", tool_use_id: callId, content: "answered" }],
      },
      toolUseResult: { answers: { [text]: answers } },
    },
  ]
  const home = w.ctx.env.get("HOME") ?? "/home/test"
  await w.fs.writeFile(
    join(home, ".claude", "projects", "-repo", "session-a.jsonl"),
    rows.map((row) => JSON.stringify(row)).join("\n"),
  )
  const proof = await readSessionProof(w.ctx, {
    agent: "claude-code",
    session: "session-a",
    callId,
  })
  if (!proof) throw new Error("fixture proof missing")
  return { session: "session-a", question: text, answer: proof.answers[0]?.answer as string, proof }
}

test("fresh native batch picks keep every selected label and consume a call once", async () => {
  const w = await nativeWorld()
  const record = (
    (await import("../../src/core/task/question-batch.ts")) as Record<string, unknown>
  ).recordPickedBatchAnswer
  expect(typeof record, "Terminal batch picks need a proof-consuming recorder").toBe("function")
  const save = record as (
    ctx: typeof w.ctx,
    pick: Awaited<ReturnType<typeof nativeProof>>,
  ) => Promise<boolean>
  const pick = await nativeProof(w, "channels", ["Slack, team (Recommended)", "Webhook"])
  expect(await save(w.ctx, pick)).toBe(true)
  expect(await save(w.ctx, pick)).toBe(false)
  expect((await answeredQuestions(w.ctx, w.task))[0]).toMatchObject({
    via: "chat",
    picked: [0, 2],
    pickedLabels: ["Slack, team", "Webhook"],
  })
})

test("forged, stale and racing native picks never duplicate an App answer", async () => {
  const w = await nativeWorld()
  const record = (
    (await import("../../src/core/task/question-batch.ts")) as Record<string, unknown>
  ).recordPickedBatchAnswer
  expect(typeof record).toBe("function")
  const save = record as (
    ctx: typeof w.ctx,
    pick: Awaited<ReturnType<typeof nativeProof>>,
  ) => Promise<boolean>
  const old = await nativeProof(w, "channels", ["Email"], "old", -10)
  expect(await save(w.ctx, old)).toBe(false)
  const fresh = await nativeProof(w, "channels", ["Email"], "fresh")
  expect(await save(w.ctx, { ...fresh, proof: { ...fresh.proof } })).toBe(false)
  const results = await Promise.all([
    answerBatch(w.ctx, w.task, { batch: "native", id: "channels", choice: 0 }),
    save(w.ctx, fresh),
  ])
  expect(results.some(Boolean)).toBe(true)
  expect(await answeredQuestions(w.ctx, w.task)).toHaveLength(1)
  const batch = await readBatch(w.ctx, w.task)
  expect(batch?.questions.some((q) => q.id === "channels")).toBe(false)
})

test("identical open member text is ambiguous and records nothing", async () => {
  const w = await world()
  await patchReadme(w.ctx, w.task, { answers: "terminal" })
  w.task.answers = "terminal"
  await askBatch(
    w.ctx,
    w.task,
    {
      id: "native",
      title: "Ambiguous",
      questions: [
        member("a", { question: "Same?" }),
        member("b", { question: "Same?" }),
        member("c"),
      ],
    },
    { agent: "claude-code" },
  )
  const record = (
    (await import("../../src/core/task/question-batch.ts")) as Record<string, unknown>
  ).recordPickedBatchAnswer as (
    ctx: typeof w.ctx,
    pick: Awaited<ReturnType<typeof nativeProof>>,
  ) => Promise<boolean>
  expect(await record(w.ctx, await nativeProof(w, "a", ["Yes"]))).toBe(false)
  expect(await answeredQuestions(w.ctx, w.task)).toHaveLength(0)
})

test("native more, unsure and Other keep existing batch answer semantics", async () => {
  const w = await nativeWorld()
  const record = (
    (await import("../../src/core/task/question-batch.ts")) as Record<string, unknown>
  ).recordPickedBatchAnswer
  expect(typeof record).toBe("function")
  const save = record as (
    ctx: typeof w.ctx,
    pick: Awaited<ReturnType<typeof nativeProof>>,
  ) => Promise<boolean>
  expect(await save(w.ctx, await nativeProof(w, "channels", ["Tell me more"], "more"))).toBe(true)
  expect((await readBatch(w.ctx, w.task))?.questions[0]?.more).toBeDefined()
  expect(await answeredQuestions(w.ctx, w.task)).toHaveLength(0)
  expect(await save(w.ctx, await nativeProof(w, "frequency", ["Not sure"], "unsure"))).toBe(true)
  expect(await save(w.ctx, await nativeProof(w, "tone", ["Only on weekdays"], "words"))).toBe(true)
  expect(await answeredQuestions(w.ctx, w.task)).toMatchObject([
    { kind: "unsure", via: "chat", choice: "Yes" },
    { words: true, via: "chat", choice: "Only on weekdays" },
  ])
})
/** Answers every open member, so the next batch may follow. */
async function settle(w: Awaited<ReturnType<typeof world>>, id: string) {
  const open = await readBatch(w.ctx, w.task, id)
  for (const q of open?.questions ?? [])
    expect((await answerBatch(w.ctx, w.task, { batch: id, id: q.id, choice: 0 })).ok).toBe(true)
}

test("question ID collisions name every reused ID and suggest an unused task-wide ID", async () => {
  const w = await world()
  expect((await askBatch(w.ctx, w.task, { id: "plan", questions: members(3, "q") })).ok).toBe(true)
  await settle(w, "plan")
  const verify = at(w.task, "verify")
  const refused = await askBatch(w.ctx, verify, {
    id: "verify",
    questions: [member("q1"), member("q2"), member("q4")],
  })
  expect(refused.ok).toBe(false)
  if (!refused.ok) {
    expect(refused.error.message).toContain("q1, q2")
    expect(refused.error.message).toContain("task")
    expect(refused.error.message).toContain("q5")
  }
  expect(await readBatch(w.ctx, w.task, "verify")).toBeNull()
  expect((await askBatch(w.ctx, verify, { id: "verify", questions: members(3, "r") })).ok).toBe(
    true,
  )
})

test("duplicates in one new batch are refused without saving a partial batch", async () => {
  const w = await world()
  const refused = await askBatch(w.ctx, w.task, {
    id: "duplicates",
    questions: [member("q1"), member("q1"), member("q2")],
  })
  expect(refused.ok).toBe(false)
  if (!refused.ok) {
    expect(refused.error.message).toContain("q1")
    expect(refused.error.message).toContain("q3")
  }
  expect(await readBatch(w.ctx, w.task)).toBeNull()
})
test("batches are counted per step", async () => {
  const w = await world()
  expect(
    (await askBatch(w.ctx, w.task, { id: "b1", title: "One", questions: members(3, "a") })).ok,
  ).toBe(true)
  await settle(w, "b1")
  expect(
    (await askBatch(w.ctx, w.task, { id: "b2", title: "Two", questions: members(3, "b") })).ok,
  ).toBe(true)
  await settle(w, "b2")
  const verify = at(w.task, "verify")
  expect(
    (await askBatch(w.ctx, verify, { id: "v1", title: "V", questions: members(3, "v") })).ok,
  ).toBe(true)
  expect((await readBatch(w.ctx, verify, "v1"))?.step).toBe("verify")
  expect((await readBatch(w.ctx, verify, "b1"))?.step).toBe("plan")
})

test("a batch may be asked while an earlier one is open: the App shows both and takes each answer", async () => {
  const { batchStrip } = await import("../../src/core/task/question-batch.ts")
  const w = await world()
  expect(
    (
      await askBatch(w.ctx, w.task, {
        id: "b1",
        title: "Scope",
        ahead: "Scope first",
        questions: members(2, "a"),
      })
    ).ok,
  ).toBe(true)
  const second = await askBatch(w.ctx, w.task, {
    id: "b2",
    title: "Naming",
    ahead: "Names next",
    questions: members(1, "b"),
  })
  expect(second.ok, JSON.stringify(second)).toBe(true)
  // The card the App draws holds the open questions of both, the earlier batch first.
  const shown = await readBatch(w.ctx, w.task)
  expect(shown?.questions.map((q) => q.id)).toEqual(["a1", "a2", "b1"])
  expect(shown?.title).toBeUndefined()
  expect(shown?.ahead).toBeUndefined()
  expect((await batchStrip(w.ctx, w.task))?.title).toBeUndefined()
  expect((await batchStrip(w.ctx, w.task))?.ahead).toBeUndefined()
  expect((await readBatch(w.ctx, w.task, "b1"))?.title).toBe("Scope")
  expect((await readBatch(w.ctx, w.task, "b2"))?.title).toBe("Naming")
  expect((await batchStrip(w.ctx, w.task))?.members.map((m) => m.id)).toEqual(["a1", "a2", "b1"])
  // The card's batch is the newest; an answer to the earlier batch's question still lands in it.
  const answered = await answerBatch(w.ctx, w.task, { batch: shown?.id ?? "", id: "a1", choice: 0 })
  expect(answered.ok, JSON.stringify(answered)).toBe(true)
  expect((await readBatch(w.ctx, w.task, "b1"))?.questions.map((q) => q.id)).toEqual(["a2"])
  expect((await readBatch(w.ctx, w.task))?.questions.map((q) => q.id)).toEqual(["a2", "b1"])
  // The newer batch answered, the earlier one still shows.
  expect((await answerBatch(w.ctx, w.task, { batch: "b2", id: "b1", choice: 0 })).ok).toBe(true)
  expect((await readBatch(w.ctx, w.task))?.questions.map((q) => q.id)).toEqual(["a2"])
  expect(await readBatch(w.ctx, w.task)).toMatchObject({ title: "Scope", ahead: "Scope first" })
  expect(await batchStrip(w.ctx, w.task)).toMatchObject({ title: "Scope", ahead: "Scope first" })
})

test("a step may be asked nothing: no batch is needed to move on", async () => {
  const w = await world()
  const plan = join(w.task.dir, "01-plan.md")
  expect(await readBatch(w.ctx, w.task)).toBeNull()
  // The Plan has no open batch and no answered one: its own document is what its approval reads.
  expect(await w.ctx.fs.exists(plan)).toBe(true)
  const moved = await advance(w.ctx, w.task, "gate_approved")
  expect(moved.ok).toBe(true)
  if (moved.ok) expect(moved.data.stage).toBe("implement")
})
test("late belongs to the Plan only", async () => {
  const w = await world()
  const refused = await askBatch(w.ctx, at(w.task, "implement"), {
    id: "b1",
    title: "T",
    questions: [member("a", { late: true }), ...members(2)],
  })
  expect(refused.ok).toBe(false)
  if (!refused.ok) expect(refused.error.code).toBe("batch_step_closed")
})

test("a finding must name an H3 of a helper's research report", async () => {
  const w = await world()
  const plan = w.task
  const choice = (finding: string) =>
    askBatch(w.ctx, plan, {
      id: "r1",
      title: "Choices the code leaves open",
      questions: [member("a", { grade: 3, finding }), ...members(2, "b")],
    })
  const none = await choice("The argument parser")
  expect(none.ok).toBe(false)
  await w.ctx.fs.writeFile(
    join(w.task.dir, "research", "r1.md"),
    "# Research\n\n## Findings\n\n### The argument parser\n\nIt reads argv once.\n\n```md\n### Not a finding\n```\n\n### Version at build time\n\nFrom package.json.\n",
  )
  const wrong = await choice("Not a finding")
  expect(wrong.ok).toBe(false)
  if (!wrong.ok) {
    expect(wrong.error.code).toBe("bad_args")
    expect(wrong.error.message).toContain("the ### title of a finding in a report under research/")
  }
  expect((await choice("### version at build time")).ok).toBe(true)
  expect((await readBatch(w.ctx, plan, "r1"))?.questions[0]?.finding).toBe("version at build time")
})

test("title and ahead round-trip with the batch; unknown batch fields stay refused", async () => {
  const w = await world()
  const asked = await askBatch(w.ctx, w.task, {
    id: "b1",
    step: "plan",
    title: "Scope and what done means",
    ahead: "Probably the only Plan batch",
    questions: members(4),
  })
  expect(asked.ok).toBe(true)
  const read = await readBatch(w.ctx, w.task, "b1")
  expect(read).toMatchObject({
    step: "plan",
    title: "Scope and what done means",
    ahead: "Probably the only Plan batch",
  })
  expect(read?.questions).toHaveLength(4)
  const wrong = await askBatch(w.ctx, w.task, { id: "b2", step: "verify", questions: members(3) })
  expect(wrong.ok).toBe(false)
  const unknown = await askBatch(w.ctx, w.task, { id: "b3", subtitle: "x", questions: members(3) })
  expect(unknown.ok).toBe(false)
  expect(
    await askBatch(w.ctx, w.task, { id: "b3", late: true, questions: members(3) }),
  ).toMatchObject({
    ok: false,
    error: {
      message: "unknown batch fields: late. Put late and settles on each question in the batch.",
    },
  })
})

test("the strip lists every member in order, answered ones with their answer, and is gone when all are answered", async () => {
  const { batchStrip } = await import("../../src/core/task/question-batch.ts")
  const w = await world()
  expect(await batchStrip(w.ctx, w.task)).toBeNull()
  await askBatch(w.ctx, w.task, {
    id: "b1",
    title: "Scope and what done means",
    ahead: "Probably the only Plan batch",
    questions: members(3),
  })
  await answerBatch(w.ctx, w.task, { batch: "b1", id: "m2", choice: 1 })
  const strip = await batchStrip(w.ctx, w.task)
  expect(strip?.title).toBe("Scope and what done means")
  expect(strip?.ahead).toBe("Probably the only Plan batch")
  expect(strip?.members.map((m) => [m.id, m.number, m.answer])).toEqual([
    ["m1", 1, undefined],
    ["m2", 2, "No"],
    ["m3", 3, undefined],
  ])
  await settle(w, "b1")
  expect(await batchStrip(w.ctx, w.task)).toBeNull()
})
