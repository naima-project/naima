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
import {
  bool,
  type Command,
  type Context,
  createItem,
  type Item,
  label,
  parse,
  readText,
  saveMeta,
  str,
  strs,
  typeOrThrow,
  usageError,
} from "../../core/api.ts"

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
  usage: 'explain <property> [--says "<sentence>"] [--gloss "<part>=<phrase>"]... [--replace] | explain --file <explanations.json>',
  options: [
    { name: "--says", says: "one sentence in plain words: what must hold, and of what" },
    { name: "--gloss", says: "a part of the formula, by its exact text, =, then a plain phrase; repeat it for each part, in reading order" },
    { name: "--replace", says: "drop the glosses recorded before, keeping only the ones given now" },
    {
      name: "--file",
      says:
        "explain many properties at once from a JSON file: property → { says, glosses: [[part, phrase], ...], note }, the glosses replacing those recorded, the note added to the property's notes; every entry is checked before any is written",
    },
  ],
  examples: [
    'explain no-deadlock --says "After any sequence of steps the machine can still take one." --gloss "[true*]=after any sequence of steps" --gloss "<true>true=some step is possible"',
  ],
  run(args, ctx) {
    const p = parse(args, { says: { type: "string" }, gloss: { type: "string", multiple: true }, replace: { type: "boolean" }, file: { type: "string" } })
    const file = str(p, "file")
    if (file !== undefined) {
      if (p.positionals.length || str(p, "says") !== undefined || strs(p, "gloss").length) throw usageError(this)
      const plan = explanationsFile(ctx, readText(file))
      for (const e of plan) applyExplanation(ctx, e)
      ctx.out(`${plan.length} propert${plan.length === 1 ? "y" : "ies"} explained`)
      return 0
    }
    const [ref, ...extra] = p.positionals
    const says = str(p, "says")?.trim()
    const added = strs(p, "gloss").map(parseGloss)
    if (!ref || extra.length || (says === undefined && !added.length && !bool(p, "replace"))) throw usageError(this)
    const e = checkedExplanation(ctx, ctx.repo.resolve(ref), says, added, bool(p, "replace"))
    applyExplanation(ctx, e)
    return 0
  },
}

/** One property's explanation, checked and ready to write. */
interface Explanation {
  item: Item
  says: string | undefined
  glosses: Record<string, string>
  note?: string
}

/** The explanation of `item`, its parts checked against its formula; throws naming the parts that are not in it. */
function checkedExplanation(ctx: Context, item: Item, says: string | undefined, added: { part: string; phrase: string }[], replace: boolean): Explanation {
  if (item.type !== "properties") throw new Error(`${label(item)} is not a property`)
  const formula = partKey(formulaText(ctx, item))
  const absent = added.filter((g) => !formula.includes(partKey(g.part)))
  if (absent.length) {
    throw new Error(`${label(item)}: not in its formula: ${absent.map((g) => JSON.stringify(g.part)).join(", ")} — a gloss names a part by its exact text`)
  }
  return { item, says, glosses: mergeGlosses(replace ? [] : glossesOf(item), added) }
}

function applyExplanation(ctx: Context, e: Explanation): void {
  const meta: Record<string, unknown> = { ...e.item.meta }
  if (e.says !== undefined) {
    if (e.says) meta["says"] = e.says
    else delete meta["says"]
  }
  if (Object.keys(e.glosses).length) meta["glosses"] = e.glosses
  else delete meta["glosses"]
  saveMeta(ctx, { ...e.item, meta: meta as Item["meta"] }, { authored: true })
  e.item.meta = meta as Item["meta"]
  const n = Object.keys(e.glosses).length
  ctx.out(`${label(e.item)}: ${e.says !== undefined ? "says set; " : ""}${n} gloss${n === 1 ? "" : "es"}`)
  if (e.note) {
    const note = ctx.registry.commands.get("note")
    if (!note) throw new Error("naima note is not loaded: the note was not written")
    note.run([e.item.slug, e.note], ctx)
  }
}

/**
 * A file of explanations: a JSON object whose keys are properties and whose values give `says`, `glosses` as a list of
 * [part, phrase] pairs in reading order (they replace the glosses recorded before), and optionally `note`, added to the
 * property's notes. Every entry is checked before any is written.
 */
export function explanationsFile(ctx: Context, text: string): Explanation[] {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch (e) {
    throw new Error(`the explanations file is not JSON: ${(e as Error).message}`)
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("the explanations file is a JSON object: property → { says, glosses, note }")
  return Object.entries(data as Record<string, unknown>).map(([ref, v]) => {
    const o = (v ?? {}) as Record<string, unknown>
    const pairs = Array.isArray(o["glosses"]) ? o["glosses"] : []
    const added = pairs.map((x) => {
      if (!Array.isArray(x) || x.length !== 2 || x.some((y) => typeof y !== "string" || !y.trim())) {
        throw new Error(`${ref}: a gloss in the file is a pair [part, phrase], not ${JSON.stringify(x)}`)
      }
      return { part: (x[0] as string).trim(), phrase: (x[1] as string).trim() }
    })
    const says = typeof o["says"] === "string" ? o["says"].trim() : undefined
    const e = checkedExplanation(ctx, ctx.repo.resolve(ref), says, added, true)
    if (typeof o["note"] === "string" && o["note"].trim()) e.note = o["note"].trim()
    return e
  })
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
  usage:
    'refine <lower model> <upper model> --relation "<relation>" --says "<sentence>" [--hide a,b] [--rename from=to,...] | refine --file <refinements.json>',
  options: [
    {
      name: "--relation",
      says: "the relation the lower model is checked against the upper by, as the tool that checks it names it (trace inclusion, branching bisimulation ...)",
    },
    { name: "--says", says: "one sentence for a reader who knows state machines: what the lower model guarantees with respect to the upper" },
    { name: "--hide", says: "the actions hidden before comparing, comma-separated" },
    { name: "--rename", says: "the actions renamed before comparing, from=to comma-separated, or a JSON object" },
    {
      name: "--file",
      says:
        "record many refinements at once from a JSON list of { lower, upper, relation, hidden, renamed, says }; every entry is checked before any is written",
    },
  ],
  examples: [
    'refine models/shell-refined.mcrl2 models/shell.mcrl2 --relation "trace inclusion" --hide read_cache,tick --says "Every run of the refined shell is a run of the small shell once its internal steps are hidden."',
  ],
  run(args, ctx) {
    const p = parse(args, {
      relation: { type: "string" },
      says: { type: "string" },
      hide: { type: "string" },
      rename: { type: "string" },
      file: { type: "string" },
    })
    const file = str(p, "file")
    if (file !== undefined) {
      if (p.positionals.length) throw usageError(this)
      let list: unknown
      try {
        list = JSON.parse(readText(file))
      } catch (e) {
        throw new Error(`the refinements file is not JSON: ${(e as Error).message}`)
      }
      if (!Array.isArray(list)) throw new Error("the refinements file is a JSON list of { lower, upper, relation, hidden, renamed, says }")
      const plan = list.map((r) => checkedRefinement(ctx, (r ?? {}) as Record<string, unknown>))
      for (const r of plan) writeRefinement(ctx, r)
      return 0
    }
    const [lower, upper, ...extra] = p.positionals
    if (!lower || !upper || extra.length) throw usageError(this)
    const rec: Record<string, unknown> = { lower, upper, relation: str(p, "relation"), says: str(p, "says") }
    const hide = str(p, "hide")
    if (hide !== undefined) rec["hidden"] = hide.split(",").map((s) => s.trim()).filter(Boolean)
    const rename = str(p, "rename")
    if (rename !== undefined) rec["renamed"] = parseRenamed(rename)
    writeRefinement(ctx, checkedRefinement(ctx, rec))
    return 0
  },
}

/** A refinement to record: the fields to write, and the item that records the pair already, if one does. */
function checkedRefinement(ctx: Context, r: Record<string, unknown>): { fields: Record<string, unknown>; was?: Item } {
  const lower = modelRel(String(r["lower"] ?? "")), upper = modelRel(String(r["upper"] ?? ""))
  if (!lower || !upper) throw new Error("a refinement names its lower and its upper model")
  if (lower === upper) throw new Error("a model does not refine itself: name two models")
  for (const m of [lower, upper]) {
    if (!existsSync(resolve(ctx.root, m))) throw new Error(`model ${m} does not exist — a model is a path from the project root`)
  }
  const was = refinementsOf(ctx).find((x) => x.lower === lower && x.upper === upper)?.item
  const fields: Record<string, unknown> = { lower, upper }
  const text = (k: string) => (typeof r[k] === "string" ? (r[k] as string).trim() : "")
  if (text("relation")) fields["relation"] = text("relation")
  if (text("says")) fields["says"] = text("says")
  if (r["hidden"] !== undefined) {
    if (!Array.isArray(r["hidden"]) || r["hidden"].some((x) => typeof x !== "string")) throw new Error(`${lower}: hidden is a list of action names`)
    fields["hidden"] = r["hidden"]
  }
  if (r["renamed"] !== undefined) fields["renamed"] = parseRenamed(JSON.stringify(r["renamed"]))
  if (!was && (!fields["relation"] || !fields["says"])) throw new Error(`${lower}: a new refinement needs its relation and its sentence (--relation, --says)`)
  return was ? { fields, was } : { fields }
}

function writeRefinement(ctx: Context, r: { fields: Record<string, unknown>; was?: Item }): void {
  if (r.was) {
    saveMeta(ctx, { ...r.was, meta: { ...r.was.meta, ...r.fields } as Item["meta"] }, { authored: true })
    ctx.out(`${label(r.was)}: updated`)
    return
  }
  const short = (m: string) => m.split("/").slice(-3).join("/")
  const made = createItem(ctx, typeOrThrow(ctx, REFINEMENTS), `${short(String(r.fields["lower"]))} refines ${short(String(r.fields["upper"]))}`, r.fields, {
    authored: true,
  })
  ctx.out(`${label(made)}: recorded`)
}
