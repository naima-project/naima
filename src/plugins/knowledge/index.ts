// Knowledge entries: what a project knows, and on what basis. One type,
// `knowledge`, whose statuses say where a statement stands (a hypothesis,
// established, refuted, …), whose `basis` says why it is believed (given by a
// source, established by evidence, derived from other entries) and whose
// `kind` says what sort of statement it is: built in (fact, hypothesis,
// finding, lesson) or declared by the project, each kind with the sections and
// fields its entries require. Evidence is any item, linked `supports` or
// `contradicts`; a passed test, a property that holds, a confirmed analysis.

import {
  bool,
  type Check,
  type Context,
  CONTRACT,
  type FieldDef,
  fieldValue,
  type Finding,
  isEvidenceType,
  isOpen,
  type Item,
  label,
  linked,
  parse,
  type Plugin,
  proves,
  readReadme,
  str,
  type TypeDef,
  type WriteHook,
} from "../../core/api.ts"

const TYPE = "knowledge"

/** A kind of entry: what it is, and what its entries require. */
export interface Kind {
  says: string
  /** Headings (`## <name>`) the page must carry, each with a body. */
  sections: string[]
  /** Fields that must hold a value. */
  fields: string[]
}

/** The kinds every project has. */
export const BUILT_IN_KINDS: Readonly<Record<string, Kind>> = {
  fact: { says: "a statement about the world taken as true: given by a source, or established", sections: [], fields: [] },
  hypothesis: { says: "a statement under investigation, with what would refute it", sections: [], fields: [] },
  finding: { says: "what an investigation found: established, or refuted, by its evidence", sections: [], fields: [] },
  lesson: {
    says: "what experience taught: what happened, the lesson, how to apply it; codified once a rule or a check holds it",
    sections: ["What happened", "The lesson", "How to apply it"],
    fields: [],
  },
}

const knowledgeType: TypeDef = {
  id: TYPE,
  dir: "knowledge",
  title: "Knowledge",
  says:
    "one statement the project knows, or is finding out, with its basis — given by a source, established by evidence, or derived from other entries — and its kind",
  statuses: {
    hypothesis: { category: "open", says: "under investigation: the evidence is not in yet" },
    established: { category: "done", says: "holds: given by its source, supported by passing evidence, or derived from established entries" },
    refuted: { category: "done", says: "the evidence went against it; kept as history" },
    inconclusive: { category: "open", says: "investigated, and the evidence settles nothing yet" },
    retracted: { category: "done", says: "a given that no longer holds" },
    superseded: { category: "done", says: "replaced by a later entry, linked `supersedes` when the planning plugin is loaded" },
  },
  initialStatus: "hypothesis",
  template: (title) =>
    `# ${title}\n\nThe statement, said so that it can be checked.\n\n## Basis\n\nWhere it comes from: the source of a given, the evidence of a finding, the entries it is derived from.\n\n## Falsifier\n\nWhat result would refute it.\n`,
}

const BASIS: FieldDef = {
  name: "basis",
  kind: "enum",
  says: "why the entry is believed",
  values: {
    given: "known without investigation: a premise, named by its `givenBy`; a given entry starts established",
    evidence: "established by experiments, analyses, tests or proofs linked `supports`; an evidence entry starts as a hypothesis",
    derived: "follows from other entries, linked `derives-from`",
  },
  appliesTo: [TYPE],
}

const SOURCE: FieldDef = {
  name: "givenBy",
  kind: "string",
  says: "who or what gives a given entry: the owner, a datasheet, a contract",
  appliesTo: [TYPE],
}

// The kind is the trackers plugin's `kind` field, which applies to every type.
const KIND = { name: "kind", kind: "string" } as const

/** The plugin's options, read once: the kinds (built in, then the project's) and whether an uncodified lesson is a note. */
export function readOptions(options: Record<string, unknown>): { kinds: Record<string, Kind>; lessonsCodified: boolean } {
  const raw = options["kinds"] ?? {}
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new Error('knowledge: option kinds must be an object of kinds, such as { "incident": { "says": "…", "sections": ["Timeline"] } }')
  }
  const kinds: Record<string, Kind> = Object.fromEntries(
    Object.entries(BUILT_IN_KINDS).map(([k, v]) => [k, { ...v, sections: [...v.sections], fields: [...v.fields] }]),
  )
  for (const [name, value] of Object.entries(raw as Record<string, unknown>)) {
    const v = (value ?? {}) as Record<string, unknown>
    const list = (key: string): string[] => {
      const l = v[key] ?? []
      if (!Array.isArray(l) || !l.every((s) => typeof s === "string" && s.trim())) {
        throw new Error(`knowledge: kind ${name}: ${key} must be a list of names`)
      }
      return l as string[]
    }
    if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error(`knowledge: kind ${name} must be an object`)
    const known = kinds[name]
    if (!known && typeof v["says"] !== "string") throw new Error(`knowledge: kind ${name} must say what it is ("says")`)
    kinds[name] = {
      says: typeof v["says"] === "string" ? v["says"] : known!.says,
      sections: [...new Set([...(known?.sections ?? []), ...list("sections")])],
      fields: [...new Set([...(known?.fields ?? []), ...list("fields")])],
    }
  }
  const codified = options["lessonsCodified"] ?? false
  if (typeof codified !== "boolean") throw new Error("knowledge: option lessonsCodified must be true or false")
  return { kinds, lessonsCodified: codified }
}

const entriesOf = (ctx: Context): Item[] => ctx.repo.items.filter((i) => i.type === TYPE)

/** Evidence that holds now: an item whose status proves; one whose type has no proving status counts once it is done. */
const current = (ctx: Context, e: Item): boolean => isEvidenceType(ctx, e.type) ? proves(ctx, e) : !isOpen(ctx, e)

const supportOf = (ctx: Context, entry: Item): Item[] => linked(ctx, entry, "supported-by")
const refutationOf = (ctx: Context, entry: Item): Item[] => linked(ctx, entry, "contradicted-by")

/** A lesson is codified when a rule, a test or a property — anything that holds it from now on — links `codifies` to it. */
const codifiersOf = (ctx: Context, entry: Item): Item[] => linked(ctx, entry, "codified-by")

const an = (word: string): string => (/^[aeiou]/i.test(word) ? `an ${word}` : `a ${word}`)
const plural = (n: number, one: string, many: string): string => (n === 1 ? one : many)

/** The `## ` headings of a page that have a body. */
function filledSections(readme: string): Set<string> {
  const out = new Set<string>()
  const lines = readme.split("\n")
  for (let i = 0; i < lines.length; i++) {
    const m = /^##\s+(.+?)\s*$/.exec(lines[i]!)
    if (!m) continue
    let j = i + 1
    while (j < lines.length && !/^#{1,2}\s/.test(lines[j]!)) j++
    if (lines.slice(i + 1, j).some((l) => l.trim())) out.add(m[1]!)
  }
  return out
}

const hasValue = (item: Item, field: string): boolean => {
  const v = item.meta[field]
  return v !== undefined && v !== null && v !== "" && !(Array.isArray(v) && v.length === 0)
}

function basisCheck(): Check {
  return {
    name: "knowledge-basis",
    says:
      "an established entry stands on its basis: a given one names its source, one on evidence has passing evidence linked `supports`; an entry both supported and refuted by current evidence, or derived from a refuted or retracted one, is noted",
    run(ctx) {
      const out: Finding[] = []
      for (const e of entriesOf(ctx)) {
        const basis = fieldValue(e, { name: BASIS.name, kind: "enum" } as const)
        const established = e.meta.status === "established"
        if (established && basis === "given" && !hasValue(e, SOURCE.name)) {
          out.push({ level: "problem", item: e, message: `${label(e)} is given, but names no source — naima set ${label(e)} givenBy="<who or what gives it>"` })
        }
        const support = supportOf(ctx, e).filter((s) => current(ctx, s))
        if (established && basis === "evidence" && !support.length) {
          out.push({
            level: "problem",
            item: e,
            message: `${label(e)} is established on evidence, but nothing passing supports it — naima link <evidence> supports ${label(e)}, or naima set ${
              label(e)
            } status=hypothesis`,
          })
        }
        const against = refutationOf(ctx, e).filter((r) => current(ctx, r))
        if (support.length && against.length) {
          out.push({
            level: "note",
            item: e,
            message: `${label(e)} is both supported (${support.map(label).join(", ")}) and refuted (${
              against.map(label).join(", ")
            }) by current evidence — settle it: naima set ${label(e)} status=inconclusive, or retire the weaker evidence`,
          })
        }
        for (const premise of linked(ctx, e, "derives-from")) {
          const s = premise.meta.status
          if (premise.type === TYPE && (s === "refuted" || s === "retracted")) {
            out.push({
              level: "note",
              item: e,
              message: `${label(e)} derives from ${label(premise)}, which is ${s} — review it, and refute or retract it too if it falls`,
            })
          }
        }
      }
      return out
    },
  }
}

function kindsCheck(kinds: Record<string, Kind>, lessonsCodified: boolean): Check {
  return {
    name: "knowledge-kinds",
    says: `an entry of a kind carries the sections and fields its kind requires; a kind not declared is noted${
      lessonsCodified ? "; so is an established lesson nothing codifies" : ""
    }`,
    run(ctx) {
      const out: Finding[] = []
      for (const e of entriesOf(ctx)) {
        const kind = fieldValue(e, KIND)
        if (kind === undefined || kind === "") continue
        const def = kinds[kind]
        if (!def) {
          // A value off the field's whole list is the core's values check's to report; one on it, but of work rather than knowledge, is this one's.
          const onList = Object.hasOwn(ctx.registry.fields.get(KIND.name)?.values ?? {}, kind)
          if (onList) {
            out.push({
              level: "note",
              item: e,
              message: `${label(e)} has the kind ${kind}, which is not a kind of knowledge entry: ${
                Object.keys(kinds).join(", ")
              } — use one of them, or declare it under the knowledge plugin's kinds option in naima.json`,
            })
          }
          continue
        }
        const filled = def.sections.length ? filledSections(readReadme(e)) : new Set<string>()
        const sections = def.sections.filter((s) => !filled.has(s))
        const fields = def.fields.filter((f) => !hasValue(e, f))
        if (sections.length || fields.length) {
          const parts = [
            ...(sections.length ? [`its page lacks the ${plural(sections.length, "section", "sections")} ${sections.join(", ")}`] : []),
            ...(fields.length ? [`it has no ${fields.join(", ")}`] : []),
          ]
          out.push({ level: "problem", item: e, message: `${label(e)} is ${an(kind)}, but ${parts.join(", and ")} — each with what it says` })
        }
        if (lessonsCodified && kind === "lesson" && e.meta.status === "established" && !codifiersOf(ctx, e).length) {
          out.push({
            level: "note",
            item: e,
            message: `${label(e)} is an established lesson nothing codifies — write the rule or the check that holds it, and naima link <it> codifies ${
              label(e)
            }`,
          })
        }
      }
      return out
    },
  }
}

/** A given entry starts established; an evidence or derived one at the type's initial status, a hypothesis. */
const startsByBasis: WriteHook = {
  name: "knowledge-starts-by-basis",
  says: "a new knowledge entry whose basis is given starts established; any other starts as a hypothesis",
  beforeWrite(write) {
    if (write.kind !== "create" || write.item.type !== TYPE) return
    const meta = write.item.meta
    if (meta[BASIS.name] === "given" && meta.status === knowledgeType.initialStatus) meta.status = "established"
  },
}

/** What an entry stands on, one line each: its source, its evidence, its premises, and for a lesson what codifies it. */
function groundsOf(ctx: Context, e: Item): string[] {
  const out: string[] = []
  const source = e.meta[SOURCE.name]
  if (typeof source === "string" && source) out.push(`given by ${source}`)
  const ref = (i: Item) => `${label(i)} (${i.meta.status})`
  const support = supportOf(ctx, e)
  if (support.length) out.push(`supported by ${support.map(ref).join(", ")}`)
  const against = refutationOf(ctx, e)
  if (against.length) out.push(`refuted by ${against.map(ref).join(", ")}`)
  const premises = linked(ctx, e, "derives-from")
  if (premises.length) out.push(`derives from ${premises.map(ref).join(", ")}`)
  if (fieldValue(e, KIND) === "lesson") {
    const by = codifiersOf(ctx, e)
    out.push(by.length ? `codified by ${by.map(label).join(", ")}` : "not codified yet")
  }
  return out.length ? out : ["no source or evidence"]
}

export default function knowledge(options: Record<string, unknown> = {}): Plugin {
  const { kinds, lessonsCodified } = readOptions(options)
  return {
    name: "knowledge",
    contract: CONTRACT,
    says: "knowledge entries: facts, hypotheses, findings and lessons, each with its basis — a source, evidence, or other entries — and its kind",
    about: "A project's lasting knowledge as items: what is known, and on what basis. " +
      "A **knowledge entry** (`naima new knowledge`) is one statement. Its `basis` says why it is believed: `given` — known without investigation, a premise named by its `givenBy` (the owner, a datasheet, a contract), which starts `established` and can still be `retracted`; `evidence` — established by experiments, analyses, tests or proofs, which starts as a `hypothesis` and carries its falsifier on its page; `derived` — following from other entries, linked `derives-from`. " +
      "Evidence is any item — a test, an analysis, an artifact, a property — linked `supports` or `contradicts` the entry; it counts while its status proves (a passed test, a property that holds), or, for a type with no proving status, once it is done. " +
      "Its `kind` says what sort of statement it is: built in, `fact`, `hypothesis`, `finding` and `lesson` (what experience taught, whose page holds What happened, The lesson and How to apply it); a project declares its own kinds, each with the sections and fields its entries require, under this plugin's `kinds` option. A kind adds requirements, never statuses. " +
      "A lesson is **codified** once a rule, a test or a property that holds it links `codifies` to it: `naima show` lists it as `codified-by`, and `naima knowledge` says it. " +
      "`naima check` fails on an established entry with nothing passing behind it (or a given one that names no `givenBy`) and on an entry missing what its kind requires; it notes an entry both supported and refuted by current evidence, one derived from a refuted or retracted entry, and, with the `lessonsCodified` option, an established lesson nothing codifies. " +
      "`naima knowledge` prints the established entries by kind, each with its source or evidence.",
    options: [
      {
        name: "kinds",
        says:
          'the project\'s own kinds of entry, by name: `says`, and the `sections` and `fields` its entries require, such as { "incident": { "says": "something that went wrong in production", "sections": ["Timeline"] } }; a built-in kind named here gains the requirements',
        default: "{} (the built-in fact, hypothesis, finding, lesson)",
      },
      { name: "lessonsCodified", says: "true to note an established lesson that no rule, test or property codifies", default: "false" },
    ],
    types: [knowledgeType],
    fields: [BASIS, SOURCE],
    relations: [
      { name: "supports", inverse: "supported-by", says: "is evidence for the knowledge entry" },
      { name: "supported-by", inverse: "supports", says: "is supported by the evidence" },
      { name: "contradicts", inverse: "contradicted-by", says: "is evidence against the knowledge entry: it refutes it" },
      { name: "contradicted-by", inverse: "contradicts", says: "is refuted by the evidence" },
      { name: "derives-from", inverse: "derived-into", says: "follows from the knowledge entry" },
      { name: "derived-into", inverse: "derives-from", says: "is a premise of the knowledge entry" },
      { name: "codifies", inverse: "codified-by", says: "holds the lesson from now on: a rule, a test or a property" },
      { name: "codified-by", inverse: "codifies", says: "is held from now on by the rule, test or property" },
    ],
    // What it reads of the trackers plugin: the kind of an item.
    uses: { fields: [KIND.name] },
    // Its kinds join the open list of the field, so that an entry's kind is on it.
    extends: [{ field: KIND.name, values: Object.fromEntries(Object.entries(kinds).map(([k, v]) => [k, `a knowledge entry: ${v.says}`])) }],
    checks: [basisCheck(), kindsCheck(kinds, lessonsCodified)],
    hooks: [startsByBasis],
    commands: [{
      name: "knowledge",
      says: "print the established knowledge entries by kind, each with its source or evidence",
      enforces: "nothing: it reads the knowledge entries and prints them; `naima check` holds what an entry must stand on",
      usage: "knowledge [--kind <k>] [--all]",
      options: [
        { name: "--kind", says: "only the entries of this kind" },
        { name: "--all", says: "every entry, whatever its status: hypotheses, refuted, retracted and superseded ones too" },
      ],
      examples: ["knowledge", "knowledge --kind lesson", "knowledge --all"],
      run(args, ctx) {
        const p = parse(args, { kind: { type: "string" }, all: { type: "boolean" } })
        const only = str(p, "kind")
        const all = bool(p, "all")
        const entries = entriesOf(ctx)
          .filter((e) => all || e.meta.status === "established")
          .filter((e) => only === undefined || fieldValue(e, KIND) === only)
        const order = (k: string) => (k === "" ? Infinity : k in kinds ? Object.keys(kinds).indexOf(k) : Object.keys(kinds).length)
        const groups = new Map<string, Item[]>()
        for (const e of entries) {
          const k = fieldValue(e, KIND) ?? ""
          groups.set(k, [...(groups.get(k) ?? []), e])
        }
        const sorted = [...groups].sort(([a], [b]) => order(a) - order(b) || a.localeCompare(b))
        ctx.out(`# Knowledge${all ? "" : ": established"}`)
        if (!sorted.length) ctx.out(), ctx.out('nothing yet — naima new knowledge "<statement>" --set basis=given --set givenBy="<who>"')
        for (const [k, group] of sorted) {
          ctx.out()
          ctx.out(`## ${k || "(no kind)"}`)
          for (const e of group.sort((a, b) => a.meta.title.localeCompare(b.meta.title))) {
            ctx.out(`  ${e.meta.status.padEnd(12)} ${e.meta.title}  — ${label(e)}`)
            for (const g of groundsOf(ctx, e)) ctx.out(`      ${g}`)
          }
        }
        return 0
      },
    }],
  }
}
