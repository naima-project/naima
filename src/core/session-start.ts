// What makes an agent run naima hello at the start of every session: for
// every tool, the pointer line in an entry file, which says so; and for each
// tool the project uses that has a session-start hook, the hook, installed
// by the tool's adapter (adapters/). `naima init` installs both, `naima
// update` adds what an older project lacks and says so, and `naima check`
// notes what is missing (features/naima-hello-runs-at-start-every-agent).

import { existsSync } from "node:fs"
import { dirname, join } from "node:path"
import { adapter, ADAPTERS, type AgentAdapter } from "./adapters/index.ts"
import { posixRelative } from "./config.ts"
import { PROGRAM_DIR } from "./layout.ts"
import { agentPointer, AGENTS_FILE, upgradePointer, writePointer } from "./pointer.ts"

/** The part of naima.json this reads: the entry files, and the agent tools the project names, if it names them. */
export interface SessionConfig {
  entryFiles: readonly string[]
  agents?: readonly string[]
}

/** The tools the project uses: those naima.json's `agents` names; absent it, those whose files the project holds. */
export function adaptersInUse(root: string, agents: readonly string[] | undefined): AgentAdapter[] {
  if (agents) return agents.map(adapter).filter((a): a is AgentAdapter => a !== undefined)
  return ADAPTERS.filter((a) => a.footprint.some((f) => existsSync(join(root, f))))
}

/** The program's launcher, from the project root, as a hook names it. */
const programPath = (root: string, tracker: string): string => posixRelative(root, join(tracker, PROGRAM_DIR, "naima.ts"))

/** What is missing for naima hello to run at every session start, each said with what adds it. */
export function sessionStartGaps(root: string, tracker: string, config: SessionConfig): string[] {
  const out: string[] = []
  const p = agentPointer(root, tracker, config.entryFiles)
  if (!p.present) out.push(`no entry file tells agents to run naima hello at the start of a session: naima update writes the line into ${p.file}`)
  else if (!p.current) {
    out.push(
      `${p.file}'s pointer to Naima is out of date: the line says where Naima is and to run naima hello at the start of a session — naima update rewrites it`,
    )
  }
  for (const a of adaptersInUse(root, config.agents)) {
    const hook = a.sessionStart
    if (hook && !hook.installed(root)) {
      out.push(`${a.name} is used here, and its session-start hook, which runs naima hello, is missing from ${hook.file}: naima update installs it`)
    }
  }
  return out
}

/**
 * Add what is missing: the pointer line (or rewrite an earlier one), and with `hooks` each session-start hook
 * of a tool in use. Returns the lines that say what was done, and the files written, project-root relative.
 */
export function startSessions(root: string, tracker: string, config: SessionConfig, opts: { hooks: boolean }): { said: string[]; wrote: string[] } {
  const said: string[] = []
  const wrote: string[] = []
  const p = agentPointer(root, tracker, config.entryFiles)
  if (!p.present) {
    writePointer(root, tracker, p.file)
    said.push(`wrote ${p.file}: ${p.line}`)
    wrote.push(p.file)
  } else if (!p.current && upgradePointer(root, tracker, p.file)) {
    said.push(`rewrote the pointer in ${p.file}: ${p.line}`)
    wrote.push(p.file)
  } else if (!p.current) {
    writePointer(root, tracker, p.file) // an earlier pointer that only links the docs: the line goes beside it
    said.push(`wrote ${p.file}: ${p.line}`)
    wrote.push(p.file)
  }
  if (!opts.hooks) return { said, wrote }
  for (const a of adaptersInUse(root, config.agents)) {
    const hook = a.sessionStart
    if (!hook) continue
    const r = hook.install(root, programPath(root, tracker))
    if (r.done === "written") {
      said.push(`installed ${a.name}'s session-start hook in ${hook.file}: it runs naima hello at the start of every session`)
      wrote.push(hook.file)
    } else if (r.done === "refused") said.push(`not written, ${r.why} — add ${a.name}'s session-start hook to ${hook.file} by hand: ${r.add}`)
  }
  return { said, wrote: [...new Set(wrote)] }
}

/** The files `startSessions` may write, absolute: what the launcher lets init and update write outside the tracker folder. */
export function sessionStartPaths(root: string, config: SessionConfig, opts: { hooks: boolean }): string[] {
  const out = [...new Set([AGENTS_FILE, ...config.entryFiles])].map((f) => join(root, f))
  if (!opts.hooks) return out
  for (const a of adaptersInUse(root, config.agents)) {
    if (!a.sessionStart) continue
    const file = join(root, a.sessionStart.file)
    out.push(file)
    if (!existsSync(dirname(file))) out.push(dirname(file)) // a folder to create: Deno asks write access to it
  }
  return out
}
