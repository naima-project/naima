// Tracker data on a development line (core/trunk-only.ts): the trunk keeps the
// board, and a line's branch writes only what belongs to the work it holds,
// which travels with its code and reaches the trunk when the line lands. A
// write on a line, or on a branch opened from one, is let through when it is
//   - an item's own work: its fixed mark (fixedOn), its test runs (the status,
//     last run, red seen and evidence a run records on an item whose type
//     records runs) and the session note; or
//   - about an item the branch works on: one its claim names, one linked to
//     such an item (the properties of a feature it formalises), or one the
//     trunk does not hold, filed on the line, which the trunk cannot change;
//     a note, a description, a field, a link, an explanation, a refinement or
//     an attachment on it; or
//   - the filing of an item by a branch that holds a claim: it is born on the
//     line and reaches the trunk with the line's landing.
// Everything else (an item the trunk holds and the branch does not work on, a
// move of such an item, an event, a gate) is refused, saying to run it in the
// trunk's checkout. naima.json is refused by the core itself, whoever writes it.

import { existsSync, readdirSync, readFileSync } from "node:fs"
import { join, relative, sep } from "node:path"
import { isDeepStrictEqual } from "node:util"
import {
  appliesTo,
  type Context,
  developmentLine,
  gitOrNull,
  type Item,
  label,
  type OnLine,
  trunk,
  trunkOnlyRefusal,
  type Write,
  type WriteHook,
} from "../../core/api.ts"

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

/** The ids of the items this branch's claim files name: the items the branch works on. */
function claimedIds(ctx: Context, on: OnLine): Set<string> {
  const dir = join(ctx.trackerRoot, "claims")
  const ids = new Set<string>()
  if (!existsSync(dir)) return ids
  for (const f of readdirSync(dir).filter((n) => n.endsWith(".json"))) {
    try {
      const c = JSON.parse(readFileSync(join(dir, f), "utf8")) as { branch?: unknown; items?: { id?: unknown }[] }
      if (c.branch !== on.branch) continue
      for (const e of c.items ?? []) if (typeof e.id === "string") ids.add(e.id)
    } catch {
      // an unreadable claim names nothing
    }
  }
  return ids
}

/** Whether the trunk holds the item's folder: false for an item filed on the line, which only the line can change. */
function trunkHolds(ctx: Context, item: Item): boolean {
  const main = trunk(ctx.root)
  if (!main) return true
  const dir = relative(ctx.root, item.dir).split(sep).join("/")
  if (dir.startsWith("..")) return true
  return gitOrNull(ctx.root, "rev-parse", "--verify", "--quiet", `refs/heads/${main}:${dir}`) !== null
}

/** Whether the item is the work of this branch: claimed by it, linked to an item it claims, or filed on the line. */
function branchItem(ctx: Context, on: OnLine, item: Item, kind: Write["kind"]): boolean {
  if (on.branch === on.line) return false // the line itself takes only landings
  if (!trunkHolds(ctx, item)) return true
  if (kind === "move") return false // a move of an item the trunk holds would collide with the trunk's own copy
  const mine = claimedIds(ctx, on)
  if (mine.has(item.meta.id)) return true
  return ctx.repo.linksOf(item).some((l) => mine.has(l.id))
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
    "on a development line or a branch opened from one, a tracker write is let through when it is an item's own work (its fixed mark, its test runs, the session note), or concerns an item the branch works on (one its claim names, one linked to such an item, one the trunk does not hold), or files a new item from a branch that holds a claim; it all reaches the trunk when the line lands. Any other write (an item the trunk holds and the branch does not work on, a move of such an item, an event) is made in the trunk's checkout, and naima.json is never changed on a line",
  beforeWrite(write, ctx) {
    if (ownWork(ctx, write)) return
    const on = developmentLine(ctx.root)
    if (!on) return
    if (write.kind === "create" ? on.branch !== on.line && claimedIds(ctx, on).size > 0 : branchItem(ctx, on, write.item, write.kind)) return
    return trunkOnlyRefusal(whatWrite(write), on)
  },
  beforeText(text, ctx) {
    if (KEPT_TEXT.has(text.what)) return
    const on = developmentLine(ctx.root)
    if (!on) return
    if (text.item && branchItem(ctx, on, text.item, "update")) return
    return trunkOnlyRefusal(text.what, on)
  },
}
