// Naima's bridge for agents: `naima ui --mcp` serves an MCP server on its standard input and output, through the UI
// stance's bridge-mcp.ts, copied unchanged like its request handler. Its tools are made for an agent with a budget of
// tokens: each read tool answers like a screen at a glance, in plain text, and gives one thing's details by its id
// (mcp-tools.ts), all read through the bridge commands the UI itself uses (bridge.ts); view gives a view's raw data in
// pages (mcp-pages.ts) for what they do not answer. action and run run the UI's actions; show, read_page and
// screenshot drive and look at the UI the owner has open, instead of a page of the agent's own.
//
//   claude mcp add naima -- naima ui --mcp        (run in the project's folder; any MCP client starts it the same way)

import { Buffer } from "node:buffer"
import { spawnSync } from "node:child_process"
import { mkdirSync, readFileSync, rmSync } from "node:fs"
import { basename, join, resolve } from "node:path"
import { createInterface } from "node:readline"
import type { Readable } from "node:stream"
import { type Context, gitOrNull, stateDir } from "../../core/api.ts"
import { ACTIONS, naimaBridge } from "./bridge.ts"
import { bridgeMcp, type McpServer, type McpTool, serveMcpLines } from "./bridge-mcp.ts"
import type { Handlers, Json } from "./bridge-handler.ts"
import { PAGE_PROPERTIES, paged, splitArgs } from "./mcp-pages.ts"
import { agentTools, bounded, cut, HARD_BOUND, type Reader, TOOL_SPECS } from "./mcp-tools.ts"
import { askShow, awaitAnswer, openUis, requestId } from "./show.ts"
import type { UiTab, UiView } from "./tabs.ts"

const obj = (properties: Record<string, unknown>, required: string[] = []) =>
  JSON.parse(JSON.stringify({ type: "object", properties, ...(required.length ? { required } : {}) }))

const str = (description: string) => ({ type: "string", description })

/** The tools, with what each does for an agent: the read tools, view, the actions, and show. */
export function naimaTools(views: readonly string[], tabs: readonly string[]): { [command: string]: McpTool } {
  return {
    ...TOOL_SPECS,
    view: {
      description:
        `A view's raw data as compact JSON, for what the tools above do not answer; with at, as that commit had it. A bare call comes shortened, naming each cut part's path; read a part with path, page it with offset and limit, narrow it with where, search, since, until and fields. The views: ${
          views.join(", ")
        }.`,
      inputSchema: obj({
        view: str("the view's name"),
        at: str("a commit (a hash or a ref a local branch reaches); absent: live"),
        query: { type: "object", description: "the view's parameters, each a string, such as {type: features}", additionalProperties: { type: "string" } },
        ...PAGE_PROPERTIES,
      }, ["view"]),
    },
    action: {
      description: `Run one of the UI's actions as a naima run; answers the run's name, which run reads. The actions: ${
        ACTIONS.map((a) => `${a.name} (${a.says})`).join("; ")
      }.`,
      inputSchema: obj({ name: str("the action"), args: { type: "array", items: { type: "string" }, description: "the arguments after the command" } }, [
        "name",
      ]),
    },
    run: {
      description: "A run action started: its state, exit code and the last lines of its log.",
      inputSchema: obj({ name: str("the run's name, as action answered it"), lines: { type: "integer", minimum: 1, description: "log lines, default 20" } }, [
        "name",
      ]),
    },
    show: {
      description:
        "Show the owner a place in the Naima UI open on this project, live: a screen, a plugin's view, an item, a commit (moving the playhead there) or a line. Give exactly one. Prefer it to a page or an artifact of your own. Opens a UI when none is open.",
      inputSchema: obj({
        screen: str("home, metrics, diary, bugs, features, failed_tests, goals, roadmap, map, all_projects or more"),
        view: str(`a plugin's view: ${tabs.join(", ")}`),
        item: str("an item's ref, such as bugs/some-bug"),
        commit: str("a commit a local branch reaches: a hash or a ref"),
        line: str("a line's name, such as main or line/release-1.2"),
      }),
    },
  }
}

export const INSTRUCTIONS = "Naima's project tracker and UI. Answers are short plain text; ask for one thing by its id for more. " +
  "Start with overview. items: one item by ref, or a search with counts. gates: why a gate is blocked. lines: the trunk, lines and branches. " +
  "history: a day or a commit. work: claims, queue, stale work. metrics: values and trends. view: a view's raw data, in pages, only when those do not answer. " +
  `No reply passes ${HARD_BOUND} characters; a cut one says how to narrow it. ` +
  "To show the owner something, call show: it moves the Naima UI the owner has open, and is preferred to a page or an artifact of your own. " +
  "read_page outlines what the owner sees; screenshot only for a rare visual check, since it costs far more. If show says no UI could be opened, tell the owner to run naima ui."

/** What the read tools read, through the bridge's commands: the views, the map, and a commit as git tells it. */
export function bridgeReader(ctx: Context, bridge: Handlers): Reader {
  return {
    name: basename(resolve(ctx.root)),
    today: () => ctx.now().toISOString().slice(0, 10),
    view: async (name, query) => await bridge["data"]!({ view: name, ...(query ? { query } : {}) }),
    metro: async () => await bridge["metro"]!({}),
    commit: (ref) => {
      if (!/^[\w./@{}^~-]{1,200}$/.test(ref) || ref.startsWith("-")) return null
      const s = gitOrNull(ctx.root, "show", "-s", "--format=%H%x1f%cI%x1f%s%x1f%b", "--end-of-options", `${ref}^{commit}`)
      if (!s) return null
      const [hash = "", date = "", subject = "", body = ""] = s.split("\x1f")
      const files = (gitOrNull(ctx.root, "show", "--name-only", "--format=", "--end-of-options", hash) ?? "").split("\n").filter(Boolean)
      return { hash, date, subject, body, files }
    },
  }
}

/** The server's commands: the read tools, view in pages, run's log cut short, and the bridge's action and show. */
export function agentHandlers(bridge: Handlers, reader: Reader, commitTime: (ref: string) => number | null): Handlers {
  const out: Handlers = {}
  // The bridge's own answers as one line: what show says it did, the run action started.
  for (const name of ["action", "show"]) {
    const command = bridge[name]
    if (!command) continue
    out[name] = async (args) => {
      const a = await command(args)
      const says = typeof a === "object" && a !== null && !Array.isArray(a) ? a["says"] : undefined
      return typeof says === "string" ? says : typeof a === "string" ? a : JSON.stringify(a)
    }
  }
  for (const [name, answer] of Object.entries(agentTools(reader))) out[name] = async (args) => bounded(await answer(args), "narrow the call")
  out["view"] = async (args) => {
    const { page, rest } = splitArgs(args)
    return JSON.stringify(paged(await bridge["data"]!(rest), page, commitTime))
  }
  if (bridge["run"]) {
    out["run"] = async (args) => {
      const r = (await bridge["run"]!({ name: args["name"] ?? null })) as { [k: string]: Json }
      const lines = typeof args["lines"] === "number" && args["lines"] > 0 ? args["lines"] : 20
      const log = Object.values(r).find((v) => Array.isArray(v) || (typeof v === "string" && v.includes("\n")))
      const tail = (Array.isArray(log) ? log.map(String) : typeof log === "string" ? log.split("\n") : []).slice(-lines)
      const head = Object.entries(r).filter(([, v]) => v !== log && (v === null || typeof v !== "object")).map(([k, v]) => `${k} ${cut(String(v), 120)}`)
      return bounded([head.join(" · "), ...tail].join("\n"), "ask for fewer lines")
    }
  }
  return out
}

/** A commit's date in milliseconds, for since and until: null when `ref` names no commit. */
export const commitTime = (root: string) => (ref: string): number | null => {
  if (!/^[\w./@{}^~-]{1,200}$/.test(ref) || ref.startsWith("-")) return null
  const t = gitOrNull(root, "log", "-1", "--format=%ct", "--end-of-options", `${ref}^{commit}`)
  return t && /^\d+$/.test(t.trim()) ? Number(t.trim()) * 1000 : null
}

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

/** The tools that look at the open UI itself, beside the bridge's: what its page shows, as text, or as a picture. */
export const LOOK_TOOLS = [
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

/** Asks the UI open on the project a question over the feed show and waits for its answer. */
async function askUi<T>(root: string, request: { kind: "read" | "rect"; [k: string]: Json }, ms: number): Promise<T | string> {
  if (!openUis(root).length) return "no Naima UI is open on this project: show something first, which opens one, or ask the owner to run naima ui"
  // Asked twice at most: a question can reach a page the moment it reloads, which never answers it.
  for (const wait of [ms / 2, ms / 2]) {
    const id = requestId()
    askShow(root, { ...request, id } as never)
    const a = await awaitAnswer<T & { error?: string }>(root, id, wait)
    if (a !== null) return a.error ? a.error : a
  }
  return "the open UI did not answer in time"
}

/** The look tools' answers: the page as text, or a capture of the window's place on the screen. */
export function lookTools(root: string, capture: (rect: Rect) => Uint8Array | string = screenCapture(root), ms = 10_000) {
  return async (name: string, args: { [k: string]: Json }): Promise<Json> => {
    if (name === "read_page") {
      const a = await askUi<{ text: string; truncated?: boolean }>(root, {
        kind: "read",
        ...(typeof args["selector"] === "string" ? { selector: args["selector"] } : {}),
        html: args["mode"] === "html",
      }, ms)
      if (typeof a === "string") return said(a, true)
      const mode = args["mode"] === "text" || args["mode"] === "html" ? args["mode"] : "outline"
      const more = a.truncated ? "\n[the page is longer than the UI reads at once: read a part of it with selector]" : ""
      if (mode === "outline") return said(outline(a.text) + more)
      const { page } = splitArgs({ offset: args["offset"] ?? null, limit: args["limit"] ?? 8000 })
      const p = paged(a.text, page) as { offset: number; next: number | null; total: number; data: string }
      return said(
        `${p.data}\n[characters ${p.offset} to ${p.offset + p.data.length} of ${p.total}${p.next === null ? "" : `; the next page: offset ${p.next}`}]${more}`,
      )
    }
    const r = await askUi<Rect>(root, { kind: "rect" }, ms)
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
export function screenCapture(root: string, os: string = process.platform) {
  return (r: Rect): Uint8Array | string => {
    if (os !== "darwin") return `a screenshot needs the system's screen capture, which Naima uses only on macOS; this is ${os}: use read_page`
    const dir = stateDir(root)
    if (!dir) return "not a git repository"
    mkdirSync(join(dir, "ui", "shots"), { recursive: true })
    const file = join(dir, "ui", "shots", `${requestId()}.png`)
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

/** The bridge's MCP server with the look tools beside its own. */
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
  views: readonly UiView[]
  tabs: readonly UiTab[]
  version: string
  /** Opens a UI on the project when a show finds none open: hello's opener by default. */
  openUi?(): Promise<string | null>
  /** Captures a region of the screen: the system's by default. */
  capture?(rect: Rect): Uint8Array | string
  input: Readable
  write(line: string): void
}

/** Serves the bridge as an MCP server until the input ends; returns the exit code. */
export async function runMcp(ctx: Context, opts: McpOptions): Promise<number> {
  const bridge = naimaBridge(ctx, {
    views: opts.views,
    tabs: opts.tabs,
    // A tab's file is the UI's to frame: an agent is told its path in the tab's folder.
    fileUrl: (tab, rel) => `naima-tab-file:${encodeURIComponent(tab)}/${rel}`,
    ...(opts.openUi ? { openUi: opts.openUi } : {}),
  })
  const bridgeServer = bridgeMcp({
    name: "naima",
    version: opts.version,
    instructions: INSTRUCTIONS,
    handlers: agentHandlers(bridge.handlers, bridgeReader(ctx, bridge.handlers), commitTime(ctx.root)),
    tools: naimaTools(opts.views.map((v) => v.name), opts.tabs.map((t) => t.name)),
  })
  try {
    const mcp = withLookTools(bridgeServer, lookTools(ctx.root, opts.capture ?? screenCapture(ctx.root)))
    await serveMcpLines(mcp, createInterface({ input: opts.input, crlfDelay: Infinity }), opts.write)
    return 0
  } finally {
    bridge.close()
  }
}
