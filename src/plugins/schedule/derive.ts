// The schedule data, derived at every call: the actual schedule of each piece from its records through the machine
// naima-codegen generates from the workshop's model (generated/actual.ts), its planned schedule from the proposals (plans.ts), its expected schedule from the project's own pace,
// then the drift, the overlaps, the resource histogram and the quality of past predictions.
//
// The pace is a reference class drawn from the project's own history: for a kind of work (an item type), the median
// duration of the pieces of that kind that ended, and, for a piece with a plan, the median ratio of actual to planned
// duration of that kind. A kind with fewer than three ended pieces borrows the figures of all kinds together; with none
// at all, a piece is given eight hours.

import { type Context, type Item, label, linked } from "../../core/api.ts"
import { type Event, initial, type Phase, type State, step } from "./generated/actual.ts"
import type { PlanRecord } from "./plans.ts"
import { plannedByItem } from "./plans.ts"
import { recordsOf } from "./records.ts"
import type {
  Accuracy,
  ActualEvent,
  ActualSchedule,
  ActualState,
  Confidence,
  DependencyOverlap,
  Drift,
  ExpectedSchedule,
  Overlap,
  PieceRef,
  PieceSchedule,
  PlannedSchedule,
  PredictionQuality,
  ResourceDay,
  ScheduleData,
} from "./types.ts"

const HOUR = 3_600_000
const DAY_MS = 86_400_000
/** The hours a piece is given when the project has no finished work to judge by. */
export const DEFAULT_HOURS = 8
/** The fewest ended pieces of a kind its own figures rest on; fewer, and all kinds' figures are used. */
const MIN_SAMPLE = 3
/** The most days the resource histogram covers, the latest ones kept. */
const MAX_DAYS = 400

export interface ScheduleOptions {
  /** Minutes without a sign of life after which work counts as stalled. */
  stallAfter: number
  /** Hours within which an end counts as on plan. */
  tolerance: number
  /** The most workers at once. */
  capacity: number
}

const STATE: Record<Phase, ActualState> = {
  NOT_STARTED: "not-started",
  ACTIVE: "active",
  STALLED: "stalled",
  PAUSED: "paused",
  LANDED: "landed",
  CLOSED: "closed",
}

const INPUT: Record<ActualEvent["kind"], Event["type"]> = {
  claim: "claim",
  step: "sign",
  commit: "sign",
  quiet: "quiet",
  release: "release",
  land: "land",
  close: "close",
}

const t = (m: string): number => Date.parse(m)
const at = (ms: number): string => new Date(ms).toISOString()
const hours = (ms: number): number => Math.round((ms / HOUR) * 100) / 100
const median = (xs: number[]): number | undefined => {
  if (!xs.length) return undefined
  const s = [...xs].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid] : ((s[mid - 1] ?? 0) + (s[mid] ?? 0)) / 2
}
const mean = (xs: number[]): number => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0)
const round = (x: number): number => Math.round(x * 100) / 100

/**
 * The records with silence added: a quiet record wherever a piece went the stall window without a record, and after
 * its last one when the window has passed by now; a release followed at once by a landing (the claim let go to land)
 * is no pause and is left out.
 */
export function withSilence(events: ActualEvent[], stallAfter: number, now: number): ActualEvent[] {
  const window = stallAfter * 60_000
  const out: ActualEvent[] = []
  events.forEach((e, i) => {
    const next = events[i + 1]
    if (e.kind === "release" && next?.kind === "land") return
    out.push(e)
    const until = next ? t(next.at) : now
    if (until - t(e.at) > window) {
      out.push({ at: at(t(e.at) + window), kind: "quiet", says: `no sign of life for ${stallAfter} min` })
    }
  })
  return out
}

/**
 * A piece's actual schedule: its records fed oldest first through the machine, each stretch opened at its record's
 * moment by the machine's action (work, stall, pause, or finish, the end of the piece). The model takes every record in
 * every phase, one that changes nothing there included; a record the machine refused would leave the state as it was.
 */
export function actualOf(events: ActualEvent[]): ActualSchedule {
  let state: State = initial({}).state
  let start: string | undefined
  let end: string | undefined
  const segments: ActualSchedule["segments"] = []
  for (const e of events) {
    const r = step(state, { type: INPUT[e.kind] })
    if (r === null) continue
    state = r.state
    for (const a of r.actions) {
      const cur = segments[segments.length - 1]
      if (cur && cur.to === undefined) cur.to = e.at
      if (a.type === "finish") {
        end = e.at
        if (start === undefined) start = e.at
        continue
      }
      if (start === undefined) start = e.at
      end = undefined
      segments.push({ kind: a.type === "stall" ? "stalled" : a.type === "pause" ? "paused" : "work", from: e.at })
    }
  }
  return { state: STATE[state.phase], ...(start ? { start } : {}), ...(end ? { end } : {}), segments, events }
}

/** The kind of work a piece is: its type, or the type it was closed from. */
export const kindOf = (item: Item): string => (item.type === "closed" && typeof item.meta["closedFrom"] === "string" ? item.meta["closedFrom"] : item.type)

const refOf = (item: Item): PieceRef => ({ id: item.meta.id, ref: label(item), type: kindOf(item), title: String(item.meta.title ?? "") })

/** The confidence a forecast of a kind is given from how its past forecasts went. */
export function confidenceOf(sample: number, withinTolerance: number): Confidence {
  if (!sample) return { value: 0, level: "none", sample }
  // Shrunk towards zero while the sample is small: three hits out of three are not yet ten out of ten.
  const value = round(withinTolerance * (sample / (sample + MIN_SAMPLE)))
  return { value, level: value >= 0.7 ? "high" : value >= 0.4 ? "medium" : "low", sample }
}

const duration = (a: { start?: string; end?: string }): number | undefined => (a.start && a.end ? t(a.end) - t(a.start) : undefined)

interface Pace {
  /** Median duration of an ended piece, ms. */
  duration: number
  /** Median actual over planned duration. */
  ratio: number
  /** How many ended pieces it rests on. */
  sample: number
  /** Whose figures: the kind's own, or all kinds'. */
  of: string
}

function paceOf(kind: string, ended: { kind: string; actual: number; planned?: number }[]): Pace {
  const own = ended.filter((e) => e.kind === kind)
  const pool = own.length >= MIN_SAMPLE ? own : ended
  const of = own.length >= MIN_SAMPLE ? kind : "all kinds"
  const ratios = pool.flatMap((e) => (e.planned && e.planned > 0 ? [e.actual / e.planned] : []))
  return { duration: median(pool.map((e) => e.actual)) ?? DEFAULT_HOURS * HOUR, ratio: median(ratios) ?? 1, sample: pool.length, of }
}

function driftOf(planned: PlannedSchedule, actual: ActualSchedule, expected: ExpectedSchedule | undefined): Drift {
  const start = actual.start ? hours(t(actual.start) - t(planned.start)) : undefined
  const endAt = actual.end ?? expected?.end
  const startAt = actual.start ?? expected?.start
  const end = endAt ? hours(t(endAt) - t(planned.end)) : undefined
  const plannedMs = t(planned.end) - t(planned.start)
  const ratio = startAt && endAt && plannedMs > 0 ? round((t(endAt) - t(startAt)) / plannedMs) : undefined
  const provisional = !actual.end
  const words = (h: number, what: string) => (Math.abs(h) < 0.01 ? `${what} on plan` : `${what} ${Math.abs(h)} h ${h > 0 ? "late" : "early"}`)
  const says = [
    start !== undefined ? words(start, "started") : "not started",
    end !== undefined ? words(end, provisional ? "expected to end" : "ended") : "",
    ratio !== undefined ? `${ratio} times the planned duration` : "",
  ].filter(Boolean).join(", ")
  return {
    ...(start !== undefined ? { start } : {}),
    ...(end !== undefined ? { end } : {}),
    ...(ratio !== undefined ? { durationRatio: ratio } : {}),
    provisional,
    says,
  }
}

function accuracyOf(planned: PlannedSchedule, actual: ActualSchedule, tolerance: number): Accuracy | undefined {
  if (!actual.start || !actual.end) return undefined
  const plannedMs = t(planned.end) - t(planned.start)
  const endError = hours(Math.abs(t(actual.end) - t(planned.end)))
  return {
    startError: hours(Math.abs(t(actual.start) - t(planned.start))),
    endError,
    durationError: plannedMs > 0 ? round(Math.abs(t(actual.end) - t(actual.start) - plannedMs) / plannedMs) : 0,
    withinTolerance: endError <= tolerance,
  }
}

function qualityOf(kind: string, pieces: PieceSchedule[]): PredictionQuality {
  const judged = pieces.filter((p) => p.accuracy && p.actual.end)
  const months = new Map<string, PieceSchedule[]>()
  for (const p of judged) {
    const m = (p.actual.end ?? "").slice(0, 7)
    months.set(m, [...(months.get(m) ?? []), p])
  }
  const within = (ps: PieceSchedule[]) => round(ps.filter((p) => p.accuracy?.withinTolerance).length / (ps.length || 1))
  const w = judged.length ? within(judged) : 0
  return {
    kind,
    sample: judged.length,
    meanEndError: round(mean(judged.map((p) => p.accuracy?.endError ?? 0))),
    meanDurationError: round(mean(judged.map((p) => p.accuracy?.durationError ?? 0))),
    withinTolerance: w,
    byMonth: [...months].sort(([a], [b]) => a.localeCompare(b)).map(([month, ps]) => ({
      month,
      sample: ps.length,
      meanEndError: round(mean(ps.map((p) => p.accuracy?.endError ?? 0))),
      withinTolerance: within(ps),
    })),
    confidence: confidenceOf(judged.length, w),
  }
}

const dayOf = (ms: number): string => at(ms).slice(0, 10)
const dayStart = (d: string): number => t(`${d}T00:00:00.000Z`)

/** Everything the Gantt draws, for `items` (all the tracker's items by default), at `now`. */
export function scheduleOf(ctx: Context, plans: PlanRecord[], options: ScheduleOptions, items: Item[] = ctx.repo.items): ScheduleData {
  const now = ctx.now().getTime()
  const records = recordsOf(ctx, items)
  const planned = plannedByItem(plans)
  // A piece is work that was planned or done: a close alone, on an item nobody claimed or landed, is no schedule.
  const pieces = items.filter((i) => planned.has(i.meta.id) || (records.byItem.get(i.meta.id) ?? []).some((e) => e.kind !== "close"))
  const byId = new Map(pieces.map((i) => [i.meta.id, i]))

  // The actual schedules first: the pace rests on what has ended.
  const actuals = new Map(pieces.map((i) => [i.meta.id, actualOf(withSilence(records.byItem.get(i.meta.id) ?? [], options.stallAfter, now))]))
  const ended = pieces.flatMap((i) => {
    const a = actuals.get(i.meta.id)
    const d = a ? duration(a) : undefined
    if (d === undefined || d <= 0) return []
    const p = planned.get(i.meta.id)
    return [{ kind: kindOf(i), actual: d, ...(p ? { planned: t(p.end) - t(p.start) } : {}) }]
  })

  // Accuracy needs only plan and actual; the quality per kind then gives each forecast its confidence.
  const accuracy = new Map<string, Accuracy>()
  for (const i of pieces) {
    const p = planned.get(i.meta.id)
    const a = actuals.get(i.meta.id)
    const acc = p && a ? accuracyOf(p, a, options.tolerance) : undefined
    if (acc) accuracy.set(i.meta.id, acc)
  }
  const kinds = [...new Set(pieces.map(kindOf))].sort()
  const judgedOf = (kind?: string) =>
    pieces.filter((i) => (kind === undefined || kindOf(i) === kind) && accuracy.has(i.meta.id)).map((i) => accuracy.get(i.meta.id) as Accuracy)
  const confidenceFor = (kind: string): Confidence => {
    const own = judgedOf(kind)
    const pool = own.length >= MIN_SAMPLE ? own : judgedOf()
    return confidenceOf(pool.length, pool.length ? pool.filter((a) => a.withinTolerance).length / pool.length : 0)
  }

  // The expected schedules, each after the expected end of what it waits on.
  const expected = new Map<string, ExpectedSchedule>()
  const visiting = new Set<string>()
  const expect = (i: Item): ExpectedSchedule => {
    const id = i.meta.id
    const done = expected.get(id)
    if (done) return done
    visiting.add(id)
    const a = actuals.get(id) as ActualSchedule
    const p = planned.get(id)
    const kind = kindOf(i)
    const pace = paceOf(kind, ended)
    const est = p ? (t(p.end) - t(p.start)) * pace.ratio : pace.duration
    const basis = p
      ? `the plan's ${hours(t(p.end) - t(p.start))} h times ${
        round(pace.ratio)
      }, the median of actual over planned duration of ${pace.of} (${pace.sample} ended)`
      : pace.sample
      ? `${hours(pace.duration)} h, the median duration of ${pace.of} (${pace.sample} ended)`
      : `${DEFAULT_HOURS} h: no ended work to judge by yet`
    let e: ExpectedSchedule
    if (a.start && a.end) e = { start: a.start, end: a.end, confidence: confidenceFor(kind), basis: "the actual schedule: it ended" }
    else if (a.start) e = { start: a.start, end: at(Math.max(now, t(a.start) + est)), confidence: confidenceFor(kind), basis: `started; ${basis}` }
    else {
      const after = linked(ctx, i, "blocked-by").filter((b) => byId.has(b.meta.id) && !visiting.has(b.meta.id)).map((b) => t(expect(b).end))
      const from = Math.max(now, p ? t(p.start) : now, ...after)
      e = { start: at(from), end: at(from + est), confidence: confidenceFor(kind), basis: `${after.length ? "after what it waits on; " : ""}${basis}` }
    }
    visiting.delete(id)
    expected.set(id, e)
    return e
  }
  for (const i of pieces) expect(i)

  const out: PieceSchedule[] = pieces.map((i) => {
    const id = i.meta.id
    const a = actuals.get(id) as ActualSchedule
    const p = planned.get(id)
    const e = expected.get(id)
    const acc = accuracy.get(id)
    const gate = i.meta["gate"]
    return {
      piece: refOf(i),
      status: String(i.meta.status),
      ...(typeof gate === "string" ? { gate } : {}),
      waitsOn: linked(ctx, i, "blocked-by").map(label),
      ...(p ? { planned: p } : {}),
      ...(e ? { expected: e } : {}),
      actual: a,
      ...(p ? { drift: driftOf(p, a, e) } : {}),
      ...(acc ? { accuracy: acc } : {}),
    }
  }).sort((x, y) => ((x.actual.start ?? x.expected?.start ?? "") < (y.actual.start ?? y.expected?.start ?? "") ? -1 : 1))

  // Overlap by dependency: a piece that started while one it waits on had not ended.
  const overlaps: Overlap[] = []
  for (const p of out) {
    if (!p.actual.start) continue
    const from = t(p.actual.start)
    const to = p.actual.end ? t(p.actual.end) : now
    for (const ref of p.waitsOn) {
      const b = out.find((q) => q.piece.ref === ref)
      if (!b) continue
      const bEnd = b.actual.end ? t(b.actual.end) : b.expected ? t(b.expected.end) : undefined
      if (bEnd === undefined || from >= bEnd) continue
      const bStart = b.actual.start ? t(b.actual.start) : b.expected ? t(b.expected.start) : bEnd
      const together = Math.min(to, bEnd) - Math.max(from, bStart)
      const o: DependencyOverlap = {
        kind: "dependency",
        piece: p.piece.ref,
        waitsOn: ref,
        hours: hours(Math.max(0, together)),
        says: `${p.piece.ref} started ${hours(bEnd - from)} h before ${ref}, which it waits on, ${b.actual.end ? "ended" : "is expected to end"}`,
      }
      overlaps.push(o)
    }
  }

  // The resource histogram: work going on each day, actual up to today and expected after it, against the capacity.
  const today = dayOf(now)
  const spans = out.flatMap((p) => {
    const actual = p.actual.segments.filter((s) => s.kind === "work").map((s) => ({
      ref: p.piece.ref,
      from: t(s.from),
      to: s.to ? t(s.to) : now,
      forecast: false,
    }))
    const ongoing = !p.actual.end && p.expected ? [{ ref: p.piece.ref, from: Math.max(now, t(p.expected.start)), to: t(p.expected.end), forecast: true }] : []
    return [...actual, ...ongoing]
  })
  const histogram: ResourceDay[] = []
  if (spans.length) {
    const first = Math.min(...spans.map((s) => s.from))
    const last = Math.max(...spans.map((s) => s.to))
    let d = Math.max(dayStart(dayOf(first)), dayStart(dayOf(last)) - (MAX_DAYS - 1) * DAY_MS)
    for (; d <= last; d += DAY_MS) {
      const day = dayOf(d)
      const forecast = day > today
      const on = [...new Set(spans.filter((s) => s.forecast === forecast && s.from < d + DAY_MS && s.to > d).map((s) => s.ref))].sort()
      histogram.push({ day, demand: on.length, capacity: options.capacity, overAllocated: on.length > options.capacity, forecast, pieces: on })
    }
  }
  for (const h of histogram.filter((h) => h.overAllocated)) {
    overlaps.push({
      kind: "capacity",
      day: h.day,
      demand: h.demand,
      capacity: h.capacity,
      pieces: h.pieces,
      says: `${h.day}: ${h.demand} pieces ${h.forecast ? "expected to run" : "ran"}, with room for ${h.capacity}`,
    })
  }

  const quality = [...kinds.map((k) => qualityOf(k, out.filter((p) => p.piece.type === k))), qualityOf("all", out)]
  return {
    version: 1,
    at: at(now),
    capacity: options.capacity,
    stallAfter: options.stallAfter,
    tolerance: options.tolerance,
    pieces: out,
    overlaps,
    histogram,
    quality,
  }
}
