// Goals, as development lines need them: their order, when one is finished,
// its freeze, and when the trunk and a line are ready for the line to land.
//
// A gate may say `after: [gates]`, the goals it comes after, besides the
// order release gates take by version and dated gates by due date. A goal is
// finished when its version is released (a git tag carries it), or, with no
// version, when it holds and its due date, if any, has come. A gate's
// `freeze: <date>` is in force from that date while its goal is unfinished,
// and refuses every landing on the trunk that closes a feature; the owner
// clears it with `naima gate set <gate> --freeze ""`. The trunk is ready for
// the line of goal G when every goal ordered before G is finished; the line
// is ready when it is up to date with the trunk and G holds on its tip.
// The model these follow: develop/models/lines/lines.mcrl2.

import { type Context, gitOrNull, isAncestor, today, trunk } from "../../core/api.ts"
import { type GateDef, gatesOf, releaseTags, versionKey } from "./index.ts"

/** The type whose items are features: a landing that closes one is refused during a freeze. Read by name. */
const FEATURES = "features"
/** The trailer a landing on a line names each item it fixes with, written by the coordination plugin. Read by name. */
const FIXES = "Fixes"

const defOf = (ctx: Context, name: string): GateDef | undefined => gatesOf(ctx).find((g) => g.name === name)?.value

/** A version's numbers, for comparing: 1.10 after 1.9. */
const numbers = (v: string): number[] => versionKey(v).split(/[.-]/).slice(0, 3).map((n) => Number(n) || 0)
const versionBefore = (a: string, b: string): boolean => {
  const [x, y] = [numbers(a), numbers(b)]
  for (let i = 0; i < 3; i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) < (y[i] ?? 0)
  return false
}

/** Whether goal `x` comes right before goal `y`: `y`'s after names it, or both have a version and `x`'s is lower, or both a due date and `x`'s is earlier. */
const rightBefore = (x: GateDef, y: GateDef): boolean =>
  !!y.after?.includes(x.name) || (!!x.version && !!y.version && versionBefore(x.version, y.version)) || (!!x.due && !!y.due && x.due < y.due)

/**
 * Whether goal `a` comes before goal `b`: through any chain of goals each right before the next, by a gate's after,
 * by version, or by due date. After adds to the order the versions and due dates make; it never replaces it.
 */
export function goalBefore(ctx: Context, a: string, b: string): boolean {
  if (a === b) return false
  const all = gatesOf(ctx).map((g) => g.value)
  const target = all.find((g) => g.name === b)
  if (!target || !all.some((g) => g.name === a)) return false
  const seen = new Set<string>([b])
  const todo: GateDef[] = [target]
  while (todo.length) {
    const y = todo.pop()!
    for (const x of all) {
      if (seen.has(x.name) || !rightBefore(x, y)) continue
      if (x.name === a) return true
      seen.add(x.name)
      todo.push(x)
    }
  }
  return false
}

/** Whether a goal is finished: its version released (a tag carries it), or, with no version, it holds and its due date has come. */
export async function finished(ctx: Context, gate: GateDef): Promise<boolean> {
  if (gate.version) return releaseTags(ctx).has(versionKey(gate.version))
  if (gate.due && gate.due > today(ctx)) return false
  return (await gate.evaluate(ctx)).holds
}

/** The goals frozen now: a freeze date that has come, on a goal not finished. */
export async function frozenGoals(ctx: Context): Promise<GateDef[]> {
  const out: GateDef[] = []
  for (const { value: g } of gatesOf(ctx)) if (g.freeze && g.freeze <= today(ctx) && !(await finished(ctx, g))) out.push(g)
  return out
}

/** The features among items, by id. */
const featuresOf = (ctx: Context, ids: readonly string[]): string[] =>
  ids.flatMap((id) => {
    const i = ctx.repo.byId.get(id)
    return i && i.type === FEATURES ? [`${i.type}/${i.slug}`] : []
  })

/** The items fixed on the line of `gate`, from the Fixes: trailers of its landings the trunk lacks. */
export function fixedOnLine(ctx: Context, gate: string): string[] {
  const main = trunk(ctx.root)
  if (!main) return []
  const out = gitOrNull(ctx.root, "log", "--first-parent", `--format=%(trailers:key=${FIXES},valueonly)`, `${main}..refs/heads/line/${gate}`) ?? ""
  return [...new Set(out.split("\n").map((s) => s.trim()).filter(Boolean))]
}

/**
 * Why the line of `gate` may not land on the trunk, each in one line; empty when the trunk and the line are ready.
 * `tip` is the tracker as the line's tip has it, where the goal must hold; `closes`, the items the landing closes.
 */
export async function lineNotReady(ctx: Context, tip: Context, gate: string, closes: readonly string[]): Promise<string[]> {
  const out: string[] = []
  const def = defOf(tip, gate)
  if (!def) return [`no gate ${gate}: a line is tied to a goal of the trunk`]
  for (const { value: g } of gatesOf(ctx)) {
    if (goalBefore(ctx, g.name, gate) && !(await finished(ctx, g))) {
      out.push(`the trunk is not ready: ${g.name}, a goal ordered before ${gate}, is not finished${g.version ? ` (no release tag for ${g.version} yet)` : ""}`)
    }
  }
  const main = trunk(ctx.root)
  if (main && !isAncestor(ctx.root, main, `refs/heads/line/${gate}`)) out.push(`the line is not up to date with ${main}: naima line sync ${gate}`)
  const r = await def.evaluate(tip)
  if (!r.holds) {
    const what = [...r.blocking.map((i) => `${i.type}/${i.slug}`), ...(r.reasons ?? [])]
    out.push(`the line is not ready: ${gate} does not hold on its tip (${what.slice(0, 5).join(", ")}${what.length > 5 ? ", …" : ""})`)
  }
  out.push(...(await freezeRefusal(ctx, featuresOf(tip, closes))))
  return out
}

/** Why closing `features` on the trunk is refused now: a freeze in force. */
async function freezeRefusal(ctx: Context, features: string[]): Promise<string[]> {
  if (!features.length) return []
  return (await frozenGoals(ctx)).map((g) =>
    `${g.name} is frozen from ${g.freeze} and not finished: no landing on the trunk closes a feature (${
      features.join(", ")
    }) — land fixes only, or the owner clears the freeze (naima gate set ${g.name} --freeze "")`
  )
}

/** What naima land hands a landing check: the coordination plugin's landing, read by its shape. */
interface Landing {
  branch: string
  closes?: string[]
}

/** What the gates plugin tells naima land: a line lands only when ready, and no feature closes on the trunk during a freeze. */
export const goalsLanding = {
  name: "goals",
  says:
    "refuses a landing on the trunk that closes a feature while a goal's freeze is in force, and the landing of a development line (line/<gate>) unless every goal ordered before its gate is finished and its gate holds on the line's tip",
  async refuses(ctx: Context, landing: Landing): Promise<string[]> {
    const gate = landing.branch.startsWith("line/") ? landing.branch.slice("line/".length) : null
    // The checkout holds the branch tip's files while the landing is checked: ctx is the tip.
    if (gate) return await lineNotReady(ctx, ctx, gate, landing.closes ?? [])
    return await freezeRefusal(ctx, featuresOf(ctx, landing.closes ?? []))
  },
}

/** The goal order the coordination plugin reads, so that naima open refuses an item on the line of a goal after its own. */
export const goalOrder = {
  name: "gates",
  says: "a gate's after, added to the order release gates take by version and dated gates by due date",
  before: (ctx: Context, a: string, b: string): boolean => goalBefore(ctx, a, b),
}
