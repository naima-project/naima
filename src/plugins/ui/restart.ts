// A running UI restarts when the program moved: `naima update` says so in a file of the state folder (core/program-moved.ts),
// and the server that began before then, which runs the old code, polls for it and asks to be restarted once. The
// browser's server restarts as it does to switch project (the launcher serves the project again on the same address,
// and its page, reconnected, reloads: programFeed); the desktop app's sidecar tells the shell, which starts another and
// reloads the window. A server that began after the program moved has nothing to do.

import { type ProgramMoved, programMoved } from "../../core/api.ts"
import type { Feeds, Json } from "./bridge-handler.ts"

/** How often the file is looked at, in ms. */
export const RESTART_POLL_MS = 1000

/** When this process began, in ms since the epoch: what it loaded of the program is from then at the latest. */
export const processStart = (): number => Date.now() - process.uptime() * 1000

export interface RestartOptions {
  root: string
  /** When the process began: a move after it is a move the code it runs does not have. */
  since?: number
  interval?: number
  read?: (root: string) => ProgramMoved | null
}

/** Calls `restart` once, when the program of the project moved after `since`; `stop` ends the watch. */
export function restartWatch(opts: RestartOptions, restart: (moved: ProgramMoved) => void): { stop(): void } {
  const since = opts.since ?? processStart()
  const read = opts.read ?? programMoved
  let done = false
  const look = (): void => {
    if (done) return
    const moved = read(opts.root)
    if (moved && moved.at > since) {
      done = true
      clearInterval(timer)
      restart(moved)
    }
  }
  const timer = setInterval(look, opts.interval ?? RESTART_POLL_MS)
  ;(timer as unknown as { unref?: () => void }).unref?.()
  return { stop: () => (done = true, clearInterval(timer)) }
}

/** What a page is told when it listens to the feed reload of a server that began at `startedAt`. */
export type ProgramReload = { kind: "reload"; why: "program"; startedAt: number }

/**
 * The feed reload of a server that always has it: each page that listens is told when this server began, and reloads
 * only when that is after the page was loaded, so a page that outlived the server before this one finds the new
 * program. With the `--watch` feed beside it, the two share the name.
 */
export function programFeed(startedAt: number, watch?: Feeds[string]): Feeds[string] {
  return (emit) => {
    emit({ kind: "reload", why: "program", startedAt } satisfies ProgramReload as unknown as Json)
    return watch ? watch(emit) : () => {}
  }
}
