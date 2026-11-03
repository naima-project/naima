// The schedule of every piece of work, as data: what the schedule plugin derives and what the Gantt draws. The
// plugin publishes it through the read-only `ui-views` view `schedule` (the bridge's `data {view: "schedule"}`) and
// through `naima view schedule --json`; the shape is the same in both.
//
// Three schedules stand side by side for each piece of work:
//
//   planned   when it was meant to start and end, as proposed when it was planned, with who proposed it; the
//             first proposal is kept as the baseline when a later one replaces it
//   expected  Naima's forecast of when it will really start and end, with how far that forecast can be trusted
//   actual    when it really started, paused, stalled and ended, derived from the claims, the posted steps, the
//             commits, the landings and the closes; nothing is entered by hand
//
// From the three come the drift of each piece (late start, late end, longer than planned), the overlaps (a piece
// that ran while work it was planned to follow had not ended; days on which more pieces ran than the agents can
// carry, the over-allocated days of the resource histogram), and the quality of past predictions per kind of work.
//
// This module holds types only and imports nothing, so any part of Naima, or the app, can import it as types.
// Moments are ISO 8601 timestamps in UTC; days are YYYY-MM-DD; durations and drifts are in hours.

/** An ISO 8601 timestamp in UTC, such as 2026-11-03T17:15:13.785Z. */
export type Moment = string

/** A day, YYYY-MM-DD. */
export type Day = string

/** The piece of work a schedule belongs to: an item of the tracker. */
export interface PieceRef {
  /** The item's id, which never changes. */
  id: string
  /** The item as the tracker names it: `<type>/<slug>`. */
  ref: string
  /** Its type, such as features or bugs: the kind of work its predictions are measured by. */
  type: string
  title: string
}

/** Who proposed a planned schedule: a person's name when known, and the role they had (owner, coordinator, worker, agent). */
export interface Proposer {
  name?: string
  role: string
}

/** One proposal of a planned schedule. */
export interface Plan {
  start: Moment
  end: Moment
  by: Proposer
  /** When it was proposed. */
  on: Moment
  /** How the dates were reached, in words: given by hand, or from the project's pace and on what it rests. */
  basis: string
}

/** The planned schedule: the plan in force, and the first one when a later proposal replaced it. */
export interface PlannedSchedule extends Plan {
  /** 1 for the plan as first set, then one more for each proposal that replaced it. */
  revision: number
  /** The plan as first set, the baseline the Gantt can draw, when this one is a revision of it. */
  first?: Plan
}

/** How far a forecast can be trusted, from how right past forecasts of the same kind of work turned out. */
export interface Confidence {
  /** From 0 (a guess) to 1 (every past forecast of this kind ended within the tolerance). */
  value: number
  /** In words: "high", "medium", "low", or "none" when there is no past work of this kind to judge by. */
  level: "high" | "medium" | "low" | "none"
  /** How many finished pieces of the same kind it rests on. */
  sample: number
}

/** The expected schedule: Naima's forecast, which moves as work happens. */
export interface ExpectedSchedule {
  start: Moment
  end: Moment
  confidence: Confidence
  /** How it was reached, in words. */
  basis: string
}

/** A stretch of the actual schedule: work going on, stalled (no sign of life for the stall window), or paused (claim released before landing). */
export interface Segment {
  kind: "work" | "stalled" | "paused"
  from: Moment
  /** Absent while it is still going on. */
  to?: Moment
}

/** One record the actual schedule is derived from. */
export interface ActualEvent {
  at: Moment
  /**
   * claim: a branch claimed the piece; step: its worker posted a step; commit: a commit on that branch; quiet: no sign
   * of life for the stall window (derived, not recorded); release: the claim went away before the piece landed;
   * land: a landing named it; close: it was closed.
   */
  kind: "claim" | "step" | "commit" | "quiet" | "release" | "land" | "close"
  /** What it was, in words: the branch, the step's text, the commit's subject. */
  says: string
  branch?: string
  commit?: string
}

/** Where the piece stands, as the actual schedule reads it. */
export type ActualState = "not-started" | "active" | "stalled" | "paused" | "landed" | "closed"

/** The actual schedule, derived from what the project records as work happens. */
export interface ActualSchedule {
  state: ActualState
  /** When work first started; absent while it has not. */
  start?: Moment
  /** When it ended: its landing, or its close; absent while it has not. */
  end?: Moment
  segments: Segment[]
  /** The records it was derived from, oldest first. */
  events: ActualEvent[]
}

/** How far the actual schedule drifted from the planned one, in hours; positive is late or longer. */
export interface Drift {
  /** Actual start minus planned start, once work started. */
  start?: number
  /** Actual end minus planned end, once it ended; while it runs, the expected end minus the planned end. */
  end?: number
  /** Actual (or expected) duration over planned duration. */
  durationRatio?: number
  /** True when the end drift is computed from the expected end, because the piece has not ended. */
  provisional: boolean
  says: string
}

/** How right the planned schedule turned out, for a piece that ended. */
export interface Accuracy {
  /** |actual start − planned start|, hours. */
  startError: number
  /** |actual end − planned end|, hours. */
  endError: number
  /** |actual duration − planned duration| over planned duration. */
  durationError: number
  /** True when the end came within the tolerance of the plan. */
  withinTolerance: boolean
}

/** The schedule of one piece of work. */
export interface PieceSchedule {
  piece: PieceRef
  /** The item's status in the tracker. */
  status: string
  gate?: string
  /** The pieces it waits on (blocked-by), by ref. */
  waitsOn: string[]
  planned?: PlannedSchedule
  expected?: ExpectedSchedule
  actual: ActualSchedule
  drift?: Drift
  accuracy?: Accuracy
}

/** A piece that ran while one it was planned to follow had not ended (blocks / blocked-by). */
export interface DependencyOverlap {
  kind: "dependency"
  /** The piece that started early. */
  piece: string
  /** The piece it waits on, which had not ended. */
  waitsOn: string
  /** How long they ran together, in hours. */
  hours: number
  says: string
}

/** A day on which more pieces ran than the agents can carry. */
export interface CapacityOverlap {
  kind: "capacity"
  day: Day
  demand: number
  capacity: number
  pieces: string[]
  says: string
}

export type Overlap = DependencyOverlap | CapacityOverlap

/** One day of the resource histogram: the pieces in progress against what the agents can carry. */
export interface ResourceDay {
  day: Day
  /** Pieces with work going on (not stalled or paused) during the day, actual for past days, expected for later ones. */
  demand: number
  /** The most workers that run at once: the coordination option maxWorkers. */
  capacity: number
  /** Demand above capacity. */
  overAllocated: boolean
  /** True for a day after today, whose demand is forecast. */
  forecast: boolean
  pieces: string[]
}

/** How good past predictions were, for one kind of work. */
export interface PredictionQuality {
  /** The kind of work: an item type, or "all". */
  kind: string
  /** Finished pieces with a planned schedule. */
  sample: number
  /** Mean |actual end − planned end|, hours. */
  meanEndError: number
  /** Mean |actual duration − planned duration| over planned duration. */
  meanDurationError: number
  /** Share of pieces that ended within the tolerance of their plan, 0 to 1. */
  withinTolerance: number
  /** The same measures month by month, oldest first, so the trend shows. */
  byMonth: { month: string; sample: number; meanEndError: number; withinTolerance: number }[]
  /** What a new forecast of this kind is given. */
  confidence: Confidence
}

/** Everything the Gantt draws: what the `schedule` view's data is. */
export interface ScheduleData {
  /** The shape's version: 1. */
  version: 1
  /** When it was derived. */
  at: Moment
  /** The most workers at once (coordination's maxWorkers): the capacity of the resource histogram. */
  capacity: number
  /** Minutes without a sign of life after which work counts as stalled. */
  stallAfter: number
  /** Hours within which an end counts as on plan. */
  tolerance: number
  pieces: PieceSchedule[]
  overlaps: Overlap[]
  /** The resource histogram, day by day over the span the pieces cover. */
  histogram: ResourceDay[]
  /** Per kind of work, then "all". */
  quality: PredictionQuality[]
}
