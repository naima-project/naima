// A gate's steps: its sub-goals, in order. They come from two places. A method
// is an ordered list of steps a plugin, typically a stance, contributes to the
// `methods` point; a gate that follows one (`method` in its configuration,
// `naima gate set <gate> --method <stance>/<method>`) gets the method's steps.
// A gate may also have steps of its own (`steps` in its configuration, written
// by `naima gate step add|remove`), which come after the method's. The gate
// holds only once every step is closed.
//
// Nothing about a step's progress is stored on the gate. A step is closed by a record: an
// item carrying `closesStep: <gate>/<step>` whose status is settled (in the done
// category, such as a settled decision) and not retired. `naima gate step`
// writes it, and refuses while the step before is not closed; a record written
// by hand in another order is allowed, and the order is kept by the derivation:
// a step counts as closed only when it and every step before it have a settled
// record. Reopening a record reopens its step and every step after it. The
// model: develop/models/method-steps/ in the workshop.

import { type Check, code, type Context, type ExtensionPoint, fieldValue, type Finding, isOpen, isRetired, type Item, label, table } from "../../core/api.ts"

/** One step of a method: what it is, and the exit criterion that closes it. */
export interface MethodStep {
  /** Lowercase letters, digits and dashes: what `closesStep` and `naima gate step` name it by. */
  name: string
  title: string
  /** The exit criterion: what must be true, and recorded, for the step to close, such as "the owner chose a variant". */
  exit: string
}

/** A method: its steps, in the order they close. */
export interface MethodDef {
  name: string
  title: string
  says: string
  steps: MethodStep[]
}

/** A step's name: lowercase letters, digits and dashes. */
export const STEP_NAME = /^[a-z0-9][a-z0-9-]*$/

/** The point a stance declares its methods on: the gates plugin declares it, any plugin may contribute. */
export const methodsPoint: ExtensionPoint<MethodDef> = {
  id: "methods",
  says:
    "an ordered list of steps, each with an exit criterion, that a gate may follow (`naima gate set <gate> --method <plugin>/<method>`): `name`, `title`, `says`, `steps: [{ name, title, exit }]`; the gate holds only once every step is closed, in order",
  noun: "method",
  key: (m) => m.name,
  validate: (v) => {
    const m = v as Partial<MethodDef> | null
    if (!m || typeof m !== "object") return "is not an object"
    if (typeof m.name !== "string" || typeof m.title !== "string") return "has no name or title"
    if (!Array.isArray(m.steps) || !m.steps.length) return "has no steps"
    const seen = new Set<string>()
    for (const s of m.steps as Partial<MethodStep>[]) {
      if (!s || typeof s !== "object" || typeof s.name !== "string" || !STEP_NAME.test(s.name)) {
        return "has a step whose name is not lowercase letters, digits and dashes"
      }
      if (typeof s.title !== "string" || typeof s.exit !== "string" || !s.exit.trim()) return `has a step ${s.name} without a title or an exit criterion`
      if (seen.has(s.name)) return `names the step ${s.name} twice`
      seen.add(s.name)
    }
    return null
  },
  gaps: (m) => (typeof m.says !== "string" || !m.says.trim() ? ["does not say what it is for"] : []),
  document: (methods) => [
    "",
    "**Methods**, which a gate follows with `naima gate set <gate> --method <plugin>/<method>`",
    ...table(
      ["Method", "Title", "What it is for", "Steps, in order"],
      methods.map((m) => [code(m.name), m.title, m.says, m.steps.map((s) => `${code(s.name)} (closes when ${s.exit})`).join("; ")]),
    ),
  ],
}

/** The field a record carries: the steps it closes, each `<gate>/<step>`. */
export const CLOSES_STEP = { name: "closesStep", kind: "strings" } as const

/** The method a gate names, by qualified id or short name; `<stance>/<method>` finds the stance's plugin, `stance-<stance>`. */
export function findMethod(ctx: Context, ref: string): { id: string; method: MethodDef } | undefined {
  if (!ctx.registry.points.has(methodsPoint.id)) return undefined
  const slash = ref.indexOf("/")
  const refs = [ref, ...(slash > 0 && !ref.startsWith("stance-") ? [`stance-${ref}`] : [])]
  for (const r of refs) {
    const found = ctx.registry.find<MethodDef>(methodsPoint.id, r)
    if (found) return { id: found.id, method: found.value }
  }
  return undefined
}

/** One step as a gate shows it: closed, the next to close, or waiting for the one before. */
export interface StepState {
  name: string
  title: string
  exit: string
  /** 1-based. */
  index: number
  state: "closed" | "next" | "waiting"
  /** The settled records that close it. */
  closedBy: string[]
  /** A step of the gate's own, not of its method. */
  own?: boolean
}

/** The settled, unretired items that record `<gate>/<step>` closed. */
const recordsOf = (ctx: Context, gate: string, step: string): Item[] =>
  ctx.repo.items.filter((i) => (fieldValue(i, CLOSES_STEP) ?? []).includes(`${gate}/${step}`) && !isOpen(ctx, i) && !isRetired(ctx, i))

/** Each step on `gate`, derived from the records: a step is closed only when every step before it is. */
export function stepStates(ctx: Context, gate: string, steps: readonly (MethodStep & { own?: boolean })[]): StepState[] {
  let before = true
  let next = true
  return steps.map((s, n) => {
    const by = recordsOf(ctx, gate, s.name).map(label)
    const closed = before && by.length > 0
    before = closed
    const state = closed ? "closed" : next ? "next" : "waiting"
    if (!closed) next = false
    return { name: s.name, title: s.title, exit: s.exit, index: n + 1, state, closedBy: closed ? by : [], ...(s.own ? { own: true } : {}) }
  })
}

/** What a gate declares about its steps: the method it follows, and its own steps. */
export interface GateSteps {
  method?: string
  steps?: MethodStep[]
}

/**
 * What a gate's steps add to its verdict: the method's steps, then its own, and a reason while one is not closed — or
 * the reason its method cannot be found, in which case only its own steps are listed.
 */
export function stepsVerdict(ctx: Context, gate: string, declared: GateSteps): { steps: StepState[]; reasons: string[]; method?: string } {
  const reasons: string[] = []
  const found = declared.method !== undefined ? findMethod(ctx, declared.method) : undefined
  if (declared.method !== undefined && !found) {
    reasons.push(`follows the method ${declared.method}, which no loaded plugin contributes — adopt its stance, or naima gate set ${gate} --method ""`)
  }
  const steps = stepStates(ctx, gate, [...(found?.method.steps ?? []), ...(declared.steps ?? []).map((s) => ({ ...s, own: true }))])
  const next = steps.find((s) => s.state === "next")
  if (next) {
    reasons.push(
      `step ${next.index} of ${steps.length}${
        next.own ? "" : ` of ${found?.id}`
      } is next: ${next.name} (${next.title}), closed when ${next.exit} — naima gate step ${gate} ${next.name} --by <item>`,
    )
  }
  return { steps, reasons, ...(found ? { method: found.id } : {}) }
}

/** A record that names a gate with no steps, or a step the gate lacks: noted, since it closes nothing. */
export function stepRecordsCheck(gates: Readonly<Record<string, GateSteps>>): Check {
  return {
    name: "method-steps",
    says:
      "an item's closesStep names a gate that has steps, and one of its steps (of its method or its own); a gate's method is one a loaded plugin contributes, and none of its own steps shares a name with a step of its method",
    run(ctx) {
      const out: Finding[] = []
      const names = new Map<string, string[]>()
      for (const [gate, d] of Object.entries(gates)) {
        const found = d.method !== undefined ? findMethod(ctx, d.method) : undefined
        if (d.method !== undefined && !found) {
          out.push({
            level: "problem",
            message:
              `gate ${gate} follows the method ${d.method}, which no loaded plugin contributes — adopt its stance, or naima gate set ${gate} --method ""`,
          })
        }
        const fromMethod = found?.method.steps.map((s) => s.name) ?? []
        const own = (d.steps ?? []).map((s) => s.name)
        for (const n of own.filter((n) => fromMethod.includes(n))) {
          out.push({
            level: "problem",
            message: `gate ${gate} has a step of its own named ${n}, as a step of its method ${found?.id} is — naima gate step remove ${gate} ${n}`,
          })
        }
        if (d.method !== undefined || own.length) names.set(gate, found || d.method === undefined ? [...fromMethod, ...own] : [])
      }
      for (const item of ctx.repo.items) {
        for (const ref of fieldValue(item, CLOSES_STEP) ?? []) {
          const [gate = "", step = ""] = ref.split("/")
          const steps = names.get(gate)
          if (steps === undefined) out.push({ level: "note", item, message: `${label(item)} closes step ${ref}, but gate ${gate} has no steps` })
          else if (steps.length && !steps.includes(step)) {
            out.push({ level: "note", item, message: `${label(item)} closes step ${ref}, but gate ${gate} has no step ${step}` })
          }
        }
      }
      return out
    },
  }
}
