// Bring to the chat: an element of the UI (an item, a count, a goal, a day, a card, a selection) handed to the chat
// session the person works in, as an event the agent host delivers itself. The UI's server (bridge.ts: chat-bring,
// chat-brought, chat-withdraw) leaves the message; the naima MCP server of each chat session (`naima ui --mcp`, mcp.ts)
// says it listens, takes a message left for it and writes it into its session as a Claude Code channel event
// (notifications/claude/channel); the agent says it took it with the server's tool chat_taken. Claude Code drops a
// channel event without a word when the session was started without the channel, so a message counts as read only
// once the agent said so. The behaviour is the model develop/models/ui/bring-to-chat in the workshop.
//
// The processes meet in files, in Naima's state folder for the clone, under ui/chat/:
//
//   listening/<id>.json  one per MCP server serving a session of the project: its root and when it last said it
//                        listens, rewritten every BEAT_MS; gone, or older than STALE_MS, once it stopped
//   waiting/<id>.json    a message brought and left for the sessions
//   taken/<id>.json      the same file, renamed by the one server that took it (a rename: only one succeeds),
//                        then rewritten with who took it and when it was written into the session
//   read/<id>.json       renamed again when the agent said it took it
//   withdrawn/<id>.json  renamed by the UI when the agent did not take it in time, or the person closed the notice:
//                        a message withdrawn is never taken afterwards, so it never reaches a session after it was pasted
//
// Files older than a day are removed by the next bring.

import { randomBytes } from "node:crypto"
import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { stateDir } from "../../core/api.ts"

/** What the person brings: the kind of element, its id (an item's ref, a goal's name, a day), a label, the view it is on, a short text. */
export interface Brought {
  kind: string
  id: string
  label: string
  view: string
  text: string
}

/** A message left for the sessions: what was brought, the message composed from it, when. */
export interface Message extends Brought {
  bring: string
  root: string
  at: number
  message: string
  /** The server that took it, and when it wrote it into its session. */
  by?: string
  emitted?: number
}

/** A chat session's MCP server listening, as its file says. */
export interface Listener {
  id: string
  root: string
  beat: number
  host: string
}

/** Where a message stands: left, taken by a session's server, read by its agent, withdrawn, or unknown (gone). */
export type Stand = "waiting" | "taken" | "read" | "withdrawn" | "unknown"

/** How often a listening server says so, and how old its file may be before it is taken as gone, in ms. */
export const BEAT_MS = 2000
export const STALE_MS = 3 * BEAT_MS
/** How often a listening server looks for a message, in ms. */
export const POLL_MS = 400
/** How long a message's files are kept, in ms. */
const KEEP_MS = 24 * 60 * 60 * 1000
/** The most characters a brought text keeps. */
export const TEXT_MAX = 4000

const STANDS = ["waiting", "taken", "read", "withdrawn"] as const

const dirOf = (root: string): string | null => {
  const s = stateDir(root)
  return s ? join(s, "ui", "chat") : null
}

const writeWhole = (file: string, value: unknown): void => {
  const tmp = `${file}.${randomBytes(4).toString("hex")}.tmp`
  writeFileSync(tmp, JSON.stringify(value) + "\n")
  renameSync(tmp, file)
}

const readJson = <T>(file: string): T | null => {
  try {
    return JSON.parse(readFileSync(file, "utf8")) as T
  } catch {
    return null
  }
}

const ID = /^[0-9a-f]{16}$/

const clip = (s: unknown, n: number): string => {
  const t = typeof s === "string" ? s.replace(/\s+\n/g, "\n").trim() : ""
  return t.length <= n ? t : `${t.slice(0, n - 1).trimEnd()}…`
}

/** What was brought, from the bridge's arguments, held to its sizes; or why it is refused. */
export function broughtOf(args: { [key: string]: unknown }): Brought | string {
  const b = {
    kind: clip(args["kind"], 40),
    id: clip(args["id"], 200),
    label: clip(args["label"], 300),
    view: clip(args["view"], 200),
    text: clip(args["text"], TEXT_MAX),
  }
  if (!b.kind) return "chat-bring names the kind of element brought: kind"
  if (!b.label && !b.id && !b.text) return "chat-bring carries something: a label, an id or a text"
  return b
}

/** The message the chat reads, and the person copies when no session takes it. */
export function compose(b: Brought): string {
  const what = b.label || b.id || b.kind
  const where = [b.id && b.id !== what ? `${b.kind} ${b.id}` : b.kind, b.view ? `seen on ${b.view}` : ""].filter(Boolean).join(", ")
  return [`From the Naima UI, about ${what} (${where}).`, b.text].filter(Boolean).join("\n")
}

/** The servers listening for the project at `root` now. */
export function listening(root: string, now = Date.now()): Listener[] {
  const dir = dirOf(root)
  if (!dir) return []
  let names: string[]
  try {
    names = readdirSync(join(dir, "listening")).filter((n) => n.endsWith(".json"))
  } catch {
    return []
  }
  return names.map((n) => readJson<Listener>(join(dir, "listening", n))).filter((l): l is Listener => !!l && l.root === root && now - l.beat < STALE_MS)
}

/** Says the server `id` listens for the project at `root`: written again every BEAT_MS while it runs. */
export function beat(root: string, id: string, host: string, now = Date.now()): void {
  const dir = dirOf(root)
  if (!dir) return
  mkdirSync(join(dir, "listening"), { recursive: true })
  writeWhole(join(dir, "listening", `${id}.json`), { id, root, beat: now, host } satisfies Listener)
}

/** The server `id` stops listening. */
export function unlisten(root: string, id: string): void {
  const dir = dirOf(root)
  if (dir) rmSync(join(dir, "listening", `${id}.json`), { force: true })
}

/** What a bring answers: nobody listens (the person copies the message), or it is left for the sessions. */
export type Bring = { state: "nobody"; message: string } | { state: "sent"; id: string; message: string }

/** Brings `b` to the chat of the project at `root`: left for the sessions when one listens, else only composed. */
export function bring(root: string, b: Brought, now = Date.now()): Bring {
  const message = compose(b)
  const dir = dirOf(root)
  if (!dir) throw new Error("not a git repository: Naima's UI brings to the chat only for a project in git")
  sweep(dir, now)
  if (listening(root, now).length === 0) return { state: "nobody", message }
  const id = randomBytes(8).toString("hex")
  mkdirSync(join(dir, "waiting"), { recursive: true })
  writeWhole(join(dir, "waiting", `${id}.json`), { ...b, bring: id, root, at: now, message } satisfies Message)
  return { state: "sent", id, message }
}

/** Where the message `id` stands. */
export function stand(root: string, id: string): Stand {
  const dir = dirOf(root)
  if (!dir || !ID.test(id)) return "unknown"
  for (const s of STANDS) {
    try {
      statSync(join(dir, s, `${id}.json`))
      return s
    } catch {
      // not there
    }
  }
  return "unknown"
}

/** Moves the message `id` from `from` to `to`: false when it is not in `from` (another process moved it first). */
function move(dir: string, id: string, from: (typeof STANDS)[number], to: (typeof STANDS)[number]): boolean {
  mkdirSync(join(dir, to), { recursive: true })
  try {
    renameSync(join(dir, from, `${id}.json`), join(dir, to, `${id}.json`))
    return true
  } catch {
    return false
  }
}

/** Withdraws the message `id` if no session's server took it yet: true when withdrawn. */
export function withdraw(root: string, id: string): boolean {
  const dir = dirOf(root)
  return !!dir && ID.test(id) && move(dir, id, "waiting", "withdrawn")
}

/** The messages the server `by` takes now, in the order they were brought: each taken by one server only. */
export function take(root: string, by: string): Message[] {
  const dir = dirOf(root)
  if (!dir) return []
  let names: string[]
  try {
    names = readdirSync(join(dir, "waiting")).filter((n) => ID.test(n.replace(/\.json$/, "")) && n.endsWith(".json"))
  } catch {
    return []
  }
  const out: Message[] = []
  for (const n of names) {
    const id = n.replace(/\.json$/, "")
    if (!move(dir, id, "waiting", "taken")) continue
    const m = readJson<Message>(join(dir, "taken", n))
    if (!m || m.root !== root) continue
    const taken = { ...m, by }
    writeWhole(join(dir, "taken", n), taken)
    out.push(taken)
  }
  return out.sort((a, b) => a.at - b.at)
}

/** Records that the message was written into its session. */
export function emitted(root: string, m: Message, now = Date.now()): void {
  const dir = dirOf(root)
  if (!dir) return
  const file = join(dir, "taken", `${m.bring}.json`)
  const was = readJson<Message>(file)
  if (was) writeWhole(file, { ...was, emitted: now })
}

/** The agent took the message `id`: it is read. Answers the message, or null when none was taken under that id. */
export function acknowledge(root: string, id: string): Message | null {
  const dir = dirOf(root)
  if (!dir || !ID.test(id)) return null
  if (!move(dir, id, "taken", "read")) return stand(root, id) === "read" ? readJson<Message>(join(dir, "read", `${id}.json`)) : null
  return readJson<Message>(join(dir, "read", `${id}.json`))
}

/** The channel event for a message: its text, and the attributes the <channel> tag carries (identifiers only). */
export function channelEvent(m: Message): { method: string; params: { content: string; meta: Record<string, string> } } {
  const meta: Record<string, string> = { brought_id: m.bring, kind: m.kind }
  if (m.id) meta["ref"] = m.id
  if (m.view) meta["view"] = m.view
  return { method: "notifications/claude/channel", params: { content: m.message, meta } }
}

/** Removes the files of messages older than KEEP_MS. */
function sweep(dir: string, now: number): void {
  for (const s of STANDS) {
    let names: string[]
    try {
      names = readdirSync(join(dir, s))
    } catch {
      continue
    }
    for (const n of names) {
      try {
        if (now - statSync(join(dir, s, n)).mtimeMs > KEEP_MS) rmSync(join(dir, s, n), { force: true })
      } catch {
        // gone meanwhile
      }
    }
  }
}

/** The chat side of a session's MCP server (mcp.ts's ChatSide) for the project at `root`, under a fresh id. */
export function chatSide(root: string): {
  beat(): void
  stop(): void
  take(): { id: string; event: { method: string; params: { content: string; meta: Record<string, string> } } }[]
  emitted(id: string): void
  acknowledge(id: string): string | null
  beatMs: number
  pollMs: number
} {
  const me = randomBytes(8).toString("hex")
  const taken = new Map<string, Message>()
  return {
    beat: () => beat(root, me, "mcp"),
    stop: () => unlisten(root, me),
    take: () =>
      take(root, me).map((m) => {
        taken.set(m.bring, m)
        return { id: m.bring, event: channelEvent(m) }
      }),
    emitted: (id) => {
      const m = taken.get(id)
      if (m) emitted(root, m)
    },
    acknowledge: (id) => {
      const m = acknowledge(root, id)
      return m ? (m.label || m.id || m.kind) : null
    },
    beatMs: BEAT_MS,
    pollMs: POLL_MS,
  }
}
