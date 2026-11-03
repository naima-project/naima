// The metro data, the bridge command metro: what the new UI's rail draws. Plugins never
// import each other, so it is read the way a person would: from the commands
// that own each part, run here with --json (`line list`, `claims`, `gates`),
// and from git for the commits. A part whose plugin is not loaded is empty.
//
//   routes   the trunk and every open line, then the other branches in a window
//            of recent history: each with its first-parent commits (newest first),
//            the commit it leaves its base at (fork) and the one it rejoins it at
//            (land, null while it has not)
//   workers  each worker branch: its claim and a status, derived from the claim,
//            its step and its silence, each with the reason it was given
//   goals    per route of the trunk and the lines, the goals still ahead in goal
//            order: a line's gate's steps, then the gate; on the trunk, every
//            unfinished gate that is a goal (isGoal) no open line stands for, then
//            each line's landing

import { type Command, type Context, gitOrNull, isAncestor, trunk, worktrees } from "../../core/api.ts"

/** How many first-parent commits of the trunk the window holds; a branch is shown when it leaves or rejoins within it. */
export const WINDOW = 60

export type RouteKind = "trunk" | "line" | "sync" | "worker" | "branch"

export interface Route {
  /** The branch. */
  name: string
  kind: RouteKind
  /** The gate of a line. */
  gate?: string
  /** The branch it leaves and rejoins: the trunk, or the line it belongs to. */
  base: string | null
  tip: string
  /** Its first-parent commits its base lacks, newest first; the trunk's, the window. */
  commits: string[]
  /** The commit of its base it left from; null for the trunk. */
  fork: string | null
  /** The commit of its base that merged it; null while it has not rejoined. */
  land: string | null
}

export interface MetroCommit {
  /** Committer time, seconds since 1970. */
  t: number
  subject: string
}

export type WorkerStatus = "working" | "testing" | "question" | "idle" | "done-waiting-to-land"

export interface Worker {
  branch: string
  status: WorkerStatus
  /** How the status was derived, in words. */
  why: string
  /** The claimed items. */
  items: { id: string; ref: string; title: string }[]
  step?: { what: string; since: string }
  quietFor?: number
  /** Commits it has that its base lacks. */
  ahead: number
}

export interface Mark {
  kind: "step" | "goal" | "landing"
  /** The gate, and for a step its name: <gate>/<step>. */
  id: string
  title: string
  /** For a step: closed, next or waiting; for a goal or a landing: holds, or blocked by N. */
  state: string
  due?: string
  version?: string
}

export interface Metro {
  trunk: string | null
  /** The branch checked out here, the moment the rail calls live. */
  head: string | null
  routes: Route[]
  commits: Record<string, MetroCommit>
  workers: Worker[]
  /** Per route name (the trunk, each line's branch), the goals ahead in order. */
  goals: Record<string, Mark[]>
}

/** What a command prints with --json, run here; null when no loaded plugin has it, or it fails. */
async function commandJson<T>(ctx: Context, words: string[]): Promise<T | null> {
  const cmd = ctx.registry.find<Command>("commands", words[0]!)?.value
  if (!cmd) return null
  const out: string[] = []
  const quiet = Object.create(ctx, { out: { value: (l = "") => void out.push(l) }, err: { value: () => {} } }) as Context
  try {
    await cmd.run([...words.slice(1), "--json"], quiet)
    return JSON.parse(out.join("\n")) as T
  } catch {
    return null
  }
}

interface LineRow {
  gate: string
  branch: string
  tip: string
}
interface ClaimRow {
  branch: string
  stale?: string
  step?: { what: string; since: string }
  quietFor?: number
  silent?: boolean
  items: { id: string; ref: string; title: string }[]
}
export interface GateRow {
  gate: string
  title: string
  holds: boolean
  blocking: unknown[]
  steps?: { name: string; title: string; state: string }[]
  version?: string
  due?: string
  before?: string[]
  finished?: boolean
}

const git = (ctx: Context, ...args: string[]): string => gitOrNull(ctx.root, ...args) ?? ""

/** First-parent commits of `range`, newest first, at most `n`, each recorded in `commits`. */
function firstParent(ctx: Context, range: string, n: number, commits: Record<string, MetroCommit>): string[] {
  return git(ctx, "log", "--first-parent", `-n${n}`, "--format=%H%x09%ct%x09%s", range, "--").split("\n").filter(Boolean).map((l) => {
    const [h = "", t = "0", ...s] = l.split("\t")
    commits[h] = { t: Number(t), subject: s.join("\t") }
    return h
  })
}

/** Why a worker branch is where it is: its claim and step, or, with no live claim, its commits waiting to land. */
function statusOf(claim: ClaimRow | undefined, ahead: number): { status: WorkerStatus; why: string } {
  if (!claim) return { status: "done-waiting-to-land", why: `no live claim, and ${ahead} commit${ahead === 1 ? "" : "s"} its base lacks` }
  if (claim.silent) return { status: "idle", why: `silent for ${claim.quietFor} min: no step and no commit` }
  const step = claim.step?.what ?? ""
  if (/\b(question|asks?|asking|waiting for (the )?(owner|coordinator|answer))\b/i.test(step)) return { status: "question", why: `its step: ${step}` }
  if (/\b(test|tests|testing|verify|verifying|check|checks|checking)\b/i.test(step)) return { status: "testing", why: `its step: ${step}` }
  return { status: "working", why: step ? `its step: ${step}` : "claimed, no step posted yet" }
}

/** The goals of `rows` not finished, in goal order: one comes after every goal ordered before it. */
const ahead = (rows: GateRow[]): GateRow[] =>
  rows.filter((g) => !g.finished).map((g, i) => ({ g, i })).sort((a, b) => (a.g.before?.length ?? 0) - (b.g.before?.length ?? 0) || a.i - b.i).map((x) => x.g)

/**
 * Whether a gate is a goal, a milestone the rail draws ahead: it has a version (a release), a due date or steps,
 * or it is ordered with other gates (it comes after one, or one comes after it). A gate with none of these
 * collects or checks something standing, such as what waits for the owner, every property holding or the
 * project's metrics: it is not a milestone, and the rail does not draw it ahead. A goal's steps are its sub-goals.
 */
export function isGoal(g: GateRow, all: readonly GateRow[]): boolean {
  return !!(g.version || g.due || g.steps?.length || g.before?.length || all.some((x) => x.before?.includes(g.gate)))
}

const goalState = (g: GateRow): string => (g.holds ? "holds" : `blocked by ${g.blocking.length}`)

export async function metroData(ctx: Context): Promise<Metro> {
  const commits: Record<string, MetroCommit> = {}
  const main = trunk(ctx.root)
  const head = gitOrNull(ctx.root, "symbolic-ref", "--quiet", "--short", "HEAD")
  const lines = (await commandJson<{ lines: LineRow[] }>(ctx, ["line", "list"]))?.lines ?? []
  const claims = ((await commandJson<{ claims: ClaimRow[] }>(ctx, ["claims"]))?.claims ?? []).filter((c) => !c.stale)
  const gates = (await commandJson<GateRow[]>(ctx, ["gates"])) ?? []
  const routes: Route[] = []
  if (main) {
    routes.push({
      name: main,
      kind: "trunk",
      base: null,
      tip: git(ctx, "rev-parse", main),
      commits: firstParent(ctx, main, WINDOW, commits),
      fork: null,
      land: null,
    })
  }
  const window = new Set(routes[0]?.commits ?? [])
  for (const l of lines) {
    routes.push({
      name: l.branch,
      kind: "line",
      gate: l.gate,
      base: main,
      tip: l.tip,
      commits: main ? firstParent(ctx, `${main}..${l.branch}`, WINDOW, commits) : [],
      fork: main ? git(ctx, "merge-base", main, l.branch) || null : null,
      land: null,
    })
    for (const c of routes.at(-1)!.commits) window.add(c)
  }
  const lineNames = new Set(lines.map((l) => l.branch))
  const claimed = new Map(claims.map((c) => [c.branch, c]))
  const standing = new Set(worktrees(ctx.root).filter((w) => !w.self).flatMap((w) => (w.branch ? [w.branch] : [])))
  const workers: Worker[] = []
  const refs = git(ctx, "for-each-ref", "--format=%(refname:short)%09%(objectname)", "refs/heads").split("\n").filter(Boolean)
  for (const r of refs) {
    const [name = "", tip = ""] = r.split("\t")
    if (!main || name === main || lineNames.has(name) || name.startsWith("line/")) continue
    // Its base: the open line whose own commits it carries, else the trunk.
    const base = lines.find((l) => {
      const mb = gitOrNull(ctx.root, "merge-base", name, l.branch)
      return !!mb && !isAncestor(ctx.root, mb, main)
    })?.branch ?? main
    // Rejoined: the oldest commit of the base's first-parent history that carries it; none for a branch with no work yet.
    const land = isAncestor(ctx.root, tip, base)
      ? git(ctx, "rev-list", "--first-parent", "--ancestry-path", "--reverse", `${tip}..${base}`).split("\n")[0] || null
      : null
    if (land && !window.has(land)) continue
    const fork = (land ? git(ctx, "merge-base", `${land}^1`, tip) : git(ctx, "merge-base", base, tip)) || null
    const list = fork ? firstParent(ctx, `${fork}..${tip}`, WINDOW, commits) : []
    const kind: RouteKind = name.startsWith("sync/") ? "sync" : claimed.has(name) || standing.has(name) || name.startsWith("worker/") ? "worker" : "branch"
    // A branch that left and never rejoined within no window: shown only when it is a worker's.
    if (!land && kind === "branch" && !(fork && window.has(fork))) continue
    routes.push({ name, kind, base, tip, commits: list, fork, land })
    if (!land && (claimed.has(name) || standing.has(name)) && (claimed.has(name) || list.length)) {
      const c = claimed.get(name)
      workers.push({
        branch: name,
        ...statusOf(c, list.length),
        items: c?.items ?? [],
        ...(c?.step ? { step: c.step } : {}),
        ...(c?.quietFor !== undefined ? { quietFor: c.quietFor } : {}),
        ahead: list.length,
      })
    }
  }
  // The goals ahead (only gates that are goals, isGoal): each line's gate's steps then the gate; on the trunk, the
  // goals no line stands for, then the landings.
  const goals: Record<string, Mark[]> = {}
  const order = ahead(gates).filter((g) => isGoal(g, gates))
  const lineOfGate = new Map(lines.map((l) => [l.gate, l.branch]))
  for (const l of lines) {
    const g = gates.find((x) => x.gate === l.gate)
    if (!g) continue
    goals[l.branch] = [
      ...(g.steps ?? []).filter((s) => s.state !== "closed").map((s): Mark => ({ kind: "step", id: `${g.gate}/${s.name}`, title: s.title, state: s.state })),
      { kind: "goal", id: g.gate, title: g.title, state: goalState(g), ...(g.due ? { due: g.due } : {}), ...(g.version ? { version: g.version } : {}) },
    ]
  }
  if (main) {
    goals[main] = order.map((g): Mark => ({
      kind: lineOfGate.has(g.gate) ? "landing" : "goal",
      id: g.gate,
      title: lineOfGate.has(g.gate) ? `${g.title}: ${lineOfGate.get(g.gate)} lands` : g.title,
      state: goalState(g),
      ...(g.due ? { due: g.due } : {}),
      ...(g.version ? { version: g.version } : {}),
    }))
  }
  return { trunk: main, head, routes, commits, workers, goals }
}
