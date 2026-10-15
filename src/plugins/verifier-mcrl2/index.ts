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
// The LTS route, `lts`, for a formula in the fragment divergence-preserving
// branching bisimilarity preserves (formula.ts):
//
//   mcrl22lps, lps2lts, ltsinfo -a                       the LTS, once per model version (lts-cache.ts)
//   ltsconvert --tau=<unmentioned> -edpbranching-bisim   hide and reduce, per formula
//   lts2pbes -c, pbessolve --evidence-file               the verdict on the reduced LTS, with its evidence
//   ltsconvert ev.lts ev.aut                             on false: the counterexample, hidden actions as tau
//
// `cross-check` runs both and gives a verdict only when they agree.
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
import { type Context, CONTRACT, installedProgram, message, NO_PROGRESS, type Plugin, type Progress } from "../../core/api.ts"
import { checkFragment, labelActions } from "./formula.ts"
import { cacheKey, cacheRoot, discard, ENTRY_LPS, ENTRY_LTS, freshFolder, type LtsRecord, prune, publish, readEntry, sha256File } from "./lts-cache.ts"
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
}
interface VerifyResult {
  verdict: "holds" | "violated" | "error" | "unknown"
  output: string
  counterexample?: string
  details?: Record<string, unknown>
}
interface Verifier {
  id: string
  says: string
  runs: string[]
  verify(request: VerifyRequest, ctx: Context): Promise<VerifyResult>
  inputs(request: VerifyRequest, ctx: Context): string[]
  version(ctx: Context): Promise<string>
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
 * the states explored (`<n>st, <m>tr, explored …`), `pbessolve` the BES equations generated (`Generated <n> BES
 * equations`). Their counting lines come separated by carriage returns as well as newlines
 * (specs/progress-long-work-says-how-far, §6).
 */
export const COUNTING: Record<string, { unit: string; count(fragment: string): number | null }> = {
  lps2lts: { unit: "states", count: (f) => numberIn(/^(\d+)st, \d+tr, explored\b/, f) },
  pbessolve: { unit: "BES equations", count: (f) => numberIn(/^Generated (\d+) BES equations\b/, f) },
}

/** A counting tool's output without its counting lines: what the run keeps (§6). */
export function withoutCounting(tool: string, text: string): string {
  const c = COUNTING[tool]
  if (!c) return text
  return text.split(/\r\n|\r|\n/).filter((f) => c.count(f) === null).join("\n")
}

const TOOLS = ["mcrl22lps", "lps2pbes", "pbessolve", "lps2lts", "ltsinfo", "ltsconvert", "lts2pbes"] as const
type Tool = (typeof TOOLS)[number]

const INSTALL =
  "naima tools install mcrl2 installs mCRL2 202607.0 into Naima's own tools directory; or set plugins.verifier-mcrl2.options.bin to the directory of an mCRL2 installed otherwise"

/** The routes a property may take (§1). */
export const ROUTES = ["lps", "lts", "cross-check"] as const
export type Route = (typeof ROUTES)[number]

/** The equivalence the LTS route reduces modulo (§2, step 4). */
export const EQUIVALENCE = "dpbranching-bisim"

/** The arguments of the steps that make an LTS, beyond its files: part of the cache key. `--threads` changes no LTS, so it is not here. */
const RECIPE: LtsRecord["recipe"] = { mcrl22lps: [], lps2lts: [] }

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
 * Where a tool is: in `bin` when it is given; otherwise the mCRL2 `naima tools install mcrl2` installed on this
 * machine; otherwise its name, looked up on PATH.
 */
export function toolPath(tool: string, bin?: string): string {
  return bin ? join(bin, tool) : installedProgram(MCRL2, tool) ?? tool
}

/** A route's answer: a result with the details of how it was reached. */
type Outcome = VerifyResult & { details: Record<string, unknown> }

/** The adapter, its tools from `bin` (a directory), the installed mCRL2 or PATH, started by `run`. */
export function mcrl2Verifier(config: { bin?: string; run?: Runner } = {}): Verifier {
  const run = config.run ?? realRun
  const path = (tool: Tool): string => toolPath(tool, config.bin)
  const missing = (tool: Tool): string =>
    `tool missing: ${tool} is not ${config.bin ? `in ${config.bin}` : "installed by naima tools, nor on PATH"} — ${INSTALL}`

  /**
   * The steps of one route: each tool's output kept in the log, the tools it started remembered for their versions.
   * Each step is a stage of `progress`; a counting tool is started with `--verbose`, its counting lines read as the
   * stage's count and left out of the log (specs/progress-long-work-says-how-far, §6).
   */
  function steps(seconds: number | undefined, cwd: string, progress: Progress) {
    const log: string[] = []
    const used = new Set<Tool>()
    /** One step: its output kept in the log; a failure is the result to return. */
    const step = async (tool: Tool, given: string[], at = cwd): Promise<{ out: ToolRun } | { stop: VerifyResult }> => {
      const counting = COUNTING[tool]
      const args = counting ? ["--verbose", ...given] : given
      progress.stage(tool, undefined, counting?.unit)
      let pending = ""
      const onStderr = counting
        ? (chunk: string): void => {
          const fragments = (pending + chunk).split(/\r\n|\r|\n/)
          pending = fragments.pop() ?? ""
          for (const f of fragments) {
            const n = counting.count(f)
            if (n !== null) progress.at(n)
            else if (f.trim()) progress.note(f.trim())
          }
        }
        : undefined
      const raw = await run(path(tool), args, at, seconds ? seconds * 1000 : undefined, onStderr)
      const r = counting ? { ...raw, stderr: withoutCounting(tool, raw.stderr) } : raw
      if (r.missing) return { stop: { verdict: "error", output: [missing(tool), ...log].join("\n") } }
      used.add(tool)
      log.push(`$ ${tool} ${args.join(" ")}`, ...(shown(r) ? [shown(r)] : []))
      if (r.timedOut) return { stop: { verdict: "unknown", output: [...log, `${tool} did not finish in ${seconds} s`].join("\n") } }
      if (r.error) return { stop: { verdict: "error", output: [...log, `${tool} could not start: ${r.error}`].join("\n") } }
      if (r.exit !== 0) return { stop: { verdict: "error", output: [...log, `${tool} exited ${r.exit}`].join("\n") } }
      return { out: r }
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

  /** The standard route: the formula against the linearised model. */
  async function lpsRoute(model: string, formula: string, dir: string, seconds: number | undefined, progress: Progress): Promise<Outcome> {
    const s = steps(seconds, dir, progress)
    const done = async (r: VerifyResult): Promise<Outcome> => ({ ...r, details: { route: "lps", tools: await s.tools() } })
    const lps = join(dir, "model.lps")
    const pbes = join(dir, "model.pbes")
    const evidence = join(dir, "evidence.lps")
    for (const [tool, args] of [["mcrl22lps", [model, lps]], ["lps2pbes", ["--counter-example", `--formula=${formula}`, lps, pbes]]] as const) {
      const r = await s.step(tool, [...args])
      if ("stop" in r) return done(r.stop)
    }
    const solved = await s.step("pbessolve", [`--file=${lps}`, `--evidence-file=${evidence}`, pbes])
    if ("stop" in solved) return done(solved.stop)
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

  /** The LTS of the model, from the cache or generated into it (§4). */
  async function ltsOf(
    model: string,
    ctx: Context,
    s: ReturnType<typeof steps>,
    threads: number,
  ): Promise<{ stop: VerifyResult } | { dir: string; record: LtsRecord; reused: boolean }> {
    const version = await run(path("mcrl22lps"), ["--version"], workBase(ctx.program))
    if (version.missing) return { stop: { verdict: "error", output: missing("mcrl22lps") } }
    if (version.exit !== 0) return { stop: { verdict: "error", output: `mcrl22lps --version exited ${version.exit}: ${shown(version)}` } }
    const toolVersion = version.stdout.trim().split("\n")[0]!.trim()
    const rel = relative(ctx.root, model).split(sep).join("/")
    const inputs = [{ path: rel, sha256: sha256File(model) }]
    const key = cacheKey(inputs, toolVersion, RECIPE)
    const root = cacheRoot(workBase(ctx.program))
    const found = readEntry(root, key)
    if (found) {
      s.log.push(`LTS reused from the cache: ${key} (${found.record.states} states, ${found.record.transitions} transitions)`)
      return { ...found, reused: true }
    }
    if (existsSync(join(root, key))) discard(join(root, key))
    const folder = freshFolder(root)
    try {
      const lps = join(folder, ENTRY_LPS)
      const lts = join(folder, ENTRY_LTS)
      const started = Date.now()
      const threaded = threads > 1 ? [`--threads=${threads}`] : []
      for (const [tool, args] of [["mcrl22lps", [model, lps]], ["lps2lts", [...threaded, lps, lts]]] as const) {
        const r = await s.step(tool, [...args], folder)
        if ("stop" in r) return r
      }
      const generationSeconds = Math.round((Date.now() - started) / 100) / 10
      const info = await s.step("ltsinfo", ["--action-label", lts], folder)
      if ("stop" in info) return info
      const read = readLtsInfo(`${info.out.stdout}\n${info.out.stderr}`)
      if (!read) return { stop: { verdict: "error", output: [...s.log, "ltsinfo printed no number of states and transitions"].join("\n") } }
      const record: LtsRecord = {
        key,
        model: rel,
        inputs,
        toolVersion,
        recipe: RECIPE,
        ltsSha256: sha256File(lts),
        ...read,
        generationSeconds,
        at: new Date().toISOString(),
      }
      const entry = publish(root, folder, record)
      prune(root, key, rel)
      return { ...entry, reused: false }
    } finally {
      if (existsSync(folder)) discard(folder)
    }
  }

  /** The LTS route (§2): refused outside the fragment (§3), on the cached LTS, hidden and reduced per formula. */
  async function ltsRoute(
    model: string,
    formula: string,
    dir: string,
    ctx: Context,
    seconds: number | undefined,
    threads: number,
    progress: Progress,
  ): Promise<Outcome> {
    const s = steps(seconds, dir, progress)
    const details: Record<string, unknown> = { route: "lts" }
    const done = async (r: VerifyResult): Promise<Outcome> => ({ ...r, details: { ...details, tools: await s.tools() } })
    const refuse = (why: string): Promise<Outcome> =>
      done({
        verdict: "error",
        output: [`LTS route refused: ${why}.`, `Route "lps" decides this property by the standard route.`, ...s.log].join("\n"),
      })

    const fragment = checkFragment(readFileSync(formula, "utf8"))
    if (!fragment.ok) return refuse(`${fragment.reason} (specs/verifier-mcrl2-lts-route-cross-check, §3.1)`)
    details["mentioned"] = fragment.mentioned

    const lts = await ltsOf(model, ctx, s, threads)
    if ("stop" in lts) return done(lts.stop)
    const { record } = lts
    details["lts"] = {
      key: record.key,
      reused: lts.reused,
      states: record.states,
      transitions: record.transitions,
      generationSeconds: record.generationSeconds,
    }

    const mentioned = new Set(fragment.mentioned)
    const hidden = new Set<string>()
    for (const label of record.labels) {
      const names = labelActions(label)
      if (!names) return refuse(`the LTS label ${JSON.stringify(label)} cannot be read as a multi-action (§3.3)`)
      if (names.length > 1 && names.some((n) => !mentioned.has(n))) {
        return refuse(`the LTS label ${JSON.stringify(label)} joins a hidden action to another: hiding would change what the formula sees (§3.3)`)
      }
      for (const n of names) if (!mentioned.has(n)) hidden.add(n)
    }
    const hiddenNames = [...hidden].sort()
    details["hidden"] = hiddenNames

    const full = join(lts.dir, ENTRY_LTS)
    const reduced = join(dir, "reduced.lts")
    const tau = hiddenNames.length ? [`--tau=${hiddenNames.join(",")}`] : []
    const converted = await s.step("ltsconvert", [...tau, `--equivalence=${EQUIVALENCE}`, full, reduced])
    if ("stop" in converted) return done(converted.stop)
    const info = await s.step("ltsinfo", [reduced])
    if ("stop" in info) return done(info.stop)
    const size = readLtsInfo(`${info.out.stdout}\n${info.out.stderr}`)
    if (!size) return done({ verdict: "error", output: [...s.log, "ltsinfo printed no number of states and transitions"].join("\n") })
    details["reduced"] = { equivalence: EQUIVALENCE, states: size.states, transitions: size.transitions }

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

  async function check({ model, property, options, progress = NO_PROGRESS }: VerifyRequest, ctx: Context): Promise<VerifyResult> {
    const chosen = routeOf(options)
    if ("wrong" in chosen) return { verdict: "error", output: chosen.wrong }
    const threads = threadsOf(options)
    if (typeof threads === "string") return { verdict: "error", output: threads }
    const seconds = timeoutOf(options)
    const dir = mkdtempSync(join(workBase(ctx.program), "run-"))
    try {
      let formula = formulaFile(property, ctx.root)
      if (formula && !existsSync(formula)) return { verdict: "error", output: `the formula file ${property.trim()} does not exist` }
      if (!formula) writeFileSync(formula = join(dir, "property.mcf"), property.trim() + "\n")
      if (chosen.route === "lps") return await lpsRoute(model, formula, dir, seconds, progress)
      if (chosen.route === "lts") return await ltsRoute(model, formula, dir, ctx, seconds, threads, progress)
      const sub = (name: string): string => {
        const d = join(dir, name)
        mkdirSync(d)
        return d
      }
      const lps = await lpsRoute(model, formula, sub("lps"), seconds, { ...progress, stage: (n, t, u) => progress.stage(`lps: ${n}`, t, u) })
      const lts = await ltsRoute(model, formula, sub("lts"), ctx, seconds, threads, { ...progress, stage: (n, t, u) => progress.stage(`lts: ${n}`, t, u) })
      return crossCheck(lps, lts)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }

  return {
    id: "mcrl2",
    says:
      "an mCRL2 specification against a modal mu-calculus formula, inline or an .mcf file: by the standard route (mcrl22lps, lps2pbes, pbessolve), by the LTS route (the state space once per model, hidden and reduced per formula, lts2pbes, pbessolve) for a formula the reduction preserves, or both, cross-checked; the evidence is the counterexample",
    runs: TOOLS.map(path),
    verify: (request, ctx) => check(request, ctx),
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

/** The plugin, its tools started by `run`: tests replay recorded output through it. */
export function mcrl2Plugin(options: Record<string, unknown> = {}, run: Runner = realRun): Plugin {
  const bin = options["bin"]
  if (bin !== undefined && (typeof bin !== "string" || !isAbsolute(bin))) {
    throw new Error("verifier-mcrl2: bin must be an absolute path to the directory holding the mCRL2 tools")
  }
  return {
    name: "verifier-mcrl2",
    contract: CONTRACT,
    says: "the mCRL2 adapter: a property is a modal mu-calculus formula over an mCRL2 specification",
    about:
      "Off until `naima.json` names it under `plugins`, since it starts programs. Contributes the `mcrl2` verifier and the `mcrl2` tool. `model` is an mCRL2 specification; `property` is a modal mu-calculus formula, inline, or the path of an `.mcf` file from the project root, which is then an input of the run. " +
      "A property chooses its route in `verifierOptions.route`. `lps`, the default, is the standard route: `mcrl22lps`, `lps2pbes --counter-example`, and `pbessolve` with an evidence file: `true` holds; `false` is violated, and the evidence, printed by `lps2lts` as an `.aut` labelled transition system, is the counterexample; any other answer, or `verifierOptions.timeoutSeconds` reached by a step, is unknown. " +
      "`lts`, the LTS route, is for a model whose state space is small but whose data makes the standard route slow. The formula is first checked to be in the fragment that divergence-preserving branching bisimilarity preserves — every visible step right after a star over an action formula that includes tau, no single step that includes tau, fixpoints only as the four inevitability patterns — and refused otherwise, as an error run whose output begins `LTS route refused:`. Then `mcrl22lps` and `lps2lts` (with `--threads` from `verifierOptions.threads`) make the LTS once per model version, kept in the run work folder under a key over the model's contents, the toolset's version and the recipe, and shared by every property of that model; per formula, `ltsconvert` hides every action the formula does not mention and reduces modulo `dpbranching-bisim`; on the reduced LTS, `lts2pbes --counter-example` and one `pbessolve` with an evidence file decide; on false, the evidence, printed by `ltsconvert` as an `.aut` labelled transition system, is the counterexample, over the reduced LTS, where the hidden actions appear as tau. " +
      "`cross-check` runs both routes and gives a verdict only when they agree; a disagreement is an error whose output begins `the routes disagree:`. Each run records in its `details` the route, the version of every tool it started, and for the LTS route the LTS's key, reuse and size, the mentioned and hidden actions, the reduced size, and on false that the counterexample comes from the reduced LTS. " +
      "The tools are taken from `bin` when it is given, otherwise from the mCRL2 202607.0 that `naima tools install mcrl2` installed on this machine, otherwise from PATH; the plugin declares that tool, so `naima tools` reports it. A tool that is not there is an error run whose output begins `tool missing:`; a tool that fails is an error with its output. The version recorded is the first line of `mcrl22lps --version`.",
    options: [
      {
        name: "bin",
        says: "the absolute directory holding the mCRL2 tools; absent, the mCRL2 naima tools installed on this machine, then PATH",
        default: "installed, then PATH",
      },
    ],
    contributes: { verifiers: [mcrl2Verifier({ ...(typeof bin === "string" ? { bin } : {}), run })], tools: [MCRL2] },
    optional: ["verifiers", "tools"],
  }
}

export default function verifierMcrl2(options: Record<string, unknown> = {}): Plugin {
  return mcrl2Plugin(options)
}
