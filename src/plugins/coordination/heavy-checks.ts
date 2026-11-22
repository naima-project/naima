// `naima heavy-checks`: the project's answer to when and where heavy checks run (a browser, a suite, model checking).
// The answer is the coordination option `heavyChecks`, and it sets `checks` (at every landing, or at a checkpoint) and the
// hosts (`landingHost`, `verifyHost`) with it, so that one command is the whole answer (src/core/heavy.ts holds the rule).
import { readFileSync } from "node:fs"
import { join } from "node:path"
import {
  type Command,
  type Context,
  DATA_FILE,
  HEAVY_OPTION,
  HEAVY_WHEN,
  heavyAnswer,
  heavyQuestion,
  type HeavyWhen,
  parse,
  rendered,
  str,
  type SummarySection,
  usageError,
  writeJson,
} from "../../core/api.ts"
import { startDue } from "./check-plan.ts"

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v)

/** Set (or, with undefined, remove) coordination options in naima.json, as the next load reads them. */
function writeOptions(ctx: Context, set: Record<string, string | boolean | undefined>): void {
  const file = join(ctx.trackerRoot, DATA_FILE)
  const raw = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>
  const plugins = isObject(raw["plugins"]) ? raw["plugins"] : {}
  const entry = isObject(plugins["coordination"]) ? plugins["coordination"] : {}
  const options: Record<string, unknown> = { ...(isObject(entry["options"]) ? entry["options"] : {}) }
  for (const [k, v] of Object.entries(set)) {
    if (v === undefined) delete options[k]
    else options[k] = v
  }
  writeJson(file, { ...raw, plugins: { ...plugins, coordination: { ...entry, enabled: entry["enabled"] ?? true, options } } })
}

const WHEN_SAYS: Record<HeavyWhen, string> = {
  landing: "at every landing",
  checkpoint: "at a checkpoint (a milestone or release)",
  demand: "only on demand (naima checkpoint, naima check --heavy)",
  off: "never: turned off",
}

export const heavyChecksCommand: Command = {
  name: "heavy-checks",
  says:
    "show or record when and where heavy checks run (a browser, a test suite, model checking): at every landing, at a checkpoint, only on demand, or never; Naima asks the owner first and runs none until the project has answered",
  enforces:
    "the answer is the owner's: an agent records it only after the owner chose; a project with a heavy check and no answer gets the question, never a run; the answer says where (this machine or a declared host) and how often, and `off` turns every heavy check off, which every start of one honours",
  usage: "heavy-checks [landing | checkpoint | demand --host <name | here> | off | pause | resume]",
  options: [{ name: "--host", says: "with landing, checkpoint or demand: the declared host the heavy checks run on, or `here` for this machine" }],
  examples: ["heavy-checks", "heavy-checks checkpoint --host here", "heavy-checks demand --host <host>", "heavy-checks off", "heavy-checks pause"],
  async run(args, ctx) {
    const p = parse(args, { host: { type: "string" } })
    const [when, ...rest] = p.positionals
    const host = str(p, "host")?.trim()
    // A pause holds every planned checkpoint and background run, and stops the one going without a result; resume lets them go on.
    if (when === "pause" || when === "resume") {
      if (rest.length || host !== undefined) throw usageError(this)
      writeOptions(ctx, { heavyChecksPaused: when === "pause" ? true : undefined })
      ctx.reload()
      if (when === "pause") {
        for (const l of await startDue(ctx, { paused: true })) if (l.startsWith("stopped")) ctx.out(l)
        ctx.out("heavy checks are paused: none starts, and the one going has stopped without a result; naima heavy-checks resume lets them go on")
      } else ctx.out("heavy checks go on: the point that is due starts when the place they run is idle")
      return 0
    }
    if (rest.length || (when !== undefined && !HEAVY_WHEN.includes(when as HeavyWhen))) throw usageError(this)
    if (when === undefined) {
      const a = heavyAnswer(ctx)
      if (!a) ctx.out(heavyQuestion())
      else {
        ctx.out(
          `heavy checks run ${WHEN_SAYS[a.when]}${a.when === "off" ? "" : ` on ${a.where === "here" ? "this machine" : a.where}`} (${
            a.how === "recorded" ? "recorded" : "implied by the project's check options"
          })`,
        )
        if (a.when !== "off") ctx.out("naima heavy-checks off turns them off; naima heavy-checks pause holds them for a while")
      }
      return 0
    }
    if (when === "off") {
      if (host !== undefined) throw usageError(this)
      writeOptions(ctx, { [HEAVY_OPTION]: "off" })
      ctx.out("heavy checks are off: none runs, however it is asked; naima heavy-checks landing | checkpoint | demand --host <name | here> turns them on")
      return 0
    }
    if (!host) throw new Error("say where heavy checks run: --host <declared host name>, or --host here for this machine")
    writeOptions(ctx, {
      [HEAVY_OPTION]: when,
      checks: when === "landing" ? "continuous" : "checkpoint",
      landingHost: host,
      verifyHost: host,
    })
    ctx.out(`heavy checks now run ${WHEN_SAYS[when as HeavyWhen]} on ${host === "here" ? "this machine" : host}; naima heavy-checks off turns them off`)
    return 0
  },
}

/** What naima hello says while the project has a heavy landing check and has not answered. */
export const heavyChecksSection: SummarySection = {
  name: "heavy-checks",
  hello: true,
  render: (ctx) => {
    const heavy = ctx.registry.contributions("landing-reports").some((c) => (c.value as { heavy?: boolean }).heavy === true)
    let say: string[] = []
    try {
      if (heavy && !heavyAnswer(ctx)) say = [`Heavy checks are not agreed yet: none runs until the owner answers. ${heavyQuestion()}`]
    } catch {
      // a malformed option is reported where it is read
    }
    return rendered(say, (l) => l)
  },
}
