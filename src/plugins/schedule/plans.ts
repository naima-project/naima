// The planned schedules: one record per proposal, `schedules/<day>-<uuid>.json` in the tracker, written by
// `naima schedule plan` (dates given) and `naima schedule propose` (dates from the project's pace), and never
// rewritten. A piece's plans are read oldest first: the first is the plan as first set, the last the plan in force.
// One new file per proposal keeps every write an addition, which the trunk accepts like a note or an event.

import { randomUUID } from "node:crypto"
import { mkdirSync } from "node:fs"
import { join } from "node:path"
import {
  beforeTextWrite,
  commitOn,
  type Context,
  filerRole,
  findPrivate,
  gitOrNull,
  guardPrivate,
  privateContext,
  readAcrossBranches,
  trackerPath,
  writeFileAtomic,
} from "../../core/api.ts"
import type { Plan, PlannedSchedule, Proposer } from "./types.ts"

export const SCHEDULES = "schedules"

/** One proposal as stored: the plan and the piece it is for. */
export interface PlanRecord extends Plan {
  item: string
}

function planOf(text: string): PlanRecord | null {
  let raw: Record<string, unknown>
  try {
    raw = JSON.parse(text) as Record<string, unknown>
  } catch {
    return null
  }
  const { item, start, end, on, basis, by } = raw
  if (typeof item !== "string" || typeof start !== "string" || typeof end !== "string" || typeof on !== "string") return null
  if ([start, end, on].some((m) => Number.isNaN(Date.parse(m)))) return null
  const b = by as { name?: unknown; role?: unknown } | undefined
  const proposer: Proposer = { ...(typeof b?.name === "string" ? { name: b.name } : {}), role: typeof b?.role === "string" ? b.role : "unknown" }
  return { item, start, end, on, basis: typeof basis === "string" ? basis : "", by: proposer }
}

/** Every proposal on every branch and worktree, once each, oldest first. */
export function readPlans(ctx: Context): PlanRecord[] {
  const seen = new Map<string, PlanRecord>()
  for (const f of readAcrossBranches(ctx.trackerGit, trackerPath(ctx.trackerPrefix, SCHEDULES), ".json")) {
    if (seen.has(f.name)) continue
    const p = planOf(f.text)
    if (p) seen.set(f.name, p)
  }
  return [...seen.values()].sort((a, b) => (a.on < b.on ? -1 : a.on > b.on ? 1 : 0))
}

/** Each piece's planned schedule, by item id: the last proposal, with the first kept when it was replaced. */
export function plannedByItem(plans: PlanRecord[]): Map<string, PlannedSchedule> {
  const out = new Map<string, PlannedSchedule>()
  const firsts = new Map<string, Plan>()
  for (const { item, ...plan } of plans) {
    const prior = out.get(item)
    if (!prior) {
      firsts.set(item, plan)
      out.set(item, { ...plan, revision: 1 })
    } else out.set(item, { ...plan, revision: prior.revision + 1, first: firsts.get(item) as Plan })
  }
  return out
}

/** Who proposes now: the git user's name when set, and the role of the checkout (owner, coordinator, worker). */
export function proposer(ctx: Context, name?: string): Proposer {
  const who = name?.trim() || gitOrNull(ctx.root, "config", "user.name")?.trim()
  return { ...(who ? { name: who } : {}), role: filerRole(ctx.root) }
}

/** A moment the command line gives: a timestamp, or a day — its start for a start, its end for an end. */
export function momentArg(value: string, edge: "start" | "end", flag: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const t = Date.parse(`${value}T00:00:00.000Z`)
    if (Number.isNaN(t) || new Date(t).toISOString().slice(0, 10) !== value) throw new Error(`${flag} ${value}: not a day`)
    return new Date(edge === "start" ? t : t + 86_400_000).toISOString()
  }
  const t = Date.parse(value)
  if (Number.isNaN(t)) throw new Error(`${flag} is a day (YYYY-MM-DD) or a timestamp, got ${JSON.stringify(value)}`)
  return new Date(t).toISOString()
}

/** Write one proposal as a new file; the path, from the project root. */
export function writePlan(ctx: Context, record: PlanRecord): string {
  if (Date.parse(record.end) <= Date.parse(record.start)) throw new Error(`a plan ends after it starts: ${record.start} to ${record.end}`)
  const allowance = guardPrivate("the plan's basis", findPrivate(record.basis, privateContext()), ctx.allowPrivate)
  const extra = beforeTextWrite(ctx, "the plan")
  const dir = join(ctx.trackerRoot, SCHEDULES)
  mkdirSync(dir, { recursive: true })
  const name = `${record.on.slice(0, 10)}-${randomUUID()}.json`
  writeFileAtomic(join(dir, name), JSON.stringify({ ...record, ...(allowance ? { allowance } : {}), ...extra }, null, 2) + "\n")
  return `${ctx.trackerDir}/${SCHEDULES}/${name} — commit it ${commitOn(ctx.root)}`
}
