// Which rewriter lps2lts explores with: jitty, interpreted, or jittyc, the
// same rewrite system compiled to C++ first. Both give the same normal forms,
// so the same LTS and the same verdict; jittyc explores many times faster but
// first spends minutes compiling. `auto`, the default, weighs one against the
// other on what the last runs of the same model measured, kept per model in
// the run work folder (timings.json).
//
// The compiled rewriter cannot be kept from one run to the next: the C++ that
// mCRL2 202607.0 generates names the addresses of terms in the memory of the
// process that generated it, so a library compiled for one run is wrong for
// any other. Each jittyc run compiles again, and that compile time is what an
// exploration must outlast.
//
// The choice is a function of one stored record and needs no model of its own
// (a waiver of the model-first check says so): it reads the last jitty
// exploration time and the last compile time, and only a jitty run updates the
// first, so once jittyc is chosen the choice stays until the model's jitty
// time is measured again.

import { existsSync, readFileSync } from "node:fs"
import { delimiter, join } from "node:path"
import { writeJson } from "../../core/api.ts"

export const REWRITERS = ["auto", "jitty", "jittyc"] as const
export type RewriterOption = (typeof REWRITERS)[number]
export type Rewriter = "jitty" | "jittyc"

/** The compile time assumed before one was measured on this host: the low end of the 4 to 6 minutes measured on a large generated model. */
export const COMPILE_ESTIMATE_SECONDS = 240

/** What the work folder keeps of one model's explorations on this host. */
export interface Timings {
  /** The last exploration with jitty: its seconds and states. */
  jitty?: { exploreSeconds: number; states: number; at: string }
  /** The last exploration with jittyc, its compile time apart. */
  jittyc?: { exploreSeconds: number; states: number; at: string }
  /** The last compile time of the rewriter for this model, as lps2lts printed it. */
  compileSeconds?: number
}

/** The rewriter chosen, and why, in words the run's output and record keep. */
export interface Choice {
  rewriter: Rewriter
  why: string
}

/**
 * The rewriter for one exploration. `asked` is the item's `verifierOptions.rewriter`; `unavailable` says why jittyc
 * cannot run on this host, or is null when it can; `past` is what the earlier runs of the model measured.
 */
export async function chooseRewriter(
  asked: RewriterOption,
  unavailable: () => string | null | Promise<string | null>,
  past: Timings | undefined,
): Promise<Choice> {
  if (asked === "jitty") return { rewriter: "jitty", why: "verifierOptions.rewriter asks for jitty" }
  if (asked === "jittyc") {
    const no = await unavailable()
    return no
      ? { rewriter: "jitty", why: `verifierOptions.rewriter asks for jittyc, but ${no}: jitty instead` }
      : { rewriter: "jittyc", why: "verifierOptions.rewriter asks for jittyc" }
  }
  const explored = past?.jitty?.exploreSeconds
  if (explored === undefined) return { rewriter: "jitty", why: "no earlier jitty exploration of this model to weigh the compile time against" }
  const compile = past?.compileSeconds
  const against = compile !== undefined
    ? `the compile time measured, ${compile} s`
    : `the compile time estimated, ${COMPILE_ESTIMATE_SECONDS} s, none measured yet`
  if (explored <= (compile ?? COMPILE_ESTIMATE_SECONDS)) {
    return { rewriter: "jitty", why: `the last jitty exploration took ${explored} s, no longer than ${against}` }
  }
  const no = await unavailable()
  if (no) return { rewriter: "jitty", why: `the last jitty exploration took ${explored} s, longer than ${against}, but ${no}: jitty instead` }
  return { rewriter: "jittyc", why: `the last jitty exploration took ${explored} s, longer than ${against}` }
}

/** The C++ compiler mCRL2's compile script would find: `CXX`, else c++, clang++ or g++ on PATH; null when there is none. */
export function cxxCompiler(env: Record<string, string | undefined> = process.env, exists: (p: string) => boolean = existsSync): string | null {
  if (env["CXX"]) return env["CXX"]!
  const dirs = (env["PATH"] ?? "").split(delimiter).filter(Boolean)
  const suffixes = process.platform === "win32" ? [".exe", ""] : [""]
  for (const name of ["c++", "clang++", "g++"]) {
    for (const d of dirs) for (const s of suffixes) if (exists(join(d, name + s))) return join(d, name + s)
  }
  return null
}

/**
 * Why jittyc cannot run on this host, or null when it can: the toolset's `lps2lts --help` must list it (the Windows
 * build does not), and a C++ compiler must be there for its compile script.
 */
export function jittycUnavailable(help: string, compiler: string | null): string | null {
  if (!/\bjittyc\b/.test(help)) return "this mCRL2 build has no compiled rewriter (lps2lts --help lists no jittyc)"
  if (!compiler) return "no C++ compiler is on this host (CXX, c++, clang++ or g++ on PATH)"
  return null
}

/** The compile time lps2lts printed with `--verbose` (`compiled in <n>ms`), in seconds; undefined when it printed none. */
export function compileSecondsIn(text: string): number | undefined {
  const m = /compiled in (\d+)\s*ms/.exec(text)
  return m ? Math.round(Number(m[1]) / 100) / 10 : undefined
}

const TIMINGS = "timings.json"

/** Every model's timings kept in the work folder `work`, by the model's path from the project root. */
export function readTimings(work: string): Record<string, Timings> {
  try {
    const t = JSON.parse(readFileSync(join(work, TIMINGS), "utf8")) as unknown
    return t && typeof t === "object" && !Array.isArray(t) ? (t as Record<string, Timings>) : {}
  } catch {
    return {}
  }
}

/** Record one exploration of `model`: the last run of each rewriter and the compile time replace the earlier ones. */
export function recordTimings(
  work: string,
  model: string,
  rewriter: Rewriter,
  run: { exploreSeconds: number; states: number; compileSeconds?: number | undefined; at: string },
): void {
  const all = readTimings(work)
  const t: Timings = { ...all[model] }
  t[rewriter] = { exploreSeconds: run.exploreSeconds, states: run.states, at: run.at }
  if (run.compileSeconds !== undefined) t.compileSeconds = run.compileSeconds
  all[model] = t
  try {
    writeJson(join(work, TIMINGS), all)
  } catch {
    // The timings only inform the next choice: a folder that cannot be written leaves it to jitty.
  }
}
