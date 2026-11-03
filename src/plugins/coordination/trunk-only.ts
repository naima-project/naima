// Tracker data is written only on the trunk (core/trunk-only.ts): on a
// development line, or on a branch opened from one, this hook refuses every
// write of an item and every free-text record except an item's own work,
// which travels with its code: its fixed mark (fixedOn), its test runs (the
// status, last run, red seen and evidence a run records on an item whose type
// records runs) and the session note. Filing an item, a note, a description,
// a link, a field set by hand, a move, an event and an attachment are refused,
// each saying to run it in the trunk's checkout. naima.json is refused by the
// core itself, whoever writes it.

import { isDeepStrictEqual } from "node:util"
import { appliesTo, type Context, developmentLine, label, trunkOnlyRefusal, type Write, type WriteHook } from "../../core/api.ts"

/** The field an item's fix sets on its branch. */
const FIXED_ON = "fixedOn"
/** The fields a recorded run names its last record in: a test's, a property's. */
const RUN_FIELDS = ["lastTestRun", "lastRun"] as const
/** What a recorded run also writes on its item, beside its status and its last record. */
const RUN_EXTRA = ["redSeen", "evidenceKind"] as const
/** Bookkeeping a write hook adds to any write, never a write of its own. */
const BOOKKEEPING = new Set(["revised"])

/** The fields an update changes, bookkeeping left out. */
function changedFields(write: Write): string[] {
  const before: Record<string, unknown> = write.before ?? {}
  const after: Record<string, unknown> = write.item.meta
  const keys = new Set([...Object.keys(before), ...Object.keys(after)])
  return [...keys].filter((k) => !BOOKKEEPING.has(k) && !isDeepStrictEqual(before[k], after[k]))
}

/** Whether the item's type records runs: one of the run fields applies to it. */
function recordsRuns(ctx: Context, type: string): boolean {
  return RUN_FIELDS.some((f) => {
    const def = ctx.registry.fields.get(f)
    return !!def && appliesTo(def, type)
  })
}

/** Whether an update is an item's own work: its fixed mark, or what a run of it records. */
export function ownWork(ctx: Context, write: Write): boolean {
  if (write.kind !== "update" || write.prose !== undefined || !write.before) return false
  const changed = changedFields(write)
  if (!changed.length) return true
  const runs = recordsRuns(ctx, write.item.type)
  const allowed = new Set<string>([FIXED_ON, ...(runs ? ["status", ...RUN_FIELDS, ...RUN_EXTRA] : [])])
  return changed.every((f) => allowed.has(f))
}

/** What a refused write was, in words. */
function whatWrite(write: Write): string {
  const item = label(write.item)
  if (write.kind === "create") return `filing ${item}`
  if (write.kind === "move") return `moving ${item}`
  if (write.prose !== undefined) return `a note or description on ${item}`
  return `a change to ${item} (${changedFields(write).join(", ")})`
}

/** Free text a line keeps: the session note travels with the work it reports. */
const KEPT_TEXT = new Set(["the session note"])

export const trunkOnlyTracker: WriteHook = {
  name: "tracker-data-on-trunk",
  says:
    "on a development line or a branch opened from one, a tracker write is refused except an item's own work, which travels with its code: its fixed mark (fixedOn), its test runs (status and last run of an item whose type records runs) and the session note; filing an item, a note, a link, a field set by hand, a move, an event and an attachment are made in the trunk's checkout, and naima.json is never changed on a line",
  beforeWrite(write, ctx) {
    if (ownWork(ctx, write)) return
    const on = developmentLine(ctx.root)
    if (on) return trunkOnlyRefusal(whatWrite(write), on)
  },
  beforeText(text, ctx) {
    if (KEPT_TEXT.has(text.what)) return
    const on = developmentLine(ctx.root)
    if (on) return trunkOnlyRefusal(text.what, on)
  },
}
