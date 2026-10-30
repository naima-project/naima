// A run's record: the directory `<tracker folder>/.runs/<name>/` that the
// `run` command writes once (run.json), the supervisor keeps current
// (status.json, log) and the command may write to (progress). Every reader
// derives the reported state from these files alone — liveness from the
// supervisor's heartbeat, never from a search of the process table.
// Shared by the commands and the supervisor; of the core, only the API.

import { closeSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, readSync, renameSync, statSync, writeFileSync } from "node:fs"
import { basename, dirname, join } from "node:path"
import { estimate, type ProgressEstimate, type ProgressSample, readProgressLine, showDuration, stageTotal } from "../../core/api.ts"

export { showDuration }

/** The folder of every record, beside the data directory; it ignores itself, so no record is ever tracked. */
export const RUNS_DIR = ".runs"
/** A run's name: what its record is called. */
export const NAME = /^[a-z0-9][a-z0-9._-]{0,63}$/
/** The words after `naima run` that are subcommands, never a run's name. */
export const SUBCOMMANDS = ["list", "status", "stop", "clean", "due"] as const

export const RUN_FILE = "run.json"
export const STATUS_FILE = "status.json"
export const LOG_FILE = "log"
export const PROGRESS_FILE = "progress"
export const STOP_FILE = "stop"

/** The defaults the specification fixes. */
export const DEFAULTS = {
  everyMs: 10_000,
  /** A run that reports progress is stale after this long without a progress line (specs/progress-long-work-says-how-far, §4). */
  staleMs: 2 * 60_000,
  /** A run declared --no-progress is stale after this long without output. */
  staleNoProgressMs: 15 * 60_000,
  timeoutMs: 10 * 60_000,
  waitEveryMs: 1_000,
  remoteEveryMs: 30_000,
  tail: 20,
  /** How often `naima wait` says how the run goes while it waits. */
  reportMs: 30_000,
  /** How long an ended run's group is given between SIGTERM and SIGKILL. */
  graceMs: 10_000,
  /**
   * How long `naima run` waits for the supervisor to report the command started, and how long a
   * record with no report yet stays starting: on a busy machine a runtime can take tens of seconds
   * to launch (macOS checks the binary before it runs).
   */
  startMs: 60_000,
} as const

/** What `naima run` asked for: written once, before the supervisor starts. */
export interface RunSpec {
  name: string
  /** A command line for the shell (`shell: true`, one element), or a program and its arguments. */
  command: string[]
  shell: boolean
  cwd: string
  budgetTimeMs: number
  budgetDiskBytes?: number
  /** Absolute paths, or, for a remote run, as the host is given them. */
  creates: string[]
  everyMs: number
  staleMs: number
  guardTracked: boolean
  started: string
  /** Set for a remote run: the host it runs on, whose own Naima keeps the real record. */
  host?: string
  /** Set by --no-progress: why the command cannot report progress. */
  noProgress?: string
}

export type Reason = "exit" | "budget-time" | "budget-disk" | "stopped" | "start-failed"

/** What the supervisor writes, and only it. */
export interface RunStatus {
  state: "starting" | "running" | "ended"
  supervisorPid: number
  pid?: number
  heartbeat: string
  elapsedMs: number
  sizeBytes?: number
  peakBytes?: number
  exitCode?: number | null
  signal?: string | null
  reason?: Reason
  ended?: string
  /** Under --guard-tracked: the tracked files the run changed. */
  changedTracked?: string[]
  error?: string
  /** The first sample of the current stage of the progress line, and of its overall count: what rates are measured from. */
  progressFrom?: ProgressSample
  overallFrom?: ProgressSample
}

export type Reported = "starting" | "running" | "stale" | "lost" | "succeeded" | "failed" | "killed" | "stopped" | "unknown"

/** One run as every reader reports it: `run status --json`, `run list --json`, and what a host answers. */
export interface RunView {
  name: string
  host?: string
  state: Reported
  /** True once nothing of the run can change any more: ended, or lost. */
  over: boolean
  pid?: number
  started: string
  elapsedMs: number
  budgetTimeMs: number
  sizeBytes?: number
  peakBytes?: number
  budgetDiskBytes?: number
  exitCode?: number | null
  signal?: string | null
  reason?: Reason
  ended?: string
  changedTracked?: string[]
  /** The last progress line, how old it is, and, for a structured one, its fields with the rate and ETA computed from it. */
  progress?: { line: string; ageMs: number } & ProgressEstimate
  /** For a run declared --no-progress: why, and the log's last line, the most it can say. */
  noProgress?: string
  lastLog?: string
  log: string
  tail?: string[]
  error?: string
}

/** The tracker folder: the folder holding the data directory, or the data directory itself once moved out of one. */
export function trackerFolder(data: string, trackerDirName: string): string {
  return basename(dirname(data)) === trackerDirName ? dirname(data) : data
}

export const runsDir = (tracker: string): string => join(tracker, RUNS_DIR)

/** Make the runs folder, ignoring itself through its own .gitignore. */
export function ensureRunsDir(tracker: string): string {
  const dir = runsDir(tracker)
  mkdirSync(dir, { recursive: true })
  const ignore = join(dir, ".gitignore")
  if (!existsSync(ignore)) writeFileSync(ignore, "*\n")
  return dir
}

/** Write `file` whole, through a temporary file renamed over it: a reader never sees half of it. */
export function writeJsonAtomic(file: string, value: unknown): void {
  const tmp = `${file}.${process.pid}.tmp`
  writeFileSync(tmp, JSON.stringify(value, null, 2) + "\n")
  renameSync(tmp, file)
}

const readJson = <T>(file: string): T | null => {
  try {
    return JSON.parse(readFileSync(file, "utf8")) as T
  } catch {
    return null
  }
}

export const readSpec = (dir: string): RunSpec | null => readJson<RunSpec>(join(dir, RUN_FILE))
export const readStatus = (dir: string): RunStatus | null => readJson<RunStatus>(join(dir, STATUS_FILE))

/** Every record's directory, newest first. */
export function recordDirs(tracker: string): string[] {
  const dir = runsDir(tracker)
  if (!existsSync(dir)) return []
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && NAME.test(e.name))
    .map((e) => join(dir, e.name))
    .map((d) => ({ d, started: readSpec(d)?.started ?? "" }))
    .sort((a, b) => b.started.localeCompare(a.started))
    .map((x) => x.d)
}

export const mtime = (file: string): number | null => {
  try {
    return statSync(file).mtimeMs
  } catch {
    return null
  }
}

/** The last `n` lines of `file`, read from its end: a long log is never read whole. */
export function tailOf(file: string, n: number): string[] {
  if (n <= 0 || !existsSync(file)) return []
  const size = statSync(file).size
  const want = Math.min(size, Math.max(4096, n * 400))
  const buf = Buffer.alloc(want)
  const fd = openSync(file, "r")
  try {
    readSync(fd, buf, 0, want, size - want)
  } finally {
    closeSync(fd)
  }
  const lines = buf.toString("utf8").replace(/\n$/, "").split("\n")
  return (size > want ? lines.slice(1) : lines).slice(-n)
}

/** The last non-empty line of `file`, or undefined. */
export function lastLine(file: string): string | undefined {
  return tailOf(file, 5).filter((l) => l.trim()).pop()
}

/** The progress line, as read at `now`, with its rate and ETA from the samples the supervisor kept (§3). */
export function progressOf(line: string, at: number, status: RunStatus | null, now: number): { line: string; ageMs: number } & ProgressEstimate {
  const out: { line: string; ageMs: number } & ProgressEstimate = { line, ageMs: Math.max(0, now - at) }
  const p = readProgressLine(line)
  if (!p) return out
  Object.assign(out, p)
  if (p.done !== undefined) {
    const from = status?.progressFrom
    // An estimated total grows as the stage passes it: the same stage still (§3.1).
    const same = from && from.stage === p.stage && from.unit === p.unit && from.total === stageTotal(p)
    const e = estimate(same ? from : undefined, p.done, at, p.total, now)
    if (e.rate !== undefined) out.rate = e.rate
    if (e.etaMs !== undefined) out.etaMs = e.etaMs
  }
  if (p.overall) {
    const from = status?.overallFrom
    const same = from && from.unit === p.overall.unit && from.total === p.overall.total
    const e = estimate(same ? from : undefined, p.overall.done, at, p.overall.total, now)
    if (e.rate !== undefined) out.overallRate = e.rate
    if (e.etaMs !== undefined) out.overallEtaMs = e.etaMs
  }
  return out
}

/** The samples to keep after reading `line`, written at `at`: a new stage, or a new overall total, starts afresh (§3.1). */
export function sampleProgress(
  line: string | undefined,
  at: number | null,
  kept: Pick<RunStatus, "progressFrom" | "overallFrom">,
): Pick<RunStatus, "progressFrom" | "overallFrom"> {
  if (line === undefined || at === null) return kept
  const p = readProgressLine(line)
  if (!p) return kept
  const out = { ...kept }
  if (p.done !== undefined) {
    const k = kept.progressFrom
    if (!k || k.stage !== p.stage || k.unit !== p.unit || k.total !== stageTotal(p)) {
      const total = stageTotal(p)
      out.progressFrom = {
        ...(p.stage !== undefined ? { stage: p.stage } : {}),
        ...(p.unit !== undefined ? { unit: p.unit } : {}),
        ...(total !== undefined ? { total } : {}),
        done: p.done,
        at,
      }
    }
  }
  if (p.overall) {
    const k = kept.overallFrom
    if (!k || k.unit !== p.overall.unit || k.total !== p.overall.total) {
      out.overallFrom = {
        ...(p.overall.unit !== undefined ? { unit: p.overall.unit } : {}),
        ...(p.overall.total !== undefined ? { total: p.overall.total } : {}),
        done: p.overall.done,
        at,
      }
    }
  }
  return out
}

/** How long a heartbeat may age before the supervisor is taken for gone. */
export const lostAfterMs = (everyMs: number): number => 3 * everyMs + 10_000

/** The reported state of a record, at `now`: §2 of the specification. */
export function view(dir: string, now: number, tail = 0): RunView {
  const spec = readSpec(dir)
  const status = readStatus(dir)
  const name = basename(dir)
  const log = join(dir, LOG_FILE)
  const started = spec?.started ?? new Date(0).toISOString()
  const base: RunView = {
    name,
    state: "unknown",
    over: false,
    started,
    elapsedMs: status?.elapsedMs ?? Math.max(0, now - Date.parse(started)),
    budgetTimeMs: spec?.budgetTimeMs ?? 0,
    log,
    ...(spec?.budgetDiskBytes !== undefined ? { budgetDiskBytes: spec.budgetDiskBytes } : {}),
  }
  if (!spec) return { ...base, state: "lost", over: true, error: "the record has no run.json" }
  const progressFile = join(dir, PROGRESS_FILE)
  const progressAt = mtime(progressFile)
  const progressLine = lastLine(progressFile)
  const lastLog = spec.noProgress !== undefined ? lastLine(log) : undefined
  const withFacts: RunView = {
    ...base,
    ...(status?.pid !== undefined ? { pid: status.pid } : {}),
    ...(status?.sizeBytes !== undefined ? { sizeBytes: status.sizeBytes } : {}),
    ...(status?.peakBytes !== undefined ? { peakBytes: status.peakBytes } : {}),
    ...(progressLine !== undefined && progressAt !== null ? { progress: progressOf(progressLine, progressAt, status, now) } : {}),
    ...(spec.noProgress !== undefined ? { noProgress: spec.noProgress } : {}),
    ...(lastLog !== undefined ? { lastLog } : {}),
    ...(tail > 0 ? { tail: tailOf(log, tail) } : {}),
  }
  if (!status) {
    const age = now - Date.parse(spec.started)
    return age > Math.max(lostAfterMs(spec.everyMs), DEFAULTS.startMs)
      ? { ...withFacts, state: "lost", over: true, error: "the supervisor never reported" }
      : { ...withFacts, state: "starting" }
  }
  if (status.state === "ended") {
    const ended: RunView = {
      ...withFacts,
      over: true,
      exitCode: status.exitCode ?? null,
      signal: status.signal ?? null,
      ...(status.reason ? { reason: status.reason } : {}),
      ...(status.ended ? { ended: status.ended } : {}),
      ...(status.changedTracked?.length ? { changedTracked: status.changedTracked } : {}),
      ...(status.error ? { error: status.error } : {}),
    }
    const state: Reported = status.reason === "budget-time" || status.reason === "budget-disk"
      ? "killed"
      : status.reason === "stopped"
      ? "stopped"
      : status.reason === "exit" && status.exitCode === 0 && !status.changedTracked?.length
      ? "succeeded"
      : "failed"
    return { ...ended, state }
  }
  const beat = Date.parse(status.heartbeat)
  if (now - beat > lostAfterMs(spec.everyMs)) {
    return { ...withFacts, elapsedMs: Math.max(status.elapsedMs, now - Date.parse(spec.started)), state: "lost", over: true }
  }
  // A run that reports progress is judged on its progress file; one declared --no-progress on whatever it writes.
  const active = Math.max(Date.parse(spec.started), spec.noProgress !== undefined ? mtime(log) ?? 0 : 0, progressAt ?? 0)
  const state: Reported = status.state === "starting" ? "starting" : now - active > spec.staleMs ? "stale" : "running"
  return { ...withFacts, elapsedMs: Math.max(status.elapsedMs, now - Date.parse(spec.started)), state }
}

const UNITS: Record<string, number> = { s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000 }

/** A duration, `<n>s|m|h|d`, in milliseconds; null when it is not one. */
export function parseDuration(raw: string): number | null {
  const m = /^(\d+)(s|m|h|d)$/.exec(raw)
  if (!m || Number(m[1]) < 1) return null
  return Number(m[1]) * UNITS[m[2] as string]!
}

const SIZES: Record<string, number> = { "": 1, K: 1024, M: 1024 ** 2, G: 1024 ** 3, T: 1024 ** 4 }

/** A size, `<n>` bytes or `<n>K|M|G|T` (binary), in bytes; null when it is not one. */
export function parseSize(raw: string): number | null {
  const m = /^(\d+)([KMGT]?)$/i.exec(raw)
  if (!m || Number(m[1]) < 1) return null
  return Number(m[1]) * SIZES[(m[2] ?? "").toUpperCase()]!
}

/** A size for people, in binary units: `512 B`, `1.5 MiB`. */
export function showSize(bytes: number): string {
  const units = ["B", "KiB", "MiB", "GiB", "TiB"]
  let v = bytes
  let i = 0
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  return i === 0 ? `${v} B` : `${v.toFixed(1)} ${units[i]}`
}
