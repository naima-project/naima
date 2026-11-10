// `naima checkpoint`: run the checks the landings since the last checkpoint owed, and the project's heavy ones, on the current tip.
import {
  bool,
  checkpointChecks,
  type CheckpointRecord,
  checkpointRuns,
  type Command,
  type Context,
  contextIn,
  currentBranch,
  gitOrNull,
  isAncestor,
  lastPass,
  owedSince,
  parse,
  readCheckpoints,
  usageError,
  verifyHost,
  writeCheckpoint,
} from "../../core/api.ts"
import { type LandingReport } from "./land.ts"
import { EMPTY_TREE, landingChecks } from "./land.ts"
import { settle, startRuns, statusLines } from "./checkpoint-runs.ts"

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

/** Wait for every run of the record that is still going, then settle it. */
async function waitFor(ctx: Context, id: string): Promise<CheckpointRecord> {
  const wait = ctx.registry.commands.get("wait")
  let record = readCheckpoints(ctx).find((r) => r.id === id)!
  for (const r of record.runs ?? []) {
    if (r.state === "running" && wait) {
      await wait.run([r.run, "--timeout", "6h", "--tail", "1"], contextIn(ctx, ctx.root, { out: () => {}, err: () => {}, now: ctx.now }))
    }
  }
  record = await settle(ctx, record)
  return record
}

/**
 * A gate that has a line is checkpointed in a checkout of that line: the options checkpointRuns and verifyHost, the
 * properties and their models are the line's own, and the trunk's tip lacks them. Throws when the checkout is not on the line
 * (nor on a branch that holds its tip).
 */
function refuseOffLine(ctx: Context, gate: string): void {
  const line = `line/${gate}`
  const tip = gitOrNull(ctx.root, "rev-parse", "--verify", "--quiet", `refs/heads/${line}^{commit}`)
  if (!tip) return
  if (currentBranch(ctx.root) === line || isAncestor(ctx.root, tip, "HEAD")) return
  throw new Error(
    `${gate} has a line, ${line}, and a checkpoint checks the checkout it runs in, which is not on it: run naima checkpoint ${gate} in a checkout of the line ` +
      `(git worktree add <folder> ${line}), where its options and properties are`,
  )
}

export const checkpointCommand: Command = {
  name: "checkpoint",
  says:
    "run every landing check the landings since the last checkpoint owed, plus the project's heavy ones, and start the project's suites and the verification of every property not current in the background; record a pass, or a failure that blocks the gate",
  enforces:
    "runs the checks named by the Checks-owed: trailers of the landings since the last passing checkpoint and by the coordination option checkpointChecks (every heavy landing check when it is empty), each as naima land would, heavy ones through naima run on the landing host; starts, through naima run and in the background, each command of the coordination option checkpointRuns (on its own host when it names one) and naima verify of every property that is not current, on the coordination option verifyHost; writes one record in the data directory's checkpoints/, pending while those runs go; naima checkpoint --status reads each run, and when all are over settles the record: a pass, or a failure that names each failing run, files or updates a bug for it, and blocks the gate it names (or every gate, when it names none) until a later checkpoint passes; exit 0 on a pass or a started checkpoint, 1 on a failure",
  usage: "checkpoint [<gate>] [--wait] | checkpoint --status",
  options: [
    { name: "--status", says: "read the runs of the latest checkpoint, settle it when they are over, and print each run's state and what is still owed" },
    { name: "--wait", says: "wait for the background runs to end, then settle the checkpoint, instead of leaving them running" },
  ],
  examples: ["checkpoint", "checkpoint release-1.2", "checkpoint release-1.2 --wait", "checkpoint --status"],
  async run(args, ctx) {
    const p = parse(args, { status: { type: "boolean" }, wait: { type: "boolean" } })
    if (p.positionals.length > 1) throw usageError(this)
    const gate = p.positionals[0]
    if (bool(p, "status")) {
      if (gate || bool(p, "wait")) throw usageError(this)
      const last = readCheckpoints(ctx).at(-1)
      if (!last) {
        ctx.out("no checkpoint yet — naima checkpoint runs one")
        return 0
      }
      const now = await settle(ctx, last)
      for (const l of statusLines(now)) ctx.out(l)
      return now.pending || now.passed ? 0 : 1
    }
    if (gate && !ctx.registry.find("gates", gate)) throw new Error(`no gate "${gate}"`)
    if (gate) refuseOffLine(ctx, gate)
    const before = readCheckpoints(ctx).at(-1)
    if (before?.pending) {
      const now = await settle(ctx, before)
      if (now.pending) {
        ctx.out("a checkpoint is still running; it must end before another starts:")
        for (const l of statusLines(now)) ctx.out(l)
        return 1
      }
    }
    const tip = gitOrNull(ctx.root, "rev-parse", "HEAD")
    const tracker = gitOrNull(ctx.trackerGit, "rev-parse", "HEAD")
    if (!tip || !tracker) throw new Error("no commit to run a checkpoint on")
    const names = checkpointNames(ctx)
    const suites = checkpointRuns(ctx)
    const last = lastPass(ctx)
    const from = last && gitOrNull(ctx.root, "cat-file", "-e", `${last.tip}^{commit}`) !== null ? last.tip : EMPTY_TREE
    const changed = (gitOrNull(ctx.root, "diff", "--name-only", "--no-renames", "-z", from, tip) ?? "").split("\0").filter(Boolean)
    ctx.out(`checkpoint on ${tip.slice(0, 12)}: ${names.length ? names.join(", ") : "no landing check owed or declared"}`)
    const { refused, notCurrent } = await landingChecks(ctx, { branch: currentBranch(ctx.root) ?? "HEAD", from, to: tip, changed }, ctx, names)
    const failed = [...refused, ...notCurrent.map((l) => `${l} — not current`)]
    const runs = await startRuns(ctx, tip, suites, verifyHost(ctx))
    const id = writeCheckpoint(ctx, {
      on: ctx.now().toISOString(),
      tip,
      tracker,
      ...(gate ? { gate } : {}),
      passed: failed.length === 0 && runs.length === 0,
      ...(runs.length ? { pending: true, runs } : {}),
      ran: names,
      failed,
    })
    let record = readCheckpoints(ctx).find((r) => r.id === id)!
    if (runs.length) {
      record = await settle(ctx, record)
      if (record.pending && bool(p, "wait")) record = await waitFor(ctx, id)
    }
    if (record.pending) {
      ctx.out(`${runs.length} run${runs.length === 1 ? "" : "s"} started in the background: ${runs.map((r) => r.run).join(", ")} — naima checkpoint --status`)
      return failed.length ? 1 : 0
    }
    if (!record.passed) {
      const all = record.failed
      ctx.out(
        `checkpoint FAILED, ${all.length} finding${all.length === 1 ? "" : "s"}; it blocks ${
          gate ? `gate ${gate}` : "every gate"
        } until a later checkpoint passes:`,
      )
      for (const l of all) ctx.out(`  ✗ ${l}`)
      for (const r of record.runs ?? []) if (r.bug) ctx.out(`  bug: ${r.bug} (${r.name})`)
      return 1
    }
    ctx.out(`checkpoint passed: ${names.length + runs.length} check${names.length + runs.length === 1 ? "" : "s"} on ${tip.slice(0, 12)}; nothing is owed now`)
    return 0
  },
}
