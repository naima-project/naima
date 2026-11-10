// The plan of a goal: the work that reaches it, as a graph of what waits for what, laid out in waves that can run at
// once, with its critical path, the heavy runs at its checkpoint, and the note an agent proposed and the owner's
// approval.
//
// The nodes are the goal's open items (a group stands for its members, as the gate counts them) and every open item
// outside the goal that one of them waits for, however far back. An edge goes from an item to one that waits for it:
// `blocks` / `blocked-by` (the core's "must be resolved before"), `has-part` (a group waits for its parts) and
// `verified-by` ("is proven by": the proof runs once the work it proves is done).
//
// A node is work, or a heavy run: an item whose code is done and whose proof is owed, or a property, a test or a
// metric still to run (a model check, a suite, a benchmark), and the full test suite of a release gate that waits for
// it. The heavy runs sit at the goal's checkpoint: each waits for every piece of work of the plan, since it runs on the
// code the work produces.
//
// The interruption points are the meetings with the owner. Every item that needs the owner (an open discussion, an
// owner's gesture: `runBy` human) is a node of kind `meeting`, and so is every meeting (a gate of the discussions
// plugin whose agenda is discussions) with an item of the plan on its agenda; an agenda item waits for its meeting, and
// the work that depends on the item waits behind it. A meeting takes no worker: the wave that holds one is where the
// parallel work stops until it is held. A meeting with a date (its `on`) is dated; one without waits for the owner.
//
// The waves come from list scheduling: a wave holds what is ready once the waves before it are done, at most
// maxWorkers (the coordination plugin's option) at once, the node with the longest chain after it first. A node
// weighs its estimate where it has one (the triage plugin's effort: S, M, L, XL), else one unit. The critical path is
// the heaviest chain through the graph, checkpoint included.
//
// The note and the approval are kept on the gate, in naima.json (`plan`): `naima plan <goal> --propose "<note>"`
// writes the note and clears any approval, since a revised plan needs approving again; `naima plan <goal> --approve`
// records the approval with a fingerprint of the plan approved, so that a plan that changed since says so. The model of
// the two is develop/models/plan-approval in the workshop.
//
// Plugins never import each other: the effort and maxWorkers are read by name.

import { createHash } from "node:crypto"
import { bool, type Command, type Context, filerRole, gitOrNull, isOpen, type Item, label, linked, parse, str, today } from "../../core/api.ts"
import { standsFor } from "./dependencies.ts"

/** What a heavy run is, in words. */
export type RunKind = "model check" | "test suite" | "benchmark" | "proof run"

export interface PlanNode {
  id: string
  ref: string
  title: string
  type: string
  status: string
  kind: "work" | "run" | "meeting"
  /** For a run, what it is. */
  run?: RunKind
  /** For a meeting, or an item that needs the owner: the meeting gate it is held at, and its date when it has one; no date means it waits for the owner. */
  meeting?: MeetingRef
  /** For an item that is not on the goal: the goal it is on, by title, or "no goal". */
  outside?: string
  /** Its weight in units: its estimate, else 1. */
  units: number
  /** Its effort as the item says it, when it does. */
  effort?: string
  /** The wave it runs in, from 0; -1 for a node on a cycle, which never becomes free. */
  wave: number
  /** On the critical path. */
  critical: boolean
  /** The nodes it waits for directly (a run's wait for the whole of the work is implied, not listed). */
  after: string[]
}

/** A meeting with the owner, as a node of the plan says it. */
export interface MeetingRef {
  /** The meeting's gate, when it is one or the item is on its agenda. */
  gate?: string
  /** Its date, YYYY-MM-DD; absent while it waits for the owner. */
  on?: string
  /** Who it needs. */
  needs: string[]
  /** For a meeting: how many items of the plan are on its agenda. */
  agenda?: number
}

export interface Wave {
  index: number
  /** Where it starts and how long it lasts, in units from now. */
  start: number
  units: number
  /** At the checkpoint: its nodes are heavy runs. */
  checkpoint: boolean
  /** It holds a meeting with the owner: the work after it waits until the meeting is held. */
  meeting: boolean
  nodes: string[]
  /** What it says in plain words: "3 can run at once; 2 are waiting on the engine fix". */
  says: string
}

export type ApprovalState = "computed" | "proposed" | "approved" | "changed"

export interface Signed {
  name?: string
  role: string
  on: string
}

export interface PlanData {
  gate: string
  title: string
  due?: string
  capacity: number
  nodes: PlanNode[]
  edges: [string, string][]
  waves: Wave[]
  /** The critical path, first to last, and its weight in units. */
  critical: { nodes: string[]; units: number }
  /** Every wave's units together: how long the plan takes at full parallelism, in units. */
  units: number
  /** Nodes on a cycle, which never become free. */
  stuck: string[]
  /** The plan's fingerprint: its nodes and edges. An approval names it. */
  fingerprint: string
  proposed: (Signed & { note: string }) | null
  approved: (Signed & { fingerprint: string }) | null
  approval: ApprovalState
  /** The plan in a few lines: what agents read. */
  summary: string
}

/** A node as the layout takes it. */
export interface LayIn {
  id: string
  kind: "work" | "run" | "meeting"
  units: number
  /** Lower runs first among equals: the item's urgency. */
  rank?: number
}

export interface Laid {
  wave: Map<string, number>
  waves: { start: number; units: number; nodes: string[]; checkpoint: boolean; meeting: boolean }[]
  critical: string[]
  criticalUnits: number
  stuck: string[]
}

/**
 * The layout of a graph: waves within `capacity`, the critical path, the nodes on a cycle. `edges` go from a node to
 * one that waits for it; every run also waits for every piece of work.
 */
export function layPlan(nodes: readonly LayIn[], edges: readonly (readonly [string, string])[], capacity: number): Laid {
  const by = new Map(nodes.map((n) => [n.id, n]))
  const preds = new Map<string, Set<string>>(nodes.map((n) => [n.id, new Set()]))
  const succs = new Map<string, Set<string>>(nodes.map((n) => [n.id, new Set()]))
  for (const [a, b] of edges) {
    if (!by.has(a) || !by.has(b) || a === b) continue
    preds.get(b)!.add(a)
    succs.get(a)!.add(b)
  }
  // A meeting is not a heavy run: what runs at the checkpoint waits for it as for the work.
  const work = nodes.filter((n) => n.kind !== "run").map((n) => n.id)
  const runs = nodes.filter((n) => n.kind === "run").map((n) => n.id)
  // Every run waits for every piece of work: the checkpoint.
  const allPreds = (id: string): string[] => (by.get(id)!.kind === "run" ? [...new Set([...preds.get(id)!, ...work])] : [...preds.get(id)!])
  const allSuccs = (
    id: string,
  ): string[] => (by.get(id)!.kind !== "run" ? [...new Set([...succs.get(id)!, ...runs])] : [...succs.get(id)!].filter((s) => by.get(s)!.kind === "run"))
  // A topological order (Kahn's), which leaves out the nodes on a cycle or after one.
  const pending = new Map(nodes.map((n) => [n.id, allPreds(n.id).length]))
  const order: string[] = []
  const queue = nodes.filter((n) => pending.get(n.id) === 0).map((n) => n.id)
  while (queue.length) {
    const id = queue.shift()!
    order.push(id)
    for (const s of allSuccs(id)) {
      const left = pending.get(s)! - 1
      pending.set(s, left)
      if (left === 0) queue.push(s)
    }
  }
  const placed = new Set(order)
  const stuck = nodes.map((n) => n.id).filter((id) => !placed.has(id))
  // The heaviest chain from each node to the end, itself included.
  const tail = new Map<string, number>()
  const nextOf = new Map<string, string | null>()
  for (const id of [...order].reverse()) {
    let best = 0, at: string | null = null
    for (const s of allSuccs(id)) {
      const t = tail.get(s) ?? 0
      if (placed.has(s) && t > best) (best = t), (at = s)
    }
    tail.set(id, by.get(id)!.units + best)
    nextOf.set(id, at)
  }
  // The waves: what is ready once the waves before are done, the longest chain first, at most `capacity`.
  const wave = new Map<string, number>()
  const waves: Laid["waves"] = []
  const cap = Math.max(1, Math.floor(capacity))
  let start = 0
  while (wave.size < order.length) {
    const ready = order.filter((id) => !wave.has(id) && allPreds(id).every((p) => wave.has(p)))
    ready.sort((a, b) => tail.get(b)! - tail.get(a)! || (by.get(a)!.rank ?? 0) - (by.get(b)!.rank ?? 0) || (a < b ? -1 : 1))
    // A meeting takes no worker: every meeting ready joins the wave, besides as many others as there are workers.
    const meets = ready.filter((id) => by.get(id)!.kind === "meeting")
    const taken = [...meets, ...ready.filter((id) => by.get(id)!.kind !== "meeting").slice(0, cap)]
    const index = waves.length
    for (const id of taken) wave.set(id, index)
    const units = Math.max(...taken.map((id) => by.get(id)!.units))
    waves.push({ start, units, nodes: taken, checkpoint: taken.every((id) => by.get(id)!.kind === "run"), meeting: meets.length > 0 })
    start += units
  }
  // The critical path: from the start with the heaviest chain, each step to the successor with the heaviest one.
  const sources = order.filter((id) => allPreds(id).length === 0)
  let at: string | null = sources.sort((a, b) => tail.get(b)! - tail.get(a)!)[0] ?? null
  const critical: string[] = []
  while (at) critical.push(at), (at = nextOf.get(at) ?? null)
  return { wave, waves, critical, criticalUnits: critical.length ? tail.get(critical[0]!)! : 0, stuck }
}

// ---------- From the project ----------

/** What the gates plugin hands the plan: its gates' items, and how it writes a gate's fields. */
export interface PlanDeps {
  /** The gate's title, due date and items as its verdict has them, or null when there is no such gate. */
  gate(ctx: Context, name: string): Promise<{ title: string; due?: string; blocking: Item[]; owed: Item[]; fullSuite: boolean; holds: boolean } | null>
  /** Every gate's name, in goal order. */
  names(ctx: Context): string[]
  /** Set a declared gate's fields in naima.json. */
  update(ctx: Context, name: string, changes: Record<string, unknown>): void
}

const EFFORT: Record<string, number> = { S: 0.5, M: 1, L: 2, XL: 4 }
const RUN_TYPES: Record<string, RunKind> = { properties: "model check", tests: "test suite", metrics: "benchmark", benchmarks: "benchmark" }
const RELS: readonly [string, "before" | "after"][] = [
  ["blocked-by", "after"],
  ["blocks", "before"],
  ["has-part", "after"],
  ["verified-by", "before"],
  // An item a discussion is about waits for its decision.
  ["concerned-by", "after"],
]
/** The weight of a meeting, in units: short, but a point the work waits at. */
const MEETING_UNITS = 0.25
const DISCUSSIONS = "discussions"
const FULL_SUITE = "full-suite"
const MAX_WORKERS = 3

/** A title cut to its first clause, for a sentence: "Faster than the current engine on the paper's experiments". */
export function shortTitle(t: string, n = 60): string {
  const first = t.split(/[:;(—]/)[0]!.trim() || t
  return first.length <= n ? first : `${first.slice(0, n - 1).trimEnd()}…`
}

const gatesOfItem = (i: Item): string[] => {
  const g = i.meta["gate"]
  return typeof g === "string" ? [g] : Array.isArray(g) ? g.filter((x): x is string => typeof x === "string") : []
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v)

/** The note and approval stored on the gate, as naima.json has them. */
function stored(ctx: Context, gate: string): { proposed: PlanData["proposed"]; approved: PlanData["approved"] } {
  const opts = ctx.config.plugins["gates"]?.options ?? {}
  const g = isObj(opts["gates"]) ? opts["gates"][gate] : undefined
  const p = isObj(g) && isObj(g["plan"]) ? g["plan"] : {}
  const signed = (v: unknown): Signed | null =>
    isObj(v) && typeof v["on"] === "string"
      ? { ...(typeof v["name"] === "string" ? { name: v["name"] } : {}), role: typeof v["role"] === "string" ? v["role"] : "unknown", on: v["on"] }
      : null
  const pr = signed(p["proposed"])
  const ap = signed(p["approved"])
  const prop = p["proposed"] as Record<string, unknown> | undefined
  const appr = p["approved"] as Record<string, unknown> | undefined
  return {
    proposed: pr && typeof prop?.["note"] === "string" ? { ...pr, note: prop["note"] } : null,
    approved: ap && typeof appr?.["fingerprint"] === "string" ? { ...ap, fingerprint: appr["fingerprint"] } : null,
  }
}

/** The meetings the discussions plugin configures, by name: who each needs and its date. Read by name, as plugins never import each other. */
function meetingsOf(ctx: Context): Map<string, { title: string; needs: string[]; on?: string }> {
  const m = ctx.config.plugins["discussions"]?.options?.["meetings"]
  const out = new Map<string, { title: string; needs: string[]; on?: string }>()
  if (!isObj(m)) return out
  for (const [name, v] of Object.entries(m)) {
    if (!isObj(v) || typeof v["title"] !== "string") continue
    const needs = Array.isArray(v["needs"]) ? v["needs"].filter((x): x is string => typeof x === "string") : ["owner"]
    out.set(name, { title: v["title"], needs: needs.length ? needs : ["owner"], ...(typeof v["on"] === "string" ? { on: v["on"] } : {}) })
  }
  return out
}

/** An item needs the owner: an open discussion, or a gesture only a person makes. */
const needsOwner = (i: Item): boolean => i.type === DISCUSSIONS || i.meta["runBy"] === "human"

const capacityOf = (ctx: Context): number => {
  const m = ctx.config.plugins["coordination"]?.options?.["maxWorkers"]
  return typeof m === "number" && m > 0 ? m : MAX_WORKERS
}

const unitsSaid = (u: number) => `${Number.isInteger(u) ? u : u.toFixed(1)} unit${u === 1 ? "" : "s"}`
const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

/** The plan of the goal `name`, or null when there is no such gate. */
export async function planOf(ctx: Context, deps: PlanDeps, name: string): Promise<PlanData | null> {
  const g = await deps.gate(ctx, name)
  if (!g) return null
  const goalTitle = new Map(deps.names(ctx).map((n) => [n, n]))
  // The goal's own open items, a group standing for its members.
  const own = new Map<string, { item: Item; owed: boolean }>()
  // A blocking item already done waits only for its proof: a heavy run, as an owed one is.
  for (const i of g.blocking) for (const m of standsFor(ctx, i)) own.set(m.meta.id, { item: m, owed: !isOpen(ctx, m) })
  for (const i of g.owed) for (const m of standsFor(ctx, i)) if (!own.has(m.meta.id)) own.set(m.meta.id, { item: m, owed: true })
  // Every open item outside the goal that one of them waits for, however far back.
  const all = new Map<string, { item: Item; owed: boolean; outside: boolean }>([...own].map(([k, v]) => [k, { ...v, outside: false }]))
  const edges = new Map<string, [string, string]>()
  const stack = [...own.values()].map((v) => v.item)
  while (stack.length) {
    const i = stack.pop()!
    for (const [rel, dir] of RELS) {
      for (const o of linked(ctx, i, rel)) {
        if (o === i || !isOpen(ctx, o)) continue
        if (!all.has(o.meta.id)) {
          // Only what the goal waits for joins from outside: a blocker, a part; never what waits for the goal.
          if (dir !== "after") continue
          all.set(o.meta.id, { item: o, owed: false, outside: true })
          stack.push(o)
        }
        const pair: [string, string] = dir === "after" ? [o.meta.id, i.meta.id] : [i.meta.id, o.meta.id]
        edges.set(pair.join(" "), pair)
      }
    }
  }
  const meetings = meetingsOf(ctx)
  const nodes: PlanNode[] = [...all.values()].map(({ item, owed, outside }) => {
    const effort = typeof item.meta["effort"] === "string" ? item.meta["effort"] : undefined
    const on = gatesOfItem(item)
    if (needsOwner(item) && isOpen(ctx, item)) {
      const at = on.find((g) => meetings.has(g))
      const m = at ? meetings.get(at)! : undefined
      const due = typeof item.meta["due"] === "string" ? item.meta["due"] : undefined
      const date = m?.on ?? due
      return {
        id: item.meta.id,
        ref: label(item),
        title: String(item.meta.title ?? ""),
        type: item.type,
        status: String(item.meta["status"] ?? ""),
        kind: "meeting" as const,
        meeting: { ...(at ? { gate: at } : {}), ...(date ? { on: date } : {}), needs: m?.needs ?? ["owner"] },
        ...(outside ? { outside: on.length ? (goalTitle.get(on[0]!) ?? on[0]!) : "no goal" } : {}),
        units: MEETING_UNITS,
        wave: -1,
        critical: false,
        after: [],
      }
    }
    const run: RunKind | undefined = RUN_TYPES[item.type] ?? (owed ? "proof run" : undefined)
    return {
      id: item.meta.id,
      ref: label(item),
      title: String(item.meta.title ?? ""),
      type: item.type,
      status: String(item.meta["status"] ?? ""),
      kind: run && !outside ? "run" : "work",
      ...(run && !outside ? { run } : {}),
      ...(outside ? { outside: on.length ? (goalTitle.get(on[0]!) ?? on[0]!) : "no goal" } : {}),
      units: (effort && EFFORT[effort]) || 1,
      ...(effort ? { effort } : {}),
      wave: -1,
      critical: false,
      after: [],
    }
  })
  if (g.fullSuite && !g.holds) {
    nodes.push({
      id: FULL_SUITE,
      ref: "",
      title: "The full test suite",
      type: "suite",
      status: "",
      kind: "run",
      run: "test suite",
      units: 1,
      wave: -1,
      critical: false,
      after: [],
    })
  }
  // Each meeting with an item of the plan on its agenda is a node of its own, which its agenda waits for.
  for (const [name, m] of meetings) {
    const agenda = nodes.filter((n) => n.meeting?.gate === name)
    if (!agenda.length) continue
    const id = `meeting:${name}`
    nodes.push({
      id,
      ref: "",
      title: m.title,
      type: "meeting",
      status: "",
      kind: "meeting",
      meeting: { gate: name, ...(m.on ? { on: m.on } : {}), needs: m.needs, agenda: agenda.length },
      units: MEETING_UNITS,
      wave: -1,
      critical: false,
      after: [],
    })
    for (const a of agenda) edges.set(`${id} ${a.id}`, [id, a.id])
  }
  const ids = new Set(nodes.map((n) => n.id))
  const edgeList = [...edges.values()].filter(([a, b]) => ids.has(a) && ids.has(b)).sort((x, y) => (x.join(" ") < y.join(" ") ? -1 : 1))
  const rank = new Map(nodes.map((n, i) => [n.id, i]))
  const laid = layPlan(nodes.map((n) => ({ id: n.id, kind: n.kind, units: n.units, rank: rank.get(n.id)! })), edgeList, capacityOf(ctx))
  const crit = new Set(laid.critical)
  for (const n of nodes) {
    n.wave = laid.wave.get(n.id) ?? -1
    n.critical = crit.has(n.id)
    n.after = edgeList.filter(([, b]) => b === n.id).map(([a]) => a)
  }
  nodes.sort((a, b) => (a.wave < 0 ? 1e9 : a.wave) - (b.wave < 0 ? 1e9 : b.wave) || Number(b.critical) - Number(a.critical) || (a.ref < b.ref ? -1 : 1))
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const waves: Wave[] = laid.waves.map((w, index) => ({ index, ...w, says: waveSays(w, index, laid, byId) }))
  const fingerprint = createHash("sha256").update(JSON.stringify([[...ids].sort(), edgeList])).digest("hex").slice(0, 12)
  const { proposed, approved } = stored(ctx, name)
  const approval: ApprovalState = approved ? (approved.fingerprint === fingerprint ? "approved" : "changed") : proposed ? "proposed" : "computed"
  const data: PlanData = {
    gate: name,
    title: g.title,
    ...(g.due ? { due: g.due } : {}),
    capacity: capacityOf(ctx),
    nodes,
    edges: edgeList,
    waves,
    critical: { nodes: laid.critical, units: laid.criticalUnits },
    units: waves.reduce((s, w) => s + w.units, 0),
    stuck: laid.stuck,
    fingerprint,
    proposed,
    approved,
    approval,
    summary: "",
  }
  data.summary = summaryOf(data)
  return data
}

/** A wave in plain words. The first: what can run at once, and what waits and for what. */
function waveSays(w: Laid["waves"][number], index: number, laid: Laid, by: Map<string, PlanNode>): string {
  const rest = waveSaysWork({ ...w, nodes: w.nodes.filter((id) => by.get(id)?.kind !== "meeting") }, index, laid, by)
  if (!w.meeting) return rest
  // The meetings of the wave: where the parallel work stops until they are held.
  const meets = w.nodes.map((id) => by.get(id)!).filter((x) => x.kind === "meeting")
  const behind = behindOf(meets.map((m) => m.id), by)
  const dated = meets.map((m) => m.meeting?.on).filter((d): d is string => !!d).sort()[0]
  const titles = meets.slice(0, 2).map((m) => shortTitle(m.title, 40))
  const head = `A meeting with you, ${dated ? `on ${dated}` : "waiting"}: ${titles.join("; ")}${meets.length > 2 ? ` and ${meets.length - 2} more` : ""}${
    behind ? `; ${count(behind, "item")} ${behind === 1 ? "waits" : "wait"} behind it` : ""
  }`
  return w.nodes.length > meets.length ? `${head}. Meanwhile, ${rest.charAt(0).toLowerCase()}${rest.slice(1)}` : head
}

/** How many nodes wait, however far down, behind any of `ids`. */
function behindOf(ids: string[], by: Map<string, PlanNode>): number {
  const seen = new Set<string>()
  const stack = [...ids]
  while (stack.length) {
    const id = stack.pop()!
    for (const x of by.values()) if (x.after.includes(id) && !seen.has(x.id)) seen.add(x.id), stack.push(x.id)
  }
  for (const id of ids) seen.delete(id)
  return seen.size
}

function waveSaysWork(w: Laid["waves"][number], index: number, laid: Laid, by: Map<string, PlanNode>): string {
  const n = w.nodes.length
  const runs = w.nodes.filter((id) => by.get(id)?.kind === "run").length
  const what = w.checkpoint ? count(n, "heavy run") : runs ? `${count(n - runs, "item")} and ${count(runs, "heavy run")}` : count(n, "item")
  if (index === 0) {
    const later = [...by.values()].filter((x) => x.kind === "work" && (laid.wave.get(x.id) ?? 0) > 0)
    const cause = new Map<string, number>()
    let slots = 0
    for (const x of later) {
      const open = x.after.filter((p) => (laid.wave.get(p) ?? -1) >= 0)
      if (!open.length) slots++
      for (const p of open) cause.set(p, (cause.get(p) ?? 0) + 1)
    }
    const top = [...cause].sort((a, b) => b[1] - a[1])[0]
    const waiting = later.length - slots
    const parts = [`${n === 1 ? "1 can run now" : `${n} can run at once`}`]
    if (waiting && top) {
      const t = shortTitle(by.get(top[0])?.title ?? "")
      parts.push(waiting === top[1] ? `${waiting} ${waiting === 1 ? "is" : "are"} waiting on ${t}` : `${waiting} are waiting, ${top[1]} of them on ${t}`)
    }
    if (slots) parts.push(`${slots} ${slots === 1 ? "waits" : "wait"} for a free worker`)
    if (w.checkpoint) return `The checkpoint: ${count(n, "heavy run")} can run at once`
    return parts.join("; ")
  }
  if (w.checkpoint) {
    const first = laid.waves.findIndex((x) => x.checkpoint) === index
    return first ? `Once the work is done, the checkpoint: ${what} at once` : `Then ${count(n, "more heavy run", "more heavy runs")} at once`
  }
  const gates = new Set(w.nodes.flatMap((id) => by.get(id)?.after ?? []).filter((p) => laid.wave.get(p) === index - 1))
  const names = [...gates].slice(0, 2).map((p) => shortTitle(by.get(p)?.title ?? "", 36))
  return `Then ${what} at once${names.length ? `, after ${names.join(" and ")}${gates.size > 2 ? ` and ${gates.size - 2} more` : ""}` : ", as workers free up"}`
}

/** The plan in a few lines. */
export function summaryOf(p: PlanData): string {
  const work = p.nodes.filter((n) => n.kind === "work").length
  const runs = p.nodes.filter((n) => n.kind === "run").length
  if (!p.nodes.length) return `${p.title}: nothing open, so there is nothing to plan.`
  const lines = [
    `${p.title}: ${count(work, "piece")} of work in ${count(p.waves.filter((w) => !w.checkpoint).length, "wave")}, at most ${p.capacity} at once${
      runs ? `, then ${count(runs, "heavy run")} at the checkpoint` : ""
    }; ${unitsSaid(p.units)} in all at full parallelism.`,
  ]
  if (p.waves[0]) lines.push(`Now: ${p.waves[0].says}.`)
  const meets = p.nodes.filter((n) => n.kind === "meeting")
  if (meets.length) {
    const waiting = meets.filter((m) => !m.meeting?.on).length
    lines.push(
      `It stops for the owner at ${count(meets.length, "point")}${waiting ? `, ${waiting} waiting for a meeting with you` : ""}: ${
        meets.slice(0, 3).map((m) => shortTitle(m.title, 40)).join("; ")
      }${meets.length > 3 ? "; …" : ""}.`,
    )
  }
  if (p.critical.nodes.length) {
    const names = p.critical.nodes.map((id) => shortTitle(p.nodes.find((n) => n.id === id)?.title ?? id, 40))
    lines.push(
      `Critical path, ${unitsSaid(p.critical.units)}: ${names.length > 4 ? [...names.slice(0, 2), "…", names.at(-1)].join(" → ") : names.join(" → ")}.`,
    )
  }
  if (p.stuck.length) lines.push(`${count(p.stuck.length, "item")} wait on each other in a cycle and can never start: naima check names it.`)
  lines.push(approvalSays(p))
  return lines.join("\n")
}

export function approvalSays(p: Pick<PlanData, "approval" | "proposed" | "approved">): string {
  const who = (s: Signed) => s.name ?? s.role
  const note = p.proposed ? ` Proposed by ${who(p.proposed)} (${p.proposed.role}) on ${p.proposed.on}: ${p.proposed.note}` : ""
  switch (p.approval) {
    case "approved":
      return `Approved by ${who(p.approved!)} on ${p.approved!.on}.${note}`
    case "changed":
      return `Approved by ${who(p.approved!)} on ${p.approved!.on}, but the plan has changed since: it needs approving again.${note}`
    case "proposed":
      return `Not approved yet.${note}`
    default:
      return "Computed from the dependencies; no agent has proposed a note and the owner has not approved it."
  }
}

/** Who signs: the name git knows, and the role of whoever runs the command. */
function signer(ctx: Context, name?: string): Signed {
  const who = name?.trim() || gitOrNull(ctx.root, "config", "user.name")?.trim()
  return { ...(who ? { name: who } : {}), role: filerRole(ctx.root), on: today(ctx) }
}

/** The roles that never approve a plan: an agent proposes, the owner approves. */
const NEVER_APPROVE = new Set(["worker", "agent"])

export function planCommand(deps: PlanDeps): Command {
  return {
    name: "plan",
    says:
      "the plan of a goal: its open items and what they wait for as a graph, in waves that run at once within maxWorkers, with the critical path and the heavy runs at the checkpoint; an agent proposes a note on it, the owner approves it",
    usage: 'plan [<goal>] [--json] | plan <goal> --propose "<note>" [--by <name>] | plan <goal> --approve [--by <name>]',
    enforces: "--approve is refused for the roles worker and agent: an agent proposes, the owner approves; plain plan prints derived state and writes nothing",
    options: [
      { name: "--json", says: "print the plan as JSON, the `plan` view's data" },
      {
        name: "--propose",
        says: "record a note on the plan, what an agent proposes or revises; it clears an approval, since a revised plan needs approving again",
      },
      { name: "--approve", says: "record the owner's approval of the plan as it is now, with its fingerprint; refused to a worker or an agent" },
      { name: "--by", says: "the name to sign with, instead of the one git knows" },
    ],
    examples: ["plan", "plan paper-ready", 'plan paper-ready --propose "run the 369-case run first: it finds the bugs"', "plan paper-ready --approve"],
    async run(args, ctx) {
      const p = parse(args, { json: { type: "boolean" }, propose: { type: "string" }, approve: { type: "boolean" }, by: { type: "string" } })
      const [name, ...rest] = p.positionals
      if (rest.length) throw new Error("plan takes one goal")
      if (!name) {
        if (bool(p, "approve") || str(p, "propose") !== undefined) throw new Error("plan --propose and --approve name a goal")
        const all = (await Promise.all(deps.names(ctx).map((n) => planOf(ctx, deps, n)))).filter((x): x is PlanData => !!x && x.nodes.length > 0)
        if (bool(p, "json")) ctx.out(JSON.stringify(all.map(brief), null, 2))
        else for (const x of all) ctx.out(`${x.gate.padEnd(18)} ${x.summary.split("\n")[0]}`)
        return 0
      }
      const propose = str(p, "propose")
      if (propose !== undefined && bool(p, "approve")) throw new Error("plan: --propose or --approve, not both")
      const plan = await planOf(ctx, deps, name)
      if (!plan) {
        ctx.err(`no goal "${name}" — goals: ${deps.names(ctx).join(", ") || "none"}`)
        return 1
      }
      const by = str(p, "by")
      if (propose !== undefined) {
        const note = propose.trim().replace(/\s+/g, " ")
        if (!note) throw new Error("plan --propose needs a note")
        deps.update(ctx, name, { plan: { proposed: { ...signer(ctx, by), note } } })
        ctx.out(`proposed a note on the plan of ${plan.title}; it needs the owner's approval: naima plan ${name} --approve`)
        return 0
      }
      if (bool(p, "approve")) {
        const s = signer(ctx, by)
        if (NEVER_APPROVE.has(s.role)) {
          ctx.err(`a ${s.role} does not approve a plan: the owner does, from the Plan view or with naima plan ${name} --approve; propose a note with --propose`)
          return 1
        }
        const keep = plan.proposed ? { proposed: { name: plan.proposed.name, role: plan.proposed.role, on: plan.proposed.on, note: plan.proposed.note } } : {}
        deps.update(ctx, name, { plan: { ...keep, approved: { ...s, fingerprint: plan.fingerprint } } })
        ctx.out(`approved the plan of ${plan.title} as it is now (${plan.fingerprint})`)
        return 0
      }
      ctx.out(bool(p, "json") ? JSON.stringify(plan, null, 2) : plan.summary)
      return 0
    },
  }
}

/** A plan in one line of data, for the list of every goal's. */
const brief = (p: PlanData) => ({
  gate: p.gate,
  title: p.title,
  work: p.nodes.filter((n) => n.kind === "work").length,
  meetings: p.nodes.filter((n) => n.kind === "meeting").length,
  runs: p.nodes.filter((n) => n.kind === "run").length,
  waves: p.waves.length,
  units: p.units,
  critical: p.critical.units,
  approval: p.approval,
  says: p.summary.split("\n")[0],
})

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")

/** The view `plan`: with `gate`, that goal's plan; without, a line for each goal with open work. */
export function planUiView(deps: PlanDeps) {
  return {
    name: "plan",
    title: "Plan",
    // The new UI shows it as the Plan view of a goal, not as a view of its own in the bar.
    screen: true,
    says:
      "the plan of a goal (query gate=<goal>): its open items as a graph of what waits for what, in waves within maxWorkers, the critical path, the heavy runs at the checkpoint, the note an agent proposed and the owner's approval, and a short summary; without a gate, one line for each goal with open work",
    async render(params: Record<string, string[]>, ctx: Context) {
      const gate = params["gate"]?.[0]
      if (gate) {
        const p = await planOf(ctx, deps, gate)
        if (!p) throw new Error(`no goal "${gate}"`)
        return { data: p, html: `<pre>${esc(p.summary)}</pre>` }
      }
      const all = (await Promise.all(deps.names(ctx).map((n) => planOf(ctx, deps, n)))).filter((x): x is PlanData => !!x && x.nodes.length > 0)
      return { data: all.map(brief), html: `<ul>${all.map((x) => `<li>${esc(x.summary.split("\n")[0]!)}</li>`).join("")}</ul>` }
    },
  }
}
