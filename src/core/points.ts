// The core's own extension points: the kinds of contribution every project
// has. Declared exactly as a plugin declares one, so the registry, `naima
// plugins` and the reference treat them and a plugin's alike.

import { code, sentence, table } from "./markdown.ts"
import { DEFAULT_DATA } from "./layout.ts"
import { flagsOf } from "./vocabulary.ts"
import { TICK_FOLDERS } from "./tick.ts"
import type {
  Check,
  Command,
  Extension,
  ExtensionPoint,
  FieldDef,
  FieldKind,
  GuideSection,
  Migration,
  OptionDoc,
  RankTerm,
  RelationDef,
  Setup,
  SummarySection,
  TickJob,
  TypeDef,
  ValueDef,
  View,
  WriteHook,
} from "./types.ts"

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v)
const blank = (s: unknown): boolean => typeof s !== "string" || !s.trim()
const text = (v: unknown, key: string): string | null => (typeof (v as Record<string, unknown>)[key] === "string" ? null : `has no ${key}`)
const fn = (v: unknown, key: string): string | null => (typeof (v as Record<string, unknown>)[key] === "function" ? null : `has no ${key} function`)
/** The first reason `v` is not a contribution: not an object, or a check that fails. */
const shape = (v: unknown, ...checks: ((v: unknown) => string | null)[]): string | null => {
  if (!isObject(v)) return "is not an object"
  for (const c of checks) {
    const why = c(v)
    if (why) return why
  }
  return null
}
const says = (c: { says?: string }, what: string): string[] => (blank(c.says) ? [`does not say what it ${what}`] : [])

/** A table of a plugin's options, or a command's: name, default, what it does. */
export function optionsTable(options: readonly OptionDoc[], what: string): string[] {
  return table([what, "Default", "What it does"], options.map((o) => [code(o.name), o.default !== undefined ? code(o.default) : "", o.says]))
}

const FLAG = /--[a-z][a-z0-9-]*/g

/** What a command lacks of its documentation. */
export function commandGaps(c: Pick<Command, "says" | "usage" | "options" | "examples">): string[] {
  const out = [...says(c, "does")]
  if (blank(c.usage)) out.push("has no usage")
  if (!c.examples?.length) out.push("has no example")
  const documented = new Set((c.options ?? []).map((o) => o.name))
  for (const flag of new Set(c.usage.match(FLAG) ?? [])) if (!documented.has(flag)) out.push(`: option ${flag} is in the usage but not documented`)
  for (const o of c.options ?? []) {
    if (!c.usage.includes(o.name)) out.push(`: option ${o.name} is documented but not in the usage`)
    if (blank(o.says)) out.push(`: option ${o.name} does not say what it does`)
  }
  return out
}

/** A command's section of the reference: heading, what it does, usage, options, examples. */
export function commandSection(c: Pick<Command, "name" | "says" | "usage" | "options" | "examples" | "enforces" | "long">): string[] {
  const long = c.long === undefined
    ? []
    : "reports" in c.long
    ? ["", `**Progress**: ${sentence(c.long.reports)}`]
    : ["", `**Progress**: none — ${c.long.cannot}; instead, ${sentence(c.long.instead)}`]
  return [
    "",
    `### naima ${c.name}`,
    "",
    sentence(c.says),
    ...(c.enforces ? ["", `**Enforces**: ${sentence(c.enforces)}`] : []),
    ...long,
    "",
    "```sh",
    ...c.usage.split(" | ").map((u) => `naima ${u}`),
    "```",
    ...optionsTable(c.options ?? [], "Option"),
    ...(c.examples?.length ? ["", "Examples:", "", "```sh", ...c.examples.map((e) => `naima ${e}`), "```"] : []),
  ]
}

export const FIELD_KINDS: readonly FieldKind[] = ["string", "strings", "date", "enum", "boolean", "number", "object"]

/** Which types a field applies to, in words. */
const appliesSaid = (types: readonly string[] | undefined, traits: readonly string[] | undefined): string =>
  !types && !traits ? "every type" : [...(types ?? []), ...(traits ?? []).map((t) => `any type tagged ${code(t)}`)].join(", ")

const transitionsLines = (transitions: Record<string, string[]> | undefined): string[] =>
  transitions && Object.keys(transitions).length
    ? [
      "",
      `Moves allowed: ${
        Object.entries(transitions).map(([from, to]) => `${code(from)} → ${to.map(code).join(", ")}`).join("; ")
      }; a status not named moves to any.`,
    ]
    : []

export const typesPoint: ExtensionPoint<TypeDef> = {
  id: "types",
  says: "item types: a directory of items, their statuses, and the status a new one starts in",
  noun: "type",
  stored: true,
  key: (t) => t.id,
  renamed: (t, id) => ({ ...t, id, dir: id }),
  validate: (v) =>
    shape(
      v,
      (t) => text(t, "id"),
      (t) => text(t, "dir"),
      (t) => text(t, "title"),
      (t) => (isObject((t as TypeDef).statuses) ? null : "has no statuses"),
    ),
  gaps: (
    t,
  ) => [...says(t, "is"), ...Object.entries(t.statuses).flatMap(([name, s]) => (blank(s.says) ? [`: status "${name}" does not say what it means`] : []))],
  document: (types) =>
    types.flatMap((t) => [
      "",
      `### type: ${t.id}`,
      "",
      `${t.title}: ${t.says}. Items live in ${code(`${DEFAULT_DATA}/${t.dir}/`)}; a new one starts as ${code(t.initialStatus)}${
        t.creatable === false ? "; it is an archive: items arrive by being moved there, never by being opened" : ""
      }.`,
      ...(t.traits?.length ? ["", `Traits: ${t.traits.map(code).join(", ")}.`] : []),
      ...table(
        ["Status", "Category", "Flags", "Meaning"],
        Object.entries(t.statuses).map(([name, s]) => [code(name), s.category, flagsOf(s).join(", "), s.says]),
      ),
      ...transitionsLines(t.transitions),
    ]),
}

export const fieldsPoint: ExtensionPoint<FieldDef> = {
  id: "fields",
  says: "typed fields of an item's meta.json, and the types they apply to",
  noun: "field",
  stored: true,
  key: (f) => f.name,
  renamed: (f, name) => ({ ...f, name }),
  validate: (v) =>
    shape(
      v,
      (f) => text(f, "name"),
      (f) => (FIELD_KINDS.includes((f as FieldDef).kind) ? null : `has kind ${JSON.stringify((f as FieldDef).kind)}, not one of: ${FIELD_KINDS.join(", ")}`),
    ),
  gaps: (f) => [
    ...says(f, "holds"),
    ...Object.entries(f.values ?? {}).flatMap(([v, s]) => (blank(s) ? [`: value "${v}" does not say what it means`] : [])),
  ],
  document: (fields) => [
    "",
    "**Fields**",
    ...table(
      ["Field", "Kind", "Applies to", "Meaning", "Values"],
      fields.map((f) => [
        code(f.name),
        f.kind,
        appliesSaid(f.appliesTo, f.traits),
        f.says,
        [
          f.valuesFrom
            ? `the name of any contribution to ${code(f.valuesFrom)}`
            : f.configured
            ? "set by the project's configuration"
            : f.values
            ? (f.kind === "enum" ? "" : "an open list: ") + Object.entries(f.values).map(([v, s]) => `${code(v)} ${s}`).join("; ")
            : "",
          f.multiple ? "one, or a list of several" : "",
        ].filter(Boolean).join("; "),
      ]),
    ),
  ],
}

export const relationsPoint: ExtensionPoint<RelationDef> = {
  id: "relations",
  says: "link relations between items, each naming its inverse",
  noun: "relation",
  stored: true,
  key: (r) => r.name,
  renamed: (r, name) => ({ ...r, name }),
  validate: (v) => shape(v, (r) => text(r, "name"), (r) => text(r, "inverse")),
  gaps: (r) => says(r, "means"),
  document: (rels) => [
    "",
    "**Link relations** — only the direction written is stored; the inverse is derived when read.",
    ...table(["Relation", "Inverse", "Reads as"], rels.map((r) => [code(r.name), code(r.inverse), r.says])),
  ],
}

export const dirsPoint: ExtensionPoint<string> = {
  id: "dirs",
  says: "directories under the tracker root a plugin owns that are not item types",
  noun: "directory",
  stored: true,
  key: (d) => d,
  renamed: (_d, name) => name,
  validate: (v) => (typeof v === "string" && /^[^\s/\\.][^/\\]*$/.test(v) ? null : "is not a directory name"),
  document: (dirs) => ["", `**Directories** it owns under the tracker root: ${dirs.map((d) => code(d + "/")).join(", ")}.`],
}

export const checksPoint: ExtensionPoint<Check> = {
  id: "checks",
  says: "invariants `naima check` holds: a problem fails it, a note does not",
  noun: "check",
  key: (c) => c.name,
  renamed: (c, name) => ({ ...c, name }),
  validate: (v) => shape(v, (c) => text(c, "name"), (c) => fn(c, "run")),
  gaps: (c) => says(c, "holds"),
  document: (checks) => ["", "**Checks**, run by `naima check`", ...table(["Check", "What it holds"], checks.map((c) => [code(c.name), c.says]))],
}

export const commandsPoint: ExtensionPoint<Command> = {
  id: "commands",
  says: "`naima <name>`: a command, with its usage, options and examples",
  noun: "command",
  key: (c) => c.name,
  renamed: (c, name) => ({ ...c, name, usage: c.usage.replace(c.name, name) }),
  validate: (v) => shape(v, (c) => text(c, "name"), (c) => text(c, "usage"), (c) => fn(c, "run")),
  gaps: commandGaps,
  document: (commands) => commands.filter((c) => !c.hidden).flatMap(commandSection),
}

export const viewsPoint: ExtensionPoint<View> = {
  id: "views",
  says: "`naima view <name>`: a named rendering of derived state",
  noun: "view",
  key: (v) => v.name,
  renamed: (v, name) => ({ ...v, name }),
  validate: (v) => shape(v, (c) => text(c, "name"), (c) => fn(c, "render")),
  gaps: (v) => says(v, "shows"),
  document: (views) => ["", "**Views**, printed by `naima view <name>`", ...table(["View", "What it shows"], views.map((v) => [code(v.name), v.says]))],
}

export const summaryPoint: ExtensionPoint<SummarySection> = {
  id: "summary",
  says:
    "a block of `naima summary`; one marked `hello` is said by `naima hello` among what waits on the owner, and one with `goals(ctx)` says there where the project is going",
  noun: "summary section",
  key: (s) => s.name,
  renamed: (s, name) => ({ ...s, name }),
  validate: (v) =>
    shape(v, (c) => text(c, "name"), (c) => fn(c, "render"), (c) => ((c as Record<string, unknown>)["goals"] === undefined ? null : fn(c, "goals"))),
  document: (sections) => ["", `**Summary sections**: ${sections.map((s) => code(s.name)).join(", ")}.`],
}

export const guidePoint: ExtensionPoint<GuideSection> = {
  id: "guide",
  says: "a block `naima guide` prints first, inside a project, before the documentation pages",
  noun: "guide section",
  key: (s) => s.name,
  renamed: (s, name) => ({ ...s, name }),
  validate: (v) => shape(v, (c) => text(c, "name"), (c) => fn(c, "render")),
  gaps: (s) => says(s, "shows"),
  document: (
    sections,
  ) => ["", "**Guide sections**, printed first by `naima guide`", ...table(["Section", "What it shows"], sections.map((s) => [code(s.name), s.says]))],
}

export const jobsPoint: ExtensionPoint<TickJob> = {
  id: "jobs",
  says: "a job the tick runs when it is due, once an hour or once a day, whichever naima process wins it; what it finds is shown to the owner as messages",
  noun: "job",
  key: (j) => j.name,
  validate: (v) =>
    shape(v, (j) => text(j, "name"), (j) => fn(j, "run"), (j) => {
      const { name, every } = j as TickJob
      if (!/^[a-z0-9][a-z0-9-]*$/.test(name) || TICK_FOLDERS.includes(name)) return `has a name the tick cannot keep its state under: ${name}`
      return every === "hour" || every === "day" ? null : "runs neither every hour nor every day"
    }),
  gaps: (j) => says(j, "does"),
  document: (jobs) => ["", "**Jobs** the tick runs when due", ...table(["Job", "Every", "What it does"], jobs.map((j) => [code(j.name), j.every, j.says]))],
}

export const rankPoint: ExtensionPoint<RankTerm> = {
  id: "rank",
  says: "an additive term of every item's urgency; lower is more urgent",
  noun: "rank term",
  key: (t) => t.name,
  renamed: (t, name) => ({ ...t, name }),
  validate: (v) => shape(v, (c) => text(c, "name"), (c) => fn(c, "score")),
  document: (terms) => [
    "",
    `**Rank terms**, added to every item's urgency: ${terms.map((t) => (t.urgent ? `${code(t.name)} (urgent: ${code(t.urgent)})` : code(t.name))).join(", ")}.`,
  ],
}

export const migrationsPoint: ExtensionPoint<Migration> = {
  id: "migrations",
  says: "a plugin's own data migrations, in order from its format 1, run by `naima update` after the core's",
  noun: "migration",
  key: (m) => String(m.from),
  validate: (v) => shape(v, (m) => (Number.isInteger((m as Migration).from) ? null : "has no from"), (m) => text(m, "says")),
  gaps: (m) => says(m, "does"),
  document: (ms) => [
    "",
    `**Migrations** of its own data, run by \`naima update\` after the core's; its format is ${ms.length + 1}:`,
    "",
    ...ms.map((m) => `- format ${m.from} → ${m.from + 1}: ${m.says}`),
  ],
}

export const hooksPoint: ExtensionPoint<WriteHook> = {
  id: "hooks",
  says:
    "hooks on every item write: `beforeWrite(write, ctx)` may change or refuse it, `afterWrite(write, ctx)` sees it done; `beforeText(text, ctx)` may refuse a write of free text or a file that is not an item's (a session note, an event, an attachment) or add to its record",
  noun: "write hook",
  key: (h) => h.name,
  renamed: (h, name) => ({ ...h, name }),
  validate: (v) =>
    shape(v, (h) => text(h, "name"), (h) => {
      const { beforeWrite, afterWrite, beforeText } = h as WriteHook
      if (beforeWrite !== undefined && typeof beforeWrite !== "function") return "has a beforeWrite that is not a function"
      if (beforeText !== undefined && typeof beforeText !== "function") return "has a beforeText that is not a function"
      return afterWrite !== undefined && typeof afterWrite !== "function" ? "has an afterWrite that is not a function" : null
    }),
  gaps: (h) => says(h, "does"),
  document: (hooks) => ["", "**Write hooks**, run on every item write", ...table(["Hook", "What it does"], hooks.map((h) => [code(h.name), h.says]))],
}

export const setupPoint: ExtensionPoint<Setup> = {
  id: "setup",
  says:
    "what a plugin puts in place in the project's clone where it is missing (a git hook, a file), run by `naima init` and `naima update` after their own work: `install(ctx) → lines`, each said",
  noun: "setup step",
  key: (s) => s.name,
  validate: (v) => shape(v, (s) => text(s, "name"), (s) => fn(s, "install")),
  gaps: (s) => says(s, "does"),
  document: (
    steps,
  ) => [
    "",
    "**Setup**, put in place by `naima init` and `naima update` where missing",
    ...table(["Step", "What it puts in place"], steps.map((s) => [code(s.name), s.says])),
  ],
}

export const extendsPoint: ExtensionPoint<Extension> = {
  id: "extends",
  says:
    "additive changes to another plugin's type — statuses (an existing one only with its category), traits, transitions — or field — enum values, more types or traits it applies to",
  noun: "extension",
  key: (e) => (e.type !== undefined ? `type:${e.type}` : `field:${e.field}`),
  validate: (v) => {
    if (!isObject(v)) return "is not an object"
    const e = v as Extension
    if ((e.type === undefined) === (e.field === undefined)) return "names neither a type nor a field, or both: an extension extends one"
    const own = e.type !== undefined ? ["type", "statuses", "traits", "transitions"] : ["field", "values", "appliesTo", "traits"]
    const other = Object.keys(e).find((k) => !own.includes(k))
    return other ? `extends a ${e.type !== undefined ? "type" : "field"}, which takes no "${other}"` : null
  },
  gaps: (e) => [
    ...Object.entries(e.statuses ?? {}).flatMap(([name, s]) => (blank(s.says) ? [`: status "${name}" does not say what it means`] : [])),
    ...Object.entries(e.values ?? {}).flatMap(([v, d]) => (blank(typeof d === "string" ? d : d?.says) ? [`: value "${v}" does not say what it means`] : [])),
  ],
  document: (es) => ["", "**Extensions** of other plugins' types and fields", "", ...es.map(extensionLine)],
}

/** A declared value as the reference says it: its title, then what it means. */
const valueSaid = (d: string | ValueDef): string => (typeof d === "string" ? d : d.title ? `${d.title} — ${d.says}` : d.says)

function extensionLine(e: Extension): string {
  const moves = (t: Record<string, string[]>) => Object.entries(t).map(([f, to]) => `${code(f)} → ${to.map(code).join(", ")}`).join("; ")
  const parts = e.type !== undefined
    ? [
      ...Object.entries(e.statuses ?? {}).map(([n, s]) => `status ${code(n)} (${[s.category, ...flagsOf(s)].join(", ")}): ${s.says}`),
      ...(e.traits?.length ? [`traits ${e.traits.map(code).join(", ")}`] : []),
      ...(e.transitions ? [`moves ${moves(e.transitions)}`] : []),
    ]
    : [
      ...(e.values ? [`values ${Object.entries(e.values).map(([v, d]) => `${code(v)} ${valueSaid(d)}`).join("; ")}`] : []),
      ...(e.appliesTo || e.traits ? [`applies to ${appliesSaid(e.appliesTo, e.traits)}`] : []),
    ]
  return `- ${e.type !== undefined ? `type ${code(e.type)}` : `field ${code(e.field ?? "")}`}: ${parts.join("; ")}`
}

/** The core's points, in the order the reference documents a plugin's contributions. */
export const CORE_POINTS: readonly ExtensionPoint[] = [
  commandsPoint,
  typesPoint,
  fieldsPoint,
  relationsPoint,
  checksPoint,
  viewsPoint,
  dirsPoint,
  summaryPoint,
  guidePoint,
  rankPoint,
  jobsPoint,
  extendsPoint,
  hooksPoint,
  setupPoint,
  migrationsPoint,
]

/** Manifest keys that are not contributions: a point may not take one as its id. */
export const MANIFEST_KEYS: readonly string[] = ["name", "says", "about", "options", "points", "contributes", "optional", "contract", "uses"]
