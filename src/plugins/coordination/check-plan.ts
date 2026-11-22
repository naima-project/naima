// `naima check-plan`: each milestone's check plan (src/core/check-plan.ts) and what starts it. Naima starts a planned point
// itself, never a person or an agent: the landing that crosses a threshold and the hourly tick both call `check-plan
// --start`, which settles the checkpoint that runs, stops it when the person's own heavy work begins or the checks are
// paused, and otherwise starts the first point that is due, or else a background run whose schedule came due, each as a
// detached `naima checkpoint` through naima run, so that no landing and no tick waits for it. One code path for every
// project: the heavy checks go where the project's heavy checks run, this machine by default, a declared host when the
// project names one. The behaviour is the model's: develop/models/check-plan/check-plan.mcrl2.
import {
  backgroundDue,
  backgroundFailures,
  bool,
  type Command,
  type Context,
  contextIn,
  countedRecords,
  currentBranch,
  duePoint,
  gitOrNull,
  idleVerdict,
  type JobOutcome,
  type ListedRun,
  type LoadProbe,
  type MilestonePlan,
  minutesSays,
  parse,
  placesOf,
  planActive,
  planOf,
  type PlanPointName,
  readCheckpoints,
  rendered,
  type SummarySection,
  systemLoad,
  type TickJob,
  trunk,
  updateCheckpoint,
  usageError,
  worktrees,
} from "../../core/api.ts"
import { naimaHere } from "./land.ts"
import { settle } from "./checkpoint-runs.ts"

/** What the plan reads of a gate: the progress a configured gate gives (the gates plugin), read by name. */
interface Milestone {
  name: string
  progress?(ctx: Context): { items: number; closed: number; released: boolean; closedDates?: string[] }
}

/** The milestones: the configured gates with items that are not released yet. */
export function milestones(ctx: Context): { gate: string; items: number; closed: number; closedDates: string[] }[] {
  const out: { gate: string; items: number; closed: number; closedDates: string[] }[] = []
  for (const c of ctx.registry.contributions("gates")) {
    const g = c.value as Milestone
    if (typeof g.progress !== "function") continue
    try {
      const p = g.progress(ctx)
      if (p.items > 0 && !p.released) out.push({ gate: g.name, items: p.items, closed: p.closed, closedDates: p.closedDates ?? [] })
    } catch {
      // a gate that cannot count its items has no plan now
    }
  }
  return out
}

/** The plan of one milestone, or of each; `crossed` names the gates whose threshold a landing crosses now. */
export function plans(ctx: Context, opts: { gate?: string; crossed?: readonly string[] } = {}): MilestonePlan[] {
  const tip = gitOrNull(ctx.root, "rev-parse", "HEAD") ?? undefined
  return milestones(ctx).filter((m) => !opts.gate || m.gate === opts.gate).map((m) =>
    planOf(ctx, m.gate, m.items, m.closed, {
      ...(tip ? { tip } : {}),
      ...(opts.crossed?.includes(m.gate) ? { begun: true } : {}),
      closedDates: m.closedDates,
    })
  ).filter((p) => p.points.length > 0)
}

/** The plan of a gate the project configures, or null when it has none (no items, released, or not a milestone). */
export const planOfGate = (ctx: Context, gate: string, crossed = false): MilestonePlan | null =>
  plans(ctx, { gate, ...(crossed ? { crossed: [gate] } : {}) })[0] ?? null

/** The runs `naima run list --json` lists here: what the idle gate reads. */
async function listedRuns(ctx: Context): Promise<ListedRun[]> {
  const cmd = ctx.registry.commands.get("run")
  if (!cmd) return []
  const lines: string[] = []
  try {
    await cmd.run(["list", "--json"], contextIn(ctx, ctx.root, { out: (l = "") => void lines.push(l), err: () => {}, now: ctx.now }))
    return JSON.parse(lines.join("\n")) as ListedRun[]
  } catch {
    return []
  }
}

/** How a point is started: by default a detached `naima checkpoint` through naima run, in the checkout of the gate's line when it has one. */
export type Launch = (ctx: Context, gate: string | undefined, point: PlanPointName | "background") => Promise<string>

/** The checkout a gate's checkpoint runs in: its line's worktree when the gate has a line, else this one; null when the line has no worktree. */
function checkoutFor(ctx: Context, gate: string | undefined): string | null {
  if (!gate) return ctx.root
  const line = `line/${gate}`
  if (!gitOrNull(ctx.root, "rev-parse", "--verify", "--quiet", `refs/heads/${line}^{commit}`)) return ctx.root
  if (currentBranch(ctx.root) === line) return ctx.root
  return worktrees(ctx.root).find((w) => w.branch === line)?.path ?? null
}

export const detachedLaunch: Launch = async (ctx, gate, point) => {
  const root = checkoutFor(ctx, gate)
  if (!root) return `due, not started: ${gate} has a line and no checkout of it — git worktree add <folder> line/${gate}`
  const run = ctx.registry.commands.get("run")
  if (!run) return "due, not started: naima run is not loaded (the long-work plugin)"
  const name = `plan-${gate ?? "background"}-${point}`.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").slice(0, 60)
  const quiet = contextIn(ctx, root, { out: () => {}, err: () => {}, now: ctx.now })
  try {
    await run.run(["clean", name], quiet)
  } catch {
    // no earlier run of that name
  }
  const said: string[] = []
  const code = await run.run(
    [
      name,
      "--budget-time",
      "1h",
      "--stale",
      "1h",
      "--no-progress",
      "it starts the checkpoint's runs and returns; naima checkpoint --status follows them",
      "--",
      ...naimaHere(contextIn(ctx, root).trackerRoot),
      "checkpoint",
      ...(gate ? [gate] : []),
      "--point",
      point,
    ],
    contextIn(ctx, root, { out: (l = "") => void said.push(l), err: (l = "") => void said.push(l), now: ctx.now }),
  )
  return code === 0
    ? `started ${point}${gate ? ` of ${gate}` : ""} (naima run ${name})`
    : `could not start: ${said.filter(Boolean).pop() ?? "naima run failed"}`
}

/**
 * What the landing and the tick call: settle the checkpoint that runs; stop it when the person's own heavy work runs where
 * it runs or the checks are paused (it yields, with no result, and its point is due again); else, the place being idle,
 * start the first point that is due, or else a background run when its schedule came due. One at a time. Returns what it did.
 */
export async function startDue(
  ctx: Context,
  opts: {
    gate?: string
    crossed?: readonly string[]
    launch?: Launch
    runs?: ListedRun[]
    load?: LoadProbe
    landingsSince?: (tip: string | undefined) => number
    /** The pause as just recorded, when the configuration read at start predates it. */
    paused?: boolean
  } = {},
): Promise<string[]> {
  if (!planActive(ctx)) return []
  const said: string[] = []
  const runs = opts.runs ?? await listedRuns(ctx)
  const places = placesOf(ctx)
  const pending = readCheckpoints(ctx).filter((r) => r.pending && !r.yielded).at(-1)
  if (pending) {
    const now = await settle(ctx, pending)
    if (now.pending) {
      // The idle gate holds while a run goes: the person's own heavy work, or a pause, stops it without a result.
      const free = idleVerdict(ctx, places, runs, () => null, opts.paused)
      if (free.idle) return [`a checkpoint of ${now.tip.slice(0, 12)} is running`]
      const stop = ctx.registry.commands.get("run")
      for (const r of (now.runs ?? []).filter((x) => x.state === "running")) {
        try {
          await stop?.run(["stop", r.run], contextIn(ctx, ctx.root, { out: () => {}, err: () => {}, now: ctx.now }))
        } catch {
          // a run already over stops nothing
        }
      }
      updateCheckpoint(ctx, now.id, { pending: false, passed: false, yielded: true, ended: ctx.now().toISOString() })
      return [`stopped the checkpoint of ${now.tip.slice(0, 12)} without a result: ${free.why}; its point is due again`]
    }
  }
  const launch = opts.launch ?? detachedLaunch
  const due = plans(ctx, { ...(opts.gate ? { gate: opts.gate } : {}), ...(opts.crossed ? { crossed: opts.crossed } : {}) })
    .map((p) => ({ plan: p, point: duePoint(p) }))
    .find((x) => x.point)
  const free = idleVerdict(ctx, places, runs, opts.load ?? systemLoad, opts.paused)
  if (due?.point) {
    if (!free.idle) return [`${due.point.point} checkpoint of ${due.plan.gate} is due and waits: ${free.why}`]
    said.push(await launch(ctx, due.plan.gate, due.point.point))
    return said
  }
  if (opts.gate) return said
  const bg = backgroundDue(ctx, ctx.now(), opts.landingsSince ?? ((t) => landingsSince(ctx, t)))
  if (bg.due) {
    if (!free.idle) return [`a background check is due (${bg.why}) and waits: ${free.why}`]
    const tip = gitOrNull(ctx.root, "rev-parse", "HEAD")
    // A commit that already has its results is never checked again.
    if (tip && countedRecords(ctx).some((r) => r.tip === tip && !r.pending)) return [`a background check is due; ${tip.slice(0, 12)} already has its results`]
    said.push(await launch(ctx, undefined, "background"))
  }
  return said
}

/** The landings on the tip since a commit (all of them, before any): the commits naima land made, by their subject. */
export function landingsSince(ctx: Context, since: string | undefined): number {
  const range = since && gitOrNull(ctx.root, "cat-file", "-e", `${since}^{commit}`) !== null ? [`${since}..HEAD`] : ["HEAD"]
  const n = gitOrNull(ctx.root, "rev-list", "--count", "--first-parent", "--grep=^Land ", ...range)
  return n ? Number(n.trim()) || 0 : 0
}

const STATE_MARK = { waiting: "·", ready: "→", running: "…", passed: "✓", failed: "✗", skipped: "–" } as const

/** The lines `naima check-plan` prints for a plan. */
export function planLines(plan: MilestonePlan): string[] {
  const lines = [
    `${plan.gate}: ${plan.closed} of ${plan.items} items closed; heavy checks run ${plan.where === "here" ? "on this machine, when idle" : `on ${plan.where}`}`,
  ]
  if (plan.fast.length) lines.push(`  at every landing: ${plan.fast.join(", ")}`)
  for (const p of plan.points) {
    const at = p.point === "release" ? "" : ` at ${p.at} of ${plan.items}`
    const dur = p.expectedMinutes === null ? "" : p.reused ? ", nothing rerun" : `, about ${minutesSays(p.expectedMinutes)} (${p.expectedFrom})`
    const tip = p.tip ? ` on ${p.tip.slice(0, 12)}` : ""
    lines.push(`  ${STATE_MARK[p.state]} ${p.point}${at}: ${p.state}${tip}${dur}${p.why ? ` — ${p.why}` : ""}`)
  }
  return lines
}

export const checkPlanCommand: Command = {
  name: "check-plan",
  says:
    "show each milestone's check plan — fast checks at every landing, a checkpoint at about half its items closed, one when all are closed, then the release check — with each point's state and expected duration; --start starts what is due, as the landing and the tick do",
  enforces:
    "a planned point starts only once its threshold is reached, by Naima itself (the landing that crosses it, or the hourly tick), never by hand; one heavy run at a time, only where the heavy checks run is idle (no heavy run of the person's own there, the machine's load under idleLoad) and the checks are not paused; a checkpoint that runs when either changes stops without a result and its point is due again; between milestones a background run starts when its schedule (backgroundChecks) comes due, on a commit with no results yet",
  usage: "check-plan [<gate>] [--json] | check-plan --start [<gate>] [--crossed]",
  options: [
    {
      name: "--json",
      says: "print the plans as JSON: each milestone's items, closed, points (state, expected minutes), the fast checks and where heavy checks run",
    },
    {
      name: "--start",
      says: "settle the checkpoint that runs, or start the point that is due, or a background run that is due: what the landing and the tick run",
    },
    {
      name: "--crossed",
      says: "with --start and a gate: the gate's threshold was crossed by this landing, so a point is due even when all its items are closed",
    },
  ],
  examples: ["check-plan", "check-plan release-1.2", "check-plan --json", "check-plan --start"],
  async run(args, ctx) {
    const p = parse(args, { json: { type: "boolean" }, start: { type: "boolean" }, crossed: { type: "boolean" } })
    if (p.positionals.length > 1) throw usageError(this)
    const gate = p.positionals[0]
    if (bool(p, "start")) {
      if (bool(p, "json")) throw usageError(this)
      for (const l of await startDue(ctx, { ...(gate ? { gate } : {}), ...(gate && bool(p, "crossed") ? { crossed: [gate] } : {}) })) ctx.out(l)
      return 0
    }
    if (bool(p, "crossed")) throw usageError(this)
    const all = plans(ctx, gate ? { gate } : {})
    if (gate && !all.length) throw new Error(`${gate} has no check plan: it is no milestone the project configures, has no items, or is released`)
    if (bool(p, "json")) {
      ctx.out(JSON.stringify(all, null, 2))
      return 0
    }
    if (!planActive(ctx)) {
      ctx.out("the project does not plan its heavy checks: naima heavy-checks checkpoint --host <name | here> and the option checks=checkpoint plan them")
    }
    if (!all.length) ctx.out("no milestone with items left to plan")
    for (const pl of all) for (const l of planLines(pl)) ctx.out(l)
    return 0
  },
}

/** The hourly job: settle what runs, stop it for the person, start what is due. */
export const checkPlanJob: TickJob = {
  name: "check-plan",
  says:
    "every hour, on the trunk's checkout: settles the checkpoint that runs (a failure files a bug), stops it without a result when the person's own heavy work runs where it runs or the checks are paused, and otherwise starts the milestone's planned point that is due, or a background run whose schedule came due, where the heavy checks run, only when that place is idle",
  every: "hour",
  timeoutMs: 30_000,
  canRunHere(ctx) {
    const t = trunk(ctx.root)
    return !!t && currentBranch(ctx.root) === t && planActive(ctx)
  },
  async run(ctx): Promise<JobOutcome> {
    try {
      await startDue(ctx)
      return { ok: true, notices: [] }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  },
}

/** What naima hello says of the checks: a background failure not yet fixed, and only that; a pass is said nothing. */
export const checkPlanSection: SummarySection = {
  name: "check-plan",
  hello: true,
  render: (ctx) => {
    let say: string[] = []
    try {
      say = backgroundFailures(ctx).map((r) =>
        `background check of ${r.tip.slice(0, 12)} failed: ${r.failed.join("; ")}${(r.runs ?? []).filter((x) => x.bug).map((x) => ` (${x.bug})`).join("")}`
      )
    } catch {
      // a record that cannot be read is reported where it is read
    }
    return rendered(say, (l) => l)
  },
}
