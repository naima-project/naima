// The metro data, the bridge command metro: what the new UI's rail draws. Plugins never
// import each other, so it is read the way a person would: from the commands
// that own each part, run here with --json (`line list`, `claims`, `gates`),
// and from git for the commits. A part whose plugin is not loaded is empty.
//
//   routes   the trunk and every open line, then the other branches in a window
//            of recent history: each with its first-parent commits (newest first;
//            the trunk's and the lines' whole history, down to the root commit),
//            the commit it leaves its base at (fork) and the one it rejoins it at
//            (land, null while it has not)
//   workers  each worker branch: its claim and a status, derived from the records of its branch (its claim and
//            its step's time, its commits, the runs started from it, the discussions open on what it claims,
//            the silences between them) by the machine of develop/models/ui/worker-status, never from the
//            words of its step, each with the records it was given
//   people   each person on the map: whoever is checked out here (git's user.name), on the branch here, and
//            each author of the commits the map draws, on the route of their newest commit
//   checkouts  the main checkout and each worktree: its name, its branch and the commit it stands on
//   names    the names the owner gave stops (`naima name-stop`, stops.ts), by commit
//   local    per route, how many of its newest commits are on no remote, and per checkout how many tracked files
//            hold work not committed: from git alone, comparing with the remote-tracking refs, never the network
//   goals    per route of the trunk and the lines, the goals still ahead in goal
//            order: a line's gate's steps, then the gate; on the trunk, every
//            unfinished gate that is a goal (isGoal) no open line stands for, then
//            each line's landing

import { basename } from "node:path"
import { type Command, type Context, gitOrNull, isAncestor, isOpen, runGit, runGitAsync, trunk, worktrees } from "../../core/api.ts"
import { type Event as StatusEvent, initial, type State, type Status, step as statusStep } from "./generated/worker-status.ts"
import { stopNames } from "./stops.ts"

/** How many first-parent commits of the trunk the window holds; a branch is shown when it leaves or rejoins within it. */
export const WINDOW = 60

/**
 * How many first-parent commits of the trunk, and of each line, are sent at most: the whole history of most projects.
 * Past it, the root commit is still sent, last, and `older` counts the commits between left out.
 */
export const HISTORY = 5000

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
  /** How many of its newest commits are on no remote (the remote-tracking refs, as git last fetched them); absent
   *  for none, or when the project has no remote. */
  local?: number
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
  /** The records the status was derived from, in words. */
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

/** A person on the map: where they are, and how that is known. */
export interface Person {
  name: string
  /** The route they stand on. */
  route: string
  /** "here": checked out here; "commit": the route of their newest commit the map draws. */
  via: "here" | "commit"
  /** Their newest commit the map draws, when there is one. */
  commit?: string
}

/** A checkout of the project: the main one, or a worktree. */
export interface Checkout {
  /** The main checkout's folder name, or the worktree's. */
  name: string
  main: boolean
  /** The one the server runs in. */
  here: boolean
  /** Null on a detached HEAD. */
  branch: string | null
  /** The commit it stands on. */
  commit: string | null
  /** How many tracked files hold changes not committed; absent for none. */
  dirty?: number
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
  /** First-parent commits of the trunk older than those sent and newer than its root: 0 unless past HISTORY. */
  older?: number
  people: Person[]
  checkouts: Checkout[]
  /** The names the owner gave stops, by the commit's full hash. */
  names: Record<string, string>
  /** The remote a branch is pushed to (origin when there is one); absent when the project has none. */
  remote?: string
}

/** What a command prints with --json, run here; null when no loaded plugin has it, or it fails. */
export async function commandJson<T>(ctx: Context, words: string[]): Promise<T | null> {
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
  claimedAt?: string
  step?: { what: string; since: string }
  quietFor?: number
  silent?: boolean
  items: { id: string; ref: string; title: string }[]
}
interface RunRow {
  name: string
  branch?: string
  started: string
  over: boolean
  ended?: string
  elapsedMs?: number
}
export interface GateRow {
  gate: string
  title: string
  holds: boolean
  blocking: unknown[]
  steps?: { name: string; title: string; state: string; closedBy?: string[] }[]
  version?: string
  due?: string
  before?: string[]
  finished?: boolean
}

const git = (ctx: Context, ...args: string[]): string => gitOrNull(ctx.root, ...args) ?? ""

/** Who wrote each commit the map draws, by hash: where people stand (never sent). */
type Authors = Map<string, string>

/** First-parent commits of `range`, newest first, at most `n`, each recorded in `commits` and its author in `authors`. */
function firstParent(ctx: Context, range: string, n: number, commits: Record<string, MetroCommit>, authors?: Authors): string[] {
  return git(ctx, "log", "--first-parent", `-n${n}`, "--format=%H%x09%ct%x09%an%x09%s", range, "--").split("\n").filter(Boolean).map((l) => {
    const [h = "", t = "0", an = "", ...s] = l.split("\t")
    commits[h] = { t: Number(t), subject: s.join("\t") }
    if (authors && an) authors.set(h, an)
    return h
  })
}

/** A record of a worker's branch, at its moment in milliseconds: an input of the worker-status machine. */
export interface StatusRecord {
  at: number
  event: StatusEvent["type"]
}

/** What the metro data knows of a worker's branch: its records, read from Naima's own. */
export interface BranchRecords {
  claim?: ClaimRow
  /** Its own commits' times, in seconds. */
  commits: number[]
  runs: RunRow[]
  /** The discussions open on an item it claims: when each was filed, YYYY-MM-DD. */
  asks: string[]
}

/** Records of the same moment in the order they happen: a claim before the work on it, a release last. */
const ORDER: StatusEvent["type"][] = ["claim", "ask", "answer", "step", "commit", "runStart", "runEnd", "quiet", "release", "land"]

/**
 * The records of a worker's branch, oldest first, with a silence (quiet) wherever more than `silentAfter` minutes
 * pass with none after a sign of life, up to `now`: what the worker-status machine is fed. The claim counts from the
 * day it was made, or from its first record when that is earlier; a claim every item of which is done is released now.
 */
export function statusRecords(r: BranchRecords, now: number, silentAfter: number): StatusRecord[] {
  const out: StatusRecord[] = []
  for (const t of r.commits) out.push({ at: t * 1000, event: "commit" })
  for (const run of r.runs) {
    const start = Date.parse(run.started)
    if (Number.isNaN(start)) continue
    out.push({ at: start, event: "runStart" })
    if (run.over) {
      const end = run.ended ? Date.parse(run.ended) : start + (run.elapsedMs ?? 0)
      out.push({ at: Number.isNaN(end) ? start : end, event: "runEnd" })
    }
  }
  for (const d of r.asks) {
    const t = Date.parse(d)
    if (!Number.isNaN(t)) out.push({ at: Math.min(t, now), event: "ask" })
  }
  if (r.claim) {
    if (r.claim.step) {
      const t = Date.parse(r.claim.step.since)
      if (!Number.isNaN(t)) out.push({ at: t, event: "step" })
    }
    const day = r.claim.claimedAt ? Date.parse(r.claim.claimedAt) : NaN
    const first = Math.min(...out.map((x) => x.at), now)
    out.push({ at: Number.isNaN(day) ? first : Math.min(day, first), event: "claim" })
    if (r.claim.stale) out.push({ at: now, event: "release" })
  }
  out.sort((a, b) => a.at - b.at || ORDER.indexOf(a.event) - ORDER.indexOf(b.event))
  // The silence window counts from a sign of life, as the claims' silence does: a claim alone starts no clock.
  const window = silentAfter * 60_000
  const fed: StatusRecord[] = []
  let last: number | null = null
  for (const x of [...out, { at: now, event: "quiet" as const }]) {
    if (last !== null && x.at - last > window) fed.push({ at: last + window, event: "quiet" })
    if (x.event === "quiet") continue
    fed.push(x)
    if (x.event !== "claim" && x.event !== "release") last = x.at
  }
  return fed
}

const SHOWN: Record<Status, WorkerStatus | null> = {
  S_NONE: null,
  S_WORKING: "working",
  S_TESTING: "testing",
  S_QUESTION: "question",
  S_IDLE: "idle",
  S_DONE: "done-waiting-to-land",
}

/** The status the machine says after the last record, or null when there is no worker to draw. */
export function statusFrom(records: readonly StatusRecord[]): WorkerStatus | null {
  let state: State = initial({}).state
  let said: Status = "S_NONE"
  for (const r of records) {
    const next = statusStep(state, { type: r.event })
    if (!next) continue
    state = next.state
    for (const a of next.actions) said = a.status
  }
  return SHOWN[said]
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

/** The records a status was derived from, in words: what the map says of a worker. */
function recordsSaid(r: BranchRecords, now: number): string {
  const going = r.runs.filter((x) => !x.over).length
  const lastSign = Math.max(...r.commits.map((t) => t * 1000), r.claim?.step ? Date.parse(r.claim.step.since) || 0 : 0)
  return [
    r.claim ? (r.claim.stale ? `its claim no longer stands (${r.claim.stale})` : "claimed") : "no live claim",
    plural(r.commits.length, "commit") + " its base lacks",
    ...(lastSign > 0 ? [`last sign of life ${Math.max(0, Math.floor((now - lastSign) / 60_000))} min ago`] : []),
    ...(going ? [`${plural(going, "run")} going on`] : []),
    ...(r.asks.length ? [`${plural(r.asks.length, "discussion")} open on what it claims`] : []),
  ].join(", ")
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

/** How the metro reads what a command prints with --json: the bridge reads it through the view whose data it is, shared with the screens. */
export type JsonOf = <T>(ctx: Context, words: string[]) => Promise<T | null>

export async function metroData(ctx: Context, read: JsonOf = commandJson): Promise<Metro> {
  const commits: Record<string, MetroCommit> = {}
  const main = trunk(ctx.root)
  const head = gitOrNull(ctx.root, "symbolic-ref", "--quiet", "--short", "HEAD")
  const lines = (await read<{ lines: LineRow[] }>(ctx, ["line", "list"]))?.lines ?? []
  const claimsJson = await read<{ claims: ClaimRow[]; silentAfter?: number }>(ctx, ["claims"])
  // A claim every item of which is done still says whose the branch was: it is released now, in the records.
  const claims = (claimsJson?.claims ?? []).filter((c) => !c.stale || /done or closed/.test(c.stale))
  const silentAfter = claimsJson?.silentAfter ?? 15
  const runs = (await read<RunRow[]>(ctx, ["run", "list"])) ?? []
  const authors: Authors = new Map()
  const gates = (await read<GateRow[]>(ctx, ["gates"])) ?? []
  const routes: Route[] = []
  if (main) {
    routes.push({
      name: main,
      kind: "trunk",
      base: null,
      tip: git(ctx, "rev-parse", main),
      commits: firstParent(ctx, main, HISTORY, commits, authors),
      fork: null,
      land: null,
    })
  }
  // The whole history down to the root: past HISTORY, the root commit still ends the trunk, the rest counted.
  let older = 0
  const trunkCommits = routes[0]?.commits ?? []
  if (main && trunkCommits.length === HISTORY) {
    const all = Number(git(ctx, "rev-list", "--first-parent", "--count", main)) || 0
    const root = git(ctx, "rev-list", "--first-parent", "--max-parents=0", main).split("\n").filter(Boolean).at(-1)
    if (root && all > HISTORY) {
      const [t = "0", ...sub] = git(ctx, "log", "-1", "--format=%ct%x09%s", root).split("\t")
      commits[root] = { t: Number(t), subject: sub.join("\t") }
      trunkCommits.push(root)
      older = all - HISTORY - 1
    }
  }
  const window = new Set(trunkCommits.slice(0, WINDOW))
  for (const l of lines) {
    routes.push({
      name: l.branch,
      kind: "line",
      gate: l.gate,
      base: main,
      tip: l.tip,
      commits: main ? firstParent(ctx, `${main}..${l.branch}`, HISTORY, commits, authors) : [],
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
  // Whether a commit is on the trunk, asked of git once per commit: the branches cut from a line share their merge base with it.
  const known = new Map<string, boolean>()
  const onTrunk = (c: string): boolean => known.get(c) ?? known.set(c, !!main && isAncestor(ctx.root, c, main)).get(c)!
  for (const r of refs) {
    const [name = "", tip = ""] = r.split("\t")
    if (!main || name === main || lineNames.has(name) || name.startsWith("line/")) continue
    // Its base: the open line whose own commits it carries, else the trunk.
    const base = lines.find((l) => {
      const mb = gitOrNull(ctx.root, "merge-base", name, l.branch)
      return !!mb && !onTrunk(mb)
    })?.branch ?? main
    // Rejoined: the oldest commit of the base's first-parent history that carries it; none for a branch with no work yet.
    const land = isAncestor(ctx.root, tip, base)
      ? git(ctx, "rev-list", "--first-parent", "--ancestry-path", "--reverse", `${tip}..${base}`).split("\n")[0] || null
      : null
    if (land && !window.has(land)) continue
    const fork = (land ? git(ctx, "merge-base", `${land}^1`, tip) : git(ctx, "merge-base", base, tip)) || null
    const list = fork ? firstParent(ctx, `${fork}..${tip}`, WINDOW, commits, authors) : []
    const kind: RouteKind = name.startsWith("sync/") ? "sync" : claimed.has(name) || standing.has(name) || name.startsWith("worker/") ? "worker" : "branch"
    // A branch that left and never rejoined within no window: shown only when it is a worker's.
    if (!land && kind === "branch" && !(fork && window.has(fork))) continue
    routes.push({ name, kind, base, tip, commits: list, fork, land })
    if (!land && (claimed.has(name) || standing.has(name)) && (claimed.has(name) || list.length)) {
      const c = claimed.get(name)
      const records: BranchRecords = {
        ...(c ? { claim: c } : {}),
        commits: list.map((h) => commits[h]!.t),
        runs: runs.filter((x) => x.branch === name),
        asks: c && !c.stale ? asksOn(ctx, c.items.map((i) => i.id)) : [],
      }
      const now = ctx.now().getTime()
      const status = statusFrom(statusRecords(records, now, silentAfter))
      if (!status) continue
      workers.push({
        branch: name,
        status,
        why: recordsSaid(records, now),
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
  const remote = remoteOf(ctx)
  if (remote) {
    const here = localCommits(ctx)
    for (const r of routes) {
      const n = r.commits.filter((h) => here.has(h)).length
      if (n) r.local = n
    }
  }
  return {
    trunk: main,
    head,
    routes,
    commits,
    workers,
    goals,
    ...(older ? { older } : {}),
    people: peopleOf(ctx, routes, authors, head, window),
    checkouts: await checkoutsOf(ctx),
    names: stopNames(ctx),
    ...(remote ? { remote } : {}),
  }
}

/** The remote branches are pushed to: origin, or the first there is; null for none. */
function remoteOf(ctx: Context): string | null {
  const all = (gitOrNull(ctx.root, "remote") ?? "").split("\n").filter(Boolean)
  return all.includes("origin") ? "origin" : all[0] ?? null
}

/** Every commit of a local branch on no remote: reachable from the branches and not from a remote-tracking ref. */
function localCommits(ctx: Context): Set<string> {
  return new Set((gitOrNull(ctx.root, "rev-list", "--branches", "--not", "--remotes") ?? "").split("\n").filter(Boolean))
}

/** When each discussion still open on one of `ids` was filed: a question the work on it waits for. */
function asksOn(ctx: Context, ids: readonly string[]): string[] {
  const on = new Set(ids)
  return ctx.repo.items.filter((i) =>
    i.type === "discussions" && isOpen(ctx, i) &&
    ((i.meta["links"] as { rel?: string; id?: string }[] | undefined) ?? []).some((l) => l.rel === "concerns" && !!l.id && on.has(l.id))
  ).map((i) => String(i.meta["created"] ?? ""))
}

/** The committer time of each of `hashes`, read by one git call: a call for each commit costs a process each, about 40 ms on Windows. */
function commitTimes(ctx: Context, hashes: readonly string[]): Map<string, number> {
  const times = new Map<string, number>()
  const unique = [...new Set(hashes)]
  if (!unique.length) return times
  const r = runGit(ctx.root, ["log", "--no-walk=unsorted", "--stdin", "--format=%H %ct"], { input: unique.join("\n") + "\n" })
  if (!r.ok) return times
  for (const line of r.out.split("\n")) {
    const [h, t] = line.split(" ")
    if (h && t) times.set(h, Number(t))
  }
  return times
}

/**
 * The people on the map: whoever is checked out here, on the branch here; then each author of the commits the map
 * draws (the trunk's window, the lines, the branches), on the route of their newest one. A name is one person.
 */
function peopleOf(ctx: Context, routes: readonly Route[], authors: Authors, head: string | null, window: ReadonlySet<string>): Person[] {
  const out: Person[] = []
  const seen = new Set<string>()
  const me = gitOrNull(ctx.root, "config", "user.name")
  const here = head ? routes.find((r) => r.name === head) : undefined
  if (me && here) {
    out.push({ name: me, route: here.name, via: "here", ...(here.commits[0] ? { commit: here.commits[0] } : {}) })
    seen.add(me)
  }
  // Newest first: each route's commits are; the trunk's are kept to its window.
  const newest = new Map<string, { route: string; commit: string; t: number }>()
  const drawn = (r: Route): string[] =>
    (r.kind === "trunk" ? r.commits.filter((c) => window.has(c)) : r.commits).filter((h) => {
      const who = authors.get(h)
      return !!who && !seen.has(who)
    })
  const times = commitTimes(ctx, routes.flatMap(drawn))
  for (const r of routes) {
    for (const h of drawn(r)) {
      const who = authors.get(h) as string
      const t = times.get(h) ?? 0
      const was = newest.get(who)
      if (!was || t > was.t) newest.set(who, { route: r.name, commit: h, t })
    }
  }
  for (const [name, n] of [...newest].sort((a, b) => b[1].t - a[1].t)) out.push({ name, route: n.route, via: "commit", commit: n.commit })
  return out
}

/** The main checkout and each worktree, with the branch and the commit it stands on, and its work not committed. */
async function checkoutsOf(ctx: Context): Promise<Checkout[]> {
  const all = worktrees(ctx.root)
  const dirty = await Promise.all(all.map((w) => dirtyOf(w.path)))
  return all.map((w, i) => ({
    name: basename(w.path),
    main: i === 0,
    here: w.self,
    branch: w.branch,
    commit: w.head,
    ...dirty[i],
  }))
}

/** How long a checkout's look for work not committed may take before the map goes without it, in ms. */
const DIRTY_MS = 2000

/** How many tracked files of a checkout differ from its commit (untracked files are not counted: listing them walks
 *  every folder); nothing when none, or git cannot tell in time. Every checkout is asked at once, none waits on another. */
async function dirtyOf(path: string): Promise<{ dirty?: number }> {
  const r = await runGitAsync(path, ["diff", "HEAD", "--name-only", "--ignore-submodules=all"], DIRTY_MS)
  const n = r.ok ? r.out.split("\n").filter(Boolean).length : 0
  return n ? { dirty: n } : {}
}
