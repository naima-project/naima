// The point this plugin declares: an adapter to a formal-methods tool. Any
// plugin contributes one under `contributes.verifiers`; `naima verify` runs
// the one a property names.

import { code, type Context, type ExtensionPoint, type Progress, table } from "../../core/api.ts"

export interface VerifyRequest {
  /** Absolute path of the model or specification file. */
  model: string
  property: string
  options: Record<string, unknown>
  /** Where the adapter reports its stages and counts, when the tool exposes them (specs/progress-long-work-says-how-far, §6). Absent: nothing reports. */
  progress?: Progress
}

export type Verdict = "holds" | "violated" | "error" | "unknown"

export interface VerifyResult {
  verdict: Verdict
  output: string
  counterexample?: string
  /** How the verdict was reached — the route, the sizes, the tools' versions — as a JSON object the run record keeps. */
  details?: Record<string, unknown>
}

/** Two versions of one model, compared modulo an equivalence: a refactoring proved by equivalence. */
export interface CompareRequest {
  /** Absolute path of a copy of the model as the earlier runs read it. */
  before: string
  /** Absolute path of the model as it is now. */
  after: string
  /** One of the adapter's `equivalences`. */
  equivalence: string
  progress?: Progress
}

export interface CompareResult {
  /** `equivalent`: the results the equivalence preserves carry over; `different`: none does; `error`: no answer, and the output says why. */
  verdict: "equivalent" | "different" | "error"
  output: string
  /** On `different`: what tells the two versions apart, such as a formula one satisfies and the other does not. */
  counterexample?: string
  /** How the answer was reached — the sizes, the tools' versions — as a JSON object the carried runs keep. */
  details?: Record<string, unknown>
}

/** An adapter to a formal-methods tool. */
export interface Verifier {
  id: string
  says: string
  /**
   * The external programs `verify` starts (a model checker, say), by name on PATH or by absolute path. The launcher
   * grants the program exactly these besides git; a program not declared here cannot be started under it.
   */
  runs?: string[]
  verify(request: VerifyRequest, ctx: Context): Promise<VerifyResult>
  /**
   * Every file a run on this request reads — the model and whatever it includes — as absolute paths. The run record
   * keeps one digest over all of them and the tool version, so a change to any of them makes the verdict stale.
   * Absent: the model alone.
   */
  inputs?(request: VerifyRequest, ctx: Context): string[] | Promise<string[]>
  /** The version of the tool a run uses, recorded with the run; a property run by another version is stale. Absent: none recorded. */
  version?(ctx: Context): string | Promise<string>
  /** The equivalences `compare` decides, by name, each with what it preserves; the first is the default. Absent: it cannot compare. */
  equivalences?: Record<string, string>
  /** Compare two versions of a model modulo one of `equivalences`. */
  compare?(request: CompareRequest, ctx: Context): Promise<CompareResult>
  /** Why a result of `property` does not carry over modulo `equivalence`; null when it does. Absent: every result does. */
  preserves?(request: { property: string; options: Record<string, unknown>; equivalence: string }, ctx: Context): string | null
}

export const verifiersPoint: ExtensionPoint<Verifier> = {
  id: "verifiers",
  says:
    "an adapter to a formal-methods tool: `verify({ model, property, options }, ctx) → { verdict, output, counterexample?, details? }`; optionally `inputs(request, ctx)`, every file a run reads, and `version(ctx)`, the tool's version, both kept in the run's digest; and `equivalences` with `compare({ before, after, equivalence }, ctx) → { verdict, output, counterexample?, details? }` and `preserves({ property, options, equivalence }, ctx)`, for `naima equivalent`",
  noun: "verifier",
  stored: true,
  key: (v) => v.id,
  renamed: (v, id) => ({ ...v, id }),
  validate: (v) => {
    const a = v as Partial<Verifier> | null
    if (!a || typeof a !== "object" || typeof a.id !== "string") return "has no id"
    if (typeof a.verify !== "function") return "has no verify function"
    for (const k of ["inputs", "version", "compare", "preserves"] as const) {
      if (a[k] !== undefined && typeof a[k] !== "function") return `has a ${k} that is not a function`
    }
    const e = a.equivalences
    if (e !== undefined && (!e || typeof e !== "object" || Array.isArray(e) || !Object.values(e).every((s) => typeof s === "string"))) {
      return "has equivalences that are not an object of names to what each preserves"
    }
    if ((a.compare === undefined) !== (e === undefined || !Object.keys(e).length)) return "has compare without equivalences, or equivalences without compare"
    return null
  },
  gaps: (v) => (typeof v.says === "string" && v.says.trim() ? [] : ["does not say what it checks"]),
  document: (vs) => ["", "**Verifiers**, used by `naima verify`", ...table(["Verifier", "What it checks"], vs.map((v) => [code(v.id), v.says]))],
}
