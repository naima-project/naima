// Naima's UI server for agents: `naima ui --mcp` serves an MCP server on its standard input and output, through the UI
// stance's bridge-mcp.ts, copied unchanged like its request handler. It only drives and reads the screen, the way a
// person does: every call goes through the agent channel (agent-endpoint.ts, the UI stance's agent protocol) to the UI
// open on the project, which runs it on its central store or on its page and answers: store reads the store's snapshot,
// transitions lists its registry of transitions (generated from the UI's machines), transition calls one by machine
// and name through the very function the UI's components call, show is the transition of one of the UI's named
// sequences, read_page reads what the page shows and screenshot pictures its window. It adds no UI behaviour of its
// own: which screen, which item, and why a place is refused, the UI decides.
//
// It imports only the standard library, the bridge's own modules and the agent channel (the UI stance's agent-endpoint
// check holds it to that), so that it has nothing of the tracker in it: the tracker's reads (items, gates, lines,
// history, work, metrics, views) and its actions are the other server's, mcp-tracker.ts, `naima ui --mcp-tracker`.
//
//   claude mcp add naima-ui -- naima ui --mcp        (run in the project's folder; any MCP client starts it the same way)

import { Buffer } from "node:buffer"
import { spawnSync } from "node:child_process"
import { randomBytes } from "node:crypto"
import { mkdirSync, readFileSync, rmSync } from "node:fs"
import { join } from "node:path"
import { createInterface } from "node:readline"
import type { Readable } from "node:stream"
import { type AgentChannel, showCall } from "./agent-endpoint.ts"
import type { Handlers, Json } from "./bridge-handler.ts"
import { bridgeMcp, type McpServer, type McpTool, serveMcpLines } from "./bridge-mcp.ts"

/** The most characters any reply takes: a safety net, never the normal case. */
const HARD_BOUND = 20_000

/** A text cut to `n` characters, with an ellipsis when cut. */
const cut = (s: string, n: number): string => (s.length <= n ? s : `${s.slice(0, Math.max(0, n - 1)).trimEnd()}…`)

/** A reply held to HARD_BOUND: cut at a line's end, saying how to narrow it. */
function bounded(text: string, narrow: string): string {
  const size = (t: string) => JSON.stringify(t).length
  if (size(text) <= HARD_BOUND) return text
  const note = `\n[cut: ${text.length} characters is past the bound of ${HARD_BOUND}; ${narrow}]`
  // The bound holds for the text as the reply carries it, escapes included.
  let room = HARD_BOUND - note.length - 2
  while (room > 0 && size(text.slice(0, room) + note) > HARD_BOUND) room = Math.floor(room * 0.9)
  const end = text.lastIndexOf("\n", room)
  return text.slice(0, end > room / 2 ? end : room) + note
}

const obj = (properties: Record<string, unknown>, required: string[] = []) =>
  JSON.parse(JSON.stringify({ type: "object", properties, ...(required.length ? { required } : {}) }))

const str = (description: string) => ({ type: "string", description })

/** The tool show, the one bridge-level tool of this server; the others look at the open UI's store and page (LOOK_TOOLS). */
export function uiTools(tabs: readonly string[]): { [command: string]: McpTool } {
  return {
    show: {
      description:
        "Show the owner a place in the Naima UI open on this project, live: a screen, a plugin's view, an item, a commit (moving the playhead there) or a line. Give exactly one. It calls the UI's named sequence for it (agent.showScreen, showView, showItem, showCommit, showLine), which transition calls the same way. Prefer it to a page or an artifact of your own. Opens a UI when none is open.",
      inputSchema: obj({
        screen: str("home, metrics, diary, bugs, features, failed_tests, goals, roadmap, map, all_projects, meetings or more"),
        view: str(`a plugin's view: ${tabs.join(", ")}`),
        item: str("an item's ref, such as bugs/some-bug"),
        commit: str("a commit a local branch reaches: a hash or a ref"),
        line: str("a line's name, such as main or line/release-1.2"),
      }),
    },
  }
}

export const INSTRUCTIONS = "Naima's UI, driven the way the owner does. The open UI is its central store, and these tools only use it as the UI's own components do: " +
  "read it with store (a summary first, then one machine or a path), list what can be done with transitions, act with transition (machine, name, args), " +
  "and use show for the common jumps, a named sequence of transitions. " +
  "To show the owner something, call show: it moves the Naima UI the owner has open, and is preferred to a page or an artifact of your own. " +
  "read_page outlines what the owner sees; screenshot only for a rare visual check, since it costs far more. If show says no UI could be opened, tell the owner to run naima ui. " +
  "The project's items, gates, lines, history, work and metrics are the other server's, naima-tracker; this one never reads them."

/** The landmarks an outline keeps. */
const LANDMARKS = /^<(main|banner|navigation|region|dialog|form|complementary|contentinfo|status|alert)\b/

/**
 * A page's text as an outline: its landmarks and headings, each heading with the first line under it, and its controls
 * gathered on a line, held to `max` characters.
 */
export function outline(text: string, max = 2000): string {
  const out: string[] = []
  let controls: string[] = []
  let underHeading = false
  const flush = () => {
    if (controls.length) out.push(cut(controls.join(" "), 240))
    controls = []
  }
  for (const raw of text.split("\n")) {
    const l = raw.trim()
    if (!l) continue
    if (l.startsWith("#")) {
      flush()
      out.push(cut(l, 120))
      underHeading = true
    } else if (l.startsWith("[")) controls.push(cut(l, 48))
    else if (LANDMARKS.test(l)) {
      flush()
      out.push(cut(l, 80))
      underHeading = false
    } else if (underHeading && !l.startsWith("<")) {
      flush()
      out.push(`  ${cut(l, 120)}`)
      underHeading = false
    }
  }
  flush()
  const all = out.join("\n")
  if (all.length <= max) return all
  const note = `\n[outline cut at ${max} of ${all.length} characters: read a part with selector, or the text with mode text]`
  return all.slice(0, all.lastIndexOf("\n", max - note.length)) + note
}

/**
 * The tools that look at the open UI itself, beside show: its central store, read and written through the
 * functions its components call (store, transitions, transition), and what its page shows, as text or as a picture.
 */
export const LOOK_TOOLS = [
  {
    name: "store",
    description:
      "The open Naima UI's central store, as the UI holds it now: a summary of every machine's fields first (a value in short, a list by its length); with machine, that machine's view; with path, one part of it (lines.0.name). Read what the owner sees here before you act.",
    inputSchema: {
      type: "object",
      properties: {
        machine: { type: "string", description: "a machine of the store, such as shell, rail or bugs" },
        path: { type: "string", description: "with machine: a dotted path in its view" },
      },
    },
  },
  {
    name: "transitions",
    description:
      "The registry of the open UI's transitions, generated from its machines: each machine's transitions with their arguments, what each does, and whether it is allowed now where the machine can say. The sequences of the machine agent are what show calls.",
    inputSchema: { type: "object", properties: { machine: { type: "string", description: "only this machine's transitions" } } },
  },
  {
    name: "transition",
    description:
      "Call one transition of the open UI's store, by machine and name, with its arguments, through the very function the UI's components call: answers in one line whether it was taken and what changed. Moves what the owner sees: call only what the owner would want shown.",
    inputSchema: {
      type: "object",
      properties: {
        machine: { type: "string", description: "the machine, as transitions lists it" },
        name: { type: "string", description: "the transition's name" },
        args: { description: "its arguments: a list in order, or an object by their names", oneOf: [{ type: "array" }, { type: "object" }] },
      },
      required: ["machine", "name"],
    },
  },
  {
    name: "read_page",
    description:
      "What the owner sees in the open Naima UI: an outline (landmarks, headings with their first line, controls) by default; the page's text or raw HTML with mode, in pages; optionally under a CSS selector. Use it to check what show did; far cheaper than screenshot.",
    inputSchema: {
      type: "object",
      properties: {
        selector: { type: "string", description: "a CSS selector: only that part of the page" },
        mode: { type: "string", enum: ["outline", "text", "html"], description: "outline (default, about 2 000 characters), text, or html" },
        offset: { type: "integer", minimum: 0, description: "text and html: the first character, the reply's next" },
        limit: { type: "integer", minimum: 1, description: "text and html: characters, default 8 000" },
      },
    },
  },
  {
    name: "screenshot",
    description:
      "A PNG picture of the open Naima UI's window. Costs far more than read_page: only for a rare visual check that text cannot answer (a layout, a colour). macOS only; elsewhere it says so.",
    inputSchema: { type: "object", properties: {} },
  },
]

type Content = { type: string; [k: string]: Json }
const said = (text: string, isError = false): Json => ({ content: [{ type: "text", text }], isError })

/**
 * Asks the UI open on the project a request through the agent channel and waits for its answer: the store's tools, the
 * page's (read_page, screenshot) and the transitions, all in the UI stance's agent protocol. The channel asks one request
 * at a time; a read is asked twice at most, since it can reach a page the moment it reloads, which never answers it; a
 * transition is asked once, since the page may have applied it before it reloaded (the model
 * develop/models/ui/agent-endpoint in the workshop).
 */
async function askUi<T>(channel: AgentChannel, tool: Parameters<AgentChannel["ask"]>[0], args: { [k: string]: unknown }, ms: number): Promise<T | string> {
  if (!channel.open()) return "no Naima UI is open on this project: show something first, which opens one, or ask the owner to run naima ui"
  const { answer } = await channel.ask<T>(tool, args, ms)
  if (answer !== null) return answer.error ? answer.error : answer
  return tool === "transition"
    ? "the open UI did not answer in time: read store to see whether the transition was applied before asking it again"
    : "the open UI did not answer in time"
}

type Changed = [string, Json, Json][]

/** A transition's answer in one line: taken or refused, and what changed. */
export function saidTransition(a: { machine?: string; name?: string; done?: boolean; changed?: Changed; says?: string }, call: string): string {
  const changed = a.changed ?? []
  const what = changed.length
    ? changed.slice(0, 8).map(([p, from, to]) => `${p} ${cut(JSON.stringify(from), 40)} → ${cut(JSON.stringify(to), 40)}`).join("; ") +
      (changed.length > 8 ? `; and ${changed.length - 8} more` : "")
    : "nothing changed"
  return `${call}: ${a.done ? "taken" : "refused"}${a.says ? ` (${a.says})` : ""}; ${what}`
}

/** The store tools' answers: the open UI's store, its registry, a transition called. */
async function storeTool(channel: AgentChannel, name: string, args: { [k: string]: Json }, ms: number): Promise<Json> {
  const s = (k: string) => (typeof args[k] === "string" && (args[k] as string).trim() ? (args[k] as string).trim() : undefined)
  if (name === "store") {
    const machine = s("machine")
    const path = s("path")
    const a = await askUi<{ summary?: { [m: string]: { [k: string]: Json } }; value?: Json; cut?: boolean; error?: string }>(
      channel,
      "store",
      { ...(machine ? { machine } : {}), ...(path ? { path } : {}) },
      ms,
    )
    if (typeof a === "string") return said(a, true)
    if (a.error) return said(a.error, true)
    if (a.summary) {
      const lines = Object.entries(a.summary).map(([m, f]) =>
        `${m}: ${Object.entries(f).map(([k, v]) => `${k}=${typeof v === "string" ? v : JSON.stringify(v)}`).join(" ") || "(no fields)"}`
      )
      const head = `${lines.length} machines; read one with machine, a part of it with path`
      return said(bounded([head, ...lines].join("\n"), "read one machine"))
    }
    const where = `${machine}${path ? "." + path : ""}`
    const more = a.cut ? `\n[cut: ${where} is larger; read a part with path]` : ""
    return said(bounded(`${where}: ${JSON.stringify(a.value)}${more}`, "read a part with path"))
  }
  if (name === "transitions") {
    const machine = s("machine")
    type T = {
      machine: string
      name: string
      args: { name: string; type: string; values?: string[]; optional?: boolean }[]
      description: string
      sequence?: boolean
      person?: boolean
      allowed: boolean | string[] | null
    }
    const a = await askUi<{ transitions?: T[]; error?: string }>(channel, "transitions", machine ? { machine } : {}, ms)
    if (typeof a === "string") return said(a, true)
    if (a.error) return said(a.error, true)
    const list = a.transitions ?? []
    const allowed = (
      t: T,
    ) => (t.allowed === null ? "" : Array.isArray(t.allowed) ? ` [allowed: ${t.allowed.join(", ") || "none"}]` : t.allowed ? "" : " [not allowed now]")
    const arg = (x: T["args"][number]) => `${x.name}${x.optional ? "?" : ""}: ${x.values && x.values.length <= 14 ? x.values.join("|") : x.type}`
    const lines = list.map((t) =>
      `${t.machine}.${t.name}(${t.args.map(arg).join(", ")})${t.sequence ? " sequence" : ""}${t.person ? " person only" : ""}${allowed(t)}: ${
        cut(t.description, 140)
      }`
    )
    const machines = new Set(list.map((t) => t.machine)).size
    return said(bounded([`${list.length} transitions on ${machines} machines`, ...lines].join("\n"), "ask for one machine"))
  }
  const machine = s("machine")
  const tname = s("name")
  if (!machine || !tname) return said("transition takes machine and name, as transitions lists them", true)
  const given = args["args"] ?? []
  const a = await askUi<{ done?: boolean; changed?: Changed; says?: string; error?: string }>(
    channel,
    "transition",
    { machine, name: tname, args: Array.isArray(given) || (typeof given === "object" && given !== null) ? given : [given] },
    ms,
  )
  if (typeof a === "string") return said(a, true)
  if (a.error) return said(a.error, true)
  return said(
    saidTransition(a, `${machine}.${tname}(${Array.isArray(given) ? given.map((g) => JSON.stringify(g)).join(", ") : JSON.stringify(given)})`),
    !a.done,
  )
}

/** The look tools' answers: the store, the page as text, or a capture of the window's place on the screen. */
export function lookTools(channel: AgentChannel, capture: (rect: Rect) => Uint8Array | string = screenCapture(null), ms = 10_000) {
  return async (name: string, args: { [k: string]: Json }): Promise<Json> => {
    if (name === "store" || name === "transitions" || name === "transition") return await storeTool(channel, name, args, ms)
    if (name === "read_page") {
      const a = await askUi<{ text: string; truncated?: boolean }>(channel, "read_page", {
        ...(typeof args["selector"] === "string" ? { selector: args["selector"] } : {}),
        html: args["mode"] === "html",
      }, ms)
      if (typeof a === "string") return said(a, true)
      const mode = args["mode"] === "text" || args["mode"] === "html" ? args["mode"] : "outline"
      const more = a.truncated ? "\n[the page is longer than the UI reads at once: read a part of it with selector]" : ""
      if (mode === "outline") return said(outline(a.text) + more)
      const offset = typeof args["offset"] === "number" && args["offset"] >= 0 ? Math.floor(args["offset"]) : 0
      const limit = typeof args["limit"] === "number" && args["limit"] >= 1 ? Math.floor(args["limit"]) : 8000
      const data = a.text.slice(offset, offset + limit)
      const next = offset + limit < a.text.length ? offset + limit : null
      return said(
        `${data}\n[characters ${offset} to ${offset + data.length} of ${a.text.length}${next === null ? "" : `; the next page: offset ${next}`}]${more}`,
      )
    }
    const r = await askUi<Rect>(channel, "screenshot", {}, ms)
    if (typeof r === "string") return said(r, true)
    const png = capture(r)
    if (typeof png === "string") return said(png, true)
    const content: Content[] = [{ type: "image", data: Buffer.from(png).toString("base64"), mimeType: "image/png" }]
    return { content, isError: false }
  }
}

/** Where the UI's page is on the screen, in screen points, as the page itself says. */
export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

/** The system's capture of a region of the screen: macOS's screencapture; elsewhere, why it cannot. */
export function screenCapture(dir: string | null, os: string = process.platform) {
  return (r: Rect): Uint8Array | string => {
    if (os !== "darwin") return `a screenshot needs the system's screen capture, which Naima uses only on macOS; this is ${os}: use read_page`
    if (!dir) return "not a git repository"
    mkdirSync(dir, { recursive: true })
    const file = join(dir, `${randomBytes(8).toString("hex")}.png`)
    const region = [r.x, r.y, r.width, r.height].map((n) => Math.round(n)).join(",")
    const run = spawnSync("screencapture", ["-x", "-t", "png", `-R${region}`, file], { encoding: "utf8" })
    try {
      if (run.status !== 0) return `screencapture failed: ${(run.stderr || run.error?.message || "").trim()} (the screen recording permission may be missing)`
      return new Uint8Array(readFileSync(file))
    } catch {
      return "screencapture wrote no picture: the screen recording permission may be missing"
    } finally {
      rmSync(file, { force: true })
    }
  }
}

/** The server with the look tools beside its own. */
export function withLookTools(server: McpServer, look: (name: string, args: { [k: string]: Json }) => Promise<Json>): McpServer {
  return async (message) => {
    const m = message as { id?: Json; method?: string; params?: { name?: string; arguments?: { [k: string]: Json } } }
    if (m.method === "tools/call" && LOOK_TOOLS.some((t) => t.name === m.params?.name)) {
      return { jsonrpc: "2.0", id: m.id ?? null, result: await look(m.params!.name!, m.params!.arguments ?? {}) }
    }
    const answer = await server(message)
    if (m.method === "tools/list" && answer && typeof answer === "object" && "result" in answer) {
      const result = (answer as { result: { tools: Json[] } }).result
      return { ...answer, result: { tools: [...result.tools, ...(LOOK_TOOLS as unknown as Json[])] } }
    }
    return answer
  }
}

export interface McpOptions {
  /** The plugins' views' names, as show's `view` offers them. */
  tabs: readonly string[]
  version: string
  /** The channel to the UI open on the project (agent-endpoint.ts). */
  channel: AgentChannel
  /** A commit's full hash for a ref, throwing when the ref names no commit: a show of a commit moves the playhead by its hash. */
  commit(ref: string): string
  /** Opens a UI on the project when a show finds none open: hello's opener by default in `naima ui --mcp`. */
  openUi?(): Promise<string | null>
  /** Where a screenshot's temporary file is written; null when the project is not in git. */
  shotsDir: string | null
  /** Captures a region of the screen: the system's by default. */
  capture?(rect: Rect): Uint8Array | string
  /** How long a show waits for the open UI's answer, in ms. */
  showWait?: number
  input: Readable
  write(line: string): void
}

/**
 * The show tool: the transition of one of the machine agent's sequences, asked of the open UI. When none is open, one
 * is opened as hello does and waited for a little longer than for a show.
 */
async function show(opts: McpOptions, args: { [k: string]: Json }): Promise<string> {
  const call = showCall(args, opts.commit)
  if (typeof call === "string") throw new Error(call)
  const channel = opts.channel
  const wait = opts.showWait ?? 8000
  if (!channel.open()) {
    const opened = opts.openUi ? await opts.openUi() : null
    // A UI just opened listens once its page has loaded.
    const until = Date.now() + wait * 3
    while (opened && !channel.open() && Date.now() < until) await new Promise((r) => setTimeout(r, 250))
    if (!channel.open()) {
      return opened
        ? `no Naima UI was open on this project; one is opening (${opened}) but did not listen in time: show again`
        : "no Naima UI is open on this project, and none could be opened: the owner opens one with naima ui"
    }
  }
  const { id, answer } = await channel.ask<{ done?: boolean; says?: string }>("transition", { machine: "agent", name: call.name, args: [call.arg] }, wait)
  const { open, took } = await channel.took(id)
  if (answer === null) return `none of the ${open} open UIs answered within ${Math.round(wait / 1000)} s: one busy reading may still`
  return answer.done === true ? `shown in ${took} of the ${open} open UIs` : `not shown: ${answer.error ?? answer.says ?? "the UI refused it now"}`
}

/** Serves the UI as an MCP server until the input ends; returns the exit code. */
export async function runUiMcp(opts: McpOptions): Promise<number> {
  const handlers: Handlers = { show: (args) => show(opts, args) }
  const server = bridgeMcp({ name: "naima-ui", version: opts.version, instructions: INSTRUCTIONS, handlers, tools: uiTools(opts.tabs) })
  const mcp = withLookTools(server, lookTools(opts.channel, opts.capture ?? screenCapture(opts.shotsDir)))
  await serveMcpLines(mcp, createInterface({ input: opts.input, crlfDelay: Infinity }), opts.write)
  return 0
}
