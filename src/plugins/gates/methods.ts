// Methods: an ordered list of steps a plugin, typically a stance, contributes to
// the `methods` point. A gate that follows one (`method` in its configuration,
// `naima gate set <gate> --method <stance>/<method>`) gets the method's steps as
// sub-goals, in order, and holds only once every one is closed.
//
// Nothing about a step is stored on the gate. A step is closed by a record: an
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

const STEP_NAME = /^[a-z0-9][a-z0-9-]*$/

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
}

/** The settled, unretired items that record `<gate>/<step>` closed. */
const recordsOf = (ctx: Context, gate: string, step: string): Item[] =>
  ctx.repo.items.filter((i) => (fieldValue(i, CLOSES_STEP) ?? []).includes(`${gate}/${step}`) && !isOpen(ctx, i) && !isRetired(ctx, i))

/** Each step of `method` on `gate`, derived from the records: a step is closed only when every step before it is. */
export function stepStates(ctx: Context, gate: string, method: MethodDef): StepState[] {
  let before = true
  let next = true
  return method.steps.map((s, n) => {
    const by = recordsOf(ctx, gate, s.name).map(label)
    const closed = before && by.length > 0
    before = closed
    const state = closed ? "closed" : next ? "next" : "waiting"
    if (!closed) next = false
    return { name: s.name, title: s.title, exit: s.exit, index: n + 1, state, closedBy: closed ? by : [] }
  })
}

/** What a gate's method adds to its verdict: its steps, and a reason while one is not closed — or the reason the method cannot be found. */
export function methodVerdict(ctx: Context, gate: string, ref: string): { steps: StepState[]; reasons: string[]; method?: string } {
  const found = findMethod(ctx, ref)
  if (!found) {
    return { steps: [], reasons: [`follows the method ${ref}, which no loaded plugin contributes — adopt its stance, or naima gate set ${gate} --method ""`] }
  }
  const steps = stepStates(ctx, gate, found.method)
  const next = steps.find((s) => s.state === "next")
  const reasons = next
    ? [
      `step ${next.index} of ${steps.length} of ${found.id} is next: ${next.name} (${next.title}), closed when ${next.exit} — naima gate step ${gate} ${next.name} --by <item>`,
    ]
    : []
  return { steps, reasons, method: found.id }
}

/** A record that names a gate following no method, or a step its method lacks: noted, since it closes nothing. */
export function stepRecordsCheck(methods: Readonly<Record<string, string>>): Check {
  return {
    name: "method-steps",
    says: "an item's closesStep names a gate that follows a method, and a step of that method; a gate's method is one a loaded plugin contributes",
    run(ctx) {
      const out: Finding[] = []
      for (const [gate, ref] of Object.entries(methods)) {
        if (!findMethod(ctx, ref)) {
          out.push({
            level: "problem",
            message: `gate ${gate} follows the method ${ref}, which no loaded plugin contributes — adopt its stance, or naima gate set ${gate} --method ""`,
          })
        }
      }
      for (const item of ctx.repo.items) {
        for (const ref of fieldValue(item, CLOSES_STEP) ?? []) {
          const [gate = "", step = ""] = ref.split("/")
          const m = Object.hasOwn(methods, gate) ? methods[gate] : undefined
          const found = m === undefined ? undefined : findMethod(ctx, m)
          if (m === undefined) out.push({ level: "note", item, message: `${label(item)} closes step ${ref}, but gate ${gate} follows no method` })
          else if (found && !found.method.steps.some((s) => s.name === step)) {
            out.push({ level: "note", item, message: `${label(item)} closes step ${ref}, but the method ${found.id} has no step ${step}` })
          }
        }
      }
      return out
    },
  }
}
