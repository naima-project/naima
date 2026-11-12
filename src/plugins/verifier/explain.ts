// What makes formal work readable by a person: a property's `says` sentence and its `glosses`, and a refinement
// recorded as a link between two models.
//
// A property records `says`, one sentence in plain words stating what must hold and of what, and `glosses`, the parts
// of its formula each paired with a plain phrase: a JSON object whose keys are the exact text of a sub-formula (or of a
// modality's or fixpoint's head, such as `[true*.expand]` or `nu X.`) and whose values are the phrases, kept in the
// order written. `naima explain` sets both. A refinement is a `refinements` item: the `lower` model, the `upper` one,
// the `relation` the lower is checked against the upper by, the actions `hidden` and `renamed` before comparing, and
// `says`, one sentence saying what the lower model guarantees with respect to the upper. `naima refine` records one.

import { existsSync, readFileSync, statSync } from "node:fs"
import { resolve } from "node:path"
import { bool, type Command, type Context, createItem, type Item, label, parse, saveMeta, str, strs, typeOrThrow, usageError } from "../../core/api.ts"

export const REFINEMENTS = "refinements"

/** A part's text as glosses are matched: every white space dropped, so a gloss survives a reformatted formula. */
export const partKey = (s: string): string => s.replace(/\s+/g, "")

/**
 * One `--gloss "<part>=<phrase>"`: split at the last `=` that is not part of an operator (`==`, `!=`, `<=`, `>=`,
 * `=>`), so a part may hold data comparisons; the phrase holds no `=`. Throws, naming what is wrong.
 */
export function parseGloss(raw: string): { part: string; phrase: string } {
  let at = -1
  for (let i = raw.length - 1; i >= 0; i--) {
    if (raw[i] !== "=") continue
    const before = raw[i - 1] ?? "", after = raw[i + 1] ?? ""
    if ((before && "=!<>".includes(before)) || after === "=" || after === ">") continue
    at = i
    break
  }
  if (at < 0) throw new Error(`gloss "${raw}" is not <part>=<phrase>: the part of the formula, =, then a plain phrase`)
  const part = raw.slice(0, at).trim(), phrase = raw.slice(at + 1).trim()
  if (!part) throw new Error(`gloss "${raw}" names no part of the formula before =`)
  if (!phrase) throw new Error(`gloss "${raw}" has no phrase after =`)
  return { part, phrase }
}

/** A property's formula text: the file `property` names from the project root, else the property as written. */
export function formulaText(ctx: Context, item: Item): string {
  const p = String(item.meta["property"] ?? "")
  const abs = resolve(ctx.root, p)
  try {
    if (p && existsSync(abs) && statSync(abs).isFile()) return readFileSync(abs, "utf8")
  } catch {
    // unreadable: the property as written
  }
  return p
}

/** The glosses a property records, in order; anything that is not a phrase is left out. */
export function glossesOf(item: Item): [string, string][] {
  const g = item.meta["glosses"]
  if (!g || typeof g !== "object" || Array.isArray(g)) return []
  return Object.entries(g as Record<string, unknown>).filter((e): e is [string, string] => typeof e[1] === "string")
}

/**
 * The glosses after adding `added` to `kept`: a part already glossed (by its text without spaces) has its phrase
 * replaced where it stands, a new one goes last.
 */
export function mergeGlosses(kept: readonly [string, string][], added: readonly { part: string; phrase: string }[]): Record<string, string> {
  const out: [string, string][] = kept.map(([p, g]) => [p, g])
  for (const { part, phrase } of added) {
    const i = out.findIndex(([p]) => partKey(p) === partKey(part))
    if (i >= 0) out[i] = [out[i]![0], phrase]
    else out.push([part, phrase])
  }
  return Object.fromEntries(out)
}

export const explain: Command = {
  name: "explain",
  says:
    "record what a property means for a person: its says sentence and a gloss for each part of its formula, which the UI's Properties screen shows in place of the text it generates",
  enforces:
    "a gloss names a part that is in the property's formula, by its exact text (white space aside); a gloss for a part already glossed replaces its phrase in place, a new one is added after the others; --replace drops the glosses kept before",
  usage: 'explain <property> [--says "<sentence>"] [--gloss "<part>=<phrase>"]... [--replace]',
  options: [
    { name: "--says", says: "one sentence in plain words: what must hold, and of what" },
    { name: "--gloss", says: "a part of the formula, by its exact text, =, then a plain phrase; repeat it for each part, in reading order" },
    { name: "--replace", says: "drop the glosses recorded before, keeping only the ones given now" },
  ],
  examples: [
    'explain no-deadlock --says "After any sequence of steps the machine can still take one." --gloss "[true*]=after any sequence of steps" --gloss "<true>true=some step is possible"',
  ],
  run(args, ctx) {
    const p = parse(args, { says: { type: "string" }, gloss: { type: "string", multiple: true }, replace: { type: "boolean" } })
    const [ref, ...extra] = p.positionals
    const says = str(p, "says")?.trim()
    const added = strs(p, "gloss").map(parseGloss)
    if (!ref || extra.length || (says === undefined && !added.length && !bool(p, "replace"))) throw usageError(this)
    const item = ctx.repo.resolve(ref)
    if (item.type !== "properties") throw new Error(`${label(item)} is not a property`)
    const formula = partKey(formulaText(ctx, item))
    const absent = added.filter((g) => !formula.includes(partKey(g.part)))
    if (absent.length) {
      throw new Error(`${label(item)}: not in its formula: ${absent.map((g) => JSON.stringify(g.part)).join(", ")} — a gloss names a part by its exact text`)
    }
    const meta: Record<string, unknown> = { ...item.meta }
    if (says !== undefined) {
      if (says) meta["says"] = says
      else delete meta["says"]
    }
    const glosses = mergeGlosses(bool(p, "replace") ? [] : glossesOf(item), added)
    if (Object.keys(glosses).length) meta["glosses"] = glosses
    else delete meta["glosses"]
    saveMeta(ctx, { ...item, meta: meta as Item["meta"] }, { authored: true })
    ctx.out(`${label(item)}: ${says !== undefined ? "says set; " : ""}${Object.keys(glosses).length} gloss${Object.keys(glosses).length === 1 ? "" : "es"}`)
    return 0
  },
}

/** A model's path as refinements store it: from the project root, forward slashes, no leading ./ */
const modelRel = (p: string) => p.replace(/\\/g, "/").replace(/^\.\//, "").trim()

/** The refinement items, each with its two models. */
export function refinementsOf(ctx: Context): { item: Item; lower: string; upper: string }[] {
  return ctx.repo.items.filter((i) => i.type === REFINEMENTS).map((item) => ({
    item,
    lower: modelRel(String(item.meta["lower"] ?? "")),
    upper: modelRel(String(item.meta["upper"] ?? "")),
  }))
}

/** `a=b,c=d` or a JSON object: the actions renamed before comparing, from the name in the lower model to the upper's. */
function parseRenamed(raw: string): Record<string, string> {
  if (raw.trim().startsWith("{")) {
    const v: unknown = JSON.parse(raw)
    if (!v || typeof v !== "object" || Array.isArray(v) || Object.values(v).some((x) => typeof x !== "string")) {
      throw new Error("--rename takes a JSON object of names, or from=to,...")
    }
    return v as Record<string, string>
  }
  return Object.fromEntries(
    raw.split(",").map((s) => s.trim()).filter(Boolean).map((s) => {
      const [a, b, ...rest] = s.split("=").map((x) => x.trim())
      if (!a || !b || rest.length) throw new Error(`--rename "${s}" is not from=to`)
      return [a, b]
    }),
  )
}

export const refine: Command = {
  name: "refine",
  says:
    "record that one model refines another: the relation it is checked by, the actions hidden or renamed before comparing, and one sentence saying what the lower model guarantees with respect to the upper",
  enforces:
    "both models are files in the project; one record per pair of models, updated in place when recorded again; a refinement has its relation and its sentence",
  usage: 'refine <lower model> <upper model> --relation "<relation>" --says "<sentence>" [--hide a,b] [--rename from=to,...]',
  options: [
    {
      name: "--relation",
      says: "the relation the lower model is checked against the upper by, as the tool that checks it names it (trace inclusion, branching bisimulation ...)",
    },
    { name: "--says", says: "one sentence for a reader who knows state machines: what the lower model guarantees with respect to the upper" },
    { name: "--hide", says: "the actions hidden before comparing, comma-separated" },
    { name: "--rename", says: "the actions renamed before comparing, from=to comma-separated, or a JSON object" },
  ],
  examples: [
    'refine models/shell-refined.mcrl2 models/shell.mcrl2 --relation "trace inclusion" --hide read_cache,tick --says "Every run of the refined shell is a run of the small shell once its internal steps are hidden."',
  ],
  run(args, ctx) {
    const p = parse(args, { relation: { type: "string" }, says: { type: "string" }, hide: { type: "string" }, rename: { type: "string" } })
    const [lowerArg, upperArg, ...extra] = p.positionals
    if (!lowerArg || !upperArg || extra.length) throw usageError(this)
    const lower = modelRel(lowerArg), upper = modelRel(upperArg)
    if (lower === upper) throw new Error("a model does not refine itself: name two models")
    for (const m of [lower, upper]) {
      if (!existsSync(resolve(ctx.root, m))) throw new Error(`model ${m} does not exist — a model is a path from the project root`)
    }
    const was = refinementsOf(ctx).find((r) => r.lower === lower && r.upper === upper)?.item
    const fields: Record<string, unknown> = { lower, upper }
    const relation = str(p, "relation")?.trim(), says = str(p, "says")?.trim()
    if (relation) fields["relation"] = relation
    if (says) fields["says"] = says
    const hide = str(p, "hide")
    if (hide !== undefined) fields["hidden"] = hide.split(",").map((s) => s.trim()).filter(Boolean)
    const rename = str(p, "rename")
    if (rename !== undefined) fields["renamed"] = parseRenamed(rename)
    if (!was && (!relation || !says)) throw new Error("a new refinement needs --relation and --says")
    if (was) {
      saveMeta(ctx, { ...was, meta: { ...was.meta, ...fields } as Item["meta"] }, { authored: true })
      ctx.out(`${label(was)}: updated`)
    } else {
      const short = (m: string) => m.split("/").slice(-3).join("/")
      const made = createItem(ctx, typeOrThrow(ctx, REFINEMENTS), `${short(lower)} refines ${short(upper)}`, fields, { authored: true })
      ctx.out(`${label(made)}: recorded`)
    }
    return 0
  },
}
