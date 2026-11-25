// At most one UI server runs per project on a machine. Whoever would serve it (`naima ui`, the desktop app's sidecar,
// the MCP server's show) first takes the seat in the project's registry (at-start.ts: numbered records, each created
// only if absent): the process that creates the next generation serves, and every other finds the record of a live
// server and attaches to it instead. A record whose process is dead is stale and is replaced by the next client. This
// follows the model develop/models/ui-server/ui-server.mcrl2 in the workshop, whose properties say that two servers never
// serve at once, that a record is replaced only once its process is dead and that an update ends only after the live
// server restarted.

import { claim, current, rewrite, type UiRecord } from "./at-start.ts"

/** Where a process that would serve stands. */
export type Seat =
  /** This process serves: its record stands, to be rewritten with the address once it listens. */
  | { kind: "serve"; dir: string; gen: number }
  /** A live server stands: attach to it. */
  | { kind: "attach"; live: UiRecord }
  /** There is no registry (outside git): serve, as nothing else can be named. */
  | { kind: "alone" }

/** Take the seat for the project whose registry is `dir`. A record that already names this process (hello started it) is its seat. */
export function takeSeat(dir: string | null, me: number, alive: (pid: number) => boolean): Seat {
  if (!dir) return { kind: "alone" }
  const c = current(dir)
  if (c.rec?.pid === me) return { kind: "serve", dir, gen: c.gen }
  const got = claim(dir, { pid: me, how: "claim" }, alive)
  if (got === null) return { kind: "alone" }
  return "live" in got ? { kind: "attach", live: got.live } : { kind: "serve", dir, gen: got.gen }
}

/** The seat's record, once the server listens: how it shows and where, and the project and the time. */
export function settle(seat: Seat, me: number, rec: Omit<UiRecord, "pid">): void {
  if (seat.kind === "serve") rewrite(seat.dir, seat.gen, { ...rec, pid: me, since: Date.now() })
}

export interface AwaitDeps {
  alive(pid: number): boolean
  sleep(ms: number): Promise<void>
}

/**
 * The record of the live server once it says how it shows: the one given when it already does (a server, not a client
 * still starting one), else the current record read again until it does, its process ends, or `ms` pass.
 */
export async function settled(dir: string, live: UiRecord, deps: AwaitDeps, ms = 15_000, step = 200): Promise<UiRecord | null> {
  let rec: UiRecord | null = live
  for (let left = ms;; left -= step) {
    if (rec && rec.how !== "claim") return rec
    if (rec && !deps.alive(rec.pid)) return null
    if (left <= 0) return rec
    await deps.sleep(step)
    rec = current(dir).rec
  }
}
