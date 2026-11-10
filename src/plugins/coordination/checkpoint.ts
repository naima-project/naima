// `naima checkpoint`: run the checks the landings since the last checkpoint owed, and the project's heavy ones, on the current tip.
import {
  checkpointChecks,
  type Command,
  type Context,
  currentBranch,
  gitOrNull,
  lastPass,
  owedSince,
  parse,
  usageError,
  writeCheckpoint,
} from "../../core/api.ts"
import { type LandingReport } from "./land.ts"
import { landingChecks } from "./land.ts"

/** git's empty tree: what a first checkpoint measures the changed files from. */
const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904"

/** The names of the landing checks a checkpoint runs: what landings owe, and the declared ones (the heavy ones when none are declared). */
export function checkpointNames(ctx: Context): string[] {
  const all = ctx.registry.contributions("landing-reports").filter((c) => {
    const v = c.value as LandingReport
    return !!v.refuses || !!v.blocks
  })
  const declared = checkpointChecks(ctx)
  const standing = declared.length ? declared : all.filter((c) => (c.value as LandingReport).heavy).map((c) => c.name)
  const names = [...owedSince(ctx).names, ...standing]
  return all.map((c) => c.name).filter((n, i, l) => names.includes(n) && l.indexOf(n) === i)
}

export const checkpointCommand: Command = {
  name: "checkpoint",
  says:
    "run every landing check the landings since the last checkpoint owed, plus the project's heavy ones (suites and model checks), on the current tip, and record a pass, or a failure that blocks the gate",
  enforces:
    "runs the checks named by the Checks-owed: trailers of the landings since the last passing checkpoint and by the coordination option checkpointChecks (every heavy landing check when it is empty), each as naima land would, heavy ones through naima run on the landing host; writes one record in the data directory's checkpoints/; exit 0 on a pass, 1 on a failure, and a failed checkpoint blocks the gate it names (or every gate, when it names none) until a later one passes",
  usage: "checkpoint [<gate>]",
  examples: ["checkpoint", "checkpoint release-1.2"],
  async run(args, ctx) {
    const p = parse(args, {})
    if (p.positionals.length > 1) throw usageError(this)
    const gate = p.positionals[0]
    if (gate && !ctx.registry.find("gates", gate)) throw new Error(`no gate "${gate}"`)
    const tip = gitOrNull(ctx.root, "rev-parse", "HEAD")
    const tracker = gitOrNull(ctx.trackerGit, "rev-parse", "HEAD")
    if (!tip || !tracker) throw new Error("no commit to run a checkpoint on")
    const names = checkpointNames(ctx)
    const last = lastPass(ctx)
    const from = last && gitOrNull(ctx.root, "cat-file", "-e", `${last.tip}^{commit}`) !== null ? last.tip : EMPTY_TREE
    const changed = (gitOrNull(ctx.root, "diff", "--name-only", "--no-renames", "-z", from, tip) ?? "").split("\0").filter(Boolean)
    ctx.out(`checkpoint on ${tip.slice(0, 12)}: ${names.length ? names.join(", ") : "no landing check owed or declared"}`)
    const { refused, notCurrent } = await landingChecks(ctx, { branch: currentBranch(ctx.root) ?? "HEAD", from, to: tip, changed }, ctx, names)
    const failed = [...refused, ...notCurrent.map((l) => `${l} — not current`)]
    writeCheckpoint(ctx, { on: ctx.now().toISOString(), tip, tracker, ...(gate ? { gate } : {}), passed: failed.length === 0, ran: names, failed })
    if (failed.length) {
      ctx.out(
        `checkpoint FAILED, ${failed.length} finding${failed.length === 1 ? "" : "s"}; it blocks ${
          gate ? `gate ${gate}` : "every gate"
        } until a later checkpoint passes:`,
      )
      for (const l of failed) ctx.out(`  ✗ ${l}`)
      return 1
    }
    ctx.out(`checkpoint passed: ${names.length} check${names.length === 1 ? "" : "s"} on ${tip.slice(0, 12)}; nothing is owed now`)
    return 0
  },
}
