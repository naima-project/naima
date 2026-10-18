// Claude Code's adapter. Its always-on file is CLAUDE.md, and its project
// settings, .claude/settings.json, hold hooks by event: a SessionStart hook's
// plain-text output is added to the conversation as context, so the agent
// starts every session having read naima hello. The settings are the
// project's own: the hook is added to whatever they hold, never over it.
// The format is the one Claude Code's hooks documentation gives:
//   { "hooks": { "SessionStart": [ { "matcher"?, "hooks": [ { "type": "command", "command": "…" } ] } ] } }
// With no matcher, the hook runs on every start: a new session, a resumed
// one, after a clear and after a compaction.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import type { AgentAdapter, HookInstall } from "./index.ts"

const SETTINGS = ".claude/settings.json"

type Json = Record<string, unknown>
const isObject = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v)

/** The command: the project's launcher, from the project directory Claude Code names, saying hello. */
const command = (program: string): string => `deno run -A "$CLAUDE_PROJECT_DIR/${program}" hello`

/** A hook entry of SessionStart that runs naima hello, whatever its matcher and wherever the program is. */
const saysHello = (entry: unknown): boolean =>
  isObject(entry) && Array.isArray(entry["hooks"]) &&
  entry["hooks"].some((h) => isObject(h) && typeof h["command"] === "string" && h["command"].includes("naima.ts") && /\shello\s*$/.test(h["command"]))

/** The settings as an object, or why they are not one. */
function read(path: string): { settings: Json } | { why: string } {
  if (!existsSync(path)) return { settings: {} }
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, "utf8"))
    return isObject(parsed) ? { settings: parsed } : { why: "it is not a JSON object" }
  } catch {
    return { why: "it is not plain JSON" }
  }
}

function installed(root: string): boolean {
  const r = read(join(root, SETTINGS))
  if (!("settings" in r)) return false
  const hooks = r.settings["hooks"]
  const start = isObject(hooks) ? hooks["SessionStart"] : undefined
  return Array.isArray(start) && start.some(saysHello)
}

function install(root: string, program: string): HookInstall {
  const path = join(root, SETTINGS)
  const entry = { hooks: [{ type: "command", command: command(program) }] }
  const add = `"hooks": { "SessionStart": [ ${JSON.stringify(entry)} ] }`
  const r = read(path)
  if (!("settings" in r)) return { done: "refused", why: r.why, add }
  if (installed(root)) return { done: "present" }
  const hooks = r.settings["hooks"] ?? {}
  if (!isObject(hooks)) return { done: "refused", why: "its hooks are not an object", add }
  const start = hooks["SessionStart"] ?? []
  if (!Array.isArray(start)) return { done: "refused", why: "its hooks.SessionStart is not a list", add }
  const settings = { ...r.settings, hooks: { ...hooks, SessionStart: [...start, entry] } }
  // Only a missing folder is made: Deno asks write access to the folder for mkdir even when it exists, and the fence names the file alone.
  if (!existsSync(dirname(path))) mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(settings, null, 2) + "\n")
  return { done: "written" }
}

export const claudeCode: AgentAdapter = {
  id: "claude-code",
  name: "Claude Code",
  entryFile: "CLAUDE.md",
  footprint: ["CLAUDE.md", ".claude"],
  sessionStart: { file: SETTINGS, command, installed, install },
}
