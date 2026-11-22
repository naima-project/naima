// Naima's bridge commands: everything the new UI reads and does, carried by the UI stance's bridge — in a browser by
// `naima ui`'s server (serve.ts), on the desktop by the Tauri shell and its Naima sidecar (sidecar.ts). The commands are
// Naima's; the stance defines only the carriers, and its request handler (bridge-handler.ts) is copied unchanged.
//
//   describe                       the project, and the actions the UI may run
//   data {view, at?, query?}       a `ui-views` view's data, what its command prints with --json; with `at`, as that
//                                  commit had it (at.ts), or, for a view that places a commit itself, about that commit;
//                                  `query` gives the view its parameters, such as the metric and the commit of the
//                                  record of a metric's run (the metrics plugin's metric-run)
//   tabs                           the tabs plugins contribute to the new UI, each with its subtabs
//   tab {name, sub?, at?, query?}  what a tab shows for a subtab at the moment: a component's data, the address of a
//                                  page of its folder, or a page it makes, as a whole HTML document the app frames
//   studies                        the Models tab's studies of the project, each declared by a `%@ui` block of a `.mcrl2`
//                                  file (studies.ts): { studies: [{ id, file, title, says, model, stepper, observer, view,
//                                  config, says_lines, problems }] }, no file contents
//   study {id}                     one study, with its stepper's bytes (`stepper`, base64) and the addresses of its frames
//                                  (`frames`: the host page, the observer and the view, the last two null when absent)
//                                  and the files a person may edit in the tab (`files`), the model first
//   study-file {id, file}          the text of one of those files
//   study-save {id, file, text}    writes it (study-work.ts): never a generated file, a build or a saved path
//   study-job {id, job, property?} starts a job of the Models tab's workbench under `naima run` (study-work.ts): check
//                                  (naima model-check on the study's properties, or on `property`), generate
//                                  (naima-codegen, then the study's build) or run (its program); answers the run's name,
//                                  which `run` reads with the end of its log
//   study-stop {run}               stops a job the tab started
//   metro                          what the rail draws: the trunk, the lines, the branches, the workers, the goals ahead,
//                                  the people, the checkouts and the stops' names
//   action {name, args}            one naima command of a short list, started through `naima run`: answers its run;
//                                  record-metrics records the metrics (naima metrics run --record), name-stop names a
//                                  commit of the map (naima name-stop)
//   run {name, tail?}              that run as `naima run status --json` shows it, with the end of its log (`tail` lines,
//                                  50 by default, at most 500)
//   show {screen|view|item|commit|line}  asks every UI open on the project to show that place (show.ts), as the
//                                  transition of the UI's sequence that shows it (agent.showScreen and the like):
//                                  what an agent calls to show the owner something; answers how many open UIs took it
//                                  and, when the UI refused it, why
//   chat-bring {kind, id, label, view, text}  brings an element of the UI to the chat session the person works in
//                                  (chat-channel.ts): { state: "nobody", message } when no session's naima MCP server
//                                  listens, the message composed for the person to copy, else { state: "sent", id,
//                                  message }, left for the one server that takes it into its session
//   chat-brought {id}              where that message stands: waiting, taken, read (the agent said it took it),
//                                  withdrawn or unknown
//   chat-withdraw {id}             withdraws it if no session took it yet: { withdrawn }
//   answer {id, ...}               the open UI's answer to an agent's question the feed show carried (the page as
//                                  text, where its window is), kept for the agent (show.ts)
//   agent-answer {id, ok, answer | error}  the open UI's answer to a request the feed agent carried, in the UI
//                                  stance's shape: the answer of the store, the registry or the transition, or why not;
//                                  kept for the agent (show.ts)
//
// and three feeds:
//
//   changes                        one event each time the project changes: a commit, a branch moved, the tracker's
//                                  files (live.ts); a hint to read again, never the data
//   show                           each question about the page an agent asked (its text, where its window is) and
//                                  the desktop window's raise, while the UI listening is open (show.ts)
//   agent                          each request on the open UI's store an agent asked, as { id, tool, args } (the UI
//                                  stance's agent feed): the store, the transitions, a transition by machine and name,
//                                  among them the show of a place, which is the transition of a named sequence (show.ts)
//
// Every command reads the files when it is called, so the UI is live.

import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { Buffer } from "node:buffer"
import { basename, dirname, join, resolve } from "node:path"
import {
  askHostsInBackground,
  type Context,
  findCodegen,
  gitReadScope,
  headCommit,
  installedProgram,
  installedPython,
  type InstalledToolRef,
  type KnownProject,
  knownProjects,
  personAtKeyboard,
} from "../../core/api.ts"
import { actionArgv, actionCommand, actionOf, ACTIONS, naimaEntry, runCommand, selfEntry } from "./actions.ts"
import { showCall } from "./agent-endpoint.ts"
import { AtCache, commitOf } from "./at.ts"
import { knownAt, recentProjects } from "./switch.ts"
import type { Feeds, Handlers, Json } from "./bridge-handler.ts"
import { type Change, snapshotAsync, watchProject } from "./live.ts"
import { stampOf, type ViewCache } from "./view-cache.ts"
import { PoolDown, type ViewPool } from "./view-pool.ts"
import { type AgentRequest, askAgent, awaitAnswer, listenShows, openUis, type Place, requestId, taken, type UiRequest, writeAnswer } from "./show.ts"
import { commandJson, type JsonOf, metroData, VIEW_OF_COMMAND } from "./metro.ts"
import { findStudies, savedPaths, type Study } from "./studies.ts"
import { bring as bringToChat, broughtOf, stand as chatStand, withdraw as withdrawChat } from "./chat-channel.ts"
import { inUiTab, spaceFile, spaceSystem, studyCache, studyCode, uiTab } from "./study-space.ts"
import { codegenCommand, codegenEnv, type Job, jobEnv, jobLine, readStudyFile, shellLine, studyFiles, writeStudyFile } from "./study-work.ts"
import { contentProblem, framePage, tabList, type UiTab, type UiTabContent, type UiView } from "./tabs.ts"

/**
 * The folder of the mCRL2 tools naima-codegen runs `mcrl22lps` from: the `bin` the mCRL2 plugin is given when it exists on
 * this machine, else the mCRL2 `naima tools install mcrl2` installed; none when neither is here and PATH has to serve.
 */
export function mcrl2Folders(ctx: Context): string[] {
  const bin = ctx.config.plugins["verifier-mcrl2"]?.options?.["bin"]
  if (typeof bin === "string" && existsSync(bin)) return [bin]
  const tool = ctx.registry.contributions("tools").map((c) => c.value as InstalledToolRef).find((t) => t.name === "mcrl2")
  const program = tool ? installedProgram(tool, "mcrl22lps") : null
  return program ? [dirname(program)] : []
}

export { actionArgv, actionCommand, actionOf, ACTIONS, naimaEntry, runCommand } from "./actions.ts"

export interface BridgeOptions {
  /** The views plugins contribute (`ui-views`), and the tabs (`ui-tabs` and every view not on a screen of its own). */
  views: readonly UiView[]
  tabs: readonly UiTab[]
  /** Where the carrier serves the file `rel` of the tab `tab`'s folder, for a page or a frame: an address the app's page can load. */
  fileUrl(tab: string, rel: string): string
  /** How often the project is looked at for the changes feed, and how long a change settles, in ms. */
  watch?: { interval?: number; debounce?: number }
  /**
   * Where the live views computed are kept between runs (view-cache.ts), so that a UI opened again draws at once: none
   * by default. A view answered from it is read again `recheck` ms later (2 s by default), and a change is said on the
   * feed when its answer moved.
   */
  cache?: ViewCache | null
  recheck?: number
  /**
   * Where the live views are rendered when given: off the serving thread, a few at a time (view-pool.ts), so that a slow
   * view holds no other request. A view the pool cannot render (no worker) is rendered in this thread, as without it.
   */
  pool?: ViewPool | null
  /** How an action's command line is started under `naima run`, before `--data` and the data this bridge shows: this program, as a person types it, by default. */
  entry?: readonly string[]
  /** What carries the UI that listens to the feed show, as an open UI says: browser or desktop. */
  carrier?: string
  /** How long the command show waits for the open UIs to take a show, in ms. */
  showWait?: number
  /** Opens a UI on the project when a show finds none open (hello's opener, at-start.ts): what it says, or null when it opened none. */
  openUi?(): Promise<string | null>
  /**
   * Switching to another recent project (switch.ts): whether this carrier can, and how; `to` is given a project of the
   * list other than this one. Without it the bridge lists the recent projects and switches to none.
   */
  switcher?: { can: boolean; to?(project: KnownProject): Promise<void> }
  /** The recent projects, the most recently opened first: the launcher's list by default. */
  known?(): readonly KnownProject[]
}

export { SHOW_SEQUENCES } from "./agent-endpoint.ts"

/** The transition a show's arguments name, or why it is refused (agent-endpoint.ts); a commit is made a full hash, which takes git. */
export const showOf = (ctx: Context, args: { [key: string]: Json }): { name: string; arg: string } | string => showCall(args, (ref) => commitOf(ctx, ref))

/** Naima's bridge: its commands and its feed, for a carrier to serve; `close` drops what the commands keep. */
export interface NaimaBridge {
  handlers: Handlers
  feeds: Feeds
  close(): void
}

const text = (v: Json | undefined): string | null => (typeof v === "string" && v.trim() ? v : null)

const json = (v: unknown): Json => JSON.parse(JSON.stringify(v ?? null)) as Json

/**
 * How long a live read's answer is shared with the same read asked again, in ms, unless the project changes first.
 * The app asks every screen's reads at once when it opens and again on every change, many of them the same (the gates,
 * the schedule); each read is the files and git read anew, so sharing them is what keeps the first screen fast.
 */
export const SHARE_MS = 10_000

/** Naima's bridge commands on the project `ctx` is about. */
export function naimaBridge(ctx: Context, opts: BridgeOptions): NaimaBridge {
  // The bridge lives as long as the page: a read never waits on a host over ssh (bugs/failed-tests-cold-load-waits-hosts-over).
  askHostsInBackground()
  const atCache = new AtCache()
  let runs = 0
  // The live reads under way or answered, by what they read: one answer for every ask until it is SHARE_MS old, the
  // project changes (the changes feed saw it) or an action runs; a read that fails is not kept.
  const shared = new Map<string, { at: number; answer: Promise<unknown> }>()
  const share = <T>(key: string, read: () => Promise<T>): Promise<T> => {
    const now = performance.now()
    const kept = shared.get(key)
    if (kept && now - kept.at < SHARE_MS) return kept.answer as Promise<T>
    const answer = read()
    shared.set(key, { at: now, answer })
    answer.catch(() => {
      if (shared.get(key)?.answer === answer) shared.delete(key)
    })
    return answer
  }
  // The views' cache on disk: each answer kept with the project's stamp, the one the change feed watches. The stamp is
  // read once, then again only after SHARE_MS or once the feed saw a change.
  // The stamp is read without holding the serving thread (a walk of the tracker's files takes 100 to 500 ms on a large
  // one), and every read asked meanwhile waits for the same walk.
  const cache = opts.cache ?? null
  let stamped: { at: number; stamp: Promise<string> } | null = null
  const stampNow = (): Promise<string> => {
    const now = performance.now()
    if (!stamped || now - stamped.at >= SHARE_MS) {
      stamped = { at: now, stamp: snapshotAsync(ctx).then((s) => stampOf({ head: s.head, refs: s.refs, items: s.items })) }
    }
    return stamped.stamp
  }
  // Who listens to the changes feed, and the views answered from the cache, read again once the first screen is drawn.
  const listeners = new Set<(c: Change) => void>()
  const rechecks = new Map<string, () => Promise<unknown>>()
  let recheckTimer: ReturnType<typeof setTimeout> | null = null
  const recheckSoon = (key: string, read: () => Promise<unknown>): void => {
    rechecks.set(key, read)
    if (recheckTimer) clearTimeout(recheckTimer)
    recheckTimer = setTimeout(() => void recheck(), opts.recheck ?? 2000)
    const t = recheckTimer as unknown
    if (typeof t === "number") (globalThis as { Deno?: { unrefTimer(id: number): void } }).Deno?.unrefTimer(t)
    else (t as { unref?: () => void }).unref?.()
  }
  const recheck = async (): Promise<void> => {
    recheckTimer = null
    const kept = [...rechecks]
    rechecks.clear()
    let moved = false
    for (const [key, read] of kept) {
      try {
        const was = shared.get(key)
        const fresh = await read()
        if (JSON.stringify(await was?.answer.catch(() => null)) !== JSON.stringify(fresh)) moved = true
        shared.set(key, { at: performance.now(), answer: Promise.resolve(fresh) })
      } catch {
        // A view that fails now is read again, and fails as it does, when next asked.
        shared.delete(key)
      }
    }
    if (moved) {
      const c: Change = { kinds: ["items"], head: headCommit(ctx.root) || null, at: ctx.now().toISOString() }
      for (const l of listeners) l(c)
    }
  }
  /** A view's data, live, shared with the same read asked again; `from` is the live context, read again when absent. */
  const live = (view: UiView, params: Record<string, string[]>, from?: Context): Promise<unknown> =>
    kept(`view ${view.name} ${JSON.stringify(params)}`, async () => {
      const here = async () => json((await view.render(params, from ?? momentOf(null))).data)
      if (!opts.pool || (from !== undefined && from !== ctx)) return await here()
      // A worker's answer is plain JSON data already: it is not copied again here.
      try {
        return await opts.pool.render(view.name, params)
      } catch (e) {
        if (e instanceof PoolDown) return await here()
        throw e
      }
    })
  /** A live read shared as `share` does, and answered from the views' cache while the project's stamp holds. */
  const kept = (key: string, compute: () => Promise<unknown>): Promise<unknown> => {
    const read = async (): Promise<unknown> => {
      const stamp = cache ? await stampNow() : ""
      // One view, or the rail's map, asks each git question once (gitReadScope). What compute answers is plain JSON data.
      const data = await gitReadScope(compute)
      if (cache) cache.put(key, stamp, data)
      return data
    }
    return share(key, async () => {
      const hit = cache ? cache.get(key, await stampNow()) : undefined
      if (hit === undefined) return read()
      recheckSoon(key, read)
      return hit
    })
  }
  /** What a command prints with --json, through the view whose data it is when there is one: what the metro reads. */
  const viaViews: JsonOf = async <T>(c: Context, words: string[]) => {
    const view = opts.views.find((v) => v.name === VIEW_OF_COMMAND[words.join(" ")])
    return view ? json(await live(view, {}, c)) as T : await commandJson<T>(c, words)
  }
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
  const known = opts.known ?? (() => knownProjects())
  /** A study of the project by its id, whole and openable, for the workbench's commands. */
  const studyOf = (id: Json | undefined): Study => {
    const study = findStudies(ctx.root, ctx.program, ctx.trackerRoot).find((s) => s.id === text(id))
    if (!study) throw new Error(`no study ${String(id)}`)
    return study
  }
  const handlers: Handlers = {
    describe: () =>
      json({
        app: "naima",
        root: ctx.root.split(/[\\/]/).filter(Boolean).pop() ?? "",
        path: resolve(ctx.root),
        actions: ACTIONS,
        uiTab: uiTab(ctx.root, ctx.program) !== null,
      }),
    recent: () => json({ projects: recentProjects(ctx.root, known()), canSwitch: opts.switcher?.can ?? false }),
    switch: async (args) => {
      const root = text(args["root"])
      const project = root === null ? null : knownAt(root, known())
      if (!project) throw new Error(`${String(args["root"])} is not one of the recent projects`)
      if (resolve(project.root) === resolve(ctx.root)) throw new Error("that is the project shown now")
      if (!opts.switcher?.can || !opts.switcher.to) throw new Error("this UI cannot switch project: start it with naima ui")
      await opts.switcher.to(project)
      return json({ root: project.root, path: resolve(project.root) })
    },
    data: async (args) => {
      const name = text(args["view"])
      const view = opts.views.find((v) => v.name === name)
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
      // A live read is plain JSON data already (live), shared by every ask: it is not copied for each.
      if (sha === null) return (await live(view, params)) as Json
      const from = view.moments ? momentOf(null) : atCache.get(ctx, sha)
      return json((await view.render(params, from)).data)
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
      const at = text(args["at"])
      // Live, a tab is read as a view is: shared with the same read asked again, answered from the views' cache while the
      // project's stamp holds, and rendered off the serving thread, so that a slow tab (the summary takes seconds on a
      // large tracker) holds no other request and no file of the page.
      const content =
        (at !== null ? await tab.render({ sub, query }, momentOf(at)) : await kept(`tab ${tab.name} ${JSON.stringify({ sub, query })}`, async () => {
          if (opts.pool) {
            try {
              return await opts.pool.renderTab(tab.name, { sub, query })
            } catch (e) {
              if (!(e instanceof PoolDown)) throw e
            }
          }
          return json(await tab.render({ sub, query }, momentOf(null)))
        })) as UiTabContent
      const problem = contentProblem(content)
      if (problem) throw new Error(`the ${tab.name} tab's content ${problem}`)
      return shown(tab, sub, content)
    },
    studies: (args) => {
      const all = findStudies(ctx.root, ctx.program, ctx.trackerRoot)
      if (text(args["source"]) !== "ui") return json({ studies: all })
      const tab = uiTab(ctx.root, ctx.program)
      return json({ studies: tab ? all.filter((s) => inUiTab(tab, s)) : [] })
    },
    study: (args) => {
      const id = text(args["id"])
      const study = findStudies(ctx.root, ctx.program, ctx.trackerRoot).find((s) => s.id === id)
      if (!study) throw new Error(`no study ${String(args["id"])}`)
      if (study.kind !== "declared") {
        // A default study: stepped through its generated code in a sandboxed frame, or on its space explored here.
        const code = study.kind === "codegen" ? studyCode(ctx.root, study) : null
        if (!code && !(study.system && existsSync(join(ctx.root, dirname(study.file), study.system)))) {
          throw new Error(`the model ${study.title} cannot open: ${study.problems.join("; ") || "it has no system to explore"}`)
        }
        const tab = uiTab(ctx.root, ctx.program)
        const card = tab?.card && inUiTab(tab, study) && existsSync(join(ctx.root, tab.card.page)) ? opts.fileUrl("ui-card", basename(tab.card.page)) : null
        return json({
          ...study,
          stepper: null,
          stepping: code ? "code" : "space",
          frames: {
            host: opts.fileUrl("naima-study", "host.html"),
            observer: null,
            view: null,
            code: code ? opts.fileUrl(`study-code-${study.id}`, code) : null,
            card,
            cardBuilt: tab?.card ? existsSync(join(ctx.root, tab.card.page)) : false,
          },
          saved: savedPaths(ctx.root, study) as unknown as Json,
          files: studyFiles(ctx.root, study),
        })
      }
      if (study.problems.length || study.stepper === null) throw new Error(`the study ${study.id} cannot open: ${study.problems.join("; ")}`)
      const dir = join(ctx.root, dirname(study.file))
      const stepper = Buffer.from(readFileSync(join(dir, study.stepper))).toString("base64")
      const frame = (rel: string | null): string | null => (rel === null ? null : opts.fileUrl(`study-${study.id}`, rel))
      return json({
        ...study,
        stepper,
        frames: { host: opts.fileUrl("naima-study", "host.html"), observer: frame(study.observer), view: frame(study.view) },
        saved: savedPaths(ctx.root, study) as unknown as Json,
        files: studyFiles(ctx.root, study),
      })
    },
    "study-file": (args) => {
      const study = studyOf(args["id"])
      const file = text(args["file"]) ?? ""
      return json({ file, text: readStudyFile(ctx.root, study, file) })
    },
    "study-save": (args) => {
      const study = studyOf(args["id"])
      const file = text(args["file"]) ?? ""
      const body = args["text"]
      if (typeof body !== "string") throw new Error("study-save takes the file's text")
      writeStudyFile(ctx.root, study, file, body)
      return json({ saved: file })
    },
    "study-job": async (args) => {
      const study = studyOf(args["id"])
      const job = String(args["job"])
      if (job !== "check" && job !== "generate" && job !== "run") throw new Error(`no job ${job}: the jobs are check, generate and run`)
      const windows = process.platform === "win32"
      const codegen = findCodegen(ctx.root)
      const python = installedPython()
      const line = jobLine(job as Job, study, {
        root: ctx.root,
        // This program, never the one the project pins: model-check may be newer than it.
        naima: actionCommand(opts.entry ?? selfEntry(), ctx.trackerRoot, []),
        codegen: codegenCommand(codegen, windows, python),
        windows,
      }, text(args["property"]) ?? undefined)
      if (typeof line !== "string") throw new Error(line.refused)
      const run = `ui-study-${job}-${ctx.now().toISOString().replace(/\D/g, "").slice(0, 14)}-${++runs}`
      // The run is started with this environment, handed to the process, not written into the line: the installed mCRL2 first
      // on PATH, and on Windows the batch file a study's build.cmd calls. Put back when the run has started.
      const env = jobEnv(codegenEnv(codegen, windows, python, process.env["NAIMA_CODEGEN_BATCH"] ?? null), mcrl2Folders(ctx), process.env["PATH"], windows)
      const before = Object.fromEntries(Object.keys(env).map((k) => [k, process.env[k]]))
      Object.assign(process.env, env)
      let started
      try {
        started = await runCommand(ctx, [
          "run",
          run,
          "--budget-time",
          job === "run" ? "1h" : "2h",
          ...(job === "check" ? ["--stale", "30m"] : [
            "--stale",
            "30m",
            "--no-progress",
            job === "generate" ? "naima-codegen and a study's build print their stages, not a count" : "a study's program writes what it writes",
          ]),
          "--",
          shellLine(line, windows),
        ])
      } finally {
        for (const [k, v] of Object.entries(before)) {
          if (v === undefined) delete process.env[k]
          else process.env[k] = v
        }
      }
      if (started.code !== 0) throw new Error(started.err.trim() || started.out.trim() || `naima run exited with ${started.code}`)
      return json({ run, job, command: line })
    },
    "study-explore": async (args) => {
      const study = studyOf(args["id"])
      const system = spaceSystem(ctx.root, study)
      if (!system || !existsSync(join(ctx.root, system))) throw new Error(`the model ${study.title} has no system to explore`)
      const bound = Math.max(1, Math.floor(Number(args["bound"]) || 20_000))
      const f = args["from"]
      const from = f && typeof f === "object" && !Array.isArray(f) ? Object.fromEntries(Object.entries(f).map(([k, v]) => [k, String(v)])) : null
      const out = spaceFile(ctx.root, system, bound, from)
      const key = basename(out)
      if (existsSync(out)) {
        const kept = JSON.parse(readFileSync(out, "utf8")) as Json
        // A failure is not kept: the tools may be installed since, or the time budget larger.
        if (!(kept && typeof kept === "object" && "failed" in kept)) return json({ key, space: kept })
      }
      const words = ["model-explore", system, "--out", out, "--max", String(bound)]
      if (from) {
        writeFileSync(`${out}.from`, JSON.stringify(from))
        words.push("--from", `${out}.from`)
      }
      const naima = actionCommand(opts.entry ?? selfEntry(), ctx.trackerRoot, [])
      const run = `ui-study-explore-${ctx.now().toISOString().replace(/\D/g, "").slice(0, 14)}-${++runs}`
      const started = await runCommand(ctx, ["run", run, "--budget-time", "30m", "--stale", "10m", "--", ...naima, ...words])
      if (started.code !== 0) throw new Error(started.err.trim() || started.out.trim() || `naima run exited with ${started.code}`)
      return json({ key, run })
    },
    "study-space": (args) => {
      const key = text(args["key"]) ?? ""
      if (!/^[0-9a-f]{24}\.json$/.test(key)) throw new Error("study-space names a space study-explore gave")
      const file = join(studyCache(ctx.root, "spaces"), key)
      if (!existsSync(file)) return json({ pending: true })
      return JSON.parse(readFileSync(file, "utf8")) as Json
    },
    "study-stop": async (args) => {
      const name = text(args["run"])
      if (name === null || !name.startsWith("ui-study-")) throw new Error("study-stop names a job the Models tab started")
      const r = await runCommand(ctx, ["run", "stop", name])
      if (r.code !== 0) throw new Error(r.err.trim() || `could not stop ${name}`)
      return json({ stopped: name })
    },
    metro: async () => (await kept("metro", async () => json(await metroData(momentOf(null), viaViews)))) as Json,
    action: async (args) => {
      shared.clear()
      stamped = null
      const argv = actionArgv(String(args["name"]), args["args"] ?? [])
      if (typeof argv === "string") throw new Error(argv)
      const action = actionOf(String(args["name"]))!
      const run = `ui-${argv[0]}-${ctx.now().toISOString().replace(/\D/g, "").slice(0, 14)}-${++runs}`
      // What the UI runs is the doing of the person at the keyboard, never an agent's own: --by names them, so a note
      // is theirs and each change records who ordered it, and the command it starts runs as a person's.
      const person = personAtKeyboard(ctx.root)?.name
      const by = person && !argv.includes("--by") ? ["--by", person] : []
      // The command it starts runs as a person's: said to that command alone, never by changing this process's environment.
      const started = await runCommand(
        ctx,
        [
          "run",
          run,
          "--budget-time",
          action.budget ?? "5m",
          ...(action.progress ? ["--stale", "10m"] : ["--stale", "1m", "--no-progress", "a naima command the UI ran, which prints its result when it ends"]),
          "--",
          ...actionCommand(opts.entry ?? naimaEntry(), ctx.trackerRoot, [...argv, ...by]),
        ],
        { NAIMA_ROLE: "person" },
      )
      if (started.code !== 0) throw new Error(started.err.trim() || started.out.trim() || `naima run exited with ${started.code}`)
      return json({ run, command: ["naima", ...argv] })
    },
    show: async (args) => {
      const show = showOf(ctx, args)
      if (typeof show === "string") throw new Error(show)
      const place = { sequence: show.name, arg: show.arg }
      if (!openUis(ctx.root).length) {
        const opened = opts.openUi ? await opts.openUi() : null
        // A UI just opened listens once its page has loaded: wait for it, a little longer than for a show.
        const until = Date.now() + (opts.showWait ?? 8000) * 3
        while (opened && !openUis(ctx.root).length && Date.now() < until) await new Promise((r) => setTimeout(r, 250))
        if (!openUis(ctx.root).length) {
          return json({
            shown: false,
            open: 0,
            place,
            says: opened
              ? `no Naima UI was open on this project; one is opening (${opened}) but did not listen in time: show again`
              : "no Naima UI is open on this project, and none could be opened: the owner opens one with naima ui",
          })
        }
      }
      // The show is the transition of the agent's sequence, which the UI carries out and answers.
      const id = requestId()
      const asked = askAgent(ctx.root, { id, tool: "transition", args: { machine: "agent", name: show.name, args: [show.arg] } })
      const wait = opts.showWait ?? 8000
      const answer = await awaitAnswer<{ done?: boolean; says?: string; error?: string }>(ctx.root, id, wait)
      const { open, took } = await taken(ctx.root, asked, 1000, "agent")
      const shown = answer?.done === true
      return json({
        shown,
        open,
        took,
        place,
        says: answer === null
          ? `none of the ${open} open UIs answered within ${Math.round(wait / 1000)} s: one busy reading may still`
          : shown
          ? `shown in ${took} of the ${open} open UIs`
          : `not shown: ${answer.error ?? answer.says ?? "the UI refused it now"}`,
      })
    },
    "chat-bring": (args) => {
      const b = broughtOf(args)
      if (typeof b === "string") throw new Error(b)
      return json(bringToChat(ctx.root, b))
    },
    "chat-brought": (args) => json({ state: chatStand(ctx.root, text(args["id"]) ?? "") }),
    "chat-withdraw": (args) => json({ withdrawn: withdrawChat(ctx.root, text(args["id"]) ?? "") }),
    answer: (args) => {
      const id = text(args["id"])
      if (id === null) throw new Error("answer names the request it answers: id")
      if (JSON.stringify(args).length > 1_000_000) throw new Error("the answer is too large")
      writeAnswer(ctx.root, id, args)
      return true
    },
    "agent-answer": (args) => {
      const id = text(args["id"])
      if (id === null) throw new Error("agent-answer names the request it answers: id")
      if (JSON.stringify(args).length > 1_000_000) throw new Error("the answer is too large")
      // The stance's shape is { id, ok: true, answer } or { id, ok: false, error }; what the agent reads is the answer's
      // own fields, or the error.
      const answer = args["answer"]
      writeAnswer(
        ctx.root,
        id,
        args["ok"] === true
          ? typeof answer === "object" && answer !== null && !Array.isArray(answer) ? answer : { value: answer ?? null }
          : { error: String(args["error"] ?? "the page refused") },
      )
      return true
    },
    run: async (args) => {
      const name = text(args["name"])
      if (name === null || !name.startsWith("ui-")) throw new Error("run names a run an action started")
      const tail = Math.min(500, Math.max(1, Number(args["tail"]) || 50))
      const r = await runCommand(ctx, ["run", "status", name, "--json", "--tail", String(tail)])
      if (r.code !== 0) throw new Error(r.err.trim() || `no run ${name}`)
      return JSON.parse(r.out) as Json
    },
  }
  // One UI hears the feeds show and agent, and is open once: they share the listener on the files (show.ts), which runs
  // while either is listened to.
  const heard = (() => {
    const emitters = { show: new Set<(e: Json) => void>(), agent: new Set<(e: Json) => void>() }
    let listening: { stop(): void } | null = null
    const carrier = opts.carrier ?? "browser"
    const start = () =>
      listenShows(
        ctx.root,
        carrier,
        (place: Place | UiRequest) => {
          // A raise is the desktop app's window coming forward, which its shell takes: a page in a browser has nothing to do.
          if (place.kind === "raise" && carrier !== "desktop") return
          for (const emit of emitters.show) emit(json(place))
        },
        (request: AgentRequest) => {
          for (const emit of emitters.agent) emit(json(request))
        },
      )
    return {
      add(feed: "show" | "agent", emit: (e: Json) => void): () => void {
        emitters[feed].add(emit)
        listening ??= start()
        return () => {
          emitters[feed].delete(emit)
          if (!emitters.show.size && !emitters.agent.size) {
            listening?.stop()
            listening = null
          }
        }
      },
    }
  })()
  const feeds: Feeds = {
    changes: (emit) => {
      const said = (c: Change) => emit(json(c))
      listeners.add(said)
      const watch = watchProject(ctx, (c) => {
        shared.clear()
        stamped = null
        emit(json(c))
      }, opts.watch ?? {})
      return () => {
        listeners.delete(said)
        watch.stop()
      }
    },
    show: (emit) => heard.add("show", emit),
    agent: (emit) => heard.add("agent", emit),
  }
  return {
    handlers,
    feeds,
    close: () => {
      if (recheckTimer) clearTimeout(recheckTimer)
      rechecks.clear()
      atCache.clear()
      shared.clear()
      opts.pool?.close()
    },
  }
}
