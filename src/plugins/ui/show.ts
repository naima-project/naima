// Where an agent's requests meet the UIs open on a project: the UI's MCP server (`naima ui --mcp`, through the agent
// channel, agent-endpoint.ts) asks, and every open UI of the project hears it on the bridge's feed `agent` and answers
// (a show of a place is the transition of its shell's agent sequences, develop/models/ui/shell in the workshop). The agent's process and the
// UIs' (a browser's `naima ui` server, the desktop app's sidecar) are separate, so they meet in files, in Naima's state
// folder for the clone (stateDir), under ui/:
//
//   open/<id>.json   one per UI listening to the feed: its project's root, its carrier, when it last said it is open
//                    and the last show it took; rewritten every BEAT_MS, removed when it stops listening, and taken
//                    as closed once it is STALE_MS old (a page or a process that ended without saying so)
//   show.json        the last show asked: its id, the project's root and the request (the desktop window's raise);
//                    written whole, then renamed
//   agent.json       the last agent request asked, in the shape of the UI stance's agent feed ({ id, tool, args }: the
//                    store, the registry of transitions, a transition by machine and name, the show of a place as the
//                    transition of a named sequence, the page as text, the window's place); written the same way, heard
//                    on the feed `agent`
//
// A UI polls the two files, as live.ts polls the project, and passes on what was asked of its own project after it
// opened, once, on the feed of each. Nothing is queued: the newest of each is the one that counts, so the agent
// channel asks one request at a time (agent-endpoint.ts). A request asked before a page reloaded is never
// passed on to the page that follows, so a transition is applied at most once (the model
// develop/models/ui/agent-endpoint in the workshop).
//
// What travels here holds no UI behaviour: a place, a question about the page, or a request on the open UI's central
// store (its snapshot, its registry of transitions, a transition by machine and name). The UI decides what each means,
// through the same functions its components call (the workshop's ui/src/logic/agent.svelte.ts).

import { randomBytes } from "node:crypto"
import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { stateDir } from "../../core/api.ts"

/** A place the owner is shown: a screen, a plugin's view, an item, a commit (its full hash) or a line, by name. */
export type Place =
  | { kind: "screen"; screen: string }
  | { kind: "view"; name: string }
  | { kind: "item"; ref: string }
  | { kind: "commit"; hash: string }
  | { kind: "line"; name: string }

/**
 * What the feed show carries besides a place: the desktop app's window brought to the front, which the app's shell takes
 * and the page never sees (desktop-app.ts). A question about the page (its text, where its window is) travels on the
 * feed agent, as the tools `read_page` and `screenshot` (agent-endpoint.ts).
 */
export type UiRequest = { kind: "raise" }

/**
 * A request on the open UI's central store, carried on the feed agent in the shape of the UI stance's agent protocol:
 * `store` (the snapshot in short, or one machine, or a path in it: args machine, path), `transitions` (the registry,
 * with what each transition allows now: args machine) and `transition` (one transition called on a machine by its
 * name, as the components call it: args machine, name and args, by name or in order); and the page's own: `read_page`
 * (the page as text or raw HTML: args selector, html) and `screenshot` (where the window is on the screen, for the
 * server's capture). A show is the transition of a named sequence of the UI's machine agent (showScreen, showView,
 * showItem, showCommit, showLine).
 */
export interface AgentRequest {
  id: string
  tool: "store" | "transitions" | "transition" | "read_page" | "screenshot"
  args: { [key: string]: unknown }
}

/** The channel a request travels: the feed, and the file that carries it. */
export type Channel = "show" | "agent"

/** An open UI, as its file says. */
export interface OpenUi {
  id: string
  root: string
  carrier: string
  beat: number
  /** The last request taken on the feed show. */
  took: string | null
  /** The last request taken on the feed agent. */
  tookAgent?: string | null
}

interface Show {
  id: string
  root: string
  place: Place | UiRequest | AgentRequest
  at: number
}

/** How often an open UI says it is open, and looks for a show, in ms. */
export const BEAT_MS = 2000
export const POLL_MS = 400
/** How old an open UI's file may be before the UI is taken as closed. */
export const STALE_MS = 3 * BEAT_MS

const dirOf = (root: string): string | null => {
  const s = stateDir(root)
  return s ? join(s, "ui") : null
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

/** The UIs open on the project at `root` now. */
export function openUis(root: string, now = Date.now()): OpenUi[] {
  const dir = dirOf(root)
  if (!dir) return []
  let names: string[]
  try {
    names = readdirSync(join(dir, "open")).filter((n) => n.endsWith(".json"))
  } catch {
    return []
  }
  return names.map((n) => readJson<OpenUi>(join(dir, "open", n))).filter((u): u is OpenUi => !!u && u.root === root && now - u.beat < STALE_MS)
}

/** Asks every UI open on the project at `root` to show `place`; returns the show's id. */
export function askShow(root: string, place: Place | UiRequest, now = Date.now()): string {
  return ask(root, "show", place, now)
}

/** Asks every UI open on the project at `root` a request on its store, on the feed agent; returns its id. */
export function askAgent(root: string, request: AgentRequest, now = Date.now()): string {
  return ask(root, "agent", request, now, request.id)
}

function ask(root: string, channel: Channel, place: Place | UiRequest | AgentRequest, now: number, given?: string): string {
  const dir = dirOf(root)
  if (!dir) throw new Error("not a git repository: Naima's UI shows only a project in git")
  mkdirSync(dir, { recursive: true })
  const id = given ?? randomBytes(8).toString("hex")
  writeWhole(join(dir, `${channel}.json`), { id, root, place, at: now } satisfies Show)
  return id
}

/** How many open UIs took the show `id` (of the feed `channel`), waiting up to `ms` for every one open to take it. */
export async function taken(root: string, id: string, ms: number, channel: Channel = "show"): Promise<{ open: number; took: number }> {
  const end = Date.now() + ms
  for (;;) {
    const open = openUis(root)
    const took = open.filter((u) => (channel === "agent" ? u.tookAgent : u.took) === id).length
    if (took === open.length || Date.now() >= end) return { open: open.length, took }
    await new Promise((r) => setTimeout(r, 100))
  }
}

/**
 * A UI open on the project at `root`, through `carrier`, listening for shows and for requests on its store: says it is
 * open until `stop` (once, however many feeds it hears), and calls `show` with each place, and `agent` with each
 * request, asked for its project after it opened.
 */
export function listenShows(
  root: string,
  carrier: string,
  show: (place: Place | UiRequest) => void,
  agent: (request: AgentRequest) => void = () => {},
): { stop(): void } {
  const dir = dirOf(root)
  if (!dir) return { stop() {} }
  const id = randomBytes(8).toString("hex")
  const mine = join(dir, "open", `${id}.json`)
  const opened = Date.now()
  const seen: { [c in Channel]: string | null } = { show: null, agent: null }
  const took: { [c in Channel]: string | null } = { show: null, agent: null }
  let lastBeat = 0
  let stopped = false
  const beat = (): void => {
    mkdirSync(join(dir, "open"), { recursive: true })
    writeWhole(mine, { id, root, carrier, beat: Date.now(), took: took.show, tookAgent: took.agent } satisfies OpenUi)
    lastBeat = Date.now()
  }
  const hear = (channel: Channel): void => {
    let changed = 0
    try {
      changed = statSync(join(dir, `${channel}.json`)).mtimeMs
    } catch {
      // nothing asked yet
    }
    if (!changed) return
    const s = readJson<Show>(join(dir, `${channel}.json`))
    if (s && s.id !== seen[channel] && s.root === root && s.at >= opened) {
      seen[channel] = s.id
      took[channel] = s.id
      if (channel === "agent") agent(s.place as AgentRequest)
      else show(s.place as Place | UiRequest)
      lastBeat = 0
    }
  }
  const tick = (): void => {
    if (stopped) return
    hear("show")
    hear("agent")
    if (Date.now() - lastBeat >= BEAT_MS) beat()
  }
  beat()
  const timer = setInterval(tick, POLL_MS)
  return {
    stop() {
      stopped = true
      clearInterval(timer)
      rmSync(mine, { force: true })
    },
  }
}

/** A fresh id for a request to the open UI. */
export const requestId = (): string => randomBytes(8).toString("hex")

/** Where the open UI's answer to request `id` is written (the bridge's command answer). */
function answerFile(root: string, id: string): string | null {
  const dir = dirOf(root)
  return dir && /^[0-9a-f]{16}$/.test(id) ? join(dir, "answers", `${id}.json`) : null
}

/** Keeps the open UI's answer to request `id`: the first one counts. */
export function writeAnswer(root: string, id: string, answer: unknown): void {
  const file = answerFile(root, id)
  if (!file) throw new Error("answer names no request")
  mkdirSync(join(file, ".."), { recursive: true })
  writeWhole(file, answer)
}

/** The open UI's answer to request `id`, waiting up to `ms`; removed once read. Null when none came. */
export async function awaitAnswer<T>(root: string, id: string, ms: number): Promise<T | null> {
  const file = answerFile(root, id)
  if (!file) return null
  const end = Date.now() + ms
  for (;;) {
    const a = readJson<T>(file)
    if (a !== null) {
      rmSync(file, { force: true })
      return a
    }
    if (Date.now() >= end) return null
    await new Promise((r) => setTimeout(r, 100))
  }
}
