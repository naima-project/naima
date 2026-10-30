// Progress: how far long work is, said so that a person, an agent and
// `naima run` can all read it (specs/progress-long-work-says-how-far). The
// progress line (§2): a JSON object with a stage, a count done of a total and
// its unit, a note and an overall count — or free text. Its rate and ETA (§3),
// read from two samples of a stage. The reporter every command of Naima uses
// for its own long work (§6): into $NAIMA_RUN_PROGRESS inside a run, onto
// standard error otherwise, never in the first seconds of short work.

import { renameSync, writeFileSync } from "node:fs"

/** A count: how much is done, of how much, of what. */
export interface Count {
  done: number
  total?: number
  unit?: string
}

/** A structured progress line (§2): every field optional. */
export interface ProgressLine {
  stage?: string
  done?: number
  total?: number
  unit?: string
  /** True when `total` is an estimate (the count a previous run of the same work ended on), not a known total. */
  estimate?: boolean
  note?: string
  overall?: Count
}

/** A progress line with what a reader computes from it (§3.3). */
export interface ProgressEstimate extends ProgressLine {
  /** Per second, in the stage's unit. */
  rate?: number
  etaMs?: number
  overallRate?: number
  overallEtaMs?: number
}

/** Where a stage was first seen: what a rate is measured from (§3.1). */
export interface ProgressSample {
  stage?: string
  unit?: string
  total?: number
  done: number
  /** Epoch milliseconds. */
  at: number
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v)
const count = (v: unknown, min: number): number | undefined => (typeof v === "number" && Number.isFinite(v) && v >= min ? v : undefined)
const text = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v.trim() : undefined)

function countOf(v: unknown): Count | undefined {
  if (!isObject(v)) return undefined
  const done = count(v["done"], 0)
  if (done === undefined) return undefined
  const total = count(v["total"], Number.MIN_VALUE)
  const unit = text(v["unit"])
  return { done, ...(total !== undefined ? { total } : {}), ...(unit !== undefined ? { unit } : {}) }
}

/** The structured line `line` holds, or null when it is free text (§2). A field of the wrong type is as if absent. */
export function readProgressLine(line: string): ProgressLine | null {
  const t = line.trim()
  if (!t.startsWith("{")) return null
  let v: unknown
  try {
    v = JSON.parse(t)
  } catch {
    return null
  }
  if (!isObject(v)) return null
  const out: ProgressLine = {}
  const stage = text(v["stage"])
  if (stage !== undefined) out.stage = stage
  const done = count(v["done"], 0)
  if (done !== undefined) out.done = done
  const total = count(v["total"], Number.MIN_VALUE)
  if (total !== undefined) out.total = total
  const unit = text(v["unit"])
  if (unit !== undefined) out.unit = unit
  if (v["estimate"] === true && total !== undefined) out.estimate = true
  const note = text(v["note"])
  if (note !== undefined) out.note = note
  const overall = countOf(v["overall"])
  if (overall) out.overall = overall
  return out
}

/** The line a writer puts in the progress file for `p`: one JSON object. */
export const progressLineOf = (p: ProgressLine): string => JSON.stringify(p)

/** The total that tells a stage from another: a known total; an estimate, which may grow as the stage goes past it, is none. */
export const stageTotal = (p: { total?: number; estimate?: boolean }): number | undefined => (p.estimate ? undefined : p.total)

/** Whether `b` is the same stage as `a`: its stage, unit and known total are the same (§3.1); an estimated total is no part of it. */
export const sameStage = (
  a: { stage?: string; unit?: string; total?: number; estimate?: boolean },
  b: { stage?: string; unit?: string; total?: number; estimate?: boolean },
): boolean => a.stage === b.stage && a.unit === b.unit && stageTotal(a) === stageTotal(b)

/** The total an estimate becomes once `done` has reached it: a tenth more than the count, so a stage never shows more than 100%. */
export const grownEstimate = (total: number, done: number): number => (done < total ? total : Math.ceil(done + done / 10) || 1)

/** The rate since `from` and, with a total, the time left at `now`: what can be computed, nothing else (§3.2). */
export function estimate(
  from: ProgressSample | undefined,
  done: number,
  at: number,
  total: number | undefined,
  now: number,
): { rate?: number; etaMs?: number } {
  if (!from || at <= from.at || done <= from.done) return {}
  const rate = (done - from.done) / ((at - from.at) / 1000)
  if (total === undefined) return { rate }
  const left = Math.max(0, total - done)
  return { rate, etaMs: Math.max(0, (left / rate) * 1000 - Math.max(0, now - at)) }
}

/** A duration for people: `45s`, `3m 20s`, `2h 5m`, `1d 3h`. */
export function showDuration(ms: number): string {
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.floor(s / 60)}m${s % 60 ? ` ${s % 60}s` : ""}`
  if (s < 86400) return `${Math.floor(s / 3600)}h${Math.floor(s / 60) % 60 ? ` ${Math.floor(s / 60) % 60}m` : ""}`
  return `${Math.floor(s / 86400)}d${Math.floor(s / 3600) % 24 ? ` ${Math.floor(s / 3600) % 24}h` : ""}`
}

const number = (n: number): string => (Number.isInteger(n) ? n.toLocaleString("en-US") : n.toLocaleString("en-US", { maximumFractionDigits: 1 }))

/** A count as `done/total unit (p%)`, or `done unit` without a total (§3.4); an estimated total as `done/~total unit (~p%)`. */
export function showCount(c: Count & { estimate?: boolean }): string {
  const unit = c.unit ? ` ${c.unit}` : ""
  if (c.total === undefined) return `${number(c.done)}${unit}`
  const est = c.estimate ? "~" : ""
  return `${number(c.done)}/${est}${number(c.total)}${unit} (${est}${Math.min(100, Math.floor((c.done / c.total) * 100))}%)`
}

/** A rate per second as `/s`, `/min` or `/h`, whichever gives a number of at least 1 (§3.4). */
export function showRate(perSecond: number): string {
  if (perSecond >= 100) return `${number(Math.round(perSecond))}/s`
  if (perSecond >= 1) return `${number(Math.round(perSecond * 10) / 10)}/s`
  if (perSecond * 60 >= 1) return `${number(Math.round(perSecond * 600) / 10)}/min`
  return `${number(Math.round(perSecond * 36000) / 10)}/h`
}

/** A progress line as people read it (§3.4): the overall count, the stage and its count, the rate, the ETA, the note. */
export function showProgress(p: ProgressEstimate): string {
  const parts: string[] = []
  if (p.overall) {
    parts.push(
      [
        showCount(p.overall),
        p.overallRate !== undefined ? showRate(p.overallRate) : "",
        p.overallEtaMs !== undefined ? `ETA ${showDuration(p.overallEtaMs)}` : "",
      ]
        .filter(Boolean).join(" · "),
    )
  }
  const stage = [
    p.stage !== undefined ? `${p.stage}${p.done !== undefined ? ":" : ""}` : "",
    p.done !== undefined
      ? showCount({
        done: p.done,
        ...(p.total !== undefined ? { total: p.total } : {}),
        ...(p.unit !== undefined ? { unit: p.unit } : {}),
        ...(p.estimate && p.total !== undefined ? { estimate: true } : {}),
      })
      : "",
  ].filter(Boolean).join(" ")
  const eta = p.etaMs !== undefined ? `ETA ${p.estimate ? "~" : ""}${showDuration(p.etaMs)}` : ""
  const rest = [stage, p.rate !== undefined ? showRate(p.rate) : "", eta].filter(Boolean).join(" · ")
  if (rest) parts.push(rest)
  const head = parts.join(" — ")
  return p.note ? (head ? `${head} — ${p.note}` : p.note) : head
}

/** What a command reports through (§6.1). */
export interface Progress {
  /** The whole work around the stages: how much is done of how much. */
  overall(done: number, total?: number, unit?: string): void
  /**
   * A new stage: its name and, when known, its total and unit. `estimate` true says the total is an estimate (the count
   * a previous run of the same work ended on): it is shown as one, and grows when the count goes past it.
   */
  stage(name: string, total?: number, unit?: string, estimate?: boolean): void
  /** How much of the stage is done. */
  at(done: number): void
  /** Anything else worth saying: the tool's last log line, the item being worked on. */
  note(text: string): void
  /** The work is over: no more lines. */
  end(): void
}

/** A reporter that reports nothing: for work that is not long, and for tests. */
export const NO_PROGRESS: Progress = { overall() {}, stage() {}, at() {}, note() {}, end() {} }

/** The timings of §6: overridable by a test. */
export const PROGRESS_TIMING = {
  /** Outside a run, nothing in the first this many milliseconds. */
  quietMs: 2_000,
  /** Outside a run, a change is printed at most this often. */
  printEveryMs: 2_000,
  /** Inside a run, a change is written at most this often. */
  writeEveryMs: 1_000,
  /** While nothing changes, the line is said again this often. */
  beatMs: 5_000,
}

export interface ReporterOptions {
  /** The progress file of the run the work is inside: $NAIMA_RUN_PROGRESS. Absent: standard error. */
  file?: string | undefined
  now?: () => number
  timing?: Partial<typeof PROGRESS_TIMING>
  /** False: no timer of its own, only the calls report (a test drives it). */
  beat?: boolean
}

/** The reporter of §6: one per command run. */
export function progressReporter(err: (line: string) => void, options: ReporterOptions = {}): Progress {
  const t = { ...PROGRESS_TIMING, ...options.timing }
  const now = options.now ?? Date.now
  const file = options.file
  const started = now()
  let overall: (Count & { from: ProgressSample }) | undefined
  let stage: { name: string; total?: number; unit?: string; estimate?: boolean; done?: number; from: ProgressSample; since: number } | undefined
  let note: string | undefined
  let said = 0
  let saidText = ""
  let ended = false

  const line = (): ProgressLine => ({
    ...(stage ? { stage: stage.name } : {}),
    ...(stage?.done !== undefined ? { done: stage.done } : {}),
    ...(stage?.total !== undefined ? { total: stage.total } : {}),
    ...(stage?.unit !== undefined ? { unit: stage.unit } : {}),
    ...(stage?.estimate ? { estimate: true } : {}),
    ...(note !== undefined ? { note } : {}),
    ...(overall
      ? { overall: { done: overall.done, ...(overall.total !== undefined ? { total: overall.total } : {}), ...(overall.unit ? { unit: overall.unit } : {}) } }
      : {}),
  })

  const write = (text: string): void => {
    try {
      const tmp = `${file}.${process.pid}.tmp`
      writeFileSync(tmp, text + "\n")
      renameSync(tmp, file!)
    } catch { /* progress never fails the work (§6.4) */ }
  }

  /** Report now if the timings allow it; `changed` a new stage when `"stage"`. */
  const report = (changed: "stage" | "count" | "beat"): void => {
    if (ended) return
    const at = now()
    const l = line()
    if (file) {
      const text = progressLineOf(l)
      if (changed === "stage" || (changed === "count" && text !== saidText && at - said >= t.writeEveryMs) || at - said >= t.beatMs) {
        write(text)
        said = at
        saidText = text
      }
      return
    }
    if (at - started < t.quietMs) return
    const s = stage ? estimate(stage.from, stage.done ?? 0, at, stage.total, at) : {}
    const o = overall ? estimate(overall.from, overall.done, at, overall.total, at) : {}
    const shown = showProgress({
      ...l,
      ...(s.rate !== undefined ? { rate: s.rate } : {}),
      ...(s.etaMs !== undefined ? { etaMs: s.etaMs } : {}),
      ...(o.rate !== undefined ? { overallRate: o.rate } : {}),
      ...(o.etaMs !== undefined ? { overallEtaMs: o.etaMs } : {}),
    })
    const key = progressLineOf(l)
    if (changed === "stage" || (key !== saidText && at - said >= t.printEveryMs) || at - said >= t.beatMs) {
      err(`progress: ${shown || "working"} · ${showDuration(at - (stage?.since ?? started))}${stage ? " in this stage" : ""}`)
      said = at
      saidText = key
    }
  }

  let timer: ReturnType<typeof setInterval> | undefined
  if (options.beat !== false) {
    timer = setInterval(() => report("beat"), 1_000)
    const deno = (globalThis as { Deno?: { unrefTimer?(id: number): void } }).Deno
    if (typeof timer === "number" && deno?.unrefTimer) deno.unrefTimer(timer)
    else (timer as { unref?: () => void }).unref?.()
  }

  return {
    overall(done, total, unit) {
      const next: Count = { done, ...(total !== undefined ? { total } : {}), ...(unit !== undefined ? { unit } : {}) }
      // Measured from the start of the work; afresh, from here, when the total or the unit changes.
      const from = !overall ? { done: 0, at: started } : overall.total === total && overall.unit === unit ? overall.from : { done, at: now() }
      overall = { ...next, from }
      report("count")
    },
    stage(name, total, unit, estimate) {
      const at = now()
      stage = {
        name,
        ...(total !== undefined ? { total } : {}),
        ...(unit !== undefined ? { unit } : {}),
        ...(estimate && total !== undefined ? { estimate: true } : {}),
        from: { done: 0, at },
        since: at,
      }
      note = undefined
      report("stage")
    },
    at(done) {
      if (!stage) return
      stage.done = done
      if (stage.estimate && stage.total !== undefined) stage.total = grownEstimate(stage.total, done)
      report("count")
    },
    note(text) {
      note = text.trim() || undefined
      report("count")
    },
    end() {
      if (ended) return
      // The last state is always written, so a run's progress file ends on where the work ended.
      if (file && progressLineOf(line()) !== saidText) write(progressLineOf(line()))
      ended = true
      if (timer !== undefined) clearInterval(timer)
    },
  }
}

/** The reporter for a command's own work: into the run's progress file when it runs inside one, else onto `err` (§6). */
export const progressFor = (err: (line: string) => void, options: Omit<ReporterOptions, "file"> = {}): Progress =>
  progressReporter(err, { ...options, file: process.env["NAIMA_RUN_PROGRESS"] || undefined })
