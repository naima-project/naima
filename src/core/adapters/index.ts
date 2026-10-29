// The agent tools Naima knows, one adapter each: the only place in the
// product that names a tool. Naima itself is a CLI over files and git, and
// works with any agent that can run a command; an adapter holds what one
// tool reads by itself — its always-on entry file, the files that show a
// project uses it — and, for a tool with a session-start hook, the installer
// of the hook that runs naima hello when a session starts
// (features/naima-hello-runs-at-start-every-agent), and of the turn-end hook
// that runs the tick when an agent ends its turn, so what Naima has for the
// owner is said even in a session that runs no naima command for hours. A tool
// with no hook is told by the pointer line in its entry file instead
// (pointer.ts), and sees the tick's messages in the output of the naima
// commands it runs.

import { claudeCode } from "./claude-code.ts"

/** What an install of a hook did: written, an older form brought up to date, there already, or not written and why, with what to add by hand. */
export type HookInstall = { done: "written" | "updated" | "present" } | { done: "refused"; why: string; add: string }

/** One of a tool's hooks that runs Naima: at a session start, naima hello; at the end of a turn, the tick. */
export interface AgentHook {
  /** The settings file the hook lives in, project-root relative. */
  file: string
  /** What it is, in a few words: "session-start hook". */
  kind: string
  /** What it does for the owner, said once it is installed. */
  why: string
  /** The hook's command, for the launcher at `program` (project-root relative, forward slashes). */
  command(program: string): string
  /** Whether the settings file holds the hook in its current form. */
  installed(root: string): boolean
  /** Add the hook, or bring an older form of it up to date, keeping everything else the file holds; never twice. */
  install(root: string, program: string): HookInstall
}

/** A hook a plugin contributes, as the adapter writes it: its id (`<plugin>/<name>`), event, matcher and the naima command's words. */
export interface PluginHook {
  id: string
  event: string
  matcher?: string
  command: string[]
}

/** What a sync of the plugins' hooks did, each hook by id; or why the settings could not be written. */
export type PluginHookSync = { added: string[]; updated: string[]; removed: string[] } | { refused: string }

/** Where and how a tool keeps the hooks plugins contribute, told apart from Naima's own hooks and the project's. */
export interface PluginHookSettings {
  /** The settings file, project-root relative. */
  file: string
  /** The hooks plugins installed there, by id, each with its event, its matcher and the command line written. */
  installed(root: string): { id: string; event: string; matcher?: string; line: string }[]
  /** The command line `hook` is written with, for the launcher at `program`. */
  line(hook: PluginHook, program: string): string
  /** Make the plugins' hooks in the file exactly `wanted`, for the launcher at `program`: add, update in place, remove the rest; the project's own hooks and Naima's are kept. */
  sync(root: string, program: string, wanted: readonly PluginHook[]): PluginHookSync
}

export interface AgentAdapter {
  /** How naima.json's `agents` names the tool. */
  id: string
  /** The tool's own name, as its users know it. */
  name: string
  /** The always-on file the tool reads, project-root relative. */
  entryFile: string
  /** Paths, project-root relative, whose presence shows the project uses the tool. */
  footprint: readonly string[]
  /** Whether a command runs inside the tool, told by the environment the tool gives the commands it runs. */
  runningIn?(env: Record<string, string | undefined>): boolean
  /** The variables `runningIn` reads: the launcher hands them to the program, which sees no others but its own list. */
  env?: readonly string[]
  /** Its session-start hook, when the tool has one: it runs naima hello. */
  sessionStart?: AgentHook
  /** Its turn-end hook, when the tool has one: it runs the tick, cheaply, and has the agent tell the owner what is due. */
  turnEnd?: AgentHook
  /**
   * Its hooks on sub-agents, when the tool has them (subagents.ts): as one starts, the project's rules are put in its
   * context; before each of its tool calls, one that acts is held until it has the rules; as it stops, one that never
   * had them is sent back to read them and say so.
   */
  subagentStart?: AgentHook
  subagentTool?: AgentHook
  subagentStop?: AgentHook
  /** Where the hooks plugins contribute go, when the tool has hooks (core/plugin-hooks.ts). */
  pluginHooks?: PluginHookSettings
  /** What naima subagent --hook prints for the tool: `context`, put in the starting sub-agent's context. */
  subagentContext?(context: string): string
  /** The sub-agent's id, from what its sub-agent-start hook is given on standard input. */
  agentOf?(hookInput: string): string | undefined
  /** What naima hello --hook prints for the tool: `shown` for the owner to see directly, `context` for the agent. */
  greeting?(shown: string, context: string): string
  /** The tool's own session id, from what its session-start hook is given on standard input: what naima hello --hook records as the session. */
  sessionOf?(hookInput: string): string | undefined
  /** What naima tick --hook prints for the tool when the owner has to be told something: `reason`, for the agent. */
  stopFor?(reason: string): string
}

/** The tools, in the order their entry files are checked after AGENTS.md. */
export const ADAPTERS: readonly AgentAdapter[] = [
  claudeCode,
  { id: "cursor", name: "Cursor", entryFile: ".cursorrules", footprint: [".cursorrules", ".cursor"] },
  { id: "copilot", name: "GitHub Copilot", entryFile: ".github/copilot-instructions.md", footprint: [".github/copilot-instructions.md"] },
  { id: "gemini-cli", name: "Gemini CLI", entryFile: "GEMINI.md", footprint: ["GEMINI.md", ".gemini"] },
]

/** The adapter naima.json's `agents` names by `id`. */
export const adapter = (id: string): AgentAdapter | undefined => ADAPTERS.find((a) => a.id === id)

/**
 * The files outside the tracker folder that Naima's setup writes in a project, project-root relative: AGENTS.md, each
 * tool's entry file, and the settings files its hooks live in. A commit Naima's setup asks for on the trunk touches
 * only these and the tracker folder (git.ts, SETUP_TRAILER).
 */
export function setupPaths(): Set<string> {
  const paths = new Set<string>(["AGENTS.md"])
  for (const a of ADAPTERS) {
    paths.add(a.entryFile)
    for (const hook of [a.sessionStart, a.turnEnd, a.subagentStart, a.subagentTool, a.subagentStop]) if (hook) paths.add(hook.file)
    if (a.pluginHooks) paths.add(a.pluginHooks.file)
  }
  return paths
}
