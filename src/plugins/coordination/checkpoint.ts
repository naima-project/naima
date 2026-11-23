// `naima checkpoint`: run the checks the landings since the last checkpoint owed, and the project's heavy ones, on the current tip.
import {
  bool,
  CHECK_POINTS,
  type CheckPoint,
  checkpointChecks,
  type CheckpointRecord,
  type CheckpointRun,
  checkpointRuns,
  type CheckResult,
  type Command,
  type Context,
  contextIn,
  currentBranch,
  gitOrNull,
  heavyAnswer,
  heavyQuestion,
  isAncestor,
  lastPass,
  owedSince,
  parse,
  planActive,
  planLine,
  readCheckpoints,
  resultsAt,
  str,
  usageError,
  verifyHost,
  writeCheckpoint,
} from "../../core/api.ts"
import { type LandingReport } from "./land.ts"
import { EMPTY_TREE, landingChecks } from "./land.ts"
import { fileBug, settle, startRuns, statusLines } from "./checkpoint-runs.ts"
import { planOfGate } from "./check-plan.ts"

/**
 * Which point a checkpoint is, when the project plans its heavy checks: the one asked (`--point`, `--release`) if the
 * plan has it due (the release: once the full checkpoint passed), else the gate's point that is due; refused when none is,
 * since heavy checks run only at their planned points, never ad hoc. Undefined when the project does not plan them.
 */
function plannedPoint(ctx: Context, gate: string | undefined, asked: CheckPoint | undefined): CheckPoint | undefined {
  if (!planActive(ctx)) return asked
  if (asked === "background") {
    if (gate) throw new Error("a background check is for no milestone: naima checkpoint --point background, with no gate")
    return asked
  }
  if (!gate) {
    throw new Error("heavy checks run only at the planned points of a milestone, never ad hoc: naima check-plan shows each plan and when its points come")
  }
  const plan = planOfGate(ctx, gate, true)
  if (!plan) {
    throw new Error(`${gate} has no check plan (no items, released, or not a milestone the project configures): its heavy checks have no point to run at`)
  }
  if (asked === "release") {
    const full = plan.points.find((p) => p.point === "full")
    const rel = plan.points.find((p) => p.point === "release")
    if (full?.state !== "passed") throw new Error(`the release check waits for the full checkpoint of ${gate} to pass — ${planLine(plan)}`)
    if (rel?.state === "running") throw new Error(`the release check of ${gate} is already running`)
    return "release"
  }
  const due = plan.points.find((p) => p.state === "ready")
  if (asked !== undefined && due?.point !== asked) {
    throw new Error(`the ${asked} checkpoint of ${gate} is not due: a checkpoint never starts before its threshold — ${planLine(plan)}`)
  }
  if (!due) throw new Error(`no checkpoint of ${gate} is due: heavy checks run only at their planned points, started by Naima — ${planLine(plan)}`)
  return due.point
}

/** Whether a suite can be affected by the files changed: one that names no paths is affected by any change. */
const affects = (paths: readonly string[] | undefined, changed: readonly string[]): boolean =>
  changed.length > 0 && (!paths?.length || changed.some((f) => paths.some((p) => f === p || f.startsWith(p.endsWith("/") ? p : `${p}/`))))

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
  usage: "checkpoint [<gate>] [--point half|full|background | --release] [--wait] | checkpoint --status",
  options: [
    {
      name: "--point",
      says:
        "the planned point it is, as Naima starts it (naima check-plan): half, full, or background; refused when that point is not due, for a project that plans its heavy checks",
    },
    {
      name: "--release",
      says: "the release check of the gate: once its full checkpoint passed; takes the results of its commit and reruns only what later commits can affect",
    },
    { name: "--status", says: "read the runs of the latest checkpoint, settle it when they are over, and print each run's state and what is still owed" },
    { name: "--wait", says: "wait for the background runs to end, then settle the checkpoint, instead of leaving them running" },
  ],
  examples: ["checkpoint", "checkpoint release-1.2", "checkpoint release-1.2 --wait", "checkpoint --status"],
  async run(args, ctx) {
    const p = parse(args, { status: { type: "boolean" }, wait: { type: "boolean" }, point: { type: "string" }, release: { type: "boolean" } })
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
    const askedRaw = bool(p, "release") ? "release" : str(p, "point")
    if (askedRaw !== undefined && (!CHECK_POINTS.includes(askedRaw as CheckPoint) || (askedRaw === "release" && str(p, "point") !== undefined))) {
      throw usageError(this)
    }
    const point = plannedPoint(ctx, gate, askedRaw as CheckPoint | undefined)
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
    const answer = heavyAnswer(ctx)
    if (!answer) {
      ctx.out(`checkpoint not run: the project has not agreed when heavy checks run. ${heavyQuestion()}`)
      return 1
    }
    let names = checkpointNames(ctx)
    // With heavy checks off, a checkpoint runs the landing checks that are not heavy and starts no suite or verification.
    let suites = answer.when === "off" ? [] : checkpointRuns(ctx)
    const last = lastPass(ctx)
    const from = last && gitOrNull(ctx.root, "cat-file", "-e", `${last.tip}^{commit}`) !== null ? last.tip : EMPTY_TREE
    const changed = (gitOrNull(ctx.root, "diff", "--name-only", "--no-renames", "-z", from, tip) ?? "").split("\0").filter(Boolean)
    // The release check after a full checkpoint that passed on another commit reruns only what the commits since can
    // affect: the checks their landings owe, the suites whose paths they change, the properties they make not current.
    if (point === "release" && last && last.tip !== tip) {
      names = owedSince(ctx).names.filter((n) => names.includes(n))
      suites = suites.filter((s) => affects(s.paths, changed))
    }
    // A result belongs to its commit: what this commit already has is taken, never computed again.
    const known = resultsAt(ctx, tip)
    const reusedChecks = names.filter((n) => known.checks.has(n))
    const toRun = names.filter((n) => !known.checks.has(n))
    const reusedRuns = suites.filter((s) => known.runs.has(s.name)).map((s) => known.runs.get(s.name)!)
    suites = suites.filter((s) => !known.runs.has(s.name))
    const verifyKnown = known.runs.get("verify")
    ctx.out(
      `checkpoint${point ? ` (${point})` : ""} on ${tip.slice(0, 12)}: ${toRun.length ? toRun.join(", ") : "no landing check to run"}${
        reusedChecks.length + reusedRuns.length
          ? `; ${reusedChecks.length + reusedRuns.length} result${reusedChecks.length + reusedRuns.length === 1 ? "" : "s"} of this commit reused`
          : ""
      }`,
    )
    const { refused, notCurrent } = toRun.length
      ? await landingChecks(ctx, { branch: currentBranch(ctx.root) ?? "HEAD", from, to: tip, changed }, ctx, toRun)
      : { refused: [] as string[], notCurrent: [] as string[] }
    const findings = [...refused, ...notCurrent.map((l) => `${l} — not current`)]
    const results: CheckResult[] = [
      ...toRun.map((n): CheckResult => {
        const mine = findings.filter((l) => l.startsWith(`${n}: `))
        return mine.length ? { name: n, passed: false, why: mine } : { name: n, passed: true }
      }),
      ...reusedChecks.map((n): CheckResult => {
        const k = known.checks.get(n)!
        return { name: n, passed: k.passed, ...(k.why ? { why: k.why } : {}), reused: k.record }
      }),
    ]
    const failed = [...findings, ...reusedChecks.flatMap((n) => known.checks.get(n)!.passed ? [] : known.checks.get(n)!.why ?? [`${n}: failed`])]
    const started = answer.when === "off" ? [] : await startRuns(ctx, tip, suites, verifyHost(ctx), undefined, { verify: !verifyKnown })
    const carried: CheckpointRun[] = [...reusedRuns, ...(verifyKnown && answer.when !== "off" ? [verifyKnown] : [])].map(({ record, ...r }) => ({
      ...r,
      reused: record,
    }))
    for (const r of carried) if (r.state === "failed") failed.push(`${r.name}: ${r.why ?? "failed"} (reused)`)
    // A background run reports only failures, as items: each failing landing check files or updates its bug.
    if (point === "background") {
      for (const res of results.filter((x) => !x.passed && !x.reused)) {
        try {
          fileBug(ctx, {
            run: `background-${tip.slice(0, 12)}`,
            name: res.name,
            kind: "check",
            what: res.name,
            state: "failed",
            why: (res.why ?? []).join("; "),
          }, tip)
        } catch {
          // off the trunk the bug is filed from the trunk's checkout; the record keeps the failure
        }
      }
    }
    const runs = [...started, ...carried]
    // Any run started (or failed to start) is settled as before: a failure files its bug.
    const going = started.length > 0
    const id = writeCheckpoint(ctx, {
      on: ctx.now().toISOString(),
      tip,
      tracker,
      ...(gate ? { gate } : {}),
      ...(point ? { point } : {}),
      passed: failed.length === 0 && !going && runs.every((r) => r.state !== "failed"),
      ...(going ? { pending: true } : { ended: ctx.now().toISOString() }),
      ...(runs.length ? { runs } : {}),
      ran: names,
      failed,
      ...(results.length ? { results } : {}),
    })
    let record = readCheckpoints(ctx).find((r) => r.id === id)!
    if (going) {
      record = await settle(ctx, record)
      if (record.pending && bool(p, "wait")) record = await waitFor(ctx, id)
    }
    if (record.pending) {
      const bg = started.filter((r) => r.state === "running")
      ctx.out(`${bg.length} run${bg.length === 1 ? "" : "s"} started in the background: ${bg.map((r) => r.run).join(", ")} — naima checkpoint --status`)
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
