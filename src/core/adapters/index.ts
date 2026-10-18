// The agent tools Naima knows, one adapter each: the only place in the
// product that names a tool. Naima itself is a CLI over files and git, and
// works with any agent that can run a command; an adapter holds what one
// tool reads by itself — its always-on entry file, the files that show a
// project uses it — and, for a tool with a session-start hook, the installer
// of the hook that runs naima hello when a session starts
// (features/naima-hello-runs-at-start-every-agent). A tool with no hook is
// told by the pointer line in its entry file instead (pointer.ts).

import { claudeCode } from "./claude-code.ts"

/** What an install of a session-start hook did: written, there already, or not written and why, with what to add by hand. */
export type HookInstall = { done: "written" | "present" } | { done: "refused"; why: string; add: string }

/** A tool's session-start hook that runs naima hello. */
export interface SessionStartHook {
  /** The settings file the hook lives in, project-root relative. */
  file: string
  /** The hook's command, for the launcher at `program` (project-root relative, forward slashes). */
  command(program: string): string
  /** Whether the settings file already runs naima hello at a session start. */
  installed(root: string): boolean
  /** Add the hook, keeping everything else the file holds; never twice. */
  install(root: string, program: string): HookInstall
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
  /** Its session-start hook, when the tool has one. */
  sessionStart?: SessionStartHook
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
