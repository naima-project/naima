// The ready-for-implementation queue: work the owner approved at the close of
// a meeting, which the coordinator starts on its own whenever a worker slot is
// free. An item is on it while it is open and carries a `ready` record: the
// command that closes a meeting writes it, and whoever starts work leaves out
// what a branch already holds.

import { byUrgency, isOpen } from "./lifecycle.ts"
import type { Context, FieldDef, Item } from "./types.ts"

/** The field that holds an item's approval: a record Naima fills, never set by hand. */
export const READY = { name: "ready", kind: "object" } as const

export const READY_FIELD: FieldDef = {
  ...READY,
  filled: true,
  says:
    "the owner's approval of the work, as the close of a meeting records it: { on: the day, start: true when the owner said to start it now, meeting, decisions: the ids of the discussions it carries, consent: the owner's yes restated }; an open item with one is on the ready queue",
}

/** An item's approval, as the close of a meeting records it. */
export interface ReadyRecord {
  /** The day the owner approved it, YYYY-MM-DD. */
  on: string
  /** The owner chose to start it now rather than queue it. */
  start?: boolean
  /** The meeting whose close approved it. */
  meeting?: string
  /** The ids of the discussions whose decisions it carries. */
  decisions?: string[]
  /** The owner's yes, restated. */
  consent?: string
}

/** An item's ready record, or undefined when it has none. */
export function readyRecord(item: Item): ReadyRecord | undefined {
  const v = item.meta[READY.name]
  if (!v || typeof v !== "object" || Array.isArray(v)) return undefined
  return typeof (v as Record<string, unknown>)["on"] === "string" ? (v as ReadyRecord) : undefined
}

/** The ready queue in the order work starts: what the owner said to start now first, then by urgency (priority, impact, effort). */
export function readyQueue(ctx: Context): Item[] {
  const ready = ctx.repo.items.filter((i) => isOpen(ctx, i) && readyRecord(i))
  return [...byUrgency(ctx, ready.filter((i) => readyRecord(i)?.start)), ...byUrgency(ctx, ready.filter((i) => !readyRecord(i)?.start))]
}
