// The naima-codegen adapter: a property item whose verifier is `naima-codegen`
// is decided by naima-codegen (https://github.com/naima-project/naima-codegen),
// the public tool that writes a model's state machine as code. Its `model` is
// the codegen project's `codegen.toml`; the project is that file's directory
// (or the one above, for a `model/codegen.toml`), or `verifierOptions.project`.
// Its `property` is one of:
//
//   refines        naima-codegen check-refinement [--no-model] [group...]
//                  the generated machine stays inside the model: every check holds
//   properties     naima-codegen check-refinement --properties [group...]
//                  every property item of the codegen project holds on the refined systems
//   <file>.mcf     the same run, judged on that one property file of the codegen project
//
// The tool prints one line per check, `<group> §<section> <check>: holds` or
// `FAILS …` (an observer: `FIRED …`), and exits 1 when one fails; a project it
// cannot read is `refused` with its problems, an error. The run reads every
// file of the codegen project — the model, the policy, `codegen.toml`, the
// properties and the generated code — so a change to any of them, a
// regeneration included, makes the verdict stale.
//
// naima-codegen is found on PATH: `naima tools` does not install it. The
// launcher grants it to `naima verify` alone (launcher.ts, `uiGrant`), so this
// first-party adapter adds no program to any other command.

import { spawn } from "node:child_process"
import { existsSync, statSync } from "node:fs"
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path"
import { type Context, message, NO_PROGRESS, projectFiles } from "../../../core/api.ts"
import type { Verifier, VerifyRequest, VerifyResult } from "../contract.ts"

/** The program, by name on PATH: what the launcher grants `naima verify`. */
export const CODEGEN_PROGRAM = "naima-codegen"

/** Where naima-codegen comes from: it is installed from its repository, never by naima tools. */
export const CODEGEN_REPOSITORY = "https://github.com/naima-project/naima-codegen"

const MISSING =
  `tool missing: ${CODEGEN_PROGRAM} is not on PATH — naima tools does not install it: clone ${CODEGEN_REPOSITORY} and put its ${CODEGEN_PROGRAM} script on PATH (it needs Python 3.11 or later and the mCRL2 toolset the model pins)`

/** What one run of the program gave. */
export interface CodegenRun {
  exit: number
  stdout: string
  stderr: string
  missing?: boolean
  timedOut?: boolean
  error?: string
}

/** Starts the program: the real one spawns it; `onLine` is given each line of its standard output as it comes. */
export type CodegenRunner = (program: string, args: string[], cwd: string, timeoutMs?: number, onLine?: (line: string) => void) => Promise<CodegenRun>

export const realCodegenRun: CodegenRunner = (program, args, cwd, timeoutMs, onLine) =>
  new Promise<CodegenRun>((done) => {
    let settled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const finish = (r: CodegenRun): void => {
      if (settled) return
      settled = true
      if (timer !== undefined) clearTimeout(timer)
      done(r)
    }
    let child: ReturnType<typeof spawn>
    try {
      child = spawn(program, args, { cwd, env: { ...process.env, NO_COLOR: "1" }, stdio: ["ignore", "pipe", "pipe"], windowsHide: true })
    } catch (e) {
      finish({ exit: -1, stdout: "", stderr: "", error: message(e) })
      return
    }
    let stdout = ""
    let stderr = ""
    let pending = ""
    let timedOut = false
    child.stdout!.setEncoding("utf8")
    child.stderr!.setEncoding("utf8")
    child.stdout!.on("data", (c: string) => {
      stdout += c
      const lines = (pending + c).split(/\r?\n/)
      pending = lines.pop() ?? ""
      for (const l of lines) onLine?.(l)
    })
    child.stderr!.on("data", (c: string) => (stderr += c))
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
    child.once("close", (code: number | null) => finish(timedOut ? { exit: -1, stdout, stderr, timedOut: true } : { exit: code ?? -1, stdout, stderr }))
  })

/** The properties this adapter decides besides a property file: the refinement, and every property item of the project. */
export const REFINES = "refines"
export const PROPERTIES = "properties"

/** One line of a check, as the tool prints it: `<group> §<section> <check>: <result>`, or the observers' line. */
export interface CheckLine {
  group: string
  check: string
  result: string
  fails: boolean
}

// The tool's report is one flat line per check, with no nesting: a pattern is the right reader.
const CHECK = /^(\S+) (§3\.9\.\d+ .+?|observers on the refined system): (.*)$/

/** The check lines of the tool's output, each with whether it failed. */
export function checkLines(stdout: string): CheckLine[] {
  const out: CheckLine[] = []
  for (const line of stdout.split(/\r?\n/)) {
    const m = CHECK.exec(line.trim())
    if (!m) continue
    const [, group, check, result] = m as unknown as [string, string, string, string]
    out.push({ group, check, result, fails: /^(FAILS|FIRED)\b/.test(result) || /: lts2pbes failed/.test(line) })
  }
  return out
}

/** The codegen project's directory, from the root: `verifierOptions.project`, or where `codegen.toml` is. */
function projectOf(model: string, options: Record<string, unknown>, root: string): { dir: string } | { wrong: string } {
  const given = options["project"]
  if (given !== undefined) {
    if (typeof given !== "string" || isAbsolute(given)) return { wrong: "verifierOptions.project must be a directory, from the project root" }
    const dir = resolve(root, given)
    const rel = relative(root, dir)
    if (rel.startsWith("..") || isAbsolute(rel)) return { wrong: `verifierOptions.project ${given} is outside the project` }
    if (!existsSync(dir) || !statSync(dir).isDirectory()) return { wrong: `verifierOptions.project ${given} is not a directory` }
    return { dir }
  }
  const here = dirname(model)
  // codegen.toml may live at <project>/model/codegen.toml; then the model directory is `model` (naima-codegen spec §3.6.9).
  return { dir: basename(here) === "model" && !existsSync(join(dirname(here), "codegen.toml")) ? dirname(here) : here }
}

/** The groups named in `verifierOptions.group`: none means every group. */
function groupsOf(options: Record<string, unknown>): string[] | string {
  const g = options["group"]
  if (g === undefined) return []
  const list = typeof g === "string" ? [g] : g
  if (!Array.isArray(list) || !list.every((x) => typeof x === "string" && /^[\w-]+$/.test(x))) {
    return "verifierOptions.group must be a group name or a list of them"
  }
  return list as string[]
}

const shown = (r: CodegenRun): string => [r.stdout.trim(), r.stderr.trim()].filter(Boolean).join("\n")

/** The adapter, its program started by `run`: tests start a fake one on PATH. */
export function codegenVerifier(config: { run?: CodegenRunner; program?: string } = {}): Verifier {
  const run = config.run ?? realCodegenRun
  const program = config.program ?? CODEGEN_PROGRAM

  async function check({ model, property, options, progress = NO_PROGRESS }: VerifyRequest, ctx: Context): Promise<VerifyResult> {
    const wanted = property.trim()
    const file = wanted !== REFINES && wanted !== PROPERTIES ? wanted : null
    if (file !== null && !/\.mcf$/.test(file)) {
      return {
        verdict: "error",
        output: `property must be "${REFINES}", "${PROPERTIES}" or the .mcf file of one of the codegen project's properties, not ${JSON.stringify(wanted)}`,
      }
    }
    const project = projectOf(model, options, ctx.root)
    if ("wrong" in project) return { verdict: "error", output: project.wrong }
    const groups = groupsOf(options)
    if (typeof groups === "string") return { verdict: "error", output: groups }
    const t = options["timeoutSeconds"]
    const seconds = typeof t === "number" && t > 0 ? t : undefined
    const args = [
      "check-refinement",
      "--project",
      project.dir,
      ...(wanted === REFINES ? (options["noModel"] === true ? ["--no-model"] : []) : ["--properties"]),
      ...groups,
    ]
    progress.stage("check-refinement", undefined, "checks")
    let seen = 0
    const r = await run(program, args, ctx.root, seconds ? seconds * 1000 : undefined, (line) => {
      if (CHECK.test(line.trim())) progress.at(++seen)
      else if (line.trim()) progress.note(line.trim())
    })
    if (r.missing) return { verdict: "error", output: MISSING }
    const log = [`$ ${CODEGEN_PROGRAM} ${args.map((a) => (a === project.dir ? relative(ctx.root, a).split(sep).join("/") || "." : a)).join(" ")}`, shown(r)]
      .filter(Boolean).join("\n")
    if (r.error) return { verdict: "error", output: `${log}\n${CODEGEN_PROGRAM} could not start: ${r.error}` }
    if (r.timedOut) return { verdict: "unknown", output: `${log}\n${CODEGEN_PROGRAM} did not finish in ${seconds} s` }
    const lines = checkLines(r.stdout)
    const details: Record<string, unknown> = {
      check: wanted === REFINES ? "refinement" : "properties",
      project: relative(ctx.root, project.dir).split(sep).join("/") || ".",
      groups: groups.length ? groups : "every group",
      checks: lines.map(({ group, check, result }) => ({ group, check, result })),
    }
    const done = (verdict: VerifyResult["verdict"], output = log, counterexample?: string): VerifyResult => ({
      verdict,
      output,
      details,
      ...(counterexample !== undefined ? { counterexample } : {}),
    })
    if (/: refused, \d+ problems?/.test(r.stderr)) return done("error", `refused: naima-codegen cannot read the project; its problems:\n${log}`)
    if (r.exit === 2) return done("error", `${log}\n${CODEGEN_PROGRAM} exited 2: it did not accept the command line`)

    // The lines this property is judged on: every one, or those of its one property file.
    const judged = file === null ? lines : lines.filter((l) => l.check.startsWith("§3.9.4 ") && l.check.slice("§3.9.4 ".length) === file)
    if (wanted !== REFINES && !judged.some((l) => l.check.startsWith("§3.9.4 "))) {
      return done(
        "error",
        `${log}\n${
          file === null ? "no property was checked" : `no property item of the codegen project has the file ${file}`
        }: a codegen property item names it, with "verifier": "mcrl2" and its group (naima-codegen spec §3.6.9)`,
      )
    }
    const failed = judged.filter((l) => l.fails)
    // A property the model checker could not decide is no counterexample: only `FAILS (false)` refutes it.
    const undecided = failed.filter((l) => l.check.startsWith("§3.9.4 ") && !/^FAILS \(false\)/.test(l.result))
    if (undecided.length) return done("error", `${log}\n${undecided.map((l) => `${l.group} ${l.check}: not decided`).join("\n")}`)
    if (failed.length) return done("violated", log, failed.map((l) => `${l.group} ${l.check}: ${l.result}`).join("\n"))
    if (file !== null) return done("holds")
    if (r.exit !== 0 || !judged.length) return done("error", `${log}\n${CODEGEN_PROGRAM} exited ${r.exit} with no failing check`)
    return done("holds")
  }

  return {
    id: "naima-codegen",
    says:
      'a naima-codegen project, its codegen.toml the model: "refines" runs check-refinement, that the generated machine stays inside the model; "properties", or one property\'s .mcf file, runs check-refinement --properties on the refined systems; every file of the project is an input',
    verify: (request, ctx) => check(request, ctx),
    inputs: ({ model, options }, ctx) => {
      const project = projectOf(model, options, ctx.root)
      if ("wrong" in project) return [model]
      const prefix = relative(ctx.root, project.dir).split(sep).join("/")
      return projectFiles(ctx.root, ctx.program).filter((f) => !prefix || f.startsWith(`${prefix}/`)).map((f) => resolve(ctx.root, f))
    },
    version: async (ctx) => {
      const r = await run(program, ["--version"], ctx.root)
      if (r.missing) throw new Error(MISSING)
      if (r.error) throw new Error(`${CODEGEN_PROGRAM} could not start: ${r.error}`)
      // A naima-codegen with no --version answers with its usage: the generator's own digest is then in generated/MANIFEST.json, an input of the run.
      return r.exit === 0 && r.stdout.trim() ? r.stdout.trim().split("\n")[0]!.trim() : `${CODEGEN_PROGRAM} (no --version: see generated/MANIFEST.json)`
    },
  }
}

export const naimaCodegen: Verifier = codegenVerifier()
