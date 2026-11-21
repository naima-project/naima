// The people of a project. Several people may own a project together, so every
// change to an item records which person ordered it, and what waits on a person
// says whom.
//
// The person at the keyboard is NAIMA_PERSON when set, else git's user.name
// (with user.email). A command's `--by <name>` names someone else; `--by agent`
// marks an agent's own change, with no person behind it.
//
// Each write of an item appends one line to the item's history, `history.jsonl`
// beside its meta.json: when, who ordered it, the agent that made it when one
// did, what changed and through which command. The tracker's .gitattributes
// merges that file by union, so two branches that both append to it never
// conflict. A tracker commit Naima makes itself carries an `Ordered-by:` trailer.

import { appendFileSync, existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { writeFileAtomic } from "./files.ts"
import { gitOrNull, isGitRepo } from "./git.ts"
import { filerRole, type Role } from "./origin.ts"
import type { Context, FieldDef, Item, Write, WriteHook } from "./types.ts"

/** The file of an item's history: one JSON line per change. */
export const HISTORY = "history.jsonl"

/** What `--by` says for an agent's own change, with no person behind it. */
export const AGENT_OWN = "agent"

/** The line of the tracker's .gitattributes that merges every item's history by union. */
export const HISTORY_ATTRIBUTE = `**/${HISTORY} merge=union`

export interface Person {
  name: string
  email?: string
}

/** The person at the keyboard: NAIMA_PERSON, else git's user.name and user.email; null when neither says. */
export function personAtKeyboard(root: string): Person | null {
  const env = process.env["NAIMA_PERSON"]?.trim()
  if (env) return { name: env }
  if (!isGitRepo(root)) return null
  const name = gitOrNull(root, "config", "user.name")?.trim()
  if (!name) return null
  const email = gitOrNull(root, "config", "user.email")?.trim()
  return { name, ...(email ? { email } : {}) }
}

/** Who ordered what this command writes: `--by`, else the person at the keyboard; `agent` for an agent's own change. */
export function orderedBy(ctx: Context): string | undefined {
  return ctx.orderedBy?.trim() || personAtKeyboard(ctx.root)?.name
}

/** The person who ordered this command's writes, or undefined for an agent's own change or when nobody is known. */
export function orderingPerson(ctx: Context): string | undefined {
  const by = orderedBy(ctx)
  return by && by !== AGENT_OWN ? by : undefined
}

/**
 * The value of `--by` in a command's arguments, and the arguments to pass on: as given when the command declares
 * `--by` itself (naima new, naima note), which then reads it too; without it otherwise.
 */
export function byOption(args: readonly string[], keep: boolean): { by?: string; rest: string[] } {
  const rest: string[] = []
  let by: string | undefined
  for (let i = 0; i < args.length; i++) {
    const a = args[i] as string
    if (a === "--") {
      rest.push(...args.slice(i))
      break
    }
    if (a === "--by" || a.startsWith("--by=")) {
      const v = a === "--by" ? args[i + 1] : a.slice(5)
      if (v?.trim()) by = v.trim()
      if (keep) rest.push(...(a === "--by" ? args.slice(i, i + 2) : [a]))
      if (a === "--by") i++
      continue
    }
    rest.push(a)
  }
  return { ...(by ? { by } : {}), rest }
}

/** One change of an item, as its history holds it. */
export interface Order {
  /** The instant, ISO 8601. */
  on: string
  /** The person who ordered it; absent for an agent's own change. */
  by?: string
  /** The agent that made it, when an agent did: coordinator, worker or agent. */
  agent?: Role
  /** What changed, in a few words: filed, status fixed, set gate, note, described, moved to closed. */
  what: string
  /** The naima command that made it. */
  command?: string
}

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v)

/** An item's history, oldest first: empty when it has none. A line that cannot be read is skipped. */
export function historyOf(item: Item): Order[] {
  const path = join(item.dir, HISTORY)
  if (!existsSync(path)) return []
  return readFileSync(path, "utf8").split("\n").flatMap((l) => {
    try {
      const v: unknown = JSON.parse(l)
      return isObject(v) && typeof v["on"] === "string" && typeof v["what"] === "string" ? [v as unknown as Order] : []
    } catch {
      return []
    }
  }).sort((a, b) => a.on.localeCompare(b.on))
}

/** What a write changed, in a few words. */
export function whatChanged(write: Write, command: string | undefined): string {
  if (write.kind === "create") return "filed"
  const before = write.before ?? {}
  const now = write.item.meta as Record<string, unknown>
  const parts: string[] = []
  if (write.kind === "move") parts.push(`moved to ${write.to?.id ?? write.item.type}`)
  if (before["status"] !== now["status"]) parts.push(`status ${String(now["status"])}`)
  const keys = [...new Set([...Object.keys(before), ...Object.keys(now)])]
    .filter((k) => k !== "status" && JSON.stringify(before[k]) !== JSON.stringify(now[k]))
  if (keys.length) parts.push(`set ${keys.sort().join(", ")}`)
  if (write.prose !== undefined) parts.push(command === "note" ? "note" : "described")
  return parts.join("; ") || command || "written"
}

/** The history entry for a write made now by this command. */
export function orderFor(ctx: Context, write: Write): Order {
  const by = orderingPerson(ctx)
  const role = filerRole(ctx.root)
  const own = orderedBy(ctx) === AGENT_OWN
  return {
    on: ctx.now().toISOString(),
    ...(by ? { by } : {}),
    ...(role !== "person" ? { agent: role } : own ? { agent: "agent" as Role } : {}),
    what: whatChanged(write, ctx.command),
    ...(ctx.command ? { command: ctx.command } : {}),
  }
}

/** Make the tracker's .gitattributes merge every item's history by union, once. */
function unionMerge(ctx: Context): void {
  const path = join(ctx.trackerRoot, ".gitattributes")
  const text = existsSync(path) ? readFileSync(path, "utf8") : ""
  if (text.split("\n").some((l) => l.trim() === HISTORY_ATTRIBUTE)) return
  writeFileAtomic(path, `${text}${text && !text.endsWith("\n") ? "\n" : ""}${HISTORY_ATTRIBUTE}\n`)
}

/**
 * Every write of an item appends who ordered it to the item's history, after the write: the person (from --by, else
 * the person at the keyboard), the agent that made it, what changed, the command. A write the same person ordered
 * just before with the same words, by the same command on the same day, is not repeated.
 */
export const orderedByHook: WriteHook = {
  name: "ordered-by",
  says:
    "every write of an item records who ordered it — the person (--by, else NAIMA_PERSON, else git's user.name), the agent that made it, what changed and the command — as one line of the item's history.jsonl, which the tracker merges by union",
  afterWrite(write, ctx) {
    try {
      const entry = orderFor(ctx, write)
      const last = historyOf(write.item).at(-1)
      if (
        last && last.by === entry.by && last.agent === entry.agent && last.what === entry.what && last.command === entry.command &&
        last.on.slice(0, 10) === entry.on.slice(0, 10)
      ) return
      appendFileSync(join(write.item.dir, HISTORY), JSON.stringify(entry) + "\n")
      unionMerge(ctx)
    } catch {
      // the history says who ordered a change; a folder that cannot be written loses the line, never the change
    }
  },
}

/** The people who ordered changes to an item, each once, in the order they first did. */
export function orderingPeople(item: Item): string[] {
  return [...new Set(historyOf(item).map((o) => o.by).filter((b): b is string => !!b))]
}

/** How an order reads on one line: `2026-11-21 Ada (worker): status fixed — naima land`. */
export const orderLine = (o: Order): string =>
  `${o.on.slice(0, 10)} ${o.by ?? "an agent on its own"}${o.agent ? ` (${o.agent})` : ""}: ${o.what}${o.command ? ` — naima ${o.command}` : ""}`

// ── comments ─────────────────────────────────────────────────────────────────

/** One comment on an item: a note of its Notes section, with its author and date. */
export interface Comment {
  /** The day, YYYY-MM-DD. */
  on: string
  /** Who wrote it, as its heading names them: a person, or an agent and the person behind it. */
  by: string
  /** The branch it was written on, when its heading says. */
  branch?: string
  text: string
}

const NOTE_HEADING = /^### (\d{4}-\d{2}-\d{2}) — (.+?)(?:, on (\S+))?$/

/** The comments of an item, from the text of its Notes section, in order. */
export function commentsOf(notes: string): Comment[] {
  const out: Comment[] = []
  let fenced = false
  for (const line of notes.split("\n")) {
    if (/^\s*(```|~~~)/.test(line)) fenced = !fenced
    const m = fenced ? null : NOTE_HEADING.exec(line)
    if (m) {
      out.push({ on: m[1]!, by: m[2]!, ...(m[3] ? { branch: m[3] } : {}), text: "" })
      continue
    }
    const last = out.at(-1)
    if (last) last.text += `${line}\n`
  }
  return out.map((c) => ({ ...c, text: c.text.trim() }))
}

/** The author a note's heading names: `--by` as given, else the person at the keyboard, with the agent that writes for them. */
export function noteAuthor(ctx: Context, by: string | undefined): string | null {
  const given = by?.trim()
  if (given) return given
  const person = personAtKeyboard(ctx.root)?.name
  if (!person) return null
  const role = filerRole(ctx.root)
  return role === "person" ? person : `${person} (through the ${role})`
}

// ── whom an item waits on ────────────────────────────────────────────────────

/** The person an item waits on, by name: set when it waits on one person in particular. */
export const WAITS_ON: FieldDef = {
  name: "waitsOn",
  kind: "string",
  says:
    "the person the item waits on, by name, when it waits on one person in particular (naima set <item> waitsOn=<name>): naima hello and the UI's waiting views show the person at the keyboard what waits on them and what waits on nobody in particular, never what waits on someone else",
}

/** The person an item waits on, or undefined when it waits on nobody in particular. */
export function waitsOnOf(item: Item): string | undefined {
  const v = item.meta[WAITS_ON.name]
  return typeof v === "string" && v.trim() ? v.trim() : undefined
}

/** Whether two names name the same person: compared without case or the spaces at their edges. */
export const samePerson = (a: string, b: string): boolean => a.trim().toLowerCase() === b.trim().toLowerCase()

/**
 * Whether an item is for the person at the keyboard: it waits on nobody in particular, or on them. When nobody is known
 * at the keyboard, everything is.
 */
export function forPersonAtKeyboard(ctx: Context, item: Item): boolean {
  const on = waitsOnOf(item)
  if (!on) return true
  const me = personAtKeyboard(ctx.root)?.name
  return !me || samePerson(on, me)
}
