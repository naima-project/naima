// Naima's bridge commands: everything the new UI reads and does, carried by the UI stance's bridge — in a browser by
// `naima ui`'s server (serve.ts), on the desktop by the Tauri shell and its Naima sidecar (sidecar.ts). The commands are
// Naima's; the stance defines only the carriers, and its request handler (bridge-handler.ts) is copied unchanged.
//
//   describe                       the project, and the actions the UI may run
//   data {view, at?}               a `ui-views` view's data, what its command prints with --json; with `at`, as that
//                                  commit had it (at.ts), or, for a view that places a commit itself, about that commit
//   tabs                           the tabs plugins contribute to the new UI, each with its subtabs
//   tab {name, sub?, at?, query?}  what a tab shows for a subtab at the moment: a component's data, the address of a
//                                  page of its folder, or a page it makes, as a whole HTML document the app frames
//   metro                          what the rail draws: the trunk, the lines, the branches, the workers, the goals ahead
//   action {name, args}            one naima command of a short list, started through `naima run`: answers its run
//   run {name}                     that run as `naima run status --json` shows it, with the end of its log
//
// and one feed:
//
//   changes                        one event each time the project changes: a commit, a branch moved, the tracker's
//                                  files (live.ts); a hint to read again, never the data
//
// Every command reads the files when it is called, so the UI is live.

import { join } from "node:path"
import { fileURLToPath } from "node:url"
import type { Command, Context } from "../../core/api.ts"
import { AtCache, commitOf } from "./at.ts"
import type { Feeds, Handlers, Json } from "./bridge-handler.ts"
import { watchProject } from "./live.ts"
import { metroData } from "./metro.ts"
import { contentProblem, framePage, tabList, type UiTab, type UiTabContent, type UiView } from "./tabs.ts"

/** The actions the UI may run: its name, the command's words, and what it does. None of them rewrites history. */
export const ACTIONS: readonly { name: string; words: string[]; says: string }[] = [
  { name: "decide", words: ["decide"], says: "record a decision on an item" },
  { name: "note", words: ["note"], says: "add a note to an item" },
  { name: "gate-step", words: ["gate", "step"], says: "close a step of a gate with the item that records it (not add or remove one)" },
  { name: "claim", words: ["claim"], says: "claim items for this branch, or post its step" },
  { name: "release", words: ["release"], says: "release this branch's claim" },
]

/** The command line of an action, or why it is refused. */
export function actionArgv(name: string, args: unknown): string[] | string {
  const action = ACTIONS.find((a) => a.name === name)
  if (!action) return `no action ${name}: the actions are ${ACTIONS.map((a) => a.name).join(", ")}`
  if (!Array.isArray(args) || !args.every((a) => typeof a === "string")) return "args is a list of strings, the arguments after the command"
  // gate step add and remove change what a gate is; only closing a step is the UI's.
  if (action.name === "gate-step" && (args[0] === "add" || args[0] === "remove")) return `gate step ${args[0]} is not an action of the UI`
  return [...action.words, ...(args as string[])]
}

/** The program that is running: the directory above src/. */
const PROGRAM = fileURLToPath(new URL("../../../", import.meta.url))

/** How a command of this program is started as a person types it: on Deno through the launcher, which sets its permissions. */
export function naimaEntry(): string[] {
  const deno = (globalThis as { Deno?: { execPath(): string } }).Deno
  return deno ? [deno.execPath(), "run", "-A", join(PROGRAM, "naima.ts")] : [process.execPath, join(PROGRAM, "src", "cli.ts")]
}

/** Runs a naima command in this process, through the command the registry holds, and keeps what it prints. */
export async function runCommand(ctx: Context, words: readonly string[]): Promise<{ code: number; out: string; err: string }> {
  const cmd = ctx.registry.find<Command>("commands", words[0]!)?.value
  if (!cmd) return { code: 2, out: "", err: `no command ${words[0]}` }
  const out: string[] = []
  const err: string[] = []
  const quiet = Object.create(ctx, { out: { value: (l = "") => void out.push(l) }, err: { value: (l = "") => void err.push(l) } }) as Context
  try {
    const code = await cmd.run(words.slice(1), quiet)
    return { code: typeof code === "number" ? code : 0, out: out.join("\n"), err: err.join("\n") }
  } catch (e) {
    return { code: 1, out: out.join("\n"), err: [...err, e instanceof Error ? e.message : String(e)].join("\n") }
  }
}

export interface BridgeOptions {
  /** The views plugins contribute (`ui-views`), and the tabs (`ui-tabs` and every view not on a screen of its own). */
  views: readonly UiView[]
  tabs: readonly UiTab[]
  /** Where the carrier serves the file `rel` of the tab `tab`'s folder, for a page or a frame: an address the app's page can load. */
  fileUrl(tab: string, rel: string): string
  /** How often the project is looked at for the changes feed, and how long a change settles, in ms. */
  watch?: { interval?: number; debounce?: number }
  /** How an action's command line is started under `naima run`: this program, as a person types it, by default. */
  entry?: readonly string[]
}

/** Naima's bridge: its commands and its feed, for a carrier to serve; `close` drops what the commands keep. */
export interface NaimaBridge {
  handlers: Handlers
  feeds: Feeds
  close(): void
}

const text = (v: Json | undefined): string | null => (typeof v === "string" && v.trim() ? v : null)

const json = (v: unknown): Json => JSON.parse(JSON.stringify(v ?? null)) as Json

/** Naima's bridge commands on the project `ctx` is about. */
export function naimaBridge(ctx: Context, opts: BridgeOptions): NaimaBridge {
  const atCache = new AtCache()
  let runs = 0
  /** The context of the moment `at` names, the live one, read again, when absent. */
  const momentOf = (at: string | null): Context => {
    if (at === null) {
      ctx.reload()
      return ctx
    }
    return atCache.get(ctx, commitOf(ctx, at))
  }
  /** What a tab shows, as the app takes it: every path of its folder made the address the carrier serves it at. */
  const shown = (tab: UiTab, sub: string | null, c: UiTabContent): Json => {
    const head = { tab: tab.name, sub }
    if ("page" in c) return json({ ...head, page: opts.fileUrl(tab.name, c.page) })
    if ("html" in c) return json({ ...head, html: framePage(tab.title, c.html, c.css) })
    if (c.component === "gallery") {
      const sections = c.data.sections.map((s) => ({ ...s, frames: s.frames.map((f) => ({ ...f, src: opts.fileUrl(tab.name, f.src) })) }))
      return json({ ...head, ...c, data: { ...c.data, sections } })
    }
    if (c.component === "list") {
      const items = c.data.items.map((i) => (i.src === undefined ? i : { ...i, src: opts.fileUrl(tab.name, i.src) }))
      return json({ ...head, ...c, data: { ...c.data, items } })
    }
    return json({ ...head, ...c })
  }
  const handlers: Handlers = {
    describe: () => json({ app: "naima", root: ctx.root.split(/[\\/]/).filter(Boolean).pop() ?? "", actions: ACTIONS }),
    data: async (args) => {
      const name = text(args["view"])
      const view = opts.views.find((v) => v.name === name)
      if (!view) throw new Error(`no view ${String(args["view"])}`)
      const at = text(args["at"])
      const sha = at === null ? null : commitOf(ctx, at)
      // A view that places a commit itself is read from the files as they are, with the commit as its parameter.
      const from = sha !== null && !view.moments ? atCache.get(ctx, sha) : momentOf(null)
      return json((await view.render(sha !== null && view.moments ? { at: [sha] } : {}, from)).data)
    },
    tabs: () => json(tabList(opts.tabs)),
    tab: async (args) => {
      const name = text(args["name"])
      const tab = opts.tabs.find((t) => t.name === name)
      if (!tab) throw new Error(`no tab ${String(args["name"])}`)
      const subs = tab.subtabs ?? []
      const sub = text(args["sub"]) ?? subs[0]?.name ?? null
      if (sub !== null && !subs.some((s) => s.name === sub)) throw new Error(`the tab ${tab.name} has no subtab ${sub}`)
      const q = args["query"]
      const query: Record<string, string[]> = {}
      if (q && typeof q === "object" && !Array.isArray(q)) {
        for (const [k, v] of Object.entries(q)) if (typeof v === "string") query[k] = [v]
      }
      const content = await tab.render({ sub, query }, momentOf(text(args["at"])))
      const problem = contentProblem(content)
      if (problem) throw new Error(`the ${tab.name} tab's content ${problem}`)
      return shown(tab, sub, content)
    },
    metro: async () => json(await metroData(momentOf(null))),
    action: async (args) => {
      const argv = actionArgv(String(args["name"]), args["args"] ?? [])
      if (typeof argv === "string") throw new Error(argv)
      const run = `ui-${argv[0]}-${ctx.now().toISOString().replace(/\D/g, "").slice(0, 14)}-${++runs}`
      const started = await runCommand(ctx, [
        "run",
        run,
        "--budget-time",
        "5m",
        "--stale",
        "1m",
        "--no-progress",
        "a naima command the UI ran, which prints its result when it ends",
        "--",
        ...(opts.entry ?? naimaEntry()),
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
  const feeds: Feeds = {
    changes: (emit) => {
      const watch = watchProject(ctx, (c) => emit(json(c)), opts.watch ?? {})
      return () => watch.stop()
    },
  }
  return { handlers, feeds, close: () => atCache.clear() }
}
