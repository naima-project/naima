// Naima's bridge for agents: `naima ui --mcp` serves the bridge commands the new UI uses (bridge.ts) as an MCP server
// on its standard input and output, through the UI stance's bridge-mcp.ts, copied unchanged like its request handler.
// An agent reads the project's views and runs the UI's actions through exactly what the UI uses, and shows the owner
// a place in the UI open on the project (the command show), instead of making a page of its own.
//
//   claude mcp add naima -- naima ui --mcp        (run in the project's folder; any MCP client starts it the same way)

import { Buffer } from "node:buffer"
import { spawnSync } from "node:child_process"
import { mkdirSync, readFileSync, rmSync } from "node:fs"
import { join } from "node:path"
import { createInterface } from "node:readline"
import type { Readable } from "node:stream"
import { type Context, stateDir } from "../../core/api.ts"
import { naimaBridge } from "./bridge.ts"
import { bridgeMcp, type McpServer, type McpTool, serveMcpLines } from "./bridge-mcp.ts"
import type { Json } from "./bridge-handler.ts"
import { askShow, awaitAnswer, openUis, requestId } from "./show.ts"
import type { UiTab, UiView } from "./tabs.ts"

const obj = (properties: Record<string, unknown>, required: string[] = []) =>
  JSON.parse(JSON.stringify({ type: "object", properties, ...(required.length ? { required } : {}) }))

const str = (description: string) => ({ type: "string", description })

/** The bridge commands offered as tools, with what each does for an agent. */
export function naimaTools(views: readonly string[], tabs: readonly string[]): { [command: string]: McpTool } {
  return {
    describe: { description: "The project this server is on, and the actions the UI may run (the tool action)." },
    data: {
      description: `A view's data, what its naima command prints with --json; with at, as that commit had it. The views: ${views.join(", ")}.`,
      inputSchema: obj({
        view: str("the view's name"),
        at: str("a commit (a hash or a ref a local branch reaches); absent: live"),
        query: { type: "object", description: "the view's parameters, each a string", additionalProperties: { type: "string" } },
      }, ["view"]),
    },
    tabs: { description: "The tabs the plugins contribute to the UI, each with its subtabs." },
    tab: {
      description: `What a tab shows for a subtab, at a commit or live. The tabs: ${tabs.join(", ")}.`,
      inputSchema: obj({ name: str("the tab"), sub: str("the subtab; absent: the first"), at: str("a commit; absent: live") }, ["name"]),
    },
    metro: { description: "The rail's map: the trunk, the lines, the branches, the workers, the goals ahead, the checkouts and the named stops." },
    action: {
      description: "Run one of the UI's actions (see describe) as a naima run; answers the run's name, which the tool run reads.",
      inputSchema: obj({ name: str("the action"), args: { type: "array", items: { type: "string" }, description: "the arguments after the command" } }, [
        "name",
      ]),
    },
    run: {
      description: "A run an action started: its state, exit code and the end of its log.",
      inputSchema: obj({ name: str("the run's name, as action answered it") }, ["name"]),
    },
    show: {
      description:
        "Show the owner a place in the Naima UI open on this project (the desktop app or a browser), live: a screen, a plugin's view, an item, a commit (moving the playhead there) or a line. Give exactly one. Prefer this to making a page or an artifact of your own. Answers whether an open UI took it; when none is open, it opens one as naima hello does (the desktop app, else a browser) and shows there.",
      inputSchema: obj({
        screen: str("home, metrics, diary, bugs, features, failed_tests, goals, roadmap, map, all_projects or more"),
        view: str(`a plugin's view: ${tabs.join(", ")}`),
        item: str("an item's reference, <type>/<slug>, such as bugs/some-bug"),
        commit: str("a commit a local branch reaches: a hash or a ref"),
        line: str("a line's name, such as main or line/release-1.2"),
      }),
    },
  }
}

export const INSTRUCTIONS =
  "Naima's project tracker and UI. Read the project through data, tab and metro, exactly as the UI does. To show the owner something (a screen, an item, a commit, a line), call show: it navigates the Naima UI the owner has open, live, and is preferred to making a separate page or artifact. To check what the owner sees, call read_page; screenshot only for a rare visual check, since it costs far more. When no UI is open, show opens one; if it says none could be opened, tell the owner to run naima ui."

/** The tools that look at the open UI itself, beside the bridge's: what its page shows, as text, or as a picture. */
export const LOOK_TOOLS = [
  {
    name: "read_page",
    description:
      "Read what the owner sees: the open Naima UI's page as text, compact (headings, landmarks, controls and their state, the text) by default, raw HTML with html=true, optionally only under a CSS selector. Prefer this to screenshot: it costs a small fraction of a picture and says exactly what is on the page; use it to check what show did.",
    inputSchema: {
      type: "object",
      properties: {
        selector: { type: "string", description: "a CSS selector: only that part of the page" },
        html: { type: "boolean", description: "raw HTML instead of the compact text" },
      },
    },
  },
  {
    name: "screenshot",
    description:
      "A PNG picture of the open Naima UI's window, as it is on the screen. Costs far more than read_page: use it only for a rare visual check that text cannot answer (a layout, a colour). Taken by the system's screen capture where there is one (macOS); otherwise it says plainly that it cannot.",
    inputSchema: { type: "object", properties: {} },
  },
]

type Content = { type: string; [k: string]: Json }
const said = (text: string, isError = false): Json => ({ content: [{ type: "text", text }], isError })

/** Asks the UI open on the project a question over the feed show and waits for its answer. */
async function askUi<T>(root: string, request: { kind: "read" | "rect"; [k: string]: Json }, ms: number): Promise<T | string> {
  if (!openUis(root).length) return "no Naima UI is open on this project: show something first, which opens one, or ask the owner to run naima ui"
  const id = requestId()
  askShow(root, { ...request, id } as never)
  const a = await awaitAnswer<T & { error?: string }>(root, id, ms)
  if (a === null) return "the open UI did not answer in time"
  return a.error ? a.error : a
}

/** The look tools' answers: the page as text, or a capture of the window's place on the screen. */
export function lookTools(root: string, capture: (rect: Rect) => Uint8Array | string = screenCapture(root), ms = 10_000) {
  return async (name: string, args: { [k: string]: Json }): Promise<Json> => {
    if (name === "read_page") {
      const a = await askUi<{ text: string; truncated?: boolean }>(root, {
        kind: "read",
        ...(typeof args["selector"] === "string" ? { selector: args["selector"] } : {}),
        html: args["html"] === true,
      }, ms)
      if (typeof a === "string") return said(a, true)
      return said(a.text + (a.truncated ? "\n[cut: the page is longer; read a part of it with selector]" : ""))
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
    handlers: bridge.handlers,
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
