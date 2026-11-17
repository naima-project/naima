// Naima's tracker server for agents: `naima ui --mcp-tracker` serves an MCP server on its standard input and output
// that only reads the tracker and runs the UI's short list of actions. It has nothing of the screen in it: it reads
// Naima's core directly (the views the plugins contribute, the lines' map, git) and never asks the UI open on the
// project anything. Whatever drives the screen, reads what it shows or takes its picture is the other server, the
// UI's (mcp.ts, `naima ui --mcp`), which reaches the open UI only through the agent channel.
//
// Its tools are made for an agent with a budget of tokens: each read tool answers like a screen at a glance, in plain
// text, and gives one thing's details by its id (mcp-tools.ts); view gives a view's raw data in pages (mcp-pages.ts)
// for what they do not answer; action and run run the UI's actions as runs of `naima run` and show them.
//
//   claude mcp add naima-tracker -- naima ui --mcp-tracker        (run in the project's folder; any MCP client starts it the same way)

import { createInterface } from "node:readline"
import type { Readable } from "node:stream"
import { basename, resolve } from "node:path"
import { type Context, gitOrNull, gitReadScope } from "../../core/api.ts"
import { actionArgv, actionOf, ACTIONS, naimaEntry, runCommand } from "./actions.ts"
import { AtCache, commitOf } from "./at.ts"
import { bridgeMcp, type McpTool, serveMcpLines } from "./bridge-mcp.ts"
import type { Handlers, Json } from "./bridge-handler.ts"
import { commandJson, type JsonOf, metroData, VIEW_OF_COMMAND } from "./metro.ts"
import { PAGE_PROPERTIES, paged, splitArgs } from "./mcp-pages.ts"
import { agentTools, bounded, cut, HARD_BOUND, type Reader, TOOL_SPECS } from "./mcp-tools.ts"
import type { UiView } from "./tabs.ts"

const obj = (properties: Record<string, unknown>, required: string[] = []) =>
  JSON.parse(JSON.stringify({ type: "object", properties, ...(required.length ? { required } : {}) }))

const str = (description: string) => ({ type: "string", description })

const text = (v: Json | undefined): string | null => (typeof v === "string" && v.trim() ? v : null)

const json = (v: unknown): Json => JSON.parse(JSON.stringify(v ?? null)) as Json

/** The tools, with what each does for an agent: the read tools, view, and the actions. */
export function trackerTools(views: readonly string[]): { [command: string]: McpTool } {
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
  }
}

export const INSTRUCTIONS = "Naima's project tracker. Answers are short plain text; ask for one thing by its id for more. " +
  "Start with overview. items: one item by ref, or a search with counts. gates: why a gate is blocked. lines: the trunk, lines and branches. " +
  "history: a day or a commit. work: claims, queue, stale work. metrics: values and trends. view: a view's raw data, in pages, only when those do not answer. " +
  "action runs one of the UI's short list of actions as a run of naima run, and run shows it. " +
  `No reply passes ${HARD_BOUND} characters; a cut one says how to narrow it. ` +
  "This server never touches the screen: to show the owner something, read what the owner sees or move the UI, use the other server, naima-ui."

/** What the tracker's reads and actions need of the project, read straight from Naima's core: no UI, no feed, no page. */
export interface TrackerReads {
  handlers: Handlers
  close(): void
}

/** The commands `data`, `metro`, `action` and `run` on the project `ctx` is about, over the views the plugins contribute. */
export function trackerReads(ctx: Context, views: readonly UiView[], entry: readonly string[] = naimaEntry()): TrackerReads {
  const atCache = new AtCache()
  let runs = 0
  /** The context of the moment `at` names; the live one, read again, when absent. */
  const momentOf = (at: string | null): Context => {
    if (at === null) {
      ctx.reload()
      return ctx
    }
    return atCache.get(ctx, commitOf(ctx, at))
  }
  const viaViews: JsonOf = async <T>(c: Context, words: string[]) => {
    const view = views.find((v) => v.name === VIEW_OF_COMMAND[words.join(" ")])
    return view ? json((await view.render({}, c)).data) as T : await commandJson<T>(c, words)
  }
  const handlers: Handlers = {
    data: async (args) => {
      const name = text(args["view"])
      const view = views.find((v) => v.name === name)
      if (!view) throw new Error(`no view ${String(args["view"])}`)
      const at = text(args["at"])
      const sha = at === null ? null : commitOf(ctx, at)
      const params: Record<string, string[]> = {}
      const q = args["query"]
      if (q && typeof q === "object" && !Array.isArray(q)) {
        for (const [k, v] of Object.entries(q)) if (typeof v === "string" && k !== "at") params[k] = [v]
      }
      // A view that places a commit itself is read from the files as they are, with the commit as its parameter.
      if (sha !== null && view.moments) params["at"] = [sha]
      const from = sha === null || view.moments ? momentOf(null) : atCache.get(ctx, sha)
      return json(await gitReadScope(async () => (await view.render(params, from)).data))
    },
    metro: async () => json(await gitReadScope(() => metroData(momentOf(null), viaViews))),
    action: async (args) => {
      const argv = actionArgv(String(args["name"]), args["args"] ?? [])
      if (typeof argv === "string") throw new Error(argv)
      const action = actionOf(String(args["name"]))!
      const run = `ui-${argv[0]}-${ctx.now().toISOString().replace(/\D/g, "").slice(0, 14)}-${++runs}`
      const started = await runCommand(ctx, [
        "run",
        run,
        "--budget-time",
        action.budget ?? "5m",
        ...(action.progress ? ["--stale", "10m"] : ["--stale", "1m", "--no-progress", "a naima command the UI ran, which prints its result when it ends"]),
        "--",
        ...entry,
        ...argv,
      ])
      if (started.code !== 0) throw new Error(started.err.trim() || started.out.trim() || `naima run exited with ${started.code}`)
      return json({ run, command: ["naima", ...argv] })
    },
    run: async (args) => {
      const name = text(args["name"])
      if (name === null || !name.startsWith("ui-")) throw new Error("run names a run an action started")
      const r = await runCommand(ctx, ["run", "status", name, "--json", "--tail", "50"])
      if (r.code !== 0) throw new Error(r.err.trim() || `no run ${name}`)
      return JSON.parse(r.out) as Json
    },
  }
  return { handlers, close: () => atCache.clear() }
}

/** What the read tools read, through the views and the map: and a commit as git tells it. */
export function trackerReader(ctx: Context, reads: Handlers): Reader {
  return {
    name: basename(resolve(ctx.root)),
    today: () => ctx.now().toISOString().slice(0, 10),
    view: async (name, query) => await reads["data"]!({ view: name, ...(query ? { query } : {}) }),
    metro: async () => await reads["metro"]!({}),
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

/** The server's commands: the read tools, view in pages, run's log cut short, and the action. */
export function trackerHandlers(reads: Handlers, reader: Reader, commitTime: (ref: string) => number | null): Handlers {
  const out: Handlers = {}
  const act = reads["action"]
  if (act) {
    out["action"] = async (args) => {
      // An agent proposes a plan; approving it is the owner's, from the UI.
      if (args["name"] === "plan-approve") {
        throw new Error("plan-approve is the owner's: an agent proposes with plan-propose, and the owner approves on the Plan view")
      }
      const a = await act(args)
      const says = typeof a === "object" && a !== null && !Array.isArray(a) ? a["says"] : undefined
      return typeof says === "string" ? says : typeof a === "string" ? a : JSON.stringify(a)
    }
  }
  for (const [name, answer] of Object.entries(agentTools(reader))) out[name] = async (args) => bounded(await answer(args), "narrow the call")
  out["view"] = async (args) => {
    const { page, rest } = splitArgs(args)
    return JSON.stringify(paged(await reads["data"]!(rest), page, commitTime))
  }
  if (reads["run"]) {
    out["run"] = async (args) => {
      const r = (await reads["run"]!({ name: args["name"] ?? null })) as { [k: string]: Json }
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

export interface TrackerMcpOptions {
  views: readonly UiView[]
  version: string
  input: Readable
  write(line: string): void
}

/** Serves the tracker as an MCP server until the input ends; returns the exit code. */
export async function runTrackerMcp(ctx: Context, opts: TrackerMcpOptions): Promise<number> {
  const reads = trackerReads(ctx, opts.views)
  const server = bridgeMcp({
    name: "naima-tracker",
    version: opts.version,
    instructions: INSTRUCTIONS,
    handlers: trackerHandlers(reads.handlers, trackerReader(ctx, reads.handlers), commitTime(ctx.root)),
    tools: trackerTools(opts.views.map((v) => v.name)),
  })
  try {
    await serveMcpLines(server, createInterface({ input: opts.input, crlfDelay: Infinity }), opts.write)
    return 0
  } finally {
    reads.close()
  }
}
