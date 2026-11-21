// `naima ui --watch`: tells every open page when the UI it is served was rebuilt, so that it reloads itself. It watches
// the bundle's folder (ui/dist) and the folders of the tab files the server serves (a study's built view); a burst of
// changes (a build writes many files) becomes one `reload` event on the feed `reload`, said once the files stay quiet
// for `debounce` ms and, for the bundle, once index.html is there again (it is written last). Without --watch the feed
// does not exist, so the page's request for it ends at once.

import { existsSync, watch as fsWatch } from "node:fs"
import { join } from "node:path"
import type { Feeds, Json } from "./bridge-handler.ts"

/** How long the files must stay quiet before a rebuild is taken as finished, in ms. */
export const WATCH_DEBOUNCE_MS = 300

/** What the page is told: the bundle was rebuilt, or the files of a tab (a study's view) changed. */
export type Reload = { kind: "reload"; why: "bundle" | "files" }

/** The timer a debounce runs on: setTimeout and clearTimeout, replaced by a test. */
export interface Timers {
  set(fn: () => void, ms: number): unknown
  clear(handle: unknown): void
}

const realTimers: Timers = { set: (fn, ms) => setTimeout(fn, ms), clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>) }

/** `fire` once, `ms` after the last `poke`: every poke inside the wait starts it again. */
export function debounced(fire: () => void, ms: number, timers: Timers = realTimers): { poke(): void; cancel(): void } {
  let handle: unknown = null
  const cancel = () => {
    if (handle !== null) timers.clear(handle)
    handle = null
  }
  return {
    poke() {
      cancel()
      handle = timers.set(() => {
        handle = null
        fire()
      }, ms)
    },
    cancel,
  }
}

/** Watches a folder, calling `changed` for each difference in it, its subfolders included; the function it returns stops it. */
export type WatchFolder = (dir: string, changed: () => void) => () => void

/** Node's, Deno's and Bun's watch on a folder; a folder that is not there, or whose watch fails, is not watched. */
export const watchFolder: WatchFolder = (dir, changed) => {
  try {
    const w = fsWatch(dir, { recursive: true }, () => changed())
    w.on("error", () => {})
    return () => w.close()
  } catch {
    return () => {}
  }
}

export interface ReloadOptions {
  /** The bundle's folder: a rebuild is finished when index.html is in it again. */
  bundle: string
  /** The folders of the tab files served, read at each start of a watch. */
  folders(): readonly string[]
  debounce?: number
  watch?: WatchFolder
  timers?: Timers
}

export interface ReloadWatch {
  /** The feed `reload`: each event is one Reload. */
  feed: Feeds[string]
  stop(): void
}

/** The watch behind --watch: it runs while a page listens to its feed, and watches again after each reload said, since a rebuild can replace a folder. */
export function reloadWatch(opts: ReloadOptions): ReloadWatch {
  const watch = opts.watch ?? watchFolder
  const emitters = new Set<(e: Json) => void>()
  let stops: (() => void)[] = []
  let bundleChanged = false
  let filesChanged = false
  const say = (event: Reload) => {
    for (const emit of emitters) emit(event as unknown as Json)
  }
  const quiet = debounced(
    () => {
      // A bundle half written has no index.html yet: wait for the next difference rather than reload into nothing.
      const bundle = bundleChanged && existsSync(join(opts.bundle, "index.html"))
      const files = filesChanged
      if (!bundle && !files) return
      if (bundle) bundleChanged = false
      filesChanged = false
      start()
      say({ kind: "reload", why: bundle ? "bundle" : "files" })
    },
    opts.debounce ?? WATCH_DEBOUNCE_MS,
    opts.timers,
  )
  const start = () => {
    for (const stop of stops) stop()
    const own = new Set(opts.folders())
    own.delete(opts.bundle)
    stops = [
      watch(opts.bundle, () => {
        bundleChanged = true
        quiet.poke()
      }),
      ...[...own].map((dir) =>
        watch(dir, () => {
          filesChanged = true
          quiet.poke()
        })
      ),
    ]
  }
  const stop = () => {
    quiet.cancel()
    for (const s of stops.splice(0)) s()
  }
  return {
    feed(emit) {
      emitters.add(emit)
      if (emitters.size === 1) start()
      return () => {
        emitters.delete(emit)
        if (!emitters.size) stop()
      }
    },
    stop() {
      emitters.clear()
      stop()
    },
  }
}
