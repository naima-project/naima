// The check plan of a milestone: fast checks at every landing; heavy checks only at the milestone's planned points, a
// checkpoint once about half its items are closed and one once all are, each started by Naima itself (the landing or the
// tick that finds its threshold crossed), never before; then the release check, which takes the results of its commit and
// reruns only what the commits after the full checkpoint can affect. Between milestones a background run, on a schedule.
// Every heavy run goes where the project's heavy checks run: this machine by default, only while it is idle (no heavy work
// of the person's own going, its load low), at low priority, within its time budget, and never while the person has paused
// the heavy checks; a declared host when the project names one, by the same rules. A result belongs to the commit it ran on
// and is reused, never recomputed, for that commit. The behaviour is the model's: develop/models/check-plan/check-plan.mcrl2.
import { cpus, loadavg } from "node:os"
import { checkMode, type CheckpointRecord, checkpointRuns, type CheckpointRunSpec, option, readCheckpoints } from "./checkpoints.ts"
import { heavyAnswer } from "./heavy.ts"
import type { Context } from "./types.ts"

/** The planned points of a milestone: about half its items closed, all closed, and the release. */
export const PLAN_POINTS = ["half", "full", "release"] as const
export type PlanPointName = (typeof PLAN_POINTS)[number]
/** What a checkpoint record was for: a planned point, or a background run between milestones. */
export type CheckPoint = PlanPointName | "background"
export const CHECK_POINTS: readonly CheckPoint[] = [...PLAN_POINTS, "background"]

export type PlanState = "waiting" | "ready" | "running" | "passed" | "failed" | "skipped"

export interface PlanPoint {
  point: PlanPointName
  /** The point in words: "half the items closed", "all closed", "release". */
  says: string
  /** How many items closed it waits for (the release: all, and the full checkpoint passed). */
  at: number
  state: PlanState
  /** The commit its latest record ran on, and when it started. */
  tip?: string
  on?: string
  /** True when every result came from a record of the same commit: nothing was run again. */
  reused?: boolean
  /** How long it is expected to take, in minutes: measured on the last checkpoints, else the runs' budgets; null when neither says. */
  expectedMinutes: number | null
  expectedFrom: "measured" | "budget" | "none"
  /** What it waits for, or what failed. */
  why?: string
}

export interface MilestonePlan {
  gate: string
  items: number
  closed: number
  /** Whether the plan applies: the project runs its heavy checks at checkpoints. */
  active: boolean
  points: PlanPoint[]
  /** The checks every landing runs. */
  fast: string[]
  /** Where the heavy checks run: "here" (this machine, when idle) or the declared host. */
  where: string
}

/** Whether the project plans its heavy checks: checkpoint mode, and heavy checks agreed to run at checkpoints. */
export function planActive(ctx: Context): boolean {
  try {
    return checkMode(ctx) === "checkpoint" && heavyAnswer(ctx)?.when === "checkpoint"
  } catch {
    return false
  }
}

/** The thresholds of a milestone of `items` items: the half point (only with two items or more) and the full one. */
export function thresholds(items: number): { half?: number; full: number } {
  return items >= 2 ? { half: Math.ceil(items / 2), full: items } : { full: items }
}

const BUDGET = /^(\d+(?:\.\d+)?)\s*(m|h|d)?$/
/** A run budget such as "2h" or "90m" in minutes; null for one it cannot read. */
export function budgetMinutes(b: string | undefined): number | null {
  const m = b ? BUDGET.exec(b.trim()) : null
  if (!m) return null
  const n = Number(m[1])
  return Math.round(m[2] === "d" ? n * 1440 : m[2] === "m" ? n : n * 60)
}

/** The checkpoint records that count: those that ended with a result or still run; a run stopped for the person (yielded) is no result. */
export const countedRecords = (ctx: Context): CheckpointRecord[] => readCheckpoints(ctx).filter((r) => !r.yielded)

/**
 * How long a checkpoint is expected to take: the mean of the last three that ran something and ended, else the longest
 * budget of its runs (they run at once), else unknown.
 */
export function expectedDuration(ctx: Context): { minutes: number | null; from: PlanPoint["expectedFrom"] } {
  const ended = countedRecords(ctx).filter((r) => r.ended && !r.pending && (r.runs ?? []).some((x) => !x.reused)).slice(-3)
  if (ended.length) {
    const ms = ended.map((r) => Date.parse(r.ended!) - Date.parse(r.on)).filter((n) => Number.isFinite(n) && n >= 0)
    if (ms.length) return { minutes: Math.max(1, Math.round(ms.reduce((a, b) => a + b, 0) / ms.length / 60_000)), from: "measured" }
  }
  let specs: CheckpointRunSpec[] = []
  try {
    specs = checkpointRuns(ctx)
  } catch {
    // a malformed option is reported where it is read
  }
  const budgets = specs.map((s) => budgetMinutes(s.budget ?? "2h")).filter((n): n is number => n !== null)
  return budgets.length ? { minutes: Math.max(...budgets), from: "budget" } : { minutes: null, from: "none" }
}

const SAYS: Record<PlanPointName, string> = { half: "half the items closed", full: "all the items closed", release: "the release" }

/** The latest counted record of a gate for a point. */
const latest = (records: CheckpointRecord[], gate: string, point: PlanPointName): CheckpointRecord | undefined =>
  records.filter((r) => r.gate === gate && r.point === point).at(-1)

/**
 * A milestone's plan, from how many items it has and how many are closed, its checkpoint records and the tip: each
 * point waiting for its threshold, due, running, passed or failed. A point is due once its threshold is reached and it has
 * no record, or its last one failed on another commit (the fix's check). A milestone whose items were all closed before
 * its plan began (no record, `begun` false) has nothing due: the plan starts while work is left, or at the landing that
 * crosses a threshold.
 */
export function planOf(
  ctx: Context,
  gate: string,
  items: number,
  closed: number,
  opts: { tip?: string; begun?: boolean; closedDates?: readonly string[] } = {},
): MilestonePlan {
  const records = countedRecords(ctx)
  const since = planSince(ctx)
  const dates = [...(opts.closedDates ?? [])].sort()
  /** The day the n-th item closed, when the dates say it. */
  const crossedOn = (n: number): string | undefined => (n > 0 && dates.length >= n ? dates[n - 1] : undefined)
  const t = thresholds(items)
  const expected = expectedDuration(ctx)
  // Begun: work is left, or a record exists, or the last item closed on or after checkPlanSince (a later tick still finds its point ready).
  const last = dates.at(-1)
  const begun = opts.begun ??
    (closed < items || records.some((r) => r.gate === gate && r.point !== undefined) || (since !== undefined && last !== undefined && last >= since))
  const state = (point: PlanPointName, reached: boolean): Omit<PlanPoint, "point" | "says" | "at" | "expectedMinutes" | "expectedFrom"> => {
    const r = latest(records, gate, point)
    if (r?.pending) return { state: "running", tip: r.tip, on: r.on }
    if (r?.passed) return { state: "passed", tip: r.tip, on: r.on, ...(reusedAll(r) ? { reused: true } : {}) }
    if (r && (!reached || !begun || (opts.tip !== undefined && r.tip === opts.tip))) {
      return { state: "failed", tip: r.tip, on: r.on, why: r.failed.join("; ") }
    }
    if (reached && begun) {
      return r ? { state: "ready", tip: r.tip, on: r.on, why: `failed on ${r.tip.slice(0, 12)}: ${r.failed.join("; ")}` } : { state: "ready" }
    }
    return { state: "waiting" }
  }
  const points: PlanPoint[] = []
  const add = (point: PlanPointName, at: number, reached: boolean, why?: string) => {
    const on = crossedOn(at)
    // A threshold crossed before the plan began (the option checkPlanSince) is skipped, unless a record of it exists.
    const skipped = reached && since !== undefined && on !== undefined && on < since && !latest(records, gate, point)
    const s = skipped ? { state: "skipped" as const, why: `crossed on ${on}, before the plan began on ${since}` } : state(point, reached)
    points.push({
      point,
      says: SAYS[point],
      at,
      ...s,
      ...(s.state === "waiting" && why ? { why } : {}),
      expectedMinutes: s.reused ? 0 : expected.minutes,
      expectedFrom: expected.from,
    })
  }
  if (items > 0 && begun) {
    if (t.half !== undefined) add("half", t.half, closed >= t.half, `waits for ${t.half} of ${items} items closed (${closed} now)`)
    add("full", t.full, closed >= t.full, `waits for all ${items} items closed (${closed} now)`)
    const full = points.find((p) => p.point === "full")!
    // A milestone whose full checkpoint was skipped finished before its plan: it has no release point either.
    if (full.state === "skipped") return finish()
    // The release check: once the full checkpoint passed, and only started by the release (naima checkpoint <gate> --release).
    const rel = state("release", full.state === "passed")
    points.push({
      point: "release",
      says: SAYS.release,
      at: t.full,
      ...(rel.state === "ready" ? { state: "waiting", why: "the release starts it: naima checkpoint " + gate + " --release" } : rel),
      ...(rel.state === "waiting" ? { why: "waits for the full checkpoint to pass" } : {}),
      expectedMinutes: rel.reused ? 0 : expected.minutes,
      expectedFrom: expected.from,
    })
  }
  return finish()
  function finish(): MilestonePlan {
    const where = (() => {
      try {
        return heavyAnswer(ctx)?.where ?? "here"
      } catch {
        return "here"
      }
    })()
    return { gate, items, closed, active: planActive(ctx), points, fast: fastNames(ctx), where }
  }
}

/** The coordination option `checkPlanSince`, YYYY-MM-DD: a threshold crossed before it is skipped, so adopting the plan starts no checkpoint for work already done. */
export function planSince(ctx: Context): string | undefined {
  const v = option(ctx, "checkPlanSince")
  return typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined
}

const fastNames = (ctx: Context): string[] => {
  const v = option(ctx, "fastChecks")
  return (Array.isArray(v) ? v.map(String) : typeof v === "string" ? v.split(",") : []).map((s) => s.trim()).filter(Boolean)
}

/** Whether a record took every result from an earlier record of its commit. */
export const reusedAll = (r: CheckpointRecord): boolean =>
  (r.runs ?? []).every((x) => !!x.reused) && (r.results ?? []).every((x) => !!x.reused) && ((r.runs?.length ?? 0) + (r.results?.length ?? 0)) > 0

/** The point of a plan that is due now, the first in order, or none. */
export const duePoint = (plan: MilestonePlan): PlanPoint | undefined => plan.active ? plan.points.find((p) => p.state === "ready") : undefined

/** The plan in one line, as `naima gates` and a refusal say it: "half (2 of 4): passed · full (4): waiting · release: waiting". */
export function planLine(plan: MilestonePlan): string {
  const one = (p: PlanPoint) =>
    `${p.point}${p.point === "release" ? "" : ` (${p.at} of ${plan.items})`}: ${p.state}${
      p.expectedMinutes !== null && (p.state === "waiting" || p.state === "ready") ? `, about ${minutesSays(p.expectedMinutes)}` : ""
    }`
  return `check plan of ${plan.gate}, ${plan.closed} of ${plan.items} closed — ${plan.points.map(one).join(" · ")}`
}

export const minutesSays = (m: number): string => (m < 90 ? `${m} min` : `${Math.round(m / 6) / 10} h`)

// ---- Where heavy runs go, and whether that place is free now.

/** The coordination option `heavyChecksPaused`: true while the person has paused the heavy checks (naima heavy-checks pause). */
export const heavyPaused = (ctx: Context): boolean => option(ctx, "heavyChecksPaused") === true

/** The coordination option `idleLoad`: the load per processor below which this machine counts as idle; 0.5 by default. */
export function idleLoad(ctx: Context): number {
  const v = option(ctx, "idleLoad")
  return typeof v === "number" && v > 0 ? v : 0.5
}

/** The prefix of every run Naima starts for its checks: the runs the idle gate does not count as the person's own work. */
export const CHECK_RUN_PREFIXES = ["checkpoint-", "background-", "plan-"] as const
export const isCheckRun = (name: string): boolean => CHECK_RUN_PREFIXES.some((p) => name.startsWith(p))

/** A run as `naima run list --json` lists it: what the idle gate reads. */
export interface ListedRun {
  name: string
  host?: string
  over?: boolean
  state?: string
}

/** The machine's load now, per processor; null where the system does not say it (Windows). */
export type LoadProbe = () => number | null
export const systemLoad: LoadProbe = () => {
  if (process.platform === "win32") return null
  const n = cpus().length || 1
  return loadavg()[0]! / n
}

export type IdleVerdict = { idle: true } | { idle: false; why: string }

/**
 * Whether heavy checks may start now at `where` ("here" or a host): never while paused, never while a heavy run of the
 * person's own (any naima run Naima did not start for its checks) goes there, and here, never while the load per
 * processor is above idleLoad. The same rule for this machine and a host; only the load is read here alone.
 */
export function idleVerdict(
  ctx: Context,
  where: readonly string[],
  runs: readonly ListedRun[],
  load: LoadProbe = systemLoad,
  paused: boolean = heavyPaused(ctx),
): IdleVerdict {
  if (paused) return { idle: false, why: "the heavy checks are paused (naima heavy-checks resume lets them go on)" }
  for (const place of where) {
    const own = runs.filter((r) => !r.over && !isCheckRun(r.name) && (place === "here" ? !r.host : r.host === place))
    if (own.length) {
      return {
        idle: false,
        why: `${place === "here" ? "this machine" : place} runs ${own.map((r) => r.name).join(", ")}: the person's own heavy work goes first`,
      }
    }
    if (place === "here") {
      const l = load()
      if (l !== null && l > idleLoad(ctx)) return { idle: false, why: `this machine is busy (load ${l.toFixed(2)} per processor, above ${idleLoad(ctx)})` }
    }
  }
  return { idle: true }
}

/** The places a checkpoint's runs go: each suite's host or here, and the verify host or here. */
export function placesOf(ctx: Context): string[] {
  let specs: CheckpointRunSpec[] = []
  try {
    specs = checkpointRuns(ctx)
  } catch {
    // reported where it is read
  }
  const v = option(ctx, "verifyHost")
  const verify = typeof v === "string" && v.trim() && v.trim() !== "here" ? v.trim() : "here"
  return [...new Set([...specs.map((s) => s.host ?? "here"), verify])]
}

/** A command at low priority where the shell has nice (not on Windows): the same words on this machine and on a host. */
export function lowPriority(command: string, windows = process.platform === "win32"): string {
  return windows || /^\s*nice\b/.test(command) ? command : `nice -n 10 ${command}`
}

// ---- Background runs between milestones.

export type BackgroundSchedule = { kind: "nightly" } | { kind: "landings"; every: number } | { kind: "off" }

/**
 * The coordination option `backgroundChecks`: `nightly` (the default while the plan is active), `landings` (every
 * `backgroundEvery` landings, 10 by default), or `off`.
 */
export function backgroundSchedule(ctx: Context): BackgroundSchedule {
  const v = option(ctx, "backgroundChecks")
  if (v === "off") return { kind: "off" }
  if (v === "landings") {
    const n = option(ctx, "backgroundEvery")
    return { kind: "landings", every: typeof n === "number" && n >= 1 ? Math.floor(n) : 10 }
  }
  if (v === undefined || v === "" || v === "nightly") return { kind: "nightly" }
  throw new Error(`the coordination option backgroundChecks is nightly, landings or off, not ${JSON.stringify(v)}`)
}

/** The night, in the machine's local hours, when a nightly background run may start. */
export const NIGHT = { from: 0, to: 6 } as const

/**
 * Whether a background run is due: never while the plan is inactive or a checkpoint runs; nightly, once a night (no
 * background record started in the last 18 hours); or after `every` landings since the last one. `landingsSince` counts
 * the landings on the tip since a commit.
 */
export function backgroundDue(ctx: Context, now: Date, landingsSince: (tip: string | undefined) => number): { due: boolean; why: string } {
  if (!planActive(ctx)) return { due: false, why: "the project does not plan its heavy checks" }
  const s = backgroundSchedule(ctx)
  if (s.kind === "off") return { due: false, why: "background checks are off" }
  const records = countedRecords(ctx)
  if (records.some((r) => r.pending)) return { due: false, why: "a checkpoint is running" }
  const last = records.filter((r) => r.point === "background").at(-1)
  if (s.kind === "nightly") {
    const h = now.getHours()
    if (h < NIGHT.from || h >= NIGHT.to) return { due: false, why: "nightly: waits for the night" }
    if (last && now.getTime() - Date.parse(last.on) < 18 * 3_600_000) return { due: false, why: "already ran tonight" }
    return { due: true, why: "nightly" }
  }
  const n = landingsSince(last?.tip)
  return n >= s.every ? { due: true, why: `${n} landings since the last one` } : { due: false, why: `${n} of ${s.every} landings since the last one` }
}

/** The failed background records not followed by a passing one on a later commit: what hello says, and only that. */
export function backgroundFailures(ctx: Context): CheckpointRecord[] {
  const bg = countedRecords(ctx).filter((r) => r.point === "background" && !r.pending)
  const lastPass = bg.map((r, i) => (r.passed ? i : -1)).reduce((a, b) => Math.max(a, b), -1)
  return bg.slice(lastPass + 1).filter((r) => !r.passed)
}
