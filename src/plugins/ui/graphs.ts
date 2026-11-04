// The map view: the graphs the new UI's map draws besides the lines and their commits (the bridge's metro):
//
//   goals  each gate the project declares, as `naima gates --json` gives it, with the date its goal started (the
//          earliest creation of an item on the gate) and, for each step, the date of the record that closed it
//   deps   the items that wait for others: every `blocks` / `blocked-by` link with an open item on either end, as an
//          edge from the item that comes first to the one that waits for it, and each item at its ends
//
// Plugins never import each other, so the gates are read the way a person would, from their command (metro.ts's
// commandJson); the links and the items are the core's.

import { type Context, isOpen, type Item, label, storedLinks } from "../../core/api.ts"
import { commandJson, type GateRow } from "./metro.ts"

export interface GoalStep {
  name: string
  title: string
  state: string
  /** The day the record that closed it was closed, when it is. */
  on?: string
}

export interface Goal {
  gate: string
  title: string
  version?: string
  due?: string
  holds: boolean
  finished: boolean
  /** The day its first item was created, or null when no item is on it. */
  start: string | null
  /** The goals ordered before it. */
  before: string[]
  steps: GoalStep[]
}

export interface DepNode {
  id: string
  ref: string
  title: string
  type: string
  status: string
  open: boolean
  /** The gate it is on, when it is on one. */
  gate?: string
}

export interface MapGraphs {
  goals: Goal[]
  deps: { nodes: DepNode[]; edges: [string, string][] }
}

const day = (v: unknown): string | undefined => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : undefined)
const gatesOf = (item: Item): string[] => {
  const g = item.meta["gate"]
  return typeof g === "string" ? [g] : Array.isArray(g) ? g.filter((x): x is string => typeof x === "string") : []
}

/** The goals of the gates, each with its start and the days its steps closed. */
export function goalGraph(ctx: Context, gates: readonly GateRow[]): Goal[] {
  const byRef = new Map(ctx.repo.items.map((i) => [label(i), i]))
  return gates.map((g) => {
    const created = ctx.repo.items.filter((i) => gatesOf(i).includes(g.gate)).map((i) => day(i.meta["created"])).filter((d): d is string => !!d).sort()
    const steps = (g.steps ?? []).map((s) => {
      const by = (s.closedBy ?? []).map((r) => byRef.get(r)).filter((i): i is Item => !!i)
      const on = by.map((i) => day(i.meta["closedOn"]) ?? day(i.meta["fixedOn"])).filter((d): d is string => !!d).sort().at(-1)
      return { name: s.name, title: s.title, state: s.state, ...(s.state === "closed" && on ? { on } : {}) }
    })
    return {
      gate: g.gate,
      title: g.title,
      ...(g.version ? { version: g.version } : {}),
      ...(g.due ? { due: g.due } : {}),
      holds: g.holds,
      finished: g.finished === true,
      start: created[0] ?? null,
      before: g.before ?? [],
      steps,
    }
  })
}

/** The items that wait for others, and the edges between them: from the item first to the one that waits for it. */
export function depGraph(ctx: Context): MapGraphs["deps"] {
  const edges = new Map<string, [string, string]>()
  for (const item of ctx.repo.items) {
    const id = String(item.meta.id ?? "")
    for (const l of storedLinks(item.meta)) {
      const pair: [string, string] | null = l.rel === "blocks" ? [id, l.id] : l.rel === "blocked-by" ? [l.id, id] : null
      if (!pair || pair[0] === pair[1]) continue
      const a = ctx.repo.byId.get(pair[0])
      const b = ctx.repo.byId.get(pair[1])
      if (!a || !b || (!isOpen(ctx, a) && !isOpen(ctx, b))) continue
      edges.set(pair.join(" "), pair)
    }
  }
  const ids = new Set([...edges.values()].flat())
  const nodes = [...ids].map((id) => {
    const i = ctx.repo.byId.get(id)!
    const gate = gatesOf(i)[0]
    return {
      id,
      ref: label(i),
      title: String(i.meta["title"] ?? ""),
      type: i.type,
      status: String(i.meta["status"] ?? ""),
      open: isOpen(ctx, i),
      ...(gate ? { gate } : {}),
    }
  }).sort((a, b) => (a.ref < b.ref ? -1 : a.ref > b.ref ? 1 : 0))
  return { nodes, edges: [...edges.values()] }
}

export async function mapGraphs(ctx: Context): Promise<MapGraphs> {
  return { goals: goalGraph(ctx, (await commandJson<GateRow[]>(ctx, ["gates"])) ?? []), deps: depGraph(ctx) }
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;")

/** The view: its data is the goals and the dependencies; the new UI's map screen reads it. */
export const mapView = {
  name: "map",
  title: "Map",
  says:
    "the graphs the new UI's map draws besides the lines and their commits: each gate's goal with its start, due date and steps (with the day each closed), and the items that wait for others, as edges from the item first to the one that waits",
  screen: true,
  async render(_params: Record<string, string[]>, ctx: Context) {
    const data = await mapGraphs(ctx)
    const html = [
      `<h3>Goals</h3><ul>${data.goals.map((g) => `<li><code>${esc(g.gate)}</code> ${esc(g.title)}${g.due ? `, due ${esc(g.due)}` : ""}, ${g.steps.length} steps</li>`).join("")}</ul>`,
      `<h3>Dependencies</h3><p>${data.deps.edges.length} items wait for others, among ${data.deps.nodes.length} items.</p>`,
    ].join("\n")
    return { data, html }
  },
}
