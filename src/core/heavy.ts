// Heavy checks are agreed with the user: a check that opens a browser, runs a suite or model-checks costs the user's
// machines and time, so where they run and how often is the user's choice, recorded in the coordination option
// `heavyChecks` (set with `naima heavy-checks`). A project that has not answered gets the question, never a run.
import { option } from "./checkpoints.ts"
import type { Context } from "./types.ts"

/** The coordination option that records how often heavy checks run. */
export const HEAVY_OPTION = "heavyChecks"

/** When heavy checks run: at every landing, at a checkpoint (a milestone or release), only when someone asks, or never. */
export const HEAVY_WHEN = ["landing", "checkpoint", "demand", "off"] as const
export type HeavyWhen = (typeof HEAVY_WHEN)[number]

export interface HeavyAnswer {
  when: HeavyWhen
  /** `recorded` by naima heavy-checks, or `implied` by options the project already set (checks, a landing host, checkpoint runs). */
  how: "recorded" | "implied"
  /** The declared host they run on, or `here`: this machine. */
  where: string
}

const named = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v.trim() : undefined)

/**
 * The project's answer, or null when it has not answered. An option `heavyChecks` is the answer; without it, a project
 * that already chose how it runs its checks (the option `checks`, a landing host, a verify host, checkpoint runs or
 * fast checks) has answered by that, so that no existing project stops running what it chose to run.
 */
export function heavyAnswer(ctx: Context, at?: Context): HeavyAnswer | null {
  const where = named(option(ctx, "landingHost", at)) ?? named(option(ctx, "verifyHost", at)) ?? "here"
  const v = option(ctx, HEAVY_OPTION, at)
  if (v !== undefined && v !== "") {
    if (!HEAVY_WHEN.includes(v as HeavyWhen)) throw new Error(`the coordination option ${HEAVY_OPTION} is ${HEAVY_WHEN.join(", ")}, not ${JSON.stringify(v)}`)
    return { when: v as HeavyWhen, how: "recorded", where }
  }
  const checks = option(ctx, "checks", at)
  if (checks === "checkpoint") return { when: "checkpoint", how: "implied", where }
  const chose = checks === "continuous" ||
    ["landingHost", "verifyHost", "fastChecks"].some((o) =>
      named(option(ctx, o, at)) !== undefined || (Array.isArray(option(ctx, o, at)) && (option(ctx, o, at) as unknown[]).length > 0)
    ) ||
    (Array.isArray(option(ctx, "checkpointRuns", at)) && (option(ctx, "checkpointRuns", at) as unknown[]).length > 0)
  return chose ? { when: "landing", how: "implied", where } : null
}

/** The question the owner is asked, and how the answer is recorded. */
export const heavyQuestion = (): string =>
  "Heavy checks (a browser, a test suite, model checking) cost this machine's time, so the owner chooses where they run (this machine, or a declared host) and how often " +
  "(at every landing, at a checkpoint at a milestone or release, or only on demand); they can also be turned off. Ask the owner, then record the answer: " +
  "naima heavy-checks landing | checkpoint | demand --host <name | here>, or naima heavy-checks off"

/** Who starts a heavy check: a landing, a checkpoint a gate step or a goal starts by itself, or a person's own command (naima checkpoint, naima check --heavy). */
export type HeavyUse = "landing" | "automatic-checkpoint" | "explicit"

export type HeavyVerdict = { run: true } | { run: false; why: string; owe: boolean }

/** Whether a heavy check may run now, for this use, as the project agreed; when it may not, why, and whether it is owed to a later run. */
export function heavyVerdict(ctx: Context, use: HeavyUse, at?: Context): HeavyVerdict {
  const a = heavyAnswer(ctx, at)
  if (!a) return { run: false, why: `not run: the project has not agreed when heavy checks run. ${heavyQuestion()}`, owe: true }
  if (a.when === "off") {
    return {
      run: false,
      why: "not run: heavy checks are turned off (naima heavy-checks landing | checkpoint | demand --host <name | here> turns them on)",
      owe: false,
    }
  }
  if (use === "explicit") return { run: true }
  if (use === "landing") {
    return a.when === "landing" ? { run: true } : {
      run: false,
      why: `owed, not run on this landing: heavy checks run ${a.when === "checkpoint" ? "at a checkpoint" : "on demand"} (naima heavy-checks)`,
      owe: true,
    }
  }
  return a.when === "checkpoint"
    ? { run: true }
    : { run: false, why: `not run: heavy checks run ${a.when === "demand" ? "on demand" : "at every landing"}`, owe: false }
}
