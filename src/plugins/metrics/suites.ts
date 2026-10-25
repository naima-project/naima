// Test suites: a project's test commands, run and recorded per test.
//
// A suite is data, declared beside the metrics in the project's naima.json:
//
//   "plugins": { "metrics": { "options": { "suites": {
//     "unit": { "preset": "deno" },
//     "rust": { "run": ["cargo", "+nightly", "test", "--", "-Z", "unstable-options", "--format", "json"],
//               "format": "libtest-json", "inputs": ["src", "tests", "Cargo.toml", "Cargo.lock"] } } } } }
//
// run, prepare  the command, as a program and its arguments: no shell. `{tmp}` is a fresh temporary directory.
// format        how its output is read: a `test-formats` contribution (formats.ts) — junit, tap, libtest-json.
// report        the file the runner writes its report to, from the project root or under `{tmp}`;
//               without it, the report is the command's output.
// inputs        the paths or patterns of the files the run reads: its identity. Without it, every file of
//               the working tree outside the tracker.
//
// `naima metrics run` runs the suites its metrics read; `--record` writes each run under
// test-runs/<suite>/ — every test's name, result, duration and message, the commit, the inputs' digest,
// and the log beside it — and hands each result to the test items that name it in `testNames`. A suite
// whose inputs are those of a recorded run is not run again: that run is reused, and named.

import { createHash, randomUUID } from "node:crypto"
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync } from "node:fs"
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path"
import { spawnSync } from "node:child_process"
import {
  ATTACHMENTS,
  type Context,
  enumRank,
  fieldValue,
  isOpen,
  type Item,
  label,
  message,
  pathMatches,
  privateContext,
  proves,
  redactPrivate,
  saveMeta,
  setFieldValue,
  TRACKER_DIR,
  writeFileAtomic,
  writeJson,
} from "../../core/api.ts"
import type { TestFormat, TestResult } from "./formats.ts"
import { SUITE_PRESETS } from "./presets.ts"

/** What a run of a command left: what a metric's kind and a suite's format read. */
export interface RunOutput {
  /** The exit code; -1 when the program could not be started. */
  exit: number
  stdout: string
  stderr: string
  /** Wall-clock seconds the command took. */
  seconds: number
}

// deno-lint-ignore no-control-regex
const ANSI = /\x1b\[[0-9;?]*[ -\/]*[@-~]/g

/** Run a command in `cwd`, colour off, its output stripped of escape codes. */
/**
 * Where a suite's `{tmp}` goes: `.tmp/` in the tracker folder, which git ignores. Not the system's temporary
 * folder, which the launcher does not let the program write: the program may write only its tracker folder.
 */
function scratchDir(ctx: Context): string {
  // The tracker folder: the data's parent when it is the usual naima-tracker/, else the data folder itself.
  const tracker = basename(dirname(ctx.trackerRoot)) === TRACKER_DIR ? dirname(ctx.trackerRoot) : ctx.trackerRoot
  const dir = join(tracker, ".tmp")
  mkdirSync(dir, { recursive: true })
  const ignore = join(dir, ".gitignore")
  if (!existsSync(ignore)) writeFileAtomic(ignore, "*\n")
  return dir
}

export function runCommand(program: string, args: string[], cwd: string): RunOutput & { error?: Error } {
  const start = performance.now()
  const r = spawnSync(program, args, { cwd, encoding: "utf8", maxBuffer: 256 * 1024 * 1024, env: { ...process.env, NO_COLOR: "1" } })
  return {
    exit: r.error ? -1 : r.status ?? -1,
    stdout: (r.stdout ?? "").replace(ANSI, ""),
    stderr: (r.stderr ?? "").replace(ANSI, ""),
    seconds: (performance.now() - start) / 1000,
    ...(r.error ? { error: r.error } : {}),
  }
}

/** A command as a configuration gives it: a list, the program first, with no space or comma in the program. */
export function checkCommand(at: string, key: string, raw: unknown): void {
  if (!Array.isArray(raw) || !raw.length || !raw.every((w) => typeof w === "string" && w.length)) {
    throw new Error(`${at}: ${key} is the command as a list, the program first: ["deno", "task", "test"]`)
  }
  if (!/^[^\s,]+$/.test(raw[0] as string)) throw new Error(`${at}: the program, ${JSON.stringify(raw[0])}, has a space or a comma`)
}

export interface SuiteConfig {
  says?: string
  preset?: string
  run: string[]
  prepare?: string[]
  format: string
  report?: string
  inputs?: string[]
}

/** A suite as the `test-suites` point holds it: its name, its configuration, and the programs it starts. */
export interface SuiteDef extends SuiteConfig {
  name: string
  runs: string[]
  configured: true
}

/** The numbers a suite's run gives its metrics. */
export const SUITE_FIELDS = ["passed", "failed", "skipped", "total", "seconds"] as const
export type SuiteField = typeof SUITE_FIELDS[number]

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v)
const NAME = /^[a-z0-9][a-z0-9_-]*$/

/** The project's suites, as its naima.json says them, each preset filled in; throws on a malformed one, naming it. */
export function readSuites(options: Record<string, unknown>): Record<string, SuiteConfig> {
  const suites = options["suites"] ?? {}
  if (!isObject(suites)) throw new Error("metrics: options.suites must be an object")
  const out: Record<string, SuiteConfig> = {}
  for (const [name, given] of Object.entries(suites)) {
    const at = `metrics: suite "${name}"`
    if (!NAME.test(name)) throw new Error(`${at}: a suite's name is lowercase letters, digits, dashes and underscores`)
    if (!isObject(given)) throw new Error(`${at} must be an object`)
    const preset = given["preset"]
    if (preset !== undefined && (typeof preset !== "string" || !Object.hasOwn(SUITE_PRESETS, preset))) {
      throw new Error(`${at}: no suite preset ${JSON.stringify(preset)} — presets: ${Object.keys(SUITE_PRESETS).join(", ")}`)
    }
    const base: Record<string, unknown> = typeof preset === "string" ? { ...SUITE_PRESETS[preset] } : {}
    // A suite's own command replaces the preset's, and the report its command writes with it.
    if (given["run"] !== undefined) {
      delete base["prepare"]
      if (given["report"] === undefined) delete base["report"]
    }
    const raw: Record<string, unknown> = { ...base, ...given }
    checkCommand(at, "run", raw["run"])
    if (raw["prepare"] !== undefined) checkCommand(at, "prepare", raw["prepare"])
    if (typeof raw["format"] !== "string" || !raw["format"]) throw new Error(`${at}: format names how its output is read: junit, tap or libtest-json`)
    for (const key of ["says", "report"]) if (raw[key] !== undefined && typeof raw[key] !== "string") throw new Error(`${at}: ${key} is a string`)
    if (typeof raw["report"] === "string" && (isAbsolute(raw["report"]) || raw["report"].split(/[\\/]/).includes(".."))) {
      throw new Error(`${at}: report is a path from the project root, or under {tmp}`)
    }
    if (raw["inputs"] !== undefined && !(Array.isArray(raw["inputs"]) && raw["inputs"].length && raw["inputs"].every((p) => typeof p === "string" && p))) {
      throw new Error(`${at}: inputs is a list of paths or patterns: ["src", "test", "deno.json"]`)
    }
    out[name] = raw as unknown as SuiteConfig
  }
  return out
}

/** A suite's command in words. */
export const suiteCommand = (s: SuiteConfig): string => [s.prepare ? `${s.prepare.join(" ")} &&` : "", s.run.join(" ")].filter(Boolean).join(" ")

// ── a run ────────────────────────────────────────────────────────────────────

export interface Counts {
  passed: number
  failed: number
  skipped: number
  total: number
}

export const RUNS_DIR = "test-runs"

/** One run of a suite, as recorded in test-runs/<suite>/. */
export interface SuiteRun {
  suite: string
  /** The commit it measured; empty until recorded. */
  commit: string
  /** True when the working tree had changes not committed: the run is of the commit and those changes. */
  dirty: boolean
  at: string
  /** The commit's own date. */
  date?: string
  command: string[]
  prepare?: string[]
  format: string
  /** One digest over the command, the format, the report's path and every input file with its sha256: what the run speaks for. */
  inputsSha256: string
  /** How many files the digest covers. */
  files: number
  exit: number
  seconds: number
  counts: Counts
  tests: TestResult[]
  /** The log's file name, beside the record. */
  log?: string
  /** Why it was run although a run of the same identity was recorded (`naima metrics run --force "<reason>"`), as `naima verify` keeps it. */
  forced?: string
  /** Why no result could be read: the run is evidence of that, and of nothing else. */
  error?: string
}

/** A suite's run where a measurement is taken: run now, or a recorded run reused. */
export interface SuiteOutcome {
  run: SuiteRun
  /** The log, private infrastructure replaced; empty for a reused run. */
  log: string
  /** The recorded run it reuses, from the data directory: test-runs/<suite>/<file>. */
  reused?: string
  /** Where it was written, once recorded. */
  recorded?: string
}

const countsOf = (tests: TestResult[]): Counts => ({
  passed: tests.filter((t) => t.result === "passed").length,
  failed: tests.filter((t) => t.result === "failed").length,
  skipped: tests.filter((t) => t.result === "skipped").length,
  total: tests.length,
})

/** JSON with every object's keys sorted: the same value always hashes the same. */
const canonical = (v: unknown): string =>
  Array.isArray(v)
    ? `[${v.map(canonical).join(",")}]`
    : v && typeof v === "object"
    ? `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`).join(",")}}`
    : JSON.stringify(v) ?? "null"

/** The files a suite reads, from the root, sorted: its `inputs` among `files`, its own report left out. */
export function inputFiles(s: SuiteConfig, files: readonly string[]): string[] {
  const report = s.report && !s.report.includes("{tmp}") ? s.report.replace(/^\.\//, "") : undefined
  return files.filter((f) => f !== report && (!s.inputs || s.inputs.some((p) => pathMatches(f, p)))).sort()
}

/** The digest a run of `s` speaks for, over the files under `root`. */
export function suiteDigest(s: SuiteConfig, root: string, files: readonly string[]): { sha256: string; files: number } {
  const picked = inputFiles(s, files)
  const listed = picked.map((f) => {
    let digest = ""
    try {
      digest = createHash("sha256").update(readFileSync(join(root, f))).digest("hex")
    } catch {
      digest = "unreadable"
    }
    return [f, digest]
  })
  const sha256 = createHash("sha256")
    .update(canonical({ run: s.run, prepare: s.prepare ?? null, format: s.format, report: s.report ?? null, files: listed }))
    .digest("hex")
  return { sha256, files: picked.length }
}

const runsDir = (ctx: Context, suite: string): string => join(ctx.trackerRoot, RUNS_DIR, suite)

/** Every recorded run of a suite, with its path from the data directory, oldest first. */
export function recordedRuns(ctx: Context, suite: string): { path: string; run: SuiteRun }[] {
  const dir = runsDir(ctx, suite)
  if (!existsSync(dir)) return []
  return readdirSync(dir).filter((f) => f.endsWith(".json")).flatMap((f) => {
    try {
      const run = JSON.parse(readFileSync(join(dir, f), "utf8")) as SuiteRun
      return run && typeof run.inputsSha256 === "string" && Array.isArray(run.tests) && isObject(run.counts) ? [{ path: `${RUNS_DIR}/${suite}/${f}`, run }] : []
    } catch {
      return []
    }
  }).sort((a, b) => (a.run.at < b.run.at ? -1 : a.run.at > b.run.at ? 1 : 0))
}

/** A recorded run, by its path from the data directory, or null. */
export function readSuiteRun(ctx: Context, path: string): SuiteRun | null {
  const [dir, suite, file] = path.split("/")
  if (dir !== RUNS_DIR || !suite || !file) return null
  return recordedRuns(ctx, suite).find((r) => r.path === path)?.run ?? null
}

/** The longest log kept, in characters: its end, where a runner says how it went. */
export const LOG_LIMIT = 256 * 1024

/** Text a run printed, made fit for a repository: the project's root as `<root>`, every private name as its placeholder. */
export function redactor(ctx: Context): (s: string) => string {
  const sorted = rootsOf(ctx.root)
  const pc = privateContext()
  return (s) => {
    let t = s
    for (const r of sorted) t = t.split(r).join("<root>")
    return redactPrivate(t, pc)
  }
}

const tail = (s: string, limit: number): string => (s.length > limit ? `[… ${s.length - limit} characters left out]\n${s.slice(-limit)}` : s)

/** A test's file as a path from the root when it is inside it. */
function fileFrom(roots: readonly string[], file: string | undefined): string | undefined {
  if (!file) return undefined
  const plain = file.startsWith("file://") ? decodeURIComponent(file.slice(7)) : file
  if (!isAbsolute(plain)) return file
  for (const root of roots) {
    const rel = relative(root, plain)
    if (rel && !rel.startsWith("..") && !isAbsolute(rel)) return rel.split(sep).join("/")
  }
  return file
}

/** A root as given and as the system resolves it: a runner may print either. */
function rootsOf(root: string): string[] {
  const out = new Set([root])
  try {
    out.add(realpathSync(root))
  } catch {
    // the root as given is enough
  }
  return [...out].sort((a, b) => b.length - a.length)
}

/**
 * Run a suite in `root` — unless a recorded run has its digest and no reason to run again is given: then that run
 * is reused. The run's tests, messages and log carry no private infrastructure.
 */
export function runSuite(
  ctx: Context,
  s: SuiteDef,
  format: TestFormat | undefined,
  root: string,
  files: readonly string[],
  rerun?: string,
): SuiteOutcome {
  const digest = suiteDigest(s, root, files)
  if (rerun === undefined) {
    const same = recordedRuns(ctx, s.name).filter((r) => r.run.inputsSha256 === digest.sha256 && !r.run.error).at(-1)
    if (same) return { run: same.run, log: "", reused: same.path }
  }
  const at = ctx.now().toISOString()
  const base: Omit<SuiteRun, "exit" | "seconds" | "counts" | "tests"> = {
    suite: s.name,
    commit: "",
    dirty: false,
    at,
    command: s.run,
    ...(s.prepare ? { prepare: s.prepare } : {}),
    format: s.format,
    inputsSha256: digest.sha256,
    files: digest.files,
    ...(rerun !== undefined ? { forced: rerun } : {}),
  }
  const clean = redactor(ctx)
  const failedRun = (error: string, out?: RunOutput): SuiteOutcome => ({
    run: { ...base, exit: out?.exit ?? -1, seconds: round(out?.seconds ?? 0), counts: countsOf([]), tests: [], error: clean(error) },
    log: out ? clean(tail([out.stdout, out.stderr].filter((x) => x.trim()).join("\n"), LOG_LIMIT)) : "",
  })
  if (!format) return failedRun(`no test format "${s.format}"`)
  const tmp = join(scratchDir(ctx), `naima-suite-${randomUUID().slice(0, 8)}`)
  const fill = (args: string[]) => args.map((a) => a.replaceAll("{tmp}", tmp))
  try {
    mkdirSync(tmp, { recursive: true })
    if (s.prepare) {
      const [p, ...a] = fill(s.prepare)
      const r = runCommand(p as string, a, root)
      if (r.exit !== 0) return failedRun(r.error ? `${p} could not be started: ${r.error.message}` : `prepare exited ${r.exit}`, r)
    }
    const [program, ...args] = fill(s.run)
    const out = runCommand(program as string, args, root)
    if (out.error) return failedRun(`${program} could not be started: ${out.error.message}`, out)
    let report = out.stdout
    if (s.report) {
      const path = resolve(root, fill([s.report])[0] as string)
      if (!existsSync(path)) return failedRun(`exited ${out.exit} and wrote no report at ${s.report}`, out)
      report = readFileSync(path, "utf8")
    }
    let parsed: TestResult[] | { error: string }
    try {
      parsed = format.parse(report)
    } catch (e) {
      parsed = { error: (e as Error).message }
    }
    if (!Array.isArray(parsed)) return failedRun(`its ${s.format} report could not be read: ${parsed.error}`, out)
    const roots = rootsOf(root)
    const tests = parsed.map((t): TestResult => {
      const file = fileFrom(roots, t.file)
      return { ...t, name: clean(t.name), ...(file ? { file: clean(file) } : {}), ...(t.message ? { message: clean(t.message) } : {}) }
    })
    const counts = countsOf(tests)
    const log = clean(tail([out.stdout, out.stderr].filter((x) => x.trim()).join("\n"), LOG_LIMIT))
    // A runner that fails with no failing test in its report failed before or around the tests: a crash, a compile error.
    const error = out.exit !== 0 && counts.failed === 0 ? `exited ${out.exit} and its report records no failing test` : undefined
    return { run: { ...base, exit: out.exit, seconds: round(out.seconds), counts, tests, ...(error ? { error } : {}) }, log }
  } finally {
    try {
      rmSync(tmp, { recursive: true, force: true })
    } catch {
      // a temporary path outside what the program may write: the system's to clean
    }
  }
}

const round = (n: number): number => Math.round(n * 1000) / 1000

/** A suite's number, as its metrics read it, or why there is none. */
export function suiteValue(o: SuiteOutcome, field: SuiteField): number | { error: string } {
  if (o.run.error) return { error: o.run.error }
  return field === "seconds" ? o.run.seconds : o.run.counts[field]
}

/** Write a run under test-runs/<suite>/, its log beside it: the path from the data directory. */
export function recordSuiteRun(ctx: Context, o: SuiteOutcome, commit: string, dirty: boolean, date: string | undefined): string {
  const dir = runsDir(ctx, o.run.suite)
  mkdirSync(dir, { recursive: true })
  const base = `${commit}-${randomUUID().slice(0, 8)}`
  const log = o.log ? `${base}.log` : undefined
  if (log) writeFileAtomic(join(dir, log), o.log.endsWith("\n") ? o.log : `${o.log}\n`)
  const run: SuiteRun = { ...o.run, commit, dirty, ...(date ? { date } : {}), ...(log ? { log } : {}) }
  writeJson(join(dir, `${base}.json`), run)
  o.run = run
  o.recorded = `${RUNS_DIR}/${o.run.suite}/${base}.json`
  return o.recorded
}

// ── test items ───────────────────────────────────────────────────────────────

export const TEST_NAMES = { name: "testNames", kind: "strings" } as const
export const TEST_SUITE = { name: "testSuite", kind: "string" } as const
export const LAST_TEST_RUN = { name: "lastTestRun", kind: "string" } as const
const RED_SEEN = { name: "redSeen", kind: "date" } as const
const EVIDENCE_KIND = { name: "evidenceKind", kind: "enum" } as const
/** The evidence a recorded run is: a log and a number, kept with the item. */
const OBSERVATION = "observation"

const globOf = (pattern: string): RegExp => new RegExp(`^${pattern.split("*").map((p) => p.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*")}$`)

/**
 * Does `pattern` name the test? It is matched, `*` standing for any text, against the test's whole name, against
 * its file and name (`<file> > <name>`), and against the end of its name after any ` > ` or `::`.
 */
export function testMatches(pattern: string, t: Pick<TestResult, "name" | "file">): boolean {
  const re = globOf(pattern.trim())
  const candidates = [t.name, ...(t.file ? [`${t.file} > ${t.name}`] : [])]
  for (const m of t.name.matchAll(/ > |::/g)) candidates.push(t.name.slice((m.index ?? 0) + m[0].length))
  return candidates.some((c) => re.test(c))
}

/** What a test item keeps of a recorded run of the tests it covers. */
export interface ItemRun {
  at: string
  commit: string
  dirty: boolean
  /** passed when every test it covers that ran passed; failed when one failed. */
  result: "passed" | "failed"
  runs: { suite: string; run: string; inputsSha256: string }[]
  tests: (TestResult & { suite: string })[]
}

const isAttachmentName = (name: string): boolean => /^[^/\\]+$/.test(name) && name !== "." && name !== ".."

/** A test item's last recorded run, or null. */
export function lastItemRun(item: Item): ItemRun | null {
  const name = fieldValue(item, LAST_TEST_RUN)
  if (typeof name !== "string" || !isAttachmentName(name)) return null
  try {
    const r = JSON.parse(readFileSync(join(item.dir, ATTACHMENTS, name), "utf8")) as ItemRun
    return r && (r.result === "passed" || r.result === "failed") && Array.isArray(r.runs) ? r : null
  } catch {
    return null
  }
}

/** The test items that name tests: those a recorded run speaks for. */
export const coveringItems = (ctx: Context): Item[] => ctx.repo.items.filter((i) => i.type === "tests" && (fieldValue(i, TEST_NAMES) ?? []).length > 0)

/**
 * Hand each recorded run's results to the test items whose `testNames` name its tests: status passed or failed,
 * the result attached and named in `lastTestRun`, `evidenceKind` observation unless stronger, and `redSeen` the day
 * of the failing run before, when one passes after it. An item the runs already speak for is left as it is.
 * The lines to print.
 */
export function attachToItems(ctx: Context, runs: SuiteOutcome[]): string[] {
  const usable = runs.filter((o) => !o.run.error && (o.recorded ?? o.reused))
  const lines: string[] = []
  if (!usable.length) return lines
  const at = ctx.now().toISOString()
  const evidenceDef = ctx.registry.fields.get(EVIDENCE_KIND.name)
  const observationRank = enumRank(evidenceDef, OBSERVATION, -1)
  for (const item of coveringItems(ctx)) {
    if (!isOpen(ctx, item) && !proves(ctx, item)) continue
    const names = fieldValue(item, TEST_NAMES) ?? []
    const only = fieldValue(item, TEST_SUITE)
    const tests = usable.filter((o) => only === undefined || o.run.suite === only).flatMap((o) =>
      o.run.tests.filter((t) => names.some((p) => testMatches(p, t))).map((t) => ({ ...t, suite: o.run.suite, from: o }))
    )
    const ran = tests.filter((t) => t.result !== "skipped")
    if (!ran.length) continue
    const sources = [...new Set(tests.map((t) => t.from))]
    const used = sources.map((o) => ({ suite: o.run.suite, run: (o.recorded ?? o.reused) as string, inputsSha256: o.run.inputsSha256 }))
    const before = lastItemRun(item)
    if (before && canonical(before.runs.map((r) => r.run).sort()) === canonical(used.map((r) => r.run).sort())) continue
    const result: ItemRun["result"] = ran.some((t) => t.result === "failed") ? "failed" : "passed"
    const commit = sources.map((o) => o.run.commit).find(Boolean) ?? ""
    const record: ItemRun = {
      at,
      commit,
      dirty: sources.some((o) => o.run.dirty),
      result,
      runs: used,
      tests: tests.map(({ from: _from, ...t }) => t),
    }
    const name = `test-run-${at.replace(/[:.]/g, "-")}-${randomUUID().slice(0, 4)}.json`
    const path = join(item.dir, ATTACHMENTS, name)
    const was = { meta: structuredClone(item.meta) }
    writeJson(path, record)
    item.meta.status = result
    setFieldValue(item, LAST_TEST_RUN, name)
    const said: string[] = []
    if (result === "passed" && fieldValue(item, RED_SEEN) === undefined && before?.result === "failed") {
      setFieldValue(item, RED_SEEN, before.at.slice(0, 10))
      said.push(`red seen ${before.at.slice(0, 10)}, green now`)
    }
    if (evidenceDef && observationRank >= 0 && enumRank(evidenceDef, fieldValue(item, EVIDENCE_KIND), Infinity) > observationRank) {
      setFieldValue(item, EVIDENCE_KIND, OBSERVATION)
    }
    try {
      saveMeta(ctx, item)
    } catch (e) {
      item.meta = was.meta
      rmSync(path, { force: true })
      lines.push(`  ! ${label(item)}: not updated — ${message(e)}`)
      continue
    }
    const failing = ran.filter((t) => t.result === "failed").length
    lines.push(
      `  ${result === "passed" ? "✓" : "✗"} ${label(item)}: ${result}, ${failing ? `${failing} of ${ran.length}` : ran.length} tests (${
        sources.map((o) => o.run.suite).join(", ")
      })${said.length ? ` — ${said.join("; ")}` : ""}`,
    )
  }
  return lines
}
