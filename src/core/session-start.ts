// What makes an agent run naima hello at the start of every session: for
// every tool, the pointer line in an entry file, which says so; and for each
// tool the project uses that has a session-start hook, the hook, installed
// by the tool's adapter (adapters/), and its turn-end hook, which runs the
// tick when the agent ends a turn, where the tool has one. `naima init` installs both, `naima
// update` adds what an older project lacks and says so, and `naima check`
// notes what is missing (features/naima-hello-runs-at-start-every-agent).
// Each write is said in one plain sentence: what was installed, and why.
// A write the permissions the program runs with do not grant is not
// attempted: an update launched by an older launcher, whose fence predates
// these files, leaves them to the next run, under the newer launcher.

import { existsSync } from "node:fs"
import { dirname, join } from "node:path"
import { adapter, ADAPTERS, type AgentAdapter, type AgentHook } from "./adapters/index.ts"
import { posixRelative } from "./config.ts"
import { mayWrite } from "./files.ts"
import { runGit } from "./git.ts"
import { trackerGitOf } from "./repos.ts"
import { DATA_FILE, PROGRAM_DIR, trackerOf } from "./layout.ts"
import { short } from "./program.ts"
import { agentPointer, AGENTS_FILE, upgradePointer, writePointer } from "./pointer.ts"

/** The part of naima.json this reads: the entry files, and the agent tools the project names, if it names them. */
export interface SessionConfig {
  entryFiles: readonly string[]
  agents?: readonly string[]
}

/**
 * The tools the project uses: those naima.json's `agents` names; absent it, those whose files the project holds,
 * and the tool Naima is running inside now, which a fresh project shows no file of yet.
 */
export function adaptersInUse(
  root: string,
  agents: readonly string[] | undefined,
  env: Record<string, string | undefined> = process.env,
): AgentAdapter[] {
  if (agents) return agents.map(adapter).filter((a): a is AgentAdapter => a !== undefined)
  return ADAPTERS.filter((a) => a.footprint.some((f) => existsSync(join(root, f))) || a.runningIn?.(env) === true)
}

/** A tool's hooks that run Naima: its session-start hook, its turn-end hook, then its hooks on sub-agents, those it has. */
export const hooksOf = (a: AgentAdapter): AgentHook[] =>
  [a.sessionStart, a.turnEnd, a.subagentStart, a.subagentTool, a.subagentStop].filter((h): h is AgentHook => h !== undefined)

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
    for (const hook of hooksOf(a)) {
      if (!hook.installed(root)) out.push(`${a.name} is used here, and its ${hook.kind} is missing from ${hook.file}, or out of date: naima update installs it`)
    }
  }
  return out
}

/** The pointer line, as what is left to write. */
const pointerPart = (file: string): string => `the line in ${file} that tells agents to run naima hello`

/** A tool's session-start hook, as what is left to install. */
const hookPart = (a: AgentAdapter, hook: AgentHook): string => `${a.name}'s ${hook.kind} in ${hook.file}`

/** Why the pointer line is there, said after what was written. */
const POINTER_WHY = "it tells every agent where Naima is and to run naima hello at the start of a session, so each session starts knowing which Naima is active"

/**
 * Add what is missing: the pointer line (or rewrite an earlier one), and with `hooks` each session-start hook
 * of a tool in use. Returns one plain sentence for each thing written, the files written (project-root
 * relative), and what was left because this run may not write it.
 */
export function startSessions(
  root: string,
  tracker: string,
  config: SessionConfig,
  opts: { hooks: boolean },
): { said: string[]; wrote: string[]; left: string[] } {
  const said: string[] = []
  const wrote: string[] = []
  const left: string[] = []
  const p = agentPointer(root, tracker, config.entryFiles)
  if (!p.current && !mayWrite(join(root, p.file))) left.push(pointerPart(p.file))
  else if (!p.present) {
    writePointer(root, tracker, p.file)
    said.push(`Added a line to ${p.file}: ${POINTER_WHY}.`)
    wrote.push(p.file)
  } else if (!p.current && upgradePointer(root, tracker, p.file)) {
    said.push(`Rewrote the out-of-date Naima line in ${p.file}: ${POINTER_WHY}.`)
    wrote.push(p.file)
  } else if (!p.current) {
    writePointer(root, tracker, p.file) // an earlier pointer that only links the docs: the line goes beside it
    said.push(`Added a line to ${p.file}: ${POINTER_WHY}.`)
    wrote.push(p.file)
  }
  if (!opts.hooks) return { said, wrote, left }
  for (const a of adaptersInUse(root, config.agents)) {
    for (const hook of hooksOf(a)) {
      if (!hook.installed(root) && !mayWrite(join(root, hook.file))) {
        left.push(hookPart(a, hook))
        continue
      }
      const r = hook.install(root, programPath(root, tracker))
      if (r.done === "written") said.push(`Installed a ${a.name} ${hook.kind} in ${hook.file}: ${hook.why}.`)
      else if (r.done === "updated") said.push(`Brought the ${a.name} ${hook.kind} in ${hook.file} up to date: ${hook.why}.`)
      else if (r.done === "refused") said.push(`not written, ${r.why} — add ${a.name}'s ${hook.kind} to ${hook.file} by hand: ${r.add}`)
      if (r.done === "written" || r.done === "updated") wrote.push(hook.file)
    }
  }
  return { said, wrote: [...new Set(wrote)], left }
}

/** What the session start lacks, each as what naima update writes: the pointer line, and each missing hook of a tool in use. */
export function sessionStartLeft(root: string, tracker: string, config: SessionConfig): string[] {
  const out: string[] = []
  const p = agentPointer(root, tracker, config.entryFiles)
  if (!p.current) out.push(pointerPart(p.file))
  for (const a of adaptersInUse(root, config.agents)) {
    for (const hook of hooksOf(a)) if (!hook.installed(root)) out.push(hookPart(a, hook))
  }
  return out
}

/** The lock naima.json holds in the project's last commit; null when it holds none. */
export function committedLock(root: string, data: string): string | null {
  const repo = trackerGitOf(root, data)
  const r = runGit(repo, ["show", `HEAD:${posixRelative(repo, join(data, DATA_FILE))}`])
  if (!r.ok) return null
  try {
    const commit = (JSON.parse(r.out) as { commit?: unknown }).commit
    return typeof commit === "string" ? commit : null
  } catch {
    return null
  }
}

/** What an update has still to do, said in one line: the move to `commit`, not yet committed, and `left` not yet written. */
export const unfinishedLine = (commit: string, left: readonly string[]): string =>
  `the update to ${short(commit)} is unfinished: run naima update once more to finish: ${left.join(" and ")}`

/**
 * An update that moved the lock to `lock` and left part of the session start unwritten, as `unfinishedLine` says
 * it: the lock is not yet the one the project's last commit holds, and something is missing. Null otherwise.
 */
export function unfinishedUpdate(root: string, data: string, lock: string, config: SessionConfig): string | null {
  const left = sessionStartLeft(root, trackerOf(data), config)
  if (!left.length) return null
  const committed = committedLock(root, data)
  return committed !== null && committed !== lock ? unfinishedLine(lock, left) : null
}

/** The files `startSessions` may write, absolute: what the launcher lets init and update write outside the tracker folder. */
export function sessionStartPaths(root: string, config: SessionConfig, opts: { hooks: boolean }): string[] {
  const out = [...new Set([AGENTS_FILE, ...config.entryFiles])].map((f) => join(root, f))
  if (!opts.hooks) return out
  for (const a of adaptersInUse(root, config.agents)) {
    for (const hook of hooksOf(a)) {
      const file = join(root, hook.file)
      out.push(file)
      if (!existsSync(dirname(file))) out.push(dirname(file)) // a folder to create: Deno asks write access to it
    }
  }
  return [...new Set(out)]
}
