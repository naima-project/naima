// Naima's bridge for agents: `naima ui --mcp` serves the bridge commands the new UI uses (bridge.ts) as an MCP server
// on its standard input and output, through the UI stance's bridge-mcp.ts, copied unchanged like its request handler.
// An agent reads the project's views and runs the UI's actions through exactly what the UI uses, and shows the owner
// a place in the UI open on the project (the command show), instead of making a page of its own.
//
//   claude mcp add naima -- naima ui --mcp        (run in the project's folder; any MCP client starts it the same way)

import { createInterface } from "node:readline"
import type { Readable } from "node:stream"
import type { Context } from "../../core/api.ts"
import { naimaBridge } from "./bridge.ts"
import { bridgeMcp, type McpTool, serveMcpLines } from "./bridge-mcp.ts"
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
  "Naima's project tracker and UI. Read the project through data, tab and metro, exactly as the UI does. To show the owner something (a screen, an item, a commit, a line), call show: it navigates the Naima UI the owner has open, live, and is preferred to making a separate page or artifact. When no UI is open, show opens one; if it says none could be opened, tell the owner to run naima ui."

export interface McpOptions {
  views: readonly UiView[]
  tabs: readonly UiTab[]
  version: string
  /** Opens a UI on the project when a show finds none open: hello's opener by default. */
  openUi?(): Promise<string | null>
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
  const mcp = bridgeMcp({
    name: "naima",
    version: opts.version,
    instructions: INSTRUCTIONS,
    handlers: bridge.handlers,
    tools: naimaTools(opts.views.map((v) => v.name), opts.tabs.map((t) => t.name)),
  })
  try {
    await serveMcpLines(mcp, createInterface({ input: opts.input, crlfDelay: Infinity }), opts.write)
    return 0
  } finally {
    bridge.close()
  }
}
