import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { isAbsolute, join, resolve } from "node:path"
import { nativeIntegrationFiles } from "../install/native-integrations.ts"

/**
 * A config with its `{file:}` references made absolute against the folder it was read from, as a
 * copy in another folder needs. An absolute path and a `~` path stay as they are.
 */
export function rebaseFileReferences(value: unknown, personal: string): unknown {
  if (typeof value === "string")
    return value.replace(/\{file:([^}]+)\}/g, (_all, path: string) =>
      path.startsWith("~") || isAbsolute(path)
        ? `{file:${path}}`
        : `{file:${resolve(personal, path)}}`,
    )
  if (Array.isArray(value)) return value.map((item) => rebaseFileReferences(item, personal))
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, rebaseFileReferences(item, personal)]),
    )
  return value
}

/** OpenCode 2 reads a config directory; its former inline-config variable is ignored. */
export function opencodeReviewEnvironment(
  env: NodeJS.ProcessEnv,
  root: string,
  binary: string,
): { env: NodeJS.ProcessEnv; close(): void } {
  mkdirSync(root, { recursive: true, mode: 0o700 })
  const temporary = mkdtempSync(join(root, "opencode-review-"))
  const directory = join(temporary, "config")
  mkdirSync(directory, { mode: 0o700 })
  try {
    const home = env.HOME || env.USERPROFILE || ""
    const configRoot = env.XDG_CONFIG_HOME || join(home, ".config")
    const personal = env.OPENCODE_CONFIG_DIR || join(configRoot, "opencode")
    let config: Record<string, unknown> = {}
    for (const name of ["opencode.json", "opencode.jsonc"]) {
      const path = join(personal, name)
      if (!existsSync(path)) continue
      const parsed = Bun.JSONC.parse(readFileSync(path, "utf8"))
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
        throw new Error("OpenCode reviewer configuration must be an object")
      config = { ...config, ...parsed }
    }
    config = rebaseFileReferences(config, personal) as Record<string, unknown>
    const plugins = nativeIntegrationFiles(binary, {
      agent: "opencode",
      label: "OpenCode",
      skills: join(directory, "skills"),
    }).filter((file) => file.path.includes(`${join("plugins", "qualitylayer")}`))
    if (!plugins.length) throw new Error("OpenCode reviewer integration is unavailable")
    mkdirSync(join(directory, "plugins", "qualitylayer"), { recursive: true, mode: 0o700 })
    for (const plugin of plugins) writeFileSync(plugin.path, plugin.text, { mode: 0o600 })
    config.permissions = [
      { action: "*", resource: "*", effect: "deny" },
      ...["read", "glob", "grep", "list", "webfetch", "websearch", "external_directory"].map(
        (action) => ({ action, resource: "*", effect: "allow" }),
      ),
    ]
    writeFileSync(join(directory, "opencode.json"), `${JSON.stringify(config)}\n`, { mode: 0o600 })
    // A reviewer started from an App session keeps its own plugin copy: the launch's variable would
    // silence it, and the review is not that session's.
    const { QUALITYLAYER_SESSION_HOOKS: _hooks, ...rest } = env
    return {
      env: { ...rest, OPENCODE_CONFIG_DIR: directory, QUALITYLAYER_REVIEW_READ_ONLY: "1" },
      close: () => rmSync(temporary, { recursive: true, force: true }),
    }
  } catch (cause) {
    rmSync(temporary, { recursive: true, force: true })
    throw cause
  }
}
