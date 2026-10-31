// The mCRL2 adapter: a property item whose verifier is `mcrl2` is decided by
// the mCRL2 toolset. The model is an mCRL2 specification; the property is a
// modal mu-calculus formula, written inline or as the path of an .mcf file
// from the project root. A property chooses its route in `verifierOptions.route`
// (specs/verifier-mcrl2-lts-route-cross-check).
//
// The standard route, `lps`, the default, is the toolset's own:
//
//   mcrl22lps model.mcrl2 model.lps                      linearise
//   lps2pbes --counter-example --formula=f.mcf …         formula and model to a PBES
//   pbessolve --file=model.lps --evidence-file=ev.lps …  true, or false with evidence
//   lps2lts ev.lps ev.aut                                the evidence as a labelled transition system
//
// The LTS route, `lts`, reduces the state space only by an equivalence that
// preserves and reflects the formula, the coarsest of three (formula.ts):
// branching bisimilarity for a formula of the fragment that sees no divergence,
// divergence-preserving branching bisimilarity for one that does, strong
// bisimilarity, hiding nothing, for any other formula:
//
//   mcrl22lps, lps2lts [--max], ltsinfo -a               the LTS, once per model version (lts-cache.ts)
//   ltsconvert [--tau=<unmentioned>] -e<equivalence>     hide and reduce, once per equivalence and hidden set
//   lts2pbes -c, pbessolve --evidence-file               the verdict on the reduced LTS, with its evidence
//   ltsconvert ev.lts ev.aut                             on false: the counterexample, hidden actions as tau
//
// `cross-check` runs both and gives a verdict only when they agree.
//
// Two versions of a model (a refactoring) are compared modulo an equivalence:
//
//   mcrl22lps, lps2lts, ltsinfo                          each version's LTS, the new one through the cache
//   ltscompare --equivalence=<e> --counter-example      true: equivalent; false: different, with a distinguishing formula
//
// `pbessolve` printing `true` holds, `false` is violated and the evidence is
// the counterexample; anything else, or a time limit hit, is unknown. A tool
// that is not there, or that fails, is an error that says which.
//
// The verifier point belongs to the verifier plugin, and plugins never import
// each other: the shapes it takes are declared here.

import { spawn } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path"
import {
  ATTACHMENTS,
  type Check,
  type Context,
  CONTRACT,
  type Finding,
  installedProgram,
  label,
  message,
  NO_PROGRESS,
  type Plugin,
  type Progress,
} from "../../core/api.ts"
import { checkFragment, labelActions } from "./formula.ts"
import {
  cacheKey,
  cacheRoot,
  discard,
  ENTRY_LPS,
  ENTRY_LTS,
  freshFolder,
  type LtsRecord,
  prune,
  publish,
  readEntry,
  readReduced,
  reducedKey,
  type ReducedRecord,
  sha256File,
  storeReduced,
} from "./lts-cache.ts"
import { type ConditionLint, lintConditions, lintLine } from "./lps-lint.ts"
import {
  chooseRewriter,
  compileSecondsIn,
  cxxCompiler,
  jittycUnavailable,
  readTimings,
  recordTimings,
  type RewriterOption,
  REWRITERS,
} from "./rewriter.ts"
import { MCRL2 } from "./tool.ts"

export { MCRL2 } from "./tool.ts"

/** What a run of one program gave: its exit status and output, and whether it was not there or ran out of time. */
export interface ToolRun {
  exit: number
  stdout: string
  stderr: string
  missing?: boolean
  timedOut?: boolean
  error?: string
}

/** Runs one program: the real one starts it; a test replays recorded output. `onStderr` is given its standard error as it comes. */
export type Runner = (program: string, args: string[], cwd: string, timeoutMs?: number, onStderr?: (chunk: string) => void) => ToolRun | Promise<ToolRun>

interface VerifyRequest {
  model: string
  property: string
  options: Record<string, unknown>
  progress?: Progress
  toolArgs?: string[]
}
interface VerifyResult {
  verdict: "holds" | "violated" | "error" | "unknown"
  output: string
  counterexample?: string
  details?: Record<string, unknown>
}
interface CompareRequest {
  before: string
  after: string
  equivalence: string
  progress?: Progress
}
interface CompareResult {
  verdict: "equivalent" | "different" | "error"
  output: string
  counterexample?: string
  details?: Record<string, unknown>
}
interface Verifier {
  id: string
  says: string
  runs: string[]
  verify(request: VerifyRequest, ctx: Context): Promise<VerifyResult>
  toolArgs: Record<string, string>
  inputs(request: VerifyRequest, ctx: Context): string[]
  version(ctx: Context): Promise<string>
  equivalences: Record<string, string>
  compare(request: CompareRequest, ctx: Context): Promise<CompareResult>
  preserves(request: { property: string; options: Record<string, unknown>; equivalence: string }, ctx: Context): string | null
}

/** The program, started for real: colour off, no shell; its standard error handed to `onStderr` as it comes, so a long step reports while it runs. */
export const realRun: Runner = (program, args, cwd, timeoutMs, onStderr) =>
  new Promise<ToolRun>((done) => {
    let settled = false
    const finish = (r: ToolRun): void => {
      if (settled) return
      settled = true
      if (timer !== undefined) clearTimeout(timer)
      done(r)
    }
    let timer: ReturnType<typeof setTimeout> | undefined
    let child: ReturnType<typeof spawn>
    try {
      child = spawn(program, args, { cwd, env: { ...process.env, NO_COLOR: "1" }, stdio: ["ignore", "pipe", "pipe"], windowsHide: true })
    } catch (e) {
      // Deno refuses a program the launcher did not grant by throwing, not by an error on the result.
      finish({ exit: -1, stdout: "", stderr: "", error: message(e) })
      return
    }
    let stdout = ""
    let stderr = ""
    let timedOut = false
    child.stdout!.setEncoding("utf8")
    child.stderr!.setEncoding("utf8")
    child.stdout!.on("data", (c: string) => (stdout += c))
    child.stderr!.on("data", (c: string) => {
      stderr += c
      onStderr?.(c)
    })
    if (timeoutMs) {
      timer = setTimeout(() => {
        timedOut = true
        child.kill("SIGTERM")
      }, timeoutMs)
    }
    child.once("error", (e: Error & { code?: string }) => {
      if (e.code === "ENOENT") finish({ exit: -1, stdout: "", stderr: "", missing: true })
      else finish({ exit: -1, stdout, stderr, error: message(e) })
    })
    child.once("close", (code: number | null) => {
      if (timedOut) finish({ exit: -1, stdout, stderr, timedOut: true })
      else finish({ exit: code ?? -1, stdout, stderr })
    })
  })

const numberIn = (pattern: RegExp, fragment: string): number | null => {
  const m = pattern.exec(fragment.trim())
  return m ? Number(m[1]) : null
}

/**
 * The tools whose `--verbose` output counts their work, with the unit and how a counting line says it: `lps2lts`
 * the states explored (`<n>st, <m>tr, explored …. Last level: <l>, …`), with the level of the exploration and the
 * transitions as the note; `pbessolve` the BES equations generated (`Generated <n> BES equations`). Their counting
 * lines come separated by carriage returns as well as newlines (specs/progress-long-work-says-how-far, §6).
 */
export const COUNTING: Record<string, { unit: string; count(fragment: string): number | null; note?(fragment: string): string | null }> = {
  lps2lts: {
    unit: "states",
    count: (f) => numberIn(/^(\d+)st, \d+tr, explored\b/, f),
    note: (f) => {
      const m = /^\d+st, (\d+)tr, explored\b(?:.*Last level: (\d+))?/.exec(f.trim())
      if (!m) return null
      return [m[2] !== undefined ? `level ${m[2]}` : "", `${m[1]} transitions`].filter(Boolean).join(", ")
    },
  },
  pbessolve: { unit: "BES equations", count: (f) => numberIn(/^Generated (\d+) BES equations\b/, f) },
}

/** The tools started with `--verbose` although they count nothing: their lines are the run's notes while they work on a large LTS. */
const VERBOSE: ReadonlySet<string> = new Set(["ltsconvert", "lts2pbes"])

/** What `lps2lts` prints when it stops at `--max`: the cap was reached and the LTS is incomplete. */
const CAPPED = /Explored the maximum number \((\d+)\) of states/

/** A counting tool's output without its counting lines: what the run keeps (§6). */
export function withoutCounting(tool: string, text: string): string {
  const c = COUNTING[tool]
  if (!c) return text
  return text.split(/\r\n|\r|\n/).filter((f) => c.count(f) === null).join("\n")
}

const TOOLS = ["mcrl22lps", "lps2pbes", "pbessolve", "lps2lts", "ltsinfo", "ltsconvert", "lts2pbes", "ltscompare", "lpspp"] as const
type Tool = (typeof TOOLS)[number]

const INSTALL =
  "naima tools install mcrl2 installs mCRL2 202607.0 into Naima's own tools directory; or set plugins.verifier-mcrl2.options.bin to the directory of an mCRL2 installed otherwise"

/** The routes a property may take (§1). */
export const ROUTES = ["lps", "lts", "cross-check"] as const
export type Route = (typeof ROUTES)[number]

/**
 * The equivalences the LTS route reduces modulo, the coarsest first: each formula is reduced by the first that
 * preserves and reflects it (§3).
 */
export const REDUCTIONS = ["branching-bisim", "dpbranching-bisim", "bisim"] as const
export type Reduction = (typeof REDUCTIONS)[number]

/**
 * The coarsest equivalence that preserves and reflects the formula `src`, with the actions it may hide and why
 * (§3): branching bisimilarity for a formula of the fragment that sees no divergence; divergence-preserving
 * branching bisimilarity for one with an inevitability pattern or a deadlock through a star; strong bisimilarity,
 * hiding nothing, for every other formula, since it preserves the whole modal mu-calculus.
 */
export function reductionFor(src: string): { equivalence: Reduction; mentioned: string[] | null; why: string } {
  const f = checkFragment(src)
  if (!f.ok) {
    return {
      equivalence: "bisim",
      mentioned: null,
      why: `outside the fragment the branching equivalences preserve (${f.reason}): only strong bisimilarity, hiding no action, preserves it`,
    }
  }
  return f.divergence
    ? {
      equivalence: "dpbranching-bisim",
      mentioned: f.mentioned,
      why:
        "in the fragment, and it sees divergence (an inevitability pattern or a deadlock through a star): divergence-preserving branching bisimilarity preserves it, plain branching bisimilarity does not",
    }
    : {
      equivalence: "branching-bisim",
      mentioned: f.mentioned,
      why: "in the fragment, with no fixpoint and no deadlock through a star: branching bisimilarity preserves it",
    }
}

/**
 * The equivalences two versions of a model are compared modulo, the strongest first, each with the properties whose
 * results it carries over: strong bisimilarity preserves every modal mu-calculus formula; divergence-preserving
 * branching bisimilarity the fragment the LTS route accepts (formula.ts).
 */
/** The flags `naima verify --tool-args` may pass to every mCRL2 tool of a run: standard options of the toolset, which change what a tool prints, never its answer. */
export const TOOL_ARGS: Record<string, string> = {
  "--verbose": "each tool says what it is doing, kept in the run's output",
  "--timings": "each tool prints how long its phases took, kept in the run's output",
}

export const EQUIVALENCES: Record<string, string> = {
  bisim: "strong bisimilarity: preserves every modal mu-calculus formula",
  "dpbranching-bisim": "divergence-preserving branching bisimilarity: preserves the formulas the LTS route accepts, those in the fragment it preserves",
}

/**
 * The arguments of the steps that make an LTS, beyond its files: part of the cache key. Linearising without rewriting
 * makes another LPS, so `--no-rewrite` is here; `--threads`, `--cached` and the rewriter change how fast lps2lts
 * explores, never the LTS it writes, so they are not.
 */
export const recipeOf = (pipeline: Pipeline): LtsRecord["recipe"] => ({ mcrl22lps: pipeline.noRewrite ? ["--no-rewrite"] : [], lps2lts: [] })

/**
 * The options a property's `verifierOptions` may hold, each with what it does: an allow-list, never free-form flags,
 * every one leaving the verdict as it is.
 */
export const VERIFIER_OPTIONS: Record<string, string> = {
  route: 'the route: "lps" (the default), "lts" or "cross-check"',
  timeoutSeconds: "the time limit of each step, in seconds; reached, the run is unknown",
  threads: "the threads lps2lts explores with (--threads), on the LTS route; default 1",
  maxStates: "the most states lps2lts may explore (--max), on the LTS route; reached, the run is unknown",
  noRewrite: "linearise without rewriting (mcrl22lps --no-rewrite), on every route; default true",
  cached: "lps2lts caches its enumerations (--cached), on the LTS route; default true",
  rewriter: 'the rewriter lps2lts explores with: "auto" (the default), "jitty" or "jittyc" (compiled)',
}

/** How the tools run beyond the route: the verdict-preserving options of the allow-list. */
export interface Pipeline {
  noRewrite: boolean
  cached: boolean
  rewriter: RewriterOption
}

/** The defaults of a run with no options, also what `naima equivalent` uses. */
export const DEFAULT_PIPELINE: Pipeline = { noRewrite: true, cached: true, rewriter: "auto" }

/** The pipeline options of `options`, or why one is not in the allow-list or not of its kind. */
export function pipelineOf(options: Record<string, unknown>): Pipeline | { wrong: string } {
  const unknown = Object.keys(options).filter((k) => !Object.hasOwn(VERIFIER_OPTIONS, k))
  if (unknown.length) {
    return {
      wrong: `verifierOptions ${unknown.map((k) => JSON.stringify(k)).join(", ")}: the mcrl2 verifier takes only ${Object.keys(VERIFIER_OPTIONS).join(", ")}`,
    }
  }
  const flag = (name: "noRewrite" | "cached"): boolean | { wrong: string } => {
    const v = options[name] ?? DEFAULT_PIPELINE[name]
    return typeof v === "boolean" ? v : { wrong: `verifierOptions.${name} must be true or false, not ${JSON.stringify(v)}` }
  }
  const noRewrite = flag("noRewrite")
  if (typeof noRewrite === "object") return noRewrite
  const cached = flag("cached")
  if (typeof cached === "object") return cached
  const rewriter = options["rewriter"] ?? DEFAULT_PIPELINE.rewriter
  if (!(REWRITERS as readonly unknown[]).includes(rewriter)) {
    return { wrong: `verifierOptions.rewriter must be ${REWRITERS.map((r) => JSON.stringify(r)).join(", ")}, not ${JSON.stringify(rewriter)}` }
  }
  return { noRewrite, cached, rewriter: rewriter as RewriterOption }
}

/** The default size above which a summand's condition is reported, in operator and variable occurrences (lps-lint.ts). */
export const CONDITION_LIMIT = 10000

/** How lps2lts explores: its threads, its state cap, and the pipeline options. */
export interface Explore {
  threads: number
  maxStates?: number | undefined
  pipeline: Pipeline
}

/** How fast a counting step went: its count, its seconds, and the count per second. */
export interface Rate {
  step: string
  unit: string
  count: number
  seconds: number
  perSecond: number
}

const rateOf = (step: string, unit: string, count: number, seconds: number): Rate => ({
  step,
  unit,
  count,
  seconds,
  perSecond: seconds > 0 ? Math.round((count / seconds) * 10) / 10 : 0,
})

/** The folder beside the program a run keeps its intermediate files in: inside the launcher's fence, and ignored by git through its own .gitignore. */
export const WORK_DIR = ".naima-work"

/**
 * Where a run keeps its intermediate files: in the tracker folder, beside the
 * program, which the launcher lets the program write and read (the system's
 * temporary directory is outside its fence); that directory only when no
 * program is named.
 */
export function workBase(program?: string): string {
  if (!program) return tmpdir()
  const work = join(dirname(program), WORK_DIR)
  const dir = join(work, "verifier-mcrl2")
  mkdirSync(dir, { recursive: true })
  if (!existsSync(join(work, ".gitignore"))) writeFileSync(join(work, ".gitignore"), "*\n")
  return dir
}

/** A property naming an .mcf file: its absolute path, from the project root. */
const formulaFile = (property: string, root: string): string | null => (/\.mcf$/.test(property.trim()) ? resolve(root, property.trim()) : null)

/** The time limit of each step, from the item's `verifierOptions.timeoutSeconds`: none when absent. */
const timeoutOf = (options: Record<string, unknown>): number | undefined => {
  const t = options["timeoutSeconds"]
  return typeof t === "number" && t > 0 ? t : undefined
}

/** The route of a property (§1), or why its `route` option is not one. */
function routeOf(options: Record<string, unknown>): { route: Route } | { wrong: string } {
  const r = options["route"] ?? "lps"
  return (ROUTES as readonly unknown[]).includes(r)
    ? { route: r as Route }
    : { wrong: `verifierOptions.route must be ${ROUTES.map((x) => JSON.stringify(x)).join(", ")}, not ${JSON.stringify(r)}` }
}

/** The `--max` of lps2lts (§1): the most states one exploration may reach; undefined when there is no cap, or why the option is wrong. */
function maxStatesOf(options: Record<string, unknown>): number | undefined | { wrong: string } {
  const m = options["maxStates"]
  if (m === undefined) return undefined
  return typeof m === "number" && Number.isInteger(m) && m > 0 ? m : { wrong: `verifierOptions.maxStates must be a positive integer, not ${JSON.stringify(m)}` }
}

/** The `--threads` of lps2lts (§1), or why the `threads` option is not a positive integer. */
function threadsOf(options: Record<string, unknown>): number | string {
  const t = options["threads"] ?? 1
  return typeof t === "number" && Number.isInteger(t) && t > 0 ? t : `verifierOptions.threads must be a positive integer, not ${JSON.stringify(t)}`
}

const shown = (r: ToolRun): string => [r.stdout.trim(), r.stderr.trim()].filter(Boolean).join("\n")

/** The last word `pbessolve` printed: its answer. */
const answerOf = (r: ToolRun): string | undefined => r.stdout.trim().split(/\s+/).pop()

/** What `ltsinfo` prints of an LTS: its size and, with `--action-label`, its labels; one fact per line. */
export function readLtsInfo(text: string): { states: number; transitions: number; labels: string[] } | null {
  const lines = text.split(/\r?\n/)
  const count = (what: string): number | undefined => {
    const line = lines.find((l) => l.startsWith(`Number of ${what}: `))
    const n = line ? Number(line.slice(`Number of ${what}: `.length).replace(/\.$/, "")) : NaN
    return Number.isInteger(n) ? n : undefined
  }
  const states = count("states")
  const transitions = count("transitions")
  if (states === undefined || transitions === undefined) return null
  const from = lines.findIndex((l) => l.startsWith("The action labels of this transition system:"))
  const labels = from < 0 ? [] : lines.slice(from + 1).map((l) => l.trim()).filter(Boolean)
  return { states, transitions, labels }
}

/**
 * Where a tool is: in `bin` when it is given and exists on this machine; otherwise the mCRL2 `naima tools install
 * mcrl2` installed on this machine; otherwise its name, looked up on PATH. A `bin` kept in a shared naima.json may be
 * one machine's path: elsewhere it is absent, and the installed tool is used instead.
 */
export function toolPath(tool: string, bin?: string): string {
  return bin && existsSync(bin) ? join(bin, tool) : installedProgram(MCRL2, tool) ?? tool
}

/** A route's answer: a result with the details of how it was reached. */
type Outcome = VerifyResult & { details: Record<string, unknown> }

/** The adapter, its tools from `bin` (a directory), the installed mCRL2 or PATH, started by `run`. */
export function mcrl2Verifier(config: { bin?: string; run?: Runner; conditionLimit?: number } = {}): Verifier {
  const run = config.run ?? realRun
  const conditionLimit = config.conditionLimit ?? CONDITION_LIMIT
  const path = (tool: Tool): string => toolPath(tool, config.bin)
  const absent = (): boolean => !!config.bin && !existsSync(config.bin)
  let said = false
  /** A configured bin absent on this machine, said once, when a tool is first started. */
  const sayAbsent = (): void => {
    if (said || !absent()) return
    said = true
    console.error(
      `verifier-mcrl2: bin ${config.bin} does not exist on this machine; using the mCRL2 installed by naima tools, otherwise PATH`,
    )
  }
  const missing = (tool: Tool): string =>
    `tool missing: ${tool} is not ${
      config.bin && !absent() ? `in ${config.bin}` : `${config.bin ? `in ${config.bin} (absent on this machine), ` : ""}installed by naima tools, nor on PATH`
    } — ${INSTALL}`

  /**
   * The steps of one route: each tool's output kept in the log, the tools it started remembered for their versions.
   * Each step is a stage of `progress`; a counting tool is started with `--verbose`, its counting lines read as the
   * stage's count and left out of the log (specs/progress-long-work-says-how-far, §6).
   */
  function steps(seconds: number | undefined, cwd: string, progress: Progress, extra: readonly string[] = []) {
    const log: string[] = []
    const used = new Set<Tool>()
    /** One step: its output kept in the log; a failure is the result to return. */
    const step = async (tool: Tool, given: string[], at = cwd): Promise<{ out: ToolRun; seconds: number; count?: number } | { stop: VerifyResult }> => {
      const counting = COUNTING[tool]
      // The flags --tool-args gives (TOOL_ARGS) go to every tool; a counting or verbose tool has --verbose already.
      const args = counting || VERBOSE.has(tool) ? ["--verbose", ...extra.filter((a) => a !== "--verbose"), ...given] : [...extra, ...given]
      progress.stage(tool, undefined, counting?.unit)
      // Every line a tool prints on standard error is the stage's note as it comes; a counting line is its count.
      let pending = ""
      let last: number | undefined
      const onStderr = (chunk: string): void => {
        const fragments = (pending + chunk).split(/\r\n|\r|\n/)
        pending = fragments.pop() ?? ""
        for (const f of fragments) {
          const n = counting ? counting.count(f) : null
          if (n !== null) {
            last = n
            progress.at(n)
            const note = counting!.note?.(f)
            if (note) progress.note(note)
          } else if (f.trim()) progress.note(f.trim())
        }
      }
      sayAbsent()
      const started = Date.now()
      const raw = await run(path(tool), args, at, seconds ? seconds * 1000 : undefined, onStderr)
      const took = (Date.now() - started) / 1000
      // A runner that hands the output only at the end: the last counting line in it is the count.
      if (counting && last === undefined) {
        for (const f of raw.stderr.split(/\r\n|\r|\n/)) last = counting.count(f) ?? last
      }
      const r = counting ? { ...raw, stderr: withoutCounting(tool, raw.stderr) } : raw
      if (r.missing) return { stop: { verdict: "error", output: [missing(tool), ...log].join("\n") } }
      used.add(tool)
      log.push(`$ ${tool} ${args.join(" ")}`, ...(shown(r) ? [shown(r)] : []))
      if (r.timedOut) return { stop: { verdict: "unknown", output: [...log, `${tool} did not finish in ${seconds} s`].join("\n") } }
      if (r.error) return { stop: { verdict: "error", output: [...log, `${tool} could not start: ${r.error}`].join("\n") } }
      if (r.exit !== 0) return { stop: { verdict: "error", output: [...log, `${tool} exited ${r.exit}`].join("\n") } }
      return { out: r, seconds: took, ...(last !== undefined ? { count: last } : {}) }
    }
    /** Each tool this route started, with the first line of its `--version` (§5). */
    const tools = async (): Promise<Record<string, string>> => {
      const out: Record<string, string> = {}
      for (const t of [...used].sort()) {
        const r = await run(path(t), ["--version"], cwd)
        out[t] = r.exit === 0 ? r.stdout.trim().split("\n")[0]!.trim() : `unknown: --version exited ${r.exit}`
      }
      return out
    }
    return { log, step, tools }
  }

  /**
   * The lint of the LPS at `lps` on its summand conditions (lps-lint.ts), its finding added to the log; null when the
   * lint is off (`summandConditionLimit` 0) or `lpspp` could not print the LPS, which the log then says.
   */
  async function lintOf(s: ReturnType<typeof steps>, lps: string, dir: string): Promise<ConditionLint | null> {
    if (conditionLimit <= 0) return null
    const aterm = join(dir, "lint.aterm")
    try {
      const printed = await s.step("lpspp", ["--format=internal", lps, aterm], dir)
      if ("stop" in printed || !existsSync(aterm)) {
        s.log.push("lint: lpspp could not print the LPS, so its summand conditions were not measured")
        return null
      }
      const lint = lintConditions(readFileSync(aterm, "utf8"), conditionLimit)
      const line = lintLine(lint)
      if (line) s.log.push(line)
      return lint
    } finally {
      rmSync(aterm, { force: true })
    }
  }

  /** The arguments of mcrl22lps beyond its files: `--no-rewrite` unless the item turned it off. */
  const linearise = (pipeline: Pipeline): string[] => (pipeline.noRewrite ? ["--no-rewrite"] : [])

  /** The standard route: the formula against the linearised model. */
  async function lpsRoute(
    model: string,
    formula: string,
    dir: string,
    seconds: number | undefined,
    progress: Progress,
    extra: readonly string[] = [],
    pipeline: Pipeline = DEFAULT_PIPELINE,
  ): Promise<Outcome> {
    const s = steps(seconds, dir, progress, extra)
    const details: Record<string, unknown> = { route: "lps", options: { mcrl22lps: linearise(pipeline) } }
    const done = async (r: VerifyResult): Promise<Outcome> => ({ ...r, details: { ...details, tools: await s.tools() } })
    const lps = join(dir, "model.lps")
    const pbes = join(dir, "model.pbes")
    const evidence = join(dir, "evidence.lps")
    const linearised = await s.step("mcrl22lps", [...linearise(pipeline), model, lps])
    if ("stop" in linearised) return done(linearised.stop)
    const lint = await lintOf(s, lps, dir)
    if (lint) details["lint"] = lint
    const translated = await s.step("lps2pbes", ["--counter-example", `--formula=${formula}`, lps, pbes])
    if ("stop" in translated) return done(translated.stop)
    const solved = await s.step("pbessolve", [`--file=${lps}`, `--evidence-file=${evidence}`, pbes])
    if ("stop" in solved) return done(solved.stop)
    if (solved.count !== undefined) details["rate"] = rateOf("pbessolve", COUNTING["pbessolve"]!.unit, solved.count, solved.seconds)
    const answer = answerOf(solved.out)
    const output = s.log.join("\n")
    if (answer === "true") return done({ verdict: "holds", output })
    if (answer !== "false") return done({ verdict: "unknown", output: `${output}\npbessolve answered neither true nor false` })
    const aut = join(dir, "evidence.aut")
    const printed = await s.step("lps2lts", [evidence, aut])
    const counterexample = "out" in printed && existsSync(aut)
      ? readFileSync(aut, "utf8")
      : `pbessolve answered false; its evidence could not be printed:\n${"stop" in printed ? printed.stop.output : ""}`
    return done({ verdict: "violated", output: s.log.join("\n"), counterexample })
  }

  /**
   * The LTS of the model, from the cache or generated into it (§4). `earlier`, a copy of an earlier version of the
   * model kept at `rel`: its LTS is taken from the cache when it is there, and otherwise made in `dir`, outside the
   * cache, so it never supersedes the LTS of the model as it is now.
   */
  async function ltsOf(
    model: string,
    ctx: Context,
    s: ReturnType<typeof steps>,
    explore: Explore,
    earlier?: { rel: string; dir: string },
  ): Promise<{ stop: VerifyResult } | { dir: string; record: LtsRecord; reused: boolean }> {
    const work = workBase(ctx.program)
    const version = await run(path("mcrl22lps"), ["--version"], work)
    if (version.missing) return { stop: { verdict: "error", output: missing("mcrl22lps") } }
    if (version.exit !== 0) return { stop: { verdict: "error", output: `mcrl22lps --version exited ${version.exit}: ${shown(version)}` } }
    const toolVersion = version.stdout.trim().split("\n")[0]!.trim()
    const rel = earlier?.rel ?? relative(ctx.root, model).split(sep).join("/")
    const inputs = [{ path: rel, sha256: sha256File(model) }]
    const recipe = recipeOf(explore.pipeline)
    const key = cacheKey(inputs, toolVersion, recipe)
    const root = cacheRoot(work)
    const found = readEntry(root, key)
    if (found) {
      s.log.push(`LTS reused from the cache: ${key} (${found.record.states} states, ${found.record.transitions} transitions)`)
      return { ...found, reused: true }
    }
    if (existsSync(join(root, key)) && !earlier) discard(join(root, key))
    const folder = earlier ? earlier.dir : freshFolder(root)
    if (earlier) mkdirSync(folder, { recursive: true })
    try {
      const lps = join(folder, ENTRY_LPS)
      const lts = join(folder, ENTRY_LTS)
      const started = Date.now()
      const linearised = await s.step("mcrl22lps", [...recipe["mcrl22lps"]!, model, lps], folder)
      if ("stop" in linearised) return linearised
      const lint = await lintOf(s, lps, folder)
      // The rewriter: asked for, or chosen on what the earlier explorations of this model measured (rewriter.ts).
      const choice = await chooseRewriter(explore.pipeline.rewriter, () => jittycOff(work), readTimings(work)[rel])
      s.log.push(`lps2lts rewrites with ${choice.rewriter}: ${choice.why}`)
      if (choice.why.includes("instead")) console.error(`verifier-mcrl2: ${choice.why}`)
      const args = [
        ...(explore.threads > 1 ? [`--threads=${explore.threads}`] : []),
        ...(explore.pipeline.cached ? ["--cached"] : []),
        ...(choice.rewriter === "jittyc" ? ["--rewriter=jittyc"] : []),
      ]
      // The cap changes no complete LTS, so it is no part of the key; an LTS it cut short is never kept.
      const capped = explore.maxStates !== undefined ? [`--max=${explore.maxStates}`] : []
      const explored = await s.step("lps2lts", [...args, ...capped, lps, lts], folder)
      if ("stop" in explored) return explored
      if (CAPPED.exec(`${explored.out.stdout}\n${explored.out.stderr}`)) {
        return {
          stop: {
            verdict: "unknown",
            output: [
              ...s.log,
              `state cap reached: lps2lts stopped at ${explore.maxStates} states (verifierOptions.maxStates), so the state space is larger and the LTS is incomplete: no verdict. Raise maxStates, or bound the model's data so its state space is finite.`,
            ].join("\n"),
          },
        }
      }
      const generationSeconds = Math.round((Date.now() - started) / 100) / 10
      const info = await s.step("ltsinfo", ["--action-label", lts], folder)
      if ("stop" in info) return info
      const read = readLtsInfo(`${info.out.stdout}\n${info.out.stderr}`)
      if (!read) return { stop: { verdict: "error", output: [...s.log, "ltsinfo printed no number of states and transitions"].join("\n") } }
      // The exploration's own time: lps2lts's, without the rewriter's compile time when it compiled one.
      const compileSeconds = choice.rewriter === "jittyc" ? compileSecondsIn(`${explored.out.stdout}\n${explored.out.stderr}`) : undefined
      const exploreSeconds = Math.round(Math.max(0, explored.seconds - (compileSeconds ?? 0)) * 10) / 10
      const rate = rateOf("lps2lts", "states", read.states, exploreSeconds)
      recordTimings(work, rel, choice.rewriter, { exploreSeconds, states: read.states, compileSeconds, at: new Date().toISOString() })
      s.log.push(
        `lps2lts explored ${read.states} states in ${exploreSeconds} s, ${rate.perSecond} states per second${
          compileSeconds !== undefined ? `, after compiling the rewriter in ${compileSeconds} s` : ""
        }`,
      )
      const exploration: Record<string, unknown> = {
        mcrl22lps: recipe["mcrl22lps"],
        lps2lts: args,
        threads: explore.threads,
        cached: explore.pipeline.cached,
        rewriter: choice.rewriter,
        rewriterAsked: explore.pipeline.rewriter,
        rewriterWhy: choice.why,
        ...(compileSeconds !== undefined ? { compileSeconds } : {}),
        rate,
      }
      const record: LtsRecord = {
        key,
        model: rel,
        inputs,
        toolVersion,
        recipe,
        ltsSha256: sha256File(lts),
        ...read,
        generationSeconds,
        exploration,
        ...(lint ? { lint: lint as unknown as Record<string, unknown> } : {}),
        at: new Date().toISOString(),
      }
      if (earlier) return { dir: folder, record, reused: false }
      const entry = publish(root, folder, record)
      prune(root, key, rel)
      return { ...entry, reused: false }
    } finally {
      if (!earlier && existsSync(folder)) discard(folder)
    }
  }

  let jittycReason: string | null | undefined
  /** Why jittyc cannot run on this host, asked of the toolset once per verifier: null when it can. */
  const jittycOff = async (work: string): Promise<string | null> => {
    if (jittycReason !== undefined) return jittycReason
    const help = await run(path("lps2lts"), ["--help"], work)
    jittycReason = jittycUnavailable(`${help.stdout}\n${help.stderr}`, cxxCompiler())
    return jittycReason
  }

  /**
   * The LTS route (§2): the cached LTS, reduced modulo the coarsest equivalence that preserves and reflects the
   * formula (§3) — hiding the actions it does not mention when that equivalence is a branching one — and solved.
   * The reduced LTS is kept beside the LTS, one per equivalence and hidden set, for every formula that needs the same.
   */
  async function ltsRoute(
    model: string,
    formula: string,
    dir: string,
    ctx: Context,
    seconds: number | undefined,
    explore: Explore,
    progress: Progress,
    extra: readonly string[] = [],
  ): Promise<Outcome> {
    const s = steps(seconds, dir, progress, extra)
    const details: Record<string, unknown> = { route: "lts" }
    const done = async (r: VerifyResult): Promise<Outcome> => ({ ...r, details: { ...details, tools: await s.tools() } })

    let chosen = reductionFor(readFileSync(formula, "utf8"))
    const lts = await ltsOf(model, ctx, s, explore)
    if ("stop" in lts) return done(lts.stop)
    const { record } = lts
    details["lts"] = {
      key: record.key,
      reused: lts.reused,
      states: record.states,
      transitions: record.transitions,
      generationSeconds: record.generationSeconds,
      ...(record.exploration ? { exploration: record.exploration } : {}),
    }
    // The rate of the exploration that made the LTS, this run's or, for a reused LTS, the run's that made it.
    const rate = record.exploration?.["rate"]
    if (rate && typeof rate === "object") details["rate"] = { ...rate, ...(lts.reused ? { reused: true } : {}) }
    if (record.lint) details["lint"] = record.lint

    // The actions the formula does not mention are hidden, unless a label joins one to another (§3.3): hiding it would
    // change what the formula sees, so the formula falls back to strong bisimilarity, which hides nothing.
    let hiddenNames: string[] = []
    if (chosen.mentioned) {
      const mentioned = new Set(chosen.mentioned)
      const hidden = new Set<string>()
      for (const label of record.labels) {
        const names = labelActions(label)
        const joins = names !== null && names.length > 1 && names.some((n) => !mentioned.has(n))
        if (!names || joins) {
          chosen = {
            equivalence: "bisim",
            mentioned: chosen.mentioned,
            why: `the LTS label ${JSON.stringify(label)} ${
              names ? "joins a hidden action to another" : "cannot be read as a multi-action"
            }, so no action is hidden and only strong bisimilarity preserves the formula`,
          }
          hidden.clear()
          break
        }
        for (const n of names) if (!mentioned.has(n)) hidden.add(n)
      }
      hiddenNames = [...hidden].sort()
      details["mentioned"] = chosen.mentioned
    }
    details["hidden"] = hiddenNames
    s.log.push(`reduced modulo ${chosen.equivalence}: the formula is ${chosen.why}`)

    const key = reducedKey(chosen.equivalence, hiddenNames)
    let reduced: string
    let size: ReducedRecord | null = readReduced(lts.dir, key)
    if (size) {
      reduced = size.path
      s.log.push(`reduced LTS reused: ${chosen.equivalence}${hiddenNames.length ? `, ${hiddenNames.length} actions hidden` : ""}`)
    } else {
      const made = join(dir, "reduced.lts")
      const tau = hiddenNames.length ? [`--tau=${hiddenNames.join(",")}`] : []
      const converted = await s.step("ltsconvert", [...tau, `--equivalence=${chosen.equivalence}`, join(lts.dir, ENTRY_LTS), made])
      if ("stop" in converted) return done(converted.stop)
      const info = await s.step("ltsinfo", [made])
      if ("stop" in info) return done(info.stop)
      const read = readLtsInfo(`${info.out.stdout}\n${info.out.stderr}`)
      if (!read) return done({ verdict: "error", output: [...s.log, "ltsinfo printed no number of states and transitions"].join("\n") })
      size = storeReduced(lts.dir, key, made, { equivalence: chosen.equivalence, hidden: hiddenNames, states: read.states, transitions: read.transitions })
      reduced = size.path
    }
    details["reduced"] = { equivalence: chosen.equivalence, why: chosen.why, states: size.states, transitions: size.transitions, reused: size.reused }

    const pbes = join(dir, "reduced.pbes")
    const evidence = join(dir, "evidence.lts")
    const translated = await s.step("lts2pbes", ["--counter-example", `--formula=${formula}`, reduced, pbes])
    if ("stop" in translated) return done(translated.stop)
    const solved = await s.step("pbessolve", [`--file=${reduced}`, `--evidence-file=${evidence}`, pbes])
    if ("stop" in solved) return done(solved.stop)
    const answer = answerOf(solved.out)
    if (answer === "true") return done({ verdict: "holds", output: s.log.join("\n") })
    if (answer !== "false") return done({ verdict: "unknown", output: `${s.log.join("\n")}\npbessolve answered neither true nor false` })

    // False: the reduced LTS's evidence is the counterexample; the hidden actions appear in it as tau (§2, step 6).
    details["counterexampleFrom"] = "reduced LTS"
    const aut = join(dir, "evidence.aut")
    const printed = await s.step("ltsconvert", [evidence, aut])
    const counterexample = "out" in printed && existsSync(aut)
      ? readFileSync(aut, "utf8")
      : `pbessolve answered false; its evidence could not be printed:\n${"stop" in printed ? printed.stop.output : ""}`
    return done({ verdict: "violated", output: s.log.join("\n"), counterexample })
  }

  /** Both routes (§6): a verdict only when they reach the same one. */
  function crossCheck(lps: Outcome, lts: Outcome): Outcome {
    const reached = (o: Outcome) => o.verdict === "holds" || o.verdict === "violated"
    const both = reached(lps) && reached(lts)
    const agree = both ? lps.verdict === lts.verdict : null
    const details = { route: "cross-check", lps: { verdict: lps.verdict, ...lps.details }, lts: { verdict: lts.verdict, ...lts.details }, agree }
    const logs = `== standard route (lps): ${lps.verdict}\n${lps.output}\n== LTS route (lts): ${lts.verdict}\n${lts.output}`
    if (agree) return { verdict: lps.verdict, output: logs, ...(lps.counterexample !== undefined ? { counterexample: lps.counterexample } : {}), details }
    if (both) {
      return { verdict: "error", output: `the routes disagree: the standard route says ${lps.verdict}, the LTS route says ${lts.verdict}\n${logs}`, details }
    }
    return { verdict: lps.verdict === "error" || lts.verdict === "error" ? "error" : "unknown", output: logs, details }
  }

  async function check({ model, property, options, progress = NO_PROGRESS, toolArgs = [] }: VerifyRequest, ctx: Context): Promise<VerifyResult> {
    const chosen = routeOf(options)
    if ("wrong" in chosen) return { verdict: "error", output: chosen.wrong }
    const threads = threadsOf(options)
    if (typeof threads === "string") return { verdict: "error", output: threads }
    const maxStates = maxStatesOf(options)
    if (typeof maxStates === "object") return { verdict: "error", output: maxStates.wrong }
    if (maxStates !== undefined && chosen.route === "lps") {
      return {
        verdict: "error",
        output:
          'verifierOptions.maxStates caps the states lps2lts explores, which the "lts" and "cross-check" routes do and the standard route does not: bound it with timeoutSeconds',
      }
    }
    const pipeline = pipelineOf(options)
    if ("wrong" in pipeline) return { verdict: "error", output: pipeline.wrong }
    const explore: Explore = { threads, maxStates, pipeline }
    const seconds = timeoutOf(options)
    const dir = mkdtempSync(join(workBase(ctx.program), "run-"))
    try {
      let formula = formulaFile(property, ctx.root)
      if (formula && !existsSync(formula)) return { verdict: "error", output: `the formula file ${property.trim()} does not exist` }
      if (!formula) writeFileSync(formula = join(dir, "property.mcf"), property.trim() + "\n")
      if (chosen.route === "lps") return await lpsRoute(model, formula, dir, seconds, progress, toolArgs, pipeline)
      if (chosen.route === "lts") return await ltsRoute(model, formula, dir, ctx, seconds, explore, progress, toolArgs)
      const sub = (name: string): string => {
        const d = join(dir, name)
        mkdirSync(d)
        return d
      }
      const lps = await lpsRoute(
        model,
        formula,
        sub("lps"),
        seconds,
        { ...progress, stage: (n, t, u, e) => progress.stage(`lps: ${n}`, t, u, e) },
        toolArgs,
        pipeline,
      )
      const lts = await ltsRoute(
        model,
        formula,
        sub("lts"),
        ctx,
        seconds,
        explore,
        { ...progress, stage: (n, t, u, e) => progress.stage(`lts: ${n}`, t, u, e) },
        toolArgs,
      )
      return crossCheck(lps, lts)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }

  /** Two versions of a model compared modulo `equivalence`: each one's LTS, then ltscompare, with a distinguishing formula when they differ. */
  async function compare({ before, after, equivalence, progress = NO_PROGRESS }: CompareRequest, ctx: Context): Promise<CompareResult> {
    if (!Object.hasOwn(EQUIVALENCES, equivalence)) {
      return { verdict: "error", output: `the mcrl2 verifier compares modulo ${Object.keys(EQUIVALENCES).join(", ")}, not ${JSON.stringify(equivalence)}` }
    }
    const dir = mkdtempSync(join(workBase(ctx.program), "compare-"))
    let phase = "before"
    const s = steps(undefined, dir, { ...progress, stage: (n, t, u, e) => progress.stage(`${phase}: ${n}`, t, u, e) })
    const failed = async (r: VerifyResult, details: Record<string, unknown>): Promise<CompareResult> => ({
      verdict: "error",
      output: r.output,
      details: { ...details, tools: await s.tools() },
    })
    try {
      const rel = relative(ctx.root, after).split(sep).join("/")
      const old = await ltsOf(before, ctx, s, { threads: 1, pipeline: DEFAULT_PIPELINE }, { rel, dir: join(dir, "before") })
      if ("stop" in old) return await failed(old.stop, { equivalence })
      phase = "after"
      const now = await ltsOf(after, ctx, s, { threads: 1, pipeline: DEFAULT_PIPELINE })
      if ("stop" in now) return await failed(now.stop, { equivalence })
      const size = (l: { record: LtsRecord; reused: boolean }) => ({ states: l.record.states, transitions: l.record.transitions, reused: l.reused })
      const details: Record<string, unknown> = { equivalence, before: size(old), after: size(now) }
      phase = "compare"
      const distinguishing = join(dir, "distinguishing.mcf")
      const compared = await s.step("ltscompare", [
        `--equivalence=${equivalence}`,
        "--counter-example",
        `--counter-example-file=${distinguishing}`,
        join(old.dir, ENTRY_LTS),
        join(now.dir, ENTRY_LTS),
      ])
      if ("stop" in compared) return await failed(compared.stop, details)
      const answer = answerOf(compared.out)
      const done = { ...details, tools: await s.tools() }
      if (answer === "true") return { verdict: "equivalent", output: s.log.join("\n"), details: done }
      if (answer !== "false") return { verdict: "error", output: `${s.log.join("\n")}\nltscompare answered neither true nor false`, details: done }
      const counterexample = existsSync(distinguishing) ? readFileSync(distinguishing, "utf8").trim() : "ltscompare wrote no distinguishing formula"
      return { verdict: "different", output: s.log.join("\n"), counterexample, details: done }
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }

  /** Why a result of `property` does not carry over modulo `equivalence`; null when it does. */
  function preserves({ property, equivalence }: { property: string; equivalence: string }, ctx: Context): string | null {
    if (!Object.hasOwn(EQUIVALENCES, equivalence)) return `the mcrl2 verifier compares modulo ${Object.keys(EQUIVALENCES).join(", ")}`
    if (equivalence === "bisim") return null
    const file = formulaFile(property, ctx.root)
    if (file && !existsSync(file)) return `the formula file ${property.trim()} does not exist`
    const fragment = checkFragment(file ? readFileSync(file, "utf8") : property)
    return fragment.ok ? null : fragment.reason
  }

  return {
    id: "mcrl2",
    says:
      "an mCRL2 specification against a modal mu-calculus formula, inline or an .mcf file: by the standard route (mcrl22lps, lps2pbes, pbessolve), by the LTS route (the state space once per model, reduced per formula by the coarsest equivalence that preserves it, lts2pbes, pbessolve), or both, cross-checked; the evidence is the counterexample",
    runs: TOOLS.map(path),
    verify: (request, ctx) => check(request, ctx),
    toolArgs: TOOL_ARGS,
    equivalences: EQUIVALENCES,
    compare,
    preserves,
    inputs: ({ model, property }, ctx) => {
      const f = formulaFile(property, ctx.root)
      return f ? [model, f] : [model]
    },
    version: async (ctx) => {
      const r = await run(path("mcrl22lps"), ["--version"], workBase(ctx.program))
      if (r.missing) throw new Error(missing("mcrl22lps"))
      if (r.exit !== 0) throw new Error(`mcrl22lps --version exited ${r.exit}: ${shown(r) || r.error || ""}`)
      return r.stdout.trim().split("\n")[0]!.trim()
    },
  }
}

/** Every lint a run record holds: at the top of its details, or under a cross-check's routes. */
function lintsIn(details: unknown): ConditionLint[] {
  if (!details || typeof details !== "object") return []
  const d = details as Record<string, unknown>
  const own = d["lint"] && typeof d["lint"] === "object" ? [d["lint"] as ConditionLint] : []
  return [...own, ...lintsIn(d["lps"]), ...lintsIn(d["lts"])].filter((l) => typeof l.overCount === "number")
}

/**
 * The check on summand conditions: each mcrl2 property whose last run linted its model's LPS (lps-lint.ts) and found
 * conditions over the limit is noted, with the largest ones. It reads the runs already recorded and starts no tool.
 */
export const summandConditions: Check = {
  name: "mcrl2-summand-conditions",
  says:
    "an mcrl2 property whose last run found summand conditions larger than the plugin's summandConditionLimit is noted: a guard copied into every summand slows every tool that reads the model",
  run(ctx) {
    const out: Finding[] = []
    const seen = new Set<string>()
    for (const item of ctx.repo.items) {
      if (item.meta["verifier"] !== "mcrl2" || typeof item.meta["lastRun"] !== "string" || typeof item.meta["model"] !== "string") continue
      let record: { details?: unknown }
      try {
        record = JSON.parse(readFileSync(join(item.dir, ATTACHMENTS, item.meta["lastRun"]), "utf8"))
      } catch {
        continue // property-evidence reports a run record that cannot be read
      }
      const lint = lintsIn(record.details).find((l) => l.overCount > 0)
      const model = item.meta["model"]
      if (!lint || seen.has(model)) continue
      seen.add(model)
      out.push({
        level: "note",
        item,
        subject: model,
        message: `${
          label(item)
        }: ${model} has ${lint.overCount} of ${lint.summands} summands with a condition larger than ${lint.limit} operator and variable occurrences (largest ${lint.largest}) — share a guard repeated in every summand as one derived predicate (docs/guide/design-with-a-model.md, "Keep generated models small"), or raise plugins.verifier-mcrl2.options.summandConditionLimit`,
      })
    }
    return out
  },
}

/** The plugin, its tools started by `run`: tests replay recorded output through it. */
export function mcrl2Plugin(options: Record<string, unknown> = {}, run: Runner = realRun): Plugin {
  const bin = options["bin"]
  if (bin !== undefined && (typeof bin !== "string" || !isAbsolute(bin))) {
    throw new Error("verifier-mcrl2: bin must be an absolute path to the directory holding the mCRL2 tools")
  }
  const limit = options["summandConditionLimit"] ?? CONDITION_LIMIT
  if (typeof limit !== "number" || !Number.isInteger(limit) || limit < 0) {
    throw new Error("verifier-mcrl2: summandConditionLimit must be a whole number of operator and variable occurrences, 0 to turn the lint off")
  }
  return {
    name: "verifier-mcrl2",
    contract: CONTRACT,
    says: "the mCRL2 adapter: a property is a modal mu-calculus formula over an mCRL2 specification",
    about:
      "Off until `naima.json` names it under `plugins`, since it starts programs. Contributes the `mcrl2` verifier and the `mcrl2` tool. `model` is an mCRL2 specification; `property` is a modal mu-calculus formula, inline, or the path of an `.mcf` file from the project root, which is then an input of the run. " +
      "A property chooses its route in `verifierOptions.route`. `lps`, the default, is the standard route: `mcrl22lps`, `lps2pbes --counter-example`, and `pbessolve` with an evidence file: `true` holds; `false` is violated, and the evidence, printed by `lps2lts` as an `.aut` labelled transition system, is the counterexample; any other answer, or `verifierOptions.timeoutSeconds` reached by a step, is unknown. " +
      "`lts`, the LTS route, is for a model whose state space is small but whose data makes the standard route slow. `mcrl22lps` and `lps2lts` (with `--threads` from `verifierOptions.threads`) make the LTS once per model version, kept in the run work folder under a key over the model's contents, the toolset's version and the recipe, and shared by every property of that model. `verifierOptions.maxStates` caps the states `lps2lts` may explore (`--max`): a state space larger than the cap makes the run unknown, its output beginning `state cap reached:`, and the LTS cut short is not kept; on the standard route the option is an error, since that route explores with `pbessolve`. Each formula is then reduced only by an equivalence that preserves and reflects it, the coarsest of three: `branching-bisim` for a formula of the fragment the branching equivalences preserve — every visible step right after a star over an action formula that includes tau, no single step that includes tau, fixpoints only as the four inevitability patterns — when it has no fixpoint and no deadlock through a star; `dpbranching-bisim` when it has one of those, which see divergence; `bisim`, strong bisimilarity, for every other formula. With a branching equivalence, `ltsconvert` first hides every action the formula does not mention, unless a label joins such an action to another, in which case the formula takes `bisim` and nothing is hidden. The output says which equivalence was used and why; the reduced LTS is kept beside the LTS, one per equivalence and set of hidden actions, for every formula that needs the same. On the reduced LTS, `lts2pbes --counter-example` and one `pbessolve` with an evidence file decide; on false, the evidence, printed by `ltsconvert` as an `.aut` labelled transition system, is the counterexample, over the reduced LTS, where the hidden actions appear as tau. " +
      "`cross-check` runs both routes and gives a verdict only when they agree; a disagreement is an error whose output begins `the routes disagree:`. Each run records in its `details` the route, the version of every tool it started, and for the LTS route the LTS's key, reuse and size, the mentioned and hidden actions, the equivalence it reduced by and why, the reduced size and whether it was reused, and on false that the counterexample comes from the reduced LTS. While a step runs, every line it prints is the run's progress: `lps2lts` its states, level and transitions, `pbessolve` its BES equations, `ltsconvert` and `lts2pbes`, started with `--verbose`, their stages; a counting step's total is estimated from the count it ended on in the previous run of the same property, model and options. " +
      "`verifierOptions` is an allow-list: `route`, `timeoutSeconds`, `threads`, `maxStates`, `noRewrite`, `cached` and `rewriter`, every one leaving the verdict as it is; any other key is an error that names the ones it takes. `noRewrite`, true by default, linearises with `mcrl22lps --no-rewrite` on every route, so the verdict never depends on the route; it makes another LPS, so it is part of the LTS's cache key. `cached`, true by default, explores with `lps2lts --cached`; `threads` stays on `lps2lts` alone. `rewriter` is `auto` (the default), `jitty` or `jittyc`: with `auto`, `lps2lts` explores with the compiled rewriter `jittyc` when the last `jitty` exploration of the same model on this host took longer than the compile time last measured there (240 s assumed until one is measured), and with `jitty` otherwise; when this mCRL2 build has no `jittyc` (the Windows one) or no C++ compiler is on the host, it explores with `jitty` and prints why. The times are kept per model in the run work folder (`timings.json`). The compiled rewriter is compiled again by every run: the C++ that mCRL2 generates names memory addresses of the process that generated it, so it cannot be kept. `--threads`, `--cached` and the rewriter change how fast the LTS is made, never the LTS, so they are no part of the key. Every run records the options it used and its rate: on the LTS route `details.lts.exploration` (the `mcrl22lps` and `lps2lts` arguments, the rewriter, why, and the compile time) and `details.rate`, the states `lps2lts` explored per second without the compile time (`reused: true` when the LTS came from the cache); on the standard route `details.rate`, the BES equations `pbessolve` generated per second. " +
      "After linearising, `lpspp --format=internal` prints the LPS and each summand's condition is measured in operator and variable occurrences; the summands over the plugin option `summandConditionLimit` (10000 by default, 0 turns it off) are named in the run's output, in a line beginning `lint:`, and in `details.lint`, and the check `mcrl2-summand-conditions` notes each model whose last run found some. " +
      "The tools are taken from `bin` when it is given and exists on this machine, otherwise from the mCRL2 202607.0 that `naima tools install mcrl2` installed on this machine, otherwise from PATH; a `bin` that does not exist on this machine, as when a shared `naima.json` names another machine's path, is said once and passed over. The plugin declares that tool, so `naima tools` reports it. A tool that is not there is an error run whose output begins `tool missing:`; a tool that fails is an error with its output. The version recorded is the first line of `mcrl22lps --version`. " +
      "For `naima equivalent`, it compares two versions of a model modulo `bisim` (strong bisimilarity, the default, which preserves every formula) or `dpbranching-bisim` (divergence-preserving branching bisimilarity, which preserves the formulas the LTS route accepts): `mcrl22lps`, `lps2lts` and `ltsinfo` for each version, the new one through the LTS cache, then `ltscompare --counter-example`; on false, the distinguishing formula it writes is what tells them apart.",
    options: [
      {
        name: "bin",
        says:
          "the absolute directory holding the mCRL2 tools; not given, or not existing on this machine (said once), the mCRL2 naima tools installed on this machine, then PATH",
        default: "installed, then PATH",
      },
      {
        name: "summandConditionLimit",
        says:
          "the size above which a summand's condition is reported, in operator and variable occurrences of the linearised model as `lpspp --format=internal` prints it; 0 turns the lint off",
        default: String(CONDITION_LIMIT),
      },
    ],
    contributes: { verifiers: [mcrl2Verifier({ ...(typeof bin === "string" ? { bin } : {}), run, conditionLimit: limit })], tools: [MCRL2] },
    checks: [summandConditions],
    optional: ["verifiers", "tools"],
  }
}

export default function verifierMcrl2(options: Record<string, unknown> = {}): Plugin {
  return mcrl2Plugin(options)
}
