// Naima feeds itself: whenever a worker slot is free (fewer worker worktrees
// open than the option maxWorkers) and the ready queue holds work the owner
// approved that no branch holds yet, the coordinator starts the next item, in
// the queue's order, without asking. `naima hello` and `naima claims` say which
// to start; the check ready-work-waiting notes a slot left idle.

import { type Check, type Context, type Finding, type Item, label, readyQueue, rendered, type SummarySection } from "../../core/api.ts"
import { claimsData } from "./index.ts"
import { type Policy, workerTrees } from "./worktrees.ts"

/** What the ready queue asks of the coordinator now: the slots free, and the items to start, in order. */
export interface ReadyNow {
  maxWorkers: number
  free: number
  /** The approved items no live claim holds, in the order they start. */
  waiting: Item[]
}

export function readyNow(ctx: Context, policy: Policy): ReadyNow {
  const held = new Set(claimsData(ctx).claims.filter((c) => !c.stale).flatMap((c) => c.items.map((e) => e.id)))
  const waiting = readyQueue(ctx).filter((i) => !held.has(i.meta.id))
  let open = 0
  try {
    open = workerTrees(ctx.root, policy).length
  } catch {
    open = 0 // not a git checkout: no worker worktrees
  }
  return { maxWorkers: policy.maxWorkers, free: Math.max(0, policy.maxWorkers - open), waiting }
}

/** The lines that tell the coordinator what to start: nothing when nothing approved waits. */
export function readyLines(r: ReadyNow): string[] {
  if (!r.waiting.length) return []
  const n = r.waiting.length
  if (!r.free) {
    return [
      `Ready queue: ${n} approved item${n === 1 ? "" : "s"} wait${
        n === 1 ? "s" : ""
      }, and every worker slot is taken (maxWorkers ${r.maxWorkers}): start the next as soon as one frees — naima queue --ready.`,
    ]
  }
  const next = r.waiting.slice(0, r.free)
  return [
    `Ready queue: ${n} approved item${n === 1 ? "" : "s"} wait${n === 1 ? "s" : ""} and ${r.free} of ${r.maxWorkers} worker slot${
      r.maxWorkers === 1 ? " is" : "s are"
    } free: start ${next.length === 1 ? "it" : `these ${next.length}`} now, each with a worker in the background, without asking the owner:`,
    ...next.map((i) => `  naima open ${label(i)}   — ${i.meta.title}`),
  ]
}

/** `naima hello`, among its offers: how many workers may run at once, and that the owner can ask to change it. Nothing in `naima summary`. */
export const workerLimitSection = (policy: Policy): SummarySection => ({
  name: "worker limit",
  offers: () =>
    rendered({ maxWorkers: policy.maxWorkers }, () => [
      `Up to ${policy.maxWorkers} worker${policy.maxWorkers === 1 ? "" : "s"} at once (maxWorkers); ask to change it.`,
    ]),
  render: () => rendered({}, () => []),
})

/** `naima hello`: the next ready items to start, when a slot is free. */
export const readySection = (policy: Policy): SummarySection => ({
  name: "ready queue",
  hello: true,
  render(ctx) {
    const r = readyNow(ctx, policy)
    return rendered({ free: r.free, maxWorkers: r.maxWorkers, waiting: r.waiting.map(label) }, () => readyLines(r))
  },
})

/** A worker slot left idle while approved work waits. */
export const readyWorkWaiting = (policy: Policy): Check => ({
  name: "ready-work-waiting",
  says: "no worker slot is idle while the ready queue holds approved work no branch holds: the coordinator starts the next on its own",
  run(ctx) {
    const r = readyNow(ctx, policy)
    if (!r.free || !r.waiting.length) return []
    const out: Finding[] = [{
      level: "note",
      message: `${r.free} worker slot${r.free === 1 ? " is" : "s are"} idle while ${r.waiting.length} approved item${r.waiting.length === 1 ? "" : "s"} wait${
        r.waiting.length === 1 ? "s" : ""
      } — start the next: naima open ${label(r.waiting[0]!)}`,
      item: r.waiting[0]!,
    }]
    return out
  },
})
