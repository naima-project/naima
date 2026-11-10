// Check modes: a project runs its landing checks on every landing (`continuous`, the default), or only the fast ones it
// names, owing the rest until a checkpoint (`checkpoint`). The landing marker carries what it owes in a `Checks-owed:`
// trailer; `naima checkpoint` runs what is owed and records the result as a file of the data directory's `checkpoints/`.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { DATA_FILE } from "./layout.ts"
import { gitOrNull } from "./git.ts"
import type { Context } from "./types.ts"

/** The trailer a landing marker names the checks it did not run in. */
export const CHECKS_OWED = "Checks-owed"

/** The directory of the data directory holding one record per checkpoint. */
export const CHECKPOINTS = "checkpoints"

export type CheckMode = "continuous" | "checkpoint"

/** A coordination option: the branch tip's own configuration first when `at` holds it, else the one `ctx` runs with. */
function option(ctx: Context, name: string, at?: Context): unknown {
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
    out.push({ name, command: o.command.trim(), ...(o.host ? { host: String(o.host) } : {}), ...(o.budget ? { budget: String(o.budget) } : {}) })
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
  /** What it is: a configured command (`suite`) or `naima verify` of the properties not current (`verify`). */
  kind: "suite" | "verify"
  /** What it runs, as its name says it: the command, or the properties. */
  what: string
  host?: string
  state: "running" | "passed" | "failed"
  /** Why it failed, or its last line. */
  why?: string
  /** The bug filed or updated for its failure. */
  bug?: string
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

/** Write a record; its file name starts with the time, so the files sort in the order made. */
export function writeCheckpoint(ctx: Context, r: Omit<CheckpointRecord, "id">): string {
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
  const next = { ...old, ...patch }
  writeFileSync(file, JSON.stringify(next, null, 2) + "\n")
  return { ...next, id }
}

/** The newest checkpoint that passed, if any. */
export const lastPass = (ctx: Context): CheckpointRecord | undefined => readCheckpoints(ctx).filter((r) => r.passed).at(-1)

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
  const mine = readCheckpoints(ctx).filter((r) => r.gate === gate || r.gate === undefined)
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
