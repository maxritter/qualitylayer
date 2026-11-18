import { readFileSync } from "node:fs"
import { log } from "../base.ts"
import {
  printable,
  TOPIC_TAIL_DEFAULT,
  TOPIC_TAIL_MAX,
  topicList,
  topicPost,
  topicTail,
  validateTopic,
} from "../topics.ts"
import { type Args, fail, flag, messageFrom, opt, out } from "./arguments.ts"
import { topicSender } from "./topic-identity.ts"

function listTopics(args: Args): number {
  const topics = topicList()
  if (flag(args, "json")) out(JSON.stringify(topics))
  else if (topics.length === 0) out("no topics")
  else
    for (const t of topics) out(`${printable(t.topic)}  last #${t.last_seq}  ${t.last_ts ?? "-"}`)
  return 0
}

function postTopic(args: Args, topic: string | undefined): number {
  const name = validateTopic(topic)
  const jsonFile = opt(args, "json-file")
  let body: { text: string } | { data: unknown }
  if (jsonFile !== undefined) {
    try {
      body = { data: JSON.parse(readFileSync(jsonFile, "utf8")) as unknown }
    } catch (cause) {
      return fail(`--json-file is not valid JSON: ${(cause as Error).message}`)
    }
  } else body = { text: messageFrom(args) }
  const sender = topicSender(args)
  if (sender === null)
    log("sender identity absent: posting anonymously; pass --as to name the session")
  const entry = topicPost(name, sender ?? {}, opt(args, "kind") ?? null, body)
  out(
    flag(args, "json")
      ? JSON.stringify({ topic: entry.topic, seq: entry.seq, ts: entry.ts })
      : `posted ${name} #${entry.seq}`,
  )
  return 0
}

function tailTopic(args: Args, topic: string | undefined): number {
  const sinceRaw = opt(args, "since")
  const since = sinceRaw === undefined ? null : Number(sinceRaw)
  if (since !== null && (!Number.isInteger(since) || since < 0))
    return fail("--since must be zero or greater", 2)
  const limit = Number(opt(args, "limit") ?? TOPIC_TAIL_DEFAULT)
  if (!Number.isInteger(limit) || limit < 1 || limit > TOPIC_TAIL_MAX)
    return fail(`--limit must be between 1 and ${TOPIC_TAIL_MAX}`, 2)
  const result = topicTail(validateTopic(topic), since, limit)
  if (flag(args, "json")) {
    out(JSON.stringify(result))
    return 0
  }
  if (result.gap !== null) out(`gap: entries ${result.gap.from}..${result.gap.to} pruned`)
  for (const e of result.entries) {
    const who = e.from_name ?? e.from_sid ?? "anonymous"
    const body = "data" in e ? JSON.stringify(e.data) : (e.text ?? "")
    out(
      `#${e.seq} ${e.ts} ${printable(String(who))}${e.kind ? ` [${e.kind}]` : ""}: ${printable(body)}`,
    )
  }
  out(`next: --since ${result.next}`)
  return 0
}

export async function cmdTopic(args: Args): Promise<number> {
  const [sub, topic] = args.positional
  if (sub === "list") return listTopics(args)
  if (sub === "post") return postTopic(args, topic)
  if (sub === "tail") return tailTopic(args, topic)
  return fail("topic subcommands are `post`, `tail` and `list`", 2)
}
