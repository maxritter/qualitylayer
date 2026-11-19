import { type MemoryRepositoryApi, PERSONAL_PROJECT } from "../memory-contracts.ts"

const fingerprint = (value: unknown): value is string =>
  typeof value === "string" && /^[a-f0-9]{64}$/.test(value)

function selection({ revision, candidate, fingerprints }: Record<string, unknown>) {
  if (typeof revision !== "number" || !Number.isSafeInteger(revision) || revision < 1)
    throw new Error("The current lesson revision is required.")
  if (candidate !== "local" && !fingerprint(candidate))
    throw new Error("Choose one of the current lesson versions.")
  if (!Array.isArray(fingerprints) || fingerprints.length < 1 || fingerprints.length > 1000)
    throw new Error("The current repository versions are required.")
  if (!fingerprints.every(fingerprint) || new Set(fingerprints).size !== fingerprints.length)
    throw new Error("The current repository versions are required.")
  if (candidate !== "local" && !fingerprints.includes(candidate))
    throw new Error("Choose one of the current lesson versions.")
  return { revision, candidate, fingerprints }
}

function read(api: MemoryRepositoryApi, path: string[]) {
  const [project, action, id] = path
  if (project === "conflicts" && path.length === 1) return api.conflicts()
  if (!project || project === PERSONAL_PROJECT) return null
  if (path.length === 2 && action === "conflicts") return api.conflicts(project)
  if (action === "conflicts" && id && path.length === 3) return api.compare(project, id)
  return path.length === 2 && (action === "export" || action === "restore")
    ? api.preview(project, action)
    : null
}

async function write(
  api: MemoryRepositoryApi,
  path: string[],
  input: () => Promise<Record<string, unknown>>,
) {
  const [project, action, id] = path
  if (!project || project === PERSONAL_PROJECT) throw new Error("Choose a Git project.")
  if (action === "export" || action === "restore")
    return path.length === 2 ? api[action](project) : null
  return action === "conflicts" && id && path.length === 3
    ? api.reconcile(project, id, selection(await input()))
    : null
}

/** The enclosing memory handler owns paired-session authority and request-size limits. */
export async function repositoryReply(
  api: MemoryRepositoryApi,
  request: Request,
  path: string[],
  body: (request: Request) => Promise<Record<string, unknown>>,
  reply: (data: unknown) => Response,
): Promise<Response> {
  const data = await (request.method === "GET"
    ? read(api, path)
    : request.method === "POST"
      ? write(api, path, () => body(request))
      : null)
  return data ? reply(data) : new Response("Memory repository route not found.", { status: 404 })
}
