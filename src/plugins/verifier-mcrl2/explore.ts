// `naima model-explore`: the state space of an mCRL2 specification, explored up to a bound, as data the Models tab steps
// on (develop/models-default-study.md §3.2, §3.4). The specification is linearised (mcrl22lps) and explored breadth first
// (lps2lts --max) into an .fsm file, whose parameter table carries each state's values; the result is that space as
// JSON. From a state (--from), the linearised process is printed (lpspp), its init replaced with the state's values and
// read back (txt2lps) before the exploration. The Models tab runs it under `naima run` with a time budget.

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { type Command, parse, positiveInt, progressFor, str, usageError } from "../../core/api.ts"

/** The space as the Models tab reads it: the states by their parameters' values, the start, the transitions. */
export interface Space {
  params: { name: string; sort: string }[]
  /** Each state's values, as mCRL2 prints them, by parameter name. */
  states: Record<string, string>[]
  initial: number
  edges: { from: number; to: number; label: string; kind: "input" | "output" }[]
  /** The bound was reached: more states exist than were explored. */
  truncated: boolean
  /** The states whose steps were not explored, when the space is cut at its bound. */
  edge: number[]
  bound: number
}

/** The default bound of an exploration (develop/models-default-study.md §3.4). */
export const BOUND = 20_000

const quotedValues = (text: string): string[] => {
  const out: string[] = []
  const re = /"((?:[^"\\]|\\.)*)"/g
  for (let m = re.exec(text); m; m = re.exec(text)) out.push(m[1]!.replace(/\\(.)/g, "$1"))
  return out
}

/**
 * The space of an .fsm file as lps2lts writes it: the parameter table (`name(n) Sort "v0" "v1" …`), the states (one
 * line of value indexes each, 0-based), the transitions (`from to "label"`, 1-based states). `bound` is the exploration's
 * bound, `cut` whether lps2lts said it stopped at it. Cut, the states explored are the first ones, breadth first: those
 * after the last state any transition leaves were found but not explored.
 */
export function parseFsm(text: string, bound: number, cut: boolean): Space {
  const sections = text.split(/^---\s*$/m)
  if (sections.length < 3) throw new Error("not an .fsm file: it has no --- separators")
  const params: { name: string; sort: string; values: string[] }[] = []
  for (const line of sections[0]!.split(/\r?\n/)) {
    if (!line.trim()) continue
    const m = /^(\S+?)\((\d+)\)\s+([^"]*?)\s*(".*)?$/.exec(line.trim())
    if (!m) throw new Error(`an .fsm parameter line that is not one: ${line}`)
    params.push({ name: m[1]!, sort: m[3]!.trim(), values: quotedValues(m[4] ?? "") })
  }
  const states: Record<string, string>[] = []
  for (const line of sections[1]!.split(/\r?\n/)) {
    if (!line.trim()) continue
    const ix = line.trim().split(/\s+/).map(Number)
    const s: Record<string, string> = {}
    params.forEach((p, i) => {
      s[p.name] = p.values[ix[i]!] ?? String(ix[i])
    })
    states.push(s)
  }
  const edges: Space["edges"] = []
  let explored = 0
  for (const line of sections[2]!.split(/\r?\n/)) {
    const m = /^\s*(\d+)\s+(\d+)\s+"((?:[^"\\]|\\.)*)"\s*$/.exec(line)
    if (!m) continue
    const from = Number(m[1]) - 1
    edges.push({ from, to: Number(m[2]) - 1, label: m[3]!.replace(/\\(.)/g, "$1"), kind: "input" })
    explored = Math.max(explored, from + 1)
  }
  const truncated = cut && explored < states.length
  const edge = truncated ? states.map((_, i) => i).filter((i) => i >= explored) : []
  return { params: params.map(({ name, sort }) => ({ name, sort })), states, initial: 0, edges, truncated, edge, bound }
}

/** The linearised process's text with its init replaced by the process at these values, in its parameters' order. */
export function withInit(lpsText: string, params: readonly string[], values: Readonly<Record<string, string>>): string {
  const proc = /^proc\s+(\w+)\s*\(/m.exec(lpsText)
  if (!proc) throw new Error("the linearised process has no proc line")
  const missing = params.filter((p) => values[p] === undefined)
  if (missing.length) throw new Error(`the state gives no value of ${missing.join(", ")}`)
  const init = `init ${proc[1]}(${params.map((p) => values[p]).join(", ")});`
  const at = lpsText.search(/^init\b/m)
  if (at < 0) throw new Error("the linearised process has no init")
  const end = lpsText.indexOf(";", at)
  return lpsText.slice(0, at) + init + lpsText.slice(end + 1)
}

/** What starts a tool: the verifier's runner and where its tools are. */
export interface ExploreTools {
  run: (
    program: string,
    args: string[],
    cwd: string,
    timeoutMs?: number,
    onStderr?: (chunk: string) => void,
    raiseStack?: boolean,
  ) => Promise<{ exit: number; stdout: string; stderr: string; missing?: boolean; error?: string }> | {
    exit: number
    stdout: string
    stderr: string
    missing?: boolean
    error?: string
  }
  path: (tool: string) => string
}

/** Explores `spec` up to `bound` states, from its init or from the state `from`; the tool's message when one fails. */
export async function exploreSpace(
  tools: ExploreTools,
  spec: string,
  bound: number,
  from: Readonly<Record<string, string>> | null,
  onStates: (n: number) => void = () => {},
): Promise<Space> {
  const work = mkdtempSync(join(tmpdir(), "naima-explore-"))
  try {
    const step = async (tool: string, args: string[], watch?: (chunk: string) => void, raise = false) => {
      const r = await tools.run(tools.path(tool), args, dirname(spec), undefined, watch, raise)
      if (r.missing) throw new Error(`${tool} is not installed: naima tools install mcrl2`)
      if (r.exit !== 0) throw new Error(`${tool} failed: ${(r.error ?? r.stderr).trim().split("\n").slice(-6).join("\n")}`)
      return r
    }
    const lps = join(work, "model.lps")
    await step("mcrl22lps", ["--quiet", spec, lps])
    if (from) {
      const txt = join(work, "model.txt")
      await step("lpspp", [lps, txt])
      // A state of a space lists the process's parameters in the order of its .fsm table, which is the process's own.
      writeFileSync(txt, withInit(readFileSync(txt, "utf8"), Object.keys(from), from))
      await step("txt2lps", [txt, lps])
    }
    const fsm = join(work, "model.fsm")
    let cut = false
    await step("lps2lts", ["--verbose", `--max=${bound}`, lps, fsm], (chunk) => {
      if (/Explored the maximum number/.test(chunk)) cut = true
      const m = /(\d+)st,/.exec(chunk.split("\n").filter((l) => /\d+st,/.test(l)).pop() ?? "")
      if (m) onStates(Number(m[1]))
    }, true)
    return parseFsm(readFileSync(fsm, "utf8"), bound, cut)
  } finally {
    rmSync(work, { recursive: true, force: true })
  }
}

export function modelExplore(tools: ExploreTools): Command {
  return {
    name: "model-explore",
    says: "explore an mCRL2 specification's state space up to a bound, from its init or from a given state, and write it as JSON: the Models tab steps on it",
    enforces: "nothing: it reads the specification and writes only the file --out names",
    usage: "model-explore <specification> --out <file.json> [--max <states>] [--from <state.json>]",
    long: {
      reports: "the stage (linearise, explore) and the states found so far, into the run's progress file under naima run",
    },
    options: [
      { name: "--out", says: "the JSON file the space is written to" },
      { name: "--max", says: `the most states explored, breadth first from the start (${BOUND} by default)` },
      { name: "--from", says: "a JSON file of a state's values by parameter, as a space gives them: the exploration starts there" },
    ],
    examples: ["model-explore model.mcrl2 --out space.json", "model-explore model.mcrl2 --out more.json --max 40000 --from state.json"],
    async run(args, ctx) {
      const p = parse(args, { out: { type: "string" }, max: { type: "string" }, from: { type: "string" } })
      const [spec] = p.positionals
      const out = str(p, "out")
      if (!spec || !out) throw usageError(this)
      const bound = positiveInt(str(p, "max"), BOUND, "model-explore --max")
      const fromFile = str(p, "from")
      const from = fromFile === undefined ? null : (JSON.parse(readFileSync(resolve(ctx.root, fromFile), "utf8")) as Record<string, string>)
      const progress = progressFor((l) => ctx.err(l))
      try {
        progress.stage("explore", bound, "states")
        const space = await exploreSpace(tools, resolve(ctx.root, spec), bound, from, (n) => progress.at(n))
        writeFileSync(resolve(ctx.root, out), JSON.stringify(space))
        ctx.out(`${space.states.length} states, ${space.edges.length} transitions${space.truncated ? `, cut at ${bound}` : ""}`)
        return 0
      } catch (e) {
        const why = e instanceof Error ? e.message : String(e)
        writeFileSync(resolve(ctx.root, out), JSON.stringify({ failed: why }))
        ctx.err(why)
        return 1
      } finally {
        progress.end()
      }
    },
  }
}
