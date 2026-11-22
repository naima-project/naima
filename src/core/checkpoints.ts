// Check modes: a project runs its landing checks on every landing (`continuous`, the default), or only the fast ones it
// names, owing the rest until a checkpoint (`checkpoint`). The landing marker carries what it owes in a `Checks-owed:`
// trailer; `naima checkpoint` runs what is owed and records the result as a file of the data directory's `checkpoints/`.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { relative, sep } from "node:path"
import { DATA_FILE } from "./layout.ts"
import { gitOrNull, trunk } from "./git.ts"
import { heavyAnswer } from "./heavy.ts"
import { privateContext, redactPrivate } from "./private.ts"
import { developmentLine } from "./trunk-only.ts"
import type { Context } from "./types.ts"

/** The trailer a landing marker names the checks it did not run in. */
export const CHECKS_OWED = "Checks-owed"

/** The directory of the data directory holding one record per checkpoint. */
export const CHECKPOINTS = "checkpoints"

export type CheckMode = "continuous" | "checkpoint"

/**
 * The options that say where and when heavy checks run: the owner's choice, recorded on the trunk by `naima heavy-checks`.
 * A development line's copy of naima.json may predate that choice, so in a checkout of a line the trunk's value wins.
 */
const TRUNK_OPTIONS: readonly string[] = ["heavyChecks", "checks", "landingHost", "verifyHost"]

const trunkOptions = new Map<string, Record<string, unknown>>()

/** The coordination options the trunk's naima.json records, read from git (not from the checkout); empty outside a development line or when the trunk has none. */
function trunkConfigured(ctx: Context): Record<string, unknown> {
  if (!developmentLine(ctx.root)) return {}
  const main = trunk(ctx.root)
  if (!main) return {}
  const file = relative(ctx.root, join(ctx.trackerRoot, DATA_FILE)).split(sep).join("/")
  if (file.startsWith("..")) return {}
  const sha = gitOrNull(ctx.root, "rev-parse", "--verify", "--quiet", `refs/heads/${main}^{commit}`)
  if (!sha) return {}
  const key = `${ctx.root}\0${sha}\0${file}`
  const known = trunkOptions.get(key)
  if (known) return known
  let options: Record<string, unknown> = {}
  try {
    const raw = gitOrNull(ctx.root, "show", `${sha}:${file}`)
    const parsed = raw === null ? null : (JSON.parse(raw) as { plugins?: Record<string, { options?: Record<string, unknown> }> })
    options = parsed?.plugins?.["coordination"]?.options ?? {}
  } catch {
    // no readable naima.json on the trunk: the checkout's configuration decides
  }
  trunkOptions.set(key, options)
  return options
}

/**
 * A coordination option: for those that say where heavy checks run, on a development line, the trunk's recorded value;
 * else the branch tip's own configuration first when `at` holds it, else the one `ctx` runs with.
 */
export function option(ctx: Context, name: string, at?: Context): unknown {
  if (TRUNK_OPTIONS.includes(name)) {
    const main = trunkConfigured(ctx)[name]
    if (main !== undefined) return main
  }
  if (at) {
    try {
      const tip = (JSON.parse(readFileSync(join(at.trackerRoot, DATA_FILE), "utf8")) as { plugins?: Record<string, { options?: Record<string, unknown> }> })
        .plugins?.["coordination"]?.options?.[name]
      if (tip !== undefined) return tip
    } catch {
      // no readable naima.json at the tip: the configuration naima runs with decides
    }
  }
  return (ctx.config.plugins["coordination"]?.options ?? {})[name]
}

/** The words of a list option: an array of strings, or one string split at commas. */
const words = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : typeof v === "string" ? v.split(",") : []).map((s) => s.trim()).filter(Boolean)

/** The coordination option `checks`: `continuous` (the default) or `checkpoint`; anything else is an error. */
export function checkMode(ctx: Context, at?: Context): CheckMode {
  const v = option(ctx, "checks", at)
  if (v === undefined || v === "" || v === "continuous") return "continuous"
  if (v === "checkpoint") return "checkpoint"
  throw new Error(`the coordination option checks is "continuous" or "checkpoint", not ${JSON.stringify(v)}`)
}

/** The coordination option `fastChecks`: the landing checks that still run on every landing in checkpoint mode. */
export const fastChecks = (ctx: Context, at?: Context): string[] => words(option(ctx, "fastChecks", at))

/** The coordination option `checkpointChecks`: landing checks a checkpoint runs whether or not one is owed; empty means every heavy one. */
export const checkpointChecks = (ctx: Context): string[] => words(option(ctx, "checkpointChecks"))

/** A command a checkpoint runs: its `naima run` name, what it is, and the host it runs on (none: this machine). */
export interface CheckpointRunSpec {
  name: string
  command: string
  host?: string
  /** `naima run --budget-time` for it. */
  budget?: string
  /** The paths (prefixes) whose change it can be affected by: a release reruns it only when one changed; none means any change. */
  paths?: string[]
}

/**
 * The coordination option `checkpointRuns`: the commands a checkpoint runs in the background, each a string (run on this
 * machine) or `{ "command": "...", "host": "<declared host>", "name": "...", "budget": "2h" }`.
 */
export function checkpointRuns(ctx: Context): CheckpointRunSpec[] {
  const raw = option(ctx, "checkpointRuns")
  if (raw === undefined || raw === "") return []
  if (!Array.isArray(raw)) throw new Error('the coordination option checkpointRuns is a list: "command" or { "command": "...", "host": "..." } each')
  const out: CheckpointRunSpec[] = []
  for (const e of raw) {
    const o = (typeof e === "string" ? { command: e } : e) as Partial<CheckpointRunSpec> | null
    if (!o || typeof o !== "object" || typeof o.command !== "string" || !o.command.trim()) {
      throw new Error('the coordination option checkpointRuns: each entry is a command or { "command": "...", "host": "..." }')
    }
    const base = o.name ?? o.command.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 30)
    let name = base || "run"
    for (let i = 2; out.some((x) => x.name === name); i++) name = `${base}-${i}`
    if (!/^[a-z0-9][a-z0-9._-]*$/.test(name)) {
      throw new Error(`the coordination option checkpointRuns: "${name}" is not a run name: lowercase letters, digits, . _ -`)
    }
    const paths = Array.isArray(o.paths) ? o.paths.map(String).filter(Boolean) : []
    out.push({
      name,
      command: o.command.trim(),
      ...(o.host ? { host: String(o.host) } : {}),
      ...(o.budget ? { budget: String(o.budget) } : {}),
      ...(paths.length ? { paths } : {}),
    })
  }
  return out
}

/** The coordination option `verifyHost`: the declared host a checkpoint's `naima verify` runs on; none means this machine. */
export const verifyHost = (ctx: Context): string | undefined => {
  const v = option(ctx, "verifyHost")
  return typeof v === "string" && v.trim() && v.trim() !== "here" ? v.trim() : undefined
}

/** The names a `Checks-owed:` trailer value lists. */
export const owedNames = (value: string): string[] => words(value)

/** The trailer line of a marker owing these checks, or none when it owes nothing. */
export const owedTrailer = (names: readonly string[]): string[] => (names.length ? [`${CHECKS_OWED}: ${names.join(", ")}`] : [])

/** One background run of a checkpoint: a suite command, or the verification of the properties not current. */
export interface CheckpointRun {
  /** The name of the run in `naima run`. */
  run: string
  /** Its name in the checkpoint, the same on every tip: what a bug it files is titled by. */
  name: string
  /** What it is: a configured command (`suite`), `naima verify` of the properties not current (`verify`), or a landing check whose failure is reported (`check`). */
  kind: "suite" | "verify" | "check"
  /** What it runs, as its name says it: the command, or the properties. */
  what: string
  host?: string
  state: "running" | "passed" | "failed"
  /** Why it failed, or its last line. */
  why?: string
  /** The bug filed or updated for its failure. */
  bug?: string
  /** The record of the same commit this result was taken from: nothing was run again. */
  reused?: string
}

/** A landing check's result in a checkpoint: passed or failed, on the record's commit, or taken from an earlier record of it. */
export interface CheckResult {
  name: string
  passed: boolean
  /** What it found, when it failed. */
  why?: string[]
  reused?: string
}

/**
 * One checkpoint: the code and tracker commits it ran on, the gate that asked for it, and what it ran and what failed.
 * While its background runs go, `pending` is set and `passed` is false; the record is settled when they are over.
 */
export interface CheckpointRecord {
  id: string
  on: string
  tip: string
  tracker: string
  gate?: string
  passed: boolean
  /** True while background runs of the checkpoint are still going. */
  pending?: boolean
  ran: string[]
  failed: string[]
  runs?: CheckpointRun[]
  /** What it was for: a planned point of its gate's check plan, or a background run between milestones (src/core/check-plan.ts). */
  point?: "half" | "full" | "release" | "background"
  /** When it settled. */
  ended?: string
  /** Each landing check's result on its commit. */
  results?: CheckResult[]
  /** Stopped without a result, for the person's own heavy work or a pause: it counts for nothing, and its point is due again. */
  yielded?: boolean
}

/** Every checkpoint record, oldest first. */
export function readCheckpoints(ctx: Context): CheckpointRecord[] {
  const dir = join(ctx.trackerRoot, CHECKPOINTS)
  if (!existsSync(dir)) return []
  return readdirSync(dir).filter((f) => f.endsWith(".json")).sort().flatMap((f) => {
    try {
      return [{ ...(JSON.parse(readFileSync(join(dir, f), "utf8")) as CheckpointRecord), id: f.slice(0, -5) }]
    } catch {
      return []
    }
  })
}

/**
 * A record with its free text scrubbed the way tracker writes are: a run's failure text, copied from its log, may hold a
 * host name or a home path, which become placeholders (<host>, <path>, <user>) before the record is written.
 */
export function scrubRecord<T extends Partial<CheckpointRecord>>(r: T): T {
  const pc = privateContext()
  const clean = (t: string): string => redactPrivate(t, pc)
  return {
    ...r,
    ...(r.ran ? { ran: r.ran.map(clean) } : {}),
    ...(r.failed ? { failed: r.failed.map(clean) } : {}),
    ...(r.runs ? { runs: r.runs.map((x) => ({ ...x, what: clean(x.what), ...(x.why !== undefined ? { why: clean(x.why) } : {}) })) } : {}),
  }
}

/** Write a record; its file name starts with the time, so the files sort in the order made. */
export function writeCheckpoint(ctx: Context, record: Omit<CheckpointRecord, "id">): string {
  const r = scrubRecord(record)
  const dir = join(ctx.trackerRoot, CHECKPOINTS)
  mkdirSync(dir, { recursive: true })
  const id = `${ctx.now().toISOString().replace(/[:.]/g, "-")}-${String(readdirSync(dir).length).padStart(4, "0")}-${r.tip.slice(0, 12)}`
  writeFileSync(join(dir, `${id}.json`), JSON.stringify(r, null, 2) + "\n")
  return id
}

/** Replace the fields of a record in place; the file keeps its name. */
export function updateCheckpoint(ctx: Context, id: string, patch: Partial<Omit<CheckpointRecord, "id">>): CheckpointRecord {
  const file = join(ctx.trackerRoot, CHECKPOINTS, `${id}.json`)
  const { id: _id, ...old } = JSON.parse(readFileSync(file, "utf8")) as CheckpointRecord
  const next = { ...old, ...scrubRecord(patch) }
  writeFileSync(file, JSON.stringify(next, null, 2) + "\n")
  return { ...next, id }
}

/** The newest checkpoint that passed, if any. */
export const lastPass = (ctx: Context): CheckpointRecord | undefined => readCheckpoints(ctx).filter((r) => r.passed && !r.yielded).at(-1)

/**
 * The results recorded for a commit, by check: each landing check's and each background run's (by its name), from the
 * settled records of that commit, the newest first. A result belongs to its commit and is reused, never recomputed.
 */
export function resultsAt(
  ctx: Context,
  tip: string,
): { checks: Map<string, CheckResult & { record: string }>; runs: Map<string, CheckpointRun & { record: string }> } {
  const checks = new Map<string, CheckResult & { record: string }>()
  const runs = new Map<string, CheckpointRun & { record: string }>()
  for (const r of readCheckpoints(ctx).filter((x) => x.tip === tip && !x.pending && !x.yielded).reverse()) {
    for (const c of r.results ?? []) if (!checks.has(c.name)) checks.set(c.name, { ...c, record: c.reused ?? r.id })
    for (const x of r.runs ?? []) {
      if ((x.state === "passed" || x.state === "failed") && !runs.has(x.name)) runs.set(x.name, { ...x, record: x.reused ?? r.id })
    }
  }
  return { checks, runs }
}

/**
 * The checks the landings since the last passing checkpoint owe, each once, and how many landings owe something: read from
 * the `Checks-owed:` trailers of the tracker's commits that checkpoint's tracker commit does not hold.
 */
export function owedSince(ctx: Context): { names: string[]; landings: number } {
  const last = lastPass(ctx)
  const range = last && gitOrNull(ctx.trackerGit, "cat-file", "-e", `${last.tracker}^{commit}`) !== null ? [`^${last.tracker}`] : []
  const sep = "\x1e"
  const out = gitOrNull(ctx.trackerGit, "log", "-n2000", `--format=%(trailers:key=${CHECKS_OWED},valueonly,separator=%x1d)${sep}`, "HEAD", ...range) ?? ""
  const names: string[] = []
  let landings = 0
  for (const r of out.split(sep)) {
    const v = r.split("\x1d").join(",")
    const list = owedNames(v)
    if (!list.length) continue
    landings++
    for (const n of list) if (!names.includes(n)) names.push(n)
  }
  return { names, landings }
}

/** Why a gate is blocked by a failed checkpoint: the newest checkpoint for it, or for no gate, failed and no later one passed. */
export function checkpointBlock(ctx: Context, gate: string): string | undefined {
  // A background run blocks nothing (its failure is reported as an item and at hello), and a run stopped for the person is no result.
  const mine = readCheckpoints(ctx).filter((r) => (r.gate === gate || r.gate === undefined) && r.point !== "background" && !r.yielded)
  const last = mine.at(-1)
  if (last?.pending) {
    const going = (last.runs ?? []).filter((r) => r.state === "running").map((r) => r.run)
    return `the checkpoint of ${last.tip.slice(0, 12)} is still running (${going.join(", ")}) — naima checkpoint --status`
  }
  return last && !last.passed
    ? `the checkpoint of ${last.tip.slice(0, 12)} failed: ${last.failed.join(", ")} — fix it and run naima checkpoint ${gate}`
    : undefined
}

/**
 * Run the checkpoint for a gate when the project is in checkpoint mode and the command is loaded: what a gate step closing
 * and a goal reached do. Says nothing and returns 0 otherwise.
 */
export async function checkpointAfter(ctx: Context, gate: string): Promise<number> {
  if (checkMode(ctx) !== "checkpoint") return 0
  // A project that runs heavy checks only on demand, or not at all, has no checkpoint start by itself.
  const answer = heavyAnswer(ctx)
  if (answer && (answer.when === "demand" || answer.when === "off")) return 0
  // A project that plans its heavy checks starts only the point of the gate's plan that is due, if one is (naima check-plan).
  const plan = answer?.when === "checkpoint" ? ctx.registry.commands.get("check-plan") : undefined
  if (plan) return await plan.run(["--start", gate, "--crossed"], ctx)
  const cmd = ctx.registry.commands.get("checkpoint")
  return cmd ? await cmd.run([gate], ctx) : 0
}

/** What `naima gates` says of the checks owed, or null when the project runs its checks continuously or none is owed. */
export function owedLine(ctx: Context): string | null {
  if (checkMode(ctx) !== "checkpoint") return null
  const o = owedSince(ctx)
  return o.names.length
    ? `checks owed since the last checkpoint (${o.landings} landing${o.landings === 1 ? "" : "s"}): ${o.names.join(", ")} — naima checkpoint`
    : null
}

/** What `naima gates` says of the last checkpoint: its result, each run's, and what is still owed; empty before any checkpoint. */
export function checkpointLines(ctx: Context): string[] {
  const last = readCheckpoints(ctx).at(-1)
  if (!last) return []
  const on = `${last.tip.slice(0, 12)}${last.gate ? ` for ${last.gate}` : ""}`
  const runs = last.runs ?? []
  const verdict = last.pending
    ? `running, ${runs.filter((r) => r.state !== "running").length} of ${runs.length} run${runs.length === 1 ? "" : "s"} over`
    : last.passed
    ? "passed"
    : "FAILED"
  const lines = [`last checkpoint ${on}: ${verdict} — naima checkpoint --status`]
  for (const r of runs) {
    const mark = r.state === "passed" ? "✓" : r.state === "failed" ? "✗" : "…"
    lines.push(`  ${mark} ${r.run}${r.host ? ` on ${r.host}` : ""}: ${r.state}${r.why ? ` — ${r.why}` : ""}${r.bug ? ` (${r.bug})` : ""}`)
  }
  if (!last.pending && !last.passed) { for (const f of last.failed) lines.push(`  ✗ ${f}`) }
  return lines
}
