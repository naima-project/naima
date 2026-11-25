// Naima as the desktop app's sidecar: `naima ui --sidecar`, which the Tauri shell starts in the project's folder and
// talks to over its standard input and output, one JSON object a line, with no network listener. It answers the same
// bridge commands the browser reaches over HTTP (bridge.ts), and two more the shell itself needs: `file`, which reads a
// file of a tab's folder for the shell's naima-files: scheme, the desktop's way of framing a tab's pages, and `bundle`,
// which names the folder of the UI bundle this Naima serves (ui/dist), so that the app shows the project's current UI.
//
//   in   {"id": 1, "command": "data", "args": {"view": "gates"}}
//   out  {"id": 1, "ok": <answer>}  or  {"id": 1, "error": "..."}
//   out  {"feed": "changes", "event": {...}}          each change of the project, pushed as it comes
//   out  {"feed": "show", "event": {...}}             each question about the page an agent asked (show.ts), pushed the same way
//   out  {"feed": "agent", "event": {...}}            each request on the page's store an agent asked, a show among them (show.ts)
//
// It stops when its standard input ends, as it does when the shell quits, once every request it read is answered: the
// machine below, generated from the protocol's model, decides when.

import { readFileSync } from "node:fs"
import { extname } from "node:path"
import { createInterface } from "node:readline"
import type { Readable } from "node:stream"
import type { Context } from "../../core/api.ts"
import { viewCache } from "./view-cache.ts"
import { type Remote } from "./remote.ts"
import { restartWatch } from "./restart.ts"
import type { ViewPool } from "./view-pool.ts"
import { naimaBridge } from "./bridge.ts"
import * as Model from "./generated/sidecar.ts"
import type { Feeds, Handlers, Json } from "./bridge-handler.ts"
import { BUNDLE, fileIn } from "./serve.ts"
import type { ReloadWatch } from "./watch.ts"
import { PAGE_TYPES, type UiTab, type UiView } from "./tabs.ts"

/** Where the desktop's webview loads a file of a tab's folder: the shell's naima-files: scheme, which WebView2 names as a host. */
export function desktopFileUrl(os: string, tab: string, rel: string): string {
  const path = `${encodeURIComponent(tab)}/${rel.split(/[\\/]/).filter((s) => s && s !== ".").map(encodeURIComponent).join("/")}`
  return os === "windows" ? `http://naima-files.localhost/${path}` : `naima-files://localhost/${path}`
}

export interface SidecarOptions {
  views: readonly UiView[]
  tabs: readonly UiTab[]
  /** The folder of a tab's files now, by the tab's name. */
  tabFolder(tab: string): string | null
  os: string
  /** The folder of the UI bundle the shell shows: this Naima's ui/dist by default. */
  bundle?: string
  input: Readable
  write(line: string): void
  watch?: { interval?: number; debounce?: number }
  /** --watch: the feed reload, which tells the shell to reload its page when the UI is rebuilt (watch.ts). */
  reload?: ReloadWatch
  /** The views and tabs are rendered in this pool of worker threads, a few at a time, instead of one after another on the thread that answers the shell. */
  pool?: ViewPool
  /** Told one line per view read (the bridge's trace). */
  trace?: (line: string) => void
  /** Told each event of the sidecar's machine and each action it takes, as its model's action record has them. */
  record?: (entry: SidecarEntry) => void
  /** A UI server already runs on the project: the commands and feeds are its, and this sidecar serves nothing of its own (remote.ts). */
  remote?: Remote
  /** Called when naima update moved the program: the shell starts the sidecar again on the new one. Pushed as the feed restart. */
  restartWatch?: typeof restartWatch
}

/** An event of the sidecar's machine, or an action it takes: the entries of its model's action record. */
export type SidecarEntry =
  | { event: { type: "request" | "answer"; req: number | null } | { type: "stdinEnd" | "change" } }
  | { action: { type: "push" | "exit" } }

/**
 * The sidecar's own state, the Core of its model in the workshop (develop/models/ui/sidecar/model/core.mcrl2), stepped
 * by the module naima-codegen generates from it (generated/sidecar.ts, a copy kept equal to the generated one): whether
 * the standard input is open, how many handlers are in flight, whether a change is to be pushed and whether the
 * sidecar has stopped. Each method is the input of the same name; the model decides the outputs, a change pushed before
 * the sidecar stops. The id of a request travels with it, so the machine only counts, and every request is the model's
 * first.
 */
export class SidecarMachine {
  #state: Model.State = Model.initial({}).state
  readonly #act: (action: "push" | "exit") => void
  readonly #record: ((entry: SidecarEntry) => void) | undefined

  constructor(act: (action: "push" | "exit") => void, record?: (entry: SidecarEntry) => void) {
    this.#act = act
    this.#record = record
  }

  get done(): boolean {
    return this.#state.done
  }

  /** A request line read: its handler starts. Refused once the input has ended. */
  request(req: number | null): boolean {
    return this.#input({ type: "request", req: "R1" }, { event: { type: "request", req } })
  }

  /** A handler settled, its answer line written. */
  answer(req: number | null): boolean {
    return this.#input({ type: "answer", req: "R1" }, { event: { type: "answer", req } })
  }

  /** The standard input ended. */
  stdinEnd(): boolean {
    return this.#input({ type: "stdinEnd" }, { event: { type: "stdinEnd" } })
  }

  /** The project changed: pushed while the sidecar runs, refused once it has stopped. */
  change(): boolean {
    return this.#input({ type: "change" }, { event: { type: "change" } })
  }

  #input(event: Model.Event, entry: SidecarEntry): boolean {
    const next = Model.step(this.#state, event)
    if (next === null) return false
    this.#record?.(entry)
    this.#state = next.state
    for (const action of next.actions) {
      this.#record?.({ action: { type: action.type } })
      this.#act(action.type)
    }
    return true
  }
}

/**
 * The commands the sidecar answers: every one of the bridge's table, the same that `naima ui` answers over HTTP, so that a
 * command the bridge gains (the Models tab's studies, study and jobs) reaches the desktop app with nothing else to list,
 * and two of the shell's own: `bundle`, the folder of the page it shows, and `file`, a file of a tab's folder.
 */
export function sidecarHandlers(bridge: Handlers, opts: Pick<SidecarOptions, "bundle" | "tabFolder">): Handlers {
  return {
    ...bridge,
    bundle: () => ({ dir: opts.bundle ?? BUNDLE }),
    file: ({ tab, path }) => {
      const dir = opts.tabFolder(String(tab))
      const found = dir ? fileIn(dir, String(path ?? ""), PAGE_TYPES) : null
      if (!found) throw new Error(`no file ${String(path)} in the ${String(tab)} tab`)
      return { type: PAGE_TYPES[extname(found).toLowerCase()]!, base64: readFileSync(found).toString("base64") }
    },
  }
}

/** The bridge of a sidecar attached to a server: no commands of its own, the server's feeds. */
function remoteBridge(remote: Remote): { handlers: Handlers; feeds: Feeds; close(): void } {
  const feeds: Feeds = {}
  for (const name of ["changes", "show", "agent", "reload"]) feeds[name] = (emit) => remote.feed(name, emit)
  return { handlers: {}, feeds, close() {} }
}

/** Answers the shell until its input ends and every request read is answered; returns the exit code. */
export async function runSidecar(ctx: Context, opts: SidecarOptions): Promise<number> {
  const remote = opts.remote
  const bridge = remote ? remoteBridge(remote) : naimaBridge(ctx, {
    views: opts.views,
    tabs: opts.tabs,
    fileUrl: (tab, rel) => desktopFileUrl(opts.os, tab, rel),
    // A UI opened again on a large project draws from the views kept on disk, then reads them again.
    cache: viewCache(ctx),
    ...(opts.pool ? { pool: opts.pool } : {}),
    ...(opts.trace ? { trace: opts.trace } : {}),
    carrier: "desktop",
    // The shell switches project itself, restarting the sidecar in the one chosen: the sidecar only lists them.
    switcher: { can: true },
    ...(opts.watch ? { watch: opts.watch } : {}),
  })
  const handlers = sidecarHandlers(bridge.handlers, opts)
  const lookup = (command: string): Handlers[string] | undefined =>
    Object.hasOwn(handlers, command) ? handlers[command] : remote ? (args) => remote.call(command, args) : undefined
  const send = (message: { [key: string]: Json }) => opts.write(JSON.stringify(message))
  let exited: () => void = () => {}
  const stopped = new Promise<void>((resolve) => (exited = resolve))
  // The feed's event to push, with its feed: the machine decides whether it is pushed, the event travels beside it.
  // All the feeds are its one input change, which it pushes at once: a show is pushed as a change of the project is.
  let event: { feed: string; event: Json } = { feed: "changes", event: null }
  const machine = new SidecarMachine((action) => {
    if (action === "push") send(event)
    else exited()
  }, opts.record)
  const feeds = opts.reload ? { ...bridge.feeds, reload: opts.reload.feed } : bridge.feeds
  const stops = (opts.reload || remote ? ["changes", "show", "agent", "reload"] : ["changes", "show", "agent"]).map((feed) =>
    feeds[feed]!((e) => {
      event = { feed, event: e }
      machine.change()
    })
  )
  // naima update moved the program: the shell is asked to start this sidecar again on the new one, and then reloads its window.
  const moved = (opts.restartWatch ?? restartWatch)({ root: ctx.root }, () => send({ feed: "restart", event: null }))
  const stop = () => (moved.stop(), stops.forEach((s) => s()))
  try {
    for await (const line of createInterface({ input: opts.input, crlfDelay: Infinity })) {
      if (!line.trim()) continue
      let request: { id?: unknown; command?: unknown; args?: unknown }
      try {
        request = JSON.parse(line)
      } catch {
        // Answered with no id and outside the machine: it changes nothing.
        send({ error: "a line that is not JSON" })
        continue
      }
      const id = typeof request.id === "number" ? request.id : null
      const command = String(request.command)
      const args = request.args && typeof request.args === "object" && !Array.isArray(request.args) ? request.args as { [key: string]: Json } : {}
      const handler = lookup(command)
      machine.request(id)
      void (async () => {
        let answer: { [key: string]: Json }
        try {
          if (!handler) throw new Error(`no such command: ${command}`)
          answer = { id, ok: await handler(args) }
        } catch (e) {
          answer = { id, error: e instanceof Error ? e.message : String(e) }
        }
        try {
          send(answer)
        } finally {
          machine.answer(id)
        }
      })()
    }
    machine.stdinEnd()
    await stopped
    return 0
  } finally {
    stop()
    bridge.close()
  }
}
