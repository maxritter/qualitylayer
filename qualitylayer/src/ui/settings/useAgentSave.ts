import { useEffect, useEffectEvent, useRef, useState } from "react"
import { validOtherAgentArgs, validOtherAgentProgram } from "../../core/config-values.ts"
import type { Config } from "../api.ts"
import { joinArguments, splitArguments } from "./arguments.ts"
import type { SaveResult } from "./CommitField.tsx"

type Agent = Config["otherAgent"]
type Draft = { program: string; args: string }
type Problems = { program: boolean; args: boolean }
const NO_PROBLEMS: Problems = { program: false, args: false }

function sameAgent(left: Agent, right: Agent): boolean {
  return (
    left.program === right.program &&
    left.args.length === right.args.length &&
    left.args.every((arg, index) => arg === right.args[index])
  )
}

function edit(agent: Agent): Draft {
  return { program: agent.program, args: joinArguments(agent.args) }
}

function read(draft: Draft): Agent {
  return { program: draft.program.trim(), args: splitArguments(draft.args.trim()) }
}

export type WriteAgentSetting = (patch: { otherAgent: Agent }) => SaveResult
type SaveState = "idle" | "saving" | "saved" | "refused"

function useAgentDraft(config: Agent) {
  const [draft, setDraft] = useState(() => edit(config))
  const [kept, setKept] = useState(config)
  const current = useRef(draft)
  const committed = useRef(config)

  const replace = (value: Draft) => {
    current.current = value
    setDraft(value)
  }
  const accept = (value: Agent) => {
    committed.current = value
    setKept(value)
  }
  const isDirty = () => !sameAgent(read(current.current), committed.current)
  const receiveExternal = useEffectEvent((value: Agent) => {
    if (sameAgent(committed.current, value)) return
    if (!isDirty()) replace(edit(value))
    accept(value)
  })
  useEffect(() => receiveExternal(config), [config])

  return { draft, kept, current, committed, replace, accept }
}

function invalidFields(next: Agent): Problems {
  return {
    program: !validOtherAgentProgram(next.program),
    args: !validOtherAgentArgs(next.args),
  }
}

async function persist(write: WriteAgentSetting, next: Agent): Promise<boolean> {
  try {
    return typeof (await write({ otherAgent: next })) !== "string"
  } catch {
    return false
  }
}

function useSaveQueue(
  permitted: boolean,
  draft: React.RefObject<Draft>,
  committed: React.RefObject<Agent>,
  writeDraft: (next: Agent) => Promise<void>,
) {
  const pending = useRef(false)
  const queued = useRef(false)
  const allowed = useRef(permitted)
  allowed.current = permitted
  return async () => {
    if (!allowed.current) return
    queued.current = true
    if (pending.current) return
    pending.current = true
    try {
      let lastAttempt: Agent | undefined
      while (queued.current && allowed.current) {
        queued.current = false
        const next = read(draft.current)
        if (sameAgent(next, committed.current) || (lastAttempt && sameAgent(next, lastAttempt)))
          break
        lastAttempt = next
        await writeDraft(next)
      }
    } finally {
      pending.current = false
    }
  }
}

export function useAgentSave(config: Agent, permitted: boolean, write: WriteAgentSetting) {
  const data = useAgentDraft(config)
  const [state, setState] = useState<SaveState>("idle")
  const [problems, setProblems] = useState(NO_PROBLEMS)
  const update = (field: keyof Draft, value: string) => {
    data.replace({ ...data.current.current, [field]: value })
    setProblems((previous) => ({ ...previous, [field]: false }))
    setState((previous) => (previous === "saving" ? previous : "idle"))
  }

  const writeDraft = async (next: Agent) => {
    const invalid = invalidFields(next)
    setProblems(invalid)
    if (invalid.program || invalid.args) {
      setState("idle")
      return
    }
    setState("saving")
    if (await persist(write, next)) {
      data.accept(next)
      setState(sameAgent(read(data.current.current), next) ? "saved" : "idle")
    } else {
      setState("refused")
    }
  }

  const save = useSaveQueue(permitted, data.current, data.committed, writeDraft)

  const dirty = !sameAgent(read(data.draft), data.kept)
  return { draft: data.draft, dirty, update, save, problems, state }
}
