// Claude Code's adapter. Its always-on file is CLAUDE.md, and its project
// settings, .claude/settings.json, hold hooks by event. Two are Naima's:
//
//   SessionStart  runs naima hello --hook claude-code, which prints JSON: the
//                 greeting as a systemMessage, which the owner sees directly,
//                 and, as additionalContext, what the agent is to say first.
//   Stop          at the end of every agent turn, a shell script beside this
//                 file (claude-code-stop.sh) reads the tick's wake files and,
//                 only when something can be due, runs naima tick --hook
//                 claude-code, which blocks the stop with what the agent must
//                 tell or ask the owner. It never blocks twice in a row: a
//                 stop the hook already continued (stop_hook_active) passes.
//   SubagentStart runs naima subagent --hook claude-code, which puts the
//                 project's rules for agents in the sub-agent's context and
//                 leaves a mark, by the sub-agent's id, that it has them.
//   PreToolUse    on Bash and the tools that write files, a second script
//                 (claude-code-subagent.sh tool) holds a sub-agent's call
//                 until it has the rules: given as it started, or read by a
//                 naima rules command, which the script marks as it passes.
//                 A call of the main session passes at once, with no Deno.
//   SubagentStop  the same script (stop) sends a sub-agent that never had
//                 the rules back once, to read them, check its work against
//                 them and say so in its report, and logs it.
//
// The settings are the project's own: the hooks are added to whatever they
// hold, never over it, and an older form of Naima's own is brought up to
// date in place. The format is the one Claude Code's hooks documentation gives:
//   { "hooks": { "<Event>": [ { "matcher"?, "hooks": [ { "type": "command", "command": "…" } ] } ] } }
// With no matcher, the hook runs on every occasion of its event.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import type { AgentAdapter, AgentHook, HookInstall } from "./index.ts"

const SETTINGS = ".claude/settings.json"
const ID = "claude-code"
/** The turn-end script, from the program's root. */
export const STOP_SCRIPT = "src/core/adapters/claude-code-stop.sh"
/** The sub-agent script, from the program's root. */
export const SUBAGENT_SCRIPT = "src/core/adapters/claude-code-subagent.sh"
/** The tools a sub-agent's call is held on until it has the rules: the shell, and every tool that writes a file. */
export const HELD_TOOLS = "Bash|Write|Edit|MultiEdit|NotebookEdit"

type Json = Record<string, unknown>
const isObject = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v)

/** The program's folder, from the launcher's path: what the turn-end script is found under. */
const programDir = (program: string): string => program.replace(/\/?naima\.ts$/, "") || "."

const helloCommand = (program: string): string => `deno run -A "$CLAUDE_PROJECT_DIR/${program}" hello --hook ${ID}`
const stopCommand = (program: string): string => `f="$CLAUDE_PROJECT_DIR/${programDir(program)}/${STOP_SCRIPT}"; [ ! -f "$f" ] || sh "$f"`
const subagentCommand = (program: string): string => `deno run -A "$CLAUDE_PROJECT_DIR/${program}" subagent --hook ${ID}`
const subagentScript = (mode: string) => (program: string): string =>
  `f="$CLAUDE_PROJECT_DIR/${programDir(program)}/${SUBAGENT_SCRIPT}"; [ ! -f "$f" ] || sh "$f" ${mode}`

/** The commands of an event's entries. */
const commandsOf = (entry: unknown): string[] =>
  isObject(entry) && Array.isArray(entry["hooks"]) ? entry["hooks"].flatMap((h) => (isObject(h) && typeof h["command"] === "string" ? [h["command"]] : [])) : []

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

/** One of Naima's hooks: the event it is under, its command, and how its current and older forms are told apart. */
function hook(
  event: string,
  kind: string,
  why: string,
  command: (program: string) => string,
  ours: (command: string) => boolean,
  current: (command: string) => boolean,
  matcher?: string,
): AgentHook {
  const entries = (root: string): unknown[] | null => {
    const r = read(join(root, SETTINGS))
    if (!("settings" in r)) return null
    const hooks = r.settings["hooks"]
    const list = isObject(hooks) ? hooks[event] : undefined
    return Array.isArray(list) ? list : []
  }
  const installed = (root: string): boolean =>
    (entries(root) ?? []).some((e) => commandsOf(e).some(current) && (matcher === undefined || (isObject(e) && e["matcher"] === matcher)))
  function install(root: string, program: string): HookInstall {
    const path = join(root, SETTINGS)
    const entry = { ...(matcher !== undefined ? { matcher } : {}), hooks: [{ type: "command", command: command(program) }] }
    const add = `"hooks": { "${event}": [ ${JSON.stringify(entry)} ] }`
    const r = read(path)
    if (!("settings" in r)) return { done: "refused", why: r.why, add }
    if (installed(root)) return { done: "present" }
    const hooks = r.settings["hooks"] ?? {}
    if (!isObject(hooks)) return { done: "refused", why: "its hooks are not an object", add }
    const list = hooks[event] ?? []
    if (!Array.isArray(list)) return { done: "refused", why: `its hooks.${event} is not a list`, add }
    // An older form of this hook is replaced where it stands; the project's own hooks are kept as they are.
    const at = list.findIndex((e) => commandsOf(e).some(ours))
    const next = at === -1 ? [...list, entry] : list.map((e, i) => (i === at ? entry : e)).filter((e, i) => i <= at || !commandsOf(e).some(ours))
    const settings = { ...r.settings, hooks: { ...hooks, [event]: next } }
    // Only a missing folder is made: Deno asks write access to the folder for mkdir even when it exists, and the fence names the file alone.
    if (!existsSync(dirname(path))) mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, JSON.stringify(settings, null, 2) + "\n")
    return { done: at === -1 ? "written" : "updated" }
  }
  return { file: SETTINGS, kind, why, command, installed, install }
}

const sessionStart = hook(
  "SessionStart",
  "session-start hook",
  "every new conversation starts by running naima hello, and you see its greeting directly: which Naima is active, whether a newer one exists, what waits on your decision",
  helloCommand,
  (c) => c.includes("naima.ts") && /\shello(\s+--hook\s+\S+)?\s*$/.test(c),
  (c) => c.includes("naima.ts") && c.trimEnd().endsWith(` hello --hook ${ID}`),
)

const turnEnd = hook(
  "Stop",
  "turn-end hook",
  "at the end of each agent turn, when Naima has something for you — a newer Naima, a long run that is due, an urgent message — the agent is told to say it; otherwise it costs nothing",
  stopCommand,
  (c) => c.includes("claude-code-stop.sh"),
  (c) => c.includes(STOP_SCRIPT),
)

const subagentStart = hook(
  "SubagentStart",
  "sub-agent-start hook",
  "every sub-agent the agent starts is given the project's rules as it starts, so a worker obeys them without depending on its brief",
  subagentCommand,
  (c) => c.includes("naima.ts") && /\ssubagent(\s+--hook\s+\S+)?\s*$/.test(c),
  (c) => c.includes("naima.ts") && c.trimEnd().endsWith(` subagent --hook ${ID}`),
)

const subagentTool = hook(
  "PreToolUse",
  "sub-agent rules guard",
  "a sub-agent that has not had the project's rules cannot run a command or write a file until it reads them (naima rules)",
  subagentScript("tool"),
  (c) => c.includes("claude-code-subagent.sh") && /\stool\s*$/.test(c),
  (c) => c.includes(SUBAGENT_SCRIPT) && c.trimEnd().endsWith(" tool"),
  HELD_TOOLS,
)

const subagentStop = hook(
  "SubagentStop",
  "sub-agent-stop hook",
  "a sub-agent that ends without ever having had the project's rules is sent back once to read them, check its work against them and say so in its report",
  subagentScript("stop"),
  (c) => c.includes("claude-code-subagent.sh") && /\sstop\s*$/.test(c),
  (c) => c.includes(SUBAGENT_SCRIPT) && c.trimEnd().endsWith(" stop"),
)

const parsed = (input: string): Json | undefined => {
  try {
    const v: unknown = JSON.parse(input)
    return isObject(v) ? v : undefined
  } catch {
    return undefined
  }
}

export const claudeCode: AgentAdapter = {
  id: ID,
  name: "Claude Code",
  entryFile: "CLAUDE.md",
  footprint: ["CLAUDE.md", ".claude"],
  runningIn: (env) => env["CLAUDECODE"] === "1",
  env: ["CLAUDECODE"],
  sessionStart,
  turnEnd,
  subagentStart,
  subagentTool,
  subagentStop,
  sessionOf: (input) => {
    const v = parsed(input)?.["session_id"]
    return typeof v === "string" ? v : undefined
  },
  agentOf: (input) => {
    const v = parsed(input)?.["agent_id"]
    return typeof v === "string" ? v : undefined
  },
  subagentContext: (context) => JSON.stringify({ hookSpecificOutput: { hookEventName: "SubagentStart", additionalContext: context } }),
  greeting: (shown, context) => JSON.stringify({ systemMessage: shown, hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: context } }),
  stopFor: (reason) => JSON.stringify({ decision: "block", reason }),
}
