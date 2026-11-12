export type PlanningWaitDetails = {
  planning: {
    stage: string
    plan_exists: boolean
    gate: { target: string; decision: string; settled: boolean } | null
    owner: {
      session_key: string
      source: "startup"
      last_event: string | null
      last_seen: number | null
    } | null
  }
  status: string
  recovery: {
    command: "qualitylayer next"
    where: "the original planning session"
    message: string
  }
  message: string
}
