// The views the UI's server computes, rendered off its serving thread: a small pool of worker threads, each opening the
// project once (src/view-worker.ts) and rendering one view at a time, so that independent views run side by side and a
// slow one never holds another view, nor a file of the page. A worker is started when a view is asked and no worker is
// free, up to `size`; the asks beyond wait in order. A worker that cannot start or dies fails its asks: the caller
// computes those in its own thread, as it did before the pool.

import { Worker } from "node:worker_threads"

/** The pool, not the view, failed: no worker could be started or one stopped; the caller computes the view itself. */
export class PoolDown extends Error {}

export interface ViewPool {
  /** A view's data for these parameters, rendered in a worker; rejects when no worker could answer. */
  render(view: string, params: Record<string, string[]>): Promise<unknown>
  /** Stop every worker. */
  close(): void
  /** How many workers have been started. */
  readonly started: number
}

interface Pending {
  view: string
  params: Record<string, string[]>
  resolve(data: unknown): void
  reject(e: Error): void
}

interface Slot {
  worker: Worker
  busy: { id: number; pending: Pending } | null
  dead: boolean
}

/** The workers a pool starts at most: one fewer than the machine's cores (read without a permission: the launcher grants no system information), between 2 and 4. */
export const poolSize = (): number =>
  Math.max(2, Math.min(4, ((globalThis as { navigator?: { hardwareConcurrency?: number } }).navigator?.hardwareConcurrency ?? 4) - 1))

/** A pool of workers for the project at `place`; the worker's module is the entry point's (src/view-worker.ts). */
export function viewPool(place: { root: string; data: string; program: string }, size: number = poolSize(), module?: URL): ViewPool {
  const file = module ?? new URL("../../view-worker.ts", import.meta.url)
  const slots: Slot[] = []
  const waiting: Pending[] = []
  let ids = 0
  let closed = false
  const dispatch = (): void => {
    while (waiting.length) {
      let slot = slots.find((s) => !s.busy && !s.dead)
      if (!slot && slots.filter((s) => !s.dead).length < size) slot = start()
      if (!slot) return
      const pending = waiting.shift()!
      const id = ++ids
      slot.busy = { id, pending }
      slot.worker.postMessage({ id, view: pending.view, params: pending.params })
    }
  }
  const start = (): Slot => {
    const worker = new Worker(file, { workerData: place })
    const slot: Slot = { worker, busy: null, dead: false }
    slots.push(slot)
    const fail = (e: Error): void => {
      slot.dead = true
      const b = slot.busy
      slot.busy = null
      b?.pending.reject(new PoolDown(e.message))
      // With no worker left alive, whatever waits is failed too: the caller falls back.
      if (!slots.some((s) => !s.dead)) { for (const w of waiting.splice(0)) w.reject(new PoolDown(e.message)) }
      else dispatch()
    }
    worker.on("message", (m: { id: number; ok: boolean; data?: unknown; error?: string; down?: boolean }) => {
      const b = slot.busy
      if (!b || b.id !== m.id) return
      slot.busy = null
      if (m.ok) b.pending.resolve(m.data)
      else b.pending.reject(m.down ? new PoolDown(m.error ?? "the project did not open") : new Error(m.error ?? "the view failed"))
      dispatch()
    })
    worker.on("error", (e) => fail(e instanceof Error ? e : new Error(String(e))))
    worker.on("exit", () => fail(new Error("a view worker stopped")))
    worker.unref()
    return slot
  }
  return {
    render: (view, params) =>
      new Promise((resolve, reject) => {
        if (closed || slots.filter((s) => s.dead).length >= 3) return reject(new PoolDown("the view pool is closed or its workers keep failing"))
        waiting.push({ view, params, resolve, reject })
        try {
          dispatch()
        } catch (e) {
          waiting.pop()
          reject(new PoolDown(e instanceof Error ? e.message : String(e)))
        }
      }),
    close: () => {
      closed = true
      for (const s of slots) void s.worker.terminate()
      for (const w of waiting.splice(0)) w.reject(new PoolDown("the view pool is closed"))
    },
    get started() {
      return slots.length
    },
  }
}
