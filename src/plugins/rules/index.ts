// A project's own rules, as tracker data: one item per rule, its README the
// rule and its reason. `naima rules` lists the active ones, and `naima guide`
// prints those for agents first, so an agent starting work in any project
// reads that project's rules before anything else.

import { readdirSync, readFileSync, statSync } from "node:fs"
import { basename, join } from "node:path"
import {
  bool,
  type Check,
  code,
  type Command,
  type Context,
  CONTRACT,
  type Contribution,
  type ExtensionPoint,
  type FieldDef,
  fieldValue,
  type Finding,
  type GuideSection,
  type Item,
  label,
  parse,
  parseFrontMatter,
  type Plugin,
  readReadme,
  type Rendered,
  rendered,
  runGit,
  sectionsOf,
  str,
  table,
  type TypeDef,
  unwrapped,
  usageError,
} from "../../core/api.ts"

export const AUDIENCES = ["agents", "people", "everyone"] as const
export type Audience = (typeof AUDIENCES)[number]

const PLACEHOLDER = "The rule, said so that it can be followed without asking.\n\nWhy: the reason it exists."
const template = (title: string): string => `# ${title}\n\n${PLACEHOLDER}\n`

const rulesType: TypeDef = {
  id: "rules",
  dir: "rules",
  title: "Rules",
  says:
    "a rule of this project, for agents, people or both: its page is the rule and its reason; a rule is not work, so neither status is open and no board of open work lists it",
  statuses: {
    active: { category: "done", says: "in force: `naima rules` and `naima guide` show it" },
    retired: { category: "done", says: "no longer in force; the page says what replaced it, if anything" },
  },
  initialStatus: "active",
  template,
}

const AUDIENCE: FieldDef = {
  name: "audience",
  kind: "enum",
  says: "who the rule binds",
  values: { agents: "an agent working in the project", people: "a person working in the project", everyone: "agents and people alike" },
  appliesTo: ["rules"],
}
const STRENGTH: FieldDef = {
  name: "strength",
  kind: "enum",
  says: "how binding the rule is",
  values: { must: "always; breaking it is a defect", should: "unless there is a reason, said where the work is recorded" },
  appliesTo: ["rules"],
}
const ENFORCED_BY: FieldDef = {
  name: "enforcedBy",
  kind: "string",
  says: "the check or gate that enforces the rule, when one does; unset, the rule is kept by whoever reads it",
  appliesTo: ["rules"],
}
const ACK: FieldDef = {
  name: "ack",
  kind: "string",
  says:
    "the exact phrase an agent must give in acknowledgement of the rule, when it asks for one; unset, none is required. naima rules prints every active one's, joined, as the line an agent must give back; naima pass --ack writes it into the session note, and naima rules check-ack checks any text for it",
  appliesTo: ["rules"],
}

/** How this plugin reads its own fields: as plain strings. */
const read = (f: FieldDef) => ({ name: f.name, kind: "string" }) as const

/**
 * A rule a plugin ships, active in every project that loads the plugin, beside the project's own rules items: what any
 * plugin contributes to the `rules` point. The project retires one with this plugin's `retire` option, never by editing it.
 */
export interface ShippedRule {
  name: string
  title: string
  audience: Audience
  strength: "must" | "should"
  /** The rule, said so that it can be followed without asking. */
  text: string
  /** The reason it exists. */
  why: string
  ack?: string
  /** The check or gate that enforces it. */
  enforcedBy?: string
}

const isText = (v: unknown): boolean => typeof v === "string" && !!v.trim()

/** Why `v` is not a shipped rule, or null. */
function shippedError(v: unknown): string | null {
  if (!v || typeof v !== "object") return "is not an object"
  const r = v as Partial<ShippedRule>
  for (const key of ["name", "title", "text", "why"] as const) if (!isText(r[key])) return `has no ${key}`
  if (!AUDIENCES.includes(r.audience as Audience)) return `has no audience among ${AUDIENCES.join(", ")}`
  if (r.strength !== "must" && r.strength !== "should") return "has no strength, must or should"
  return null
}

/** The keys of a rule file's front matter: those of a shipped rule but its text and why, and `when`. */
const RULE_KEYS = ["name", "title", "audience", "strength", "ack", "enforcedBy", "when"] as const
const REQUIRED_KEYS = ["name", "title", "audience", "strength"] as const

/** The rule's name a rule file's name gives: without a leading number and dash, without `.md`, and without a variant after a dot. */
export const ruleFileName = (file: string): string => basename(file, ".md").replace(/^\d+-/, "").split(".")[0] ?? ""

/** `text` with every `{{setting}}` replaced by the setting's value; an error for one the plugin does not give. */
function filled(text: string, settings: Readonly<Record<string, string>>): string {
  return text.replace(/\{\{([a-zA-Z]+)\}\}/g, (_, key: string) => {
    const v = settings[key]
    if (v === undefined) throw new Error(`{{${key}}} names a setting the plugin does not give${givenSettings(settings)}`)
    return v
  })
}

const givenSettings = (settings: Readonly<Record<string, string>>): string =>
  Object.keys(settings).length ? ` — it gives ${Object.keys(settings).join(", ")}` : " — it gives none"

/**
 * The rule a rule file holds (docs/guide/extending-naima.md#rules-a-plugin-ships), or null when its `when` does not hold
 * for `settings`; an error saying why when the file is not a rule.
 */
export function ruleFromFile(file: string, text: string, settings: Readonly<Record<string, string>> = {}): ShippedRule | null {
  const { fields, body } = parseFrontMatter(text)
  for (const key of fields.keys()) {
    if (!(RULE_KEYS as readonly string[]).includes(key)) throw new Error(`${key} is not a key of a rule file: ${RULE_KEYS.join(", ")}`)
  }
  const one = (key: string): string | undefined => {
    const v = fields.get(key)
    if (Array.isArray(v)) throw new Error(`${key} is one value, not a list`)
    return v
  }
  for (const key of RULE_KEYS) if (key !== "when") one(key)
  for (const key of REQUIRED_KEYS) if (!one(key)?.trim()) throw new Error(`the front matter has no ${key}`)
  if (!AUDIENCES.includes(one("audience") as Audience)) throw new Error(`the rule has no audience among ${AUDIENCES.join(", ")}`)
  if (one("strength") !== "must" && one("strength") !== "should") throw new Error("the rule has no strength, must or should")
  const name = one("name") as string
  if (ruleFileName(file) !== name) {
    throw new Error(`the file is named for "${ruleFileName(file)}" and holds the rule "${name}" — name it [<number>-]${name}[.<variant>].md`)
  }
  const raw = fields.get("when")
  for (const cond of raw === undefined ? [] : Array.isArray(raw) ? raw : [raw]) {
    const [key = "", value, ...extra] = cond.split("=")
    if (!key || value === undefined || extra.length) throw new Error(`when: "${cond}" is not <setting>=<value>`)
    if (settings[key] === undefined) throw new Error(`when: ${key} is a setting the plugin does not give${givenSettings(settings)}`)
    if (settings[key] !== value) return null
  }
  const { lead, sections } = sectionsOf(body)
  const why = sections.find((x) => x.heading === "Why")
  const other = sections.find((x) => x.heading !== "Why")
  if (other) throw new Error(`the body has a section "${other.heading}": a rule file holds the rule, then one section ## Why`)
  if (sections.length > 1) throw new Error("the body has ## Why twice")
  if (!lead) throw new Error("the body has no rule before ## Why")
  if (!why?.text) throw new Error("the body has no ## Why section with the reason")
  const rule: ShippedRule = {
    name,
    title: filled(one("title") as string, settings),
    audience: one("audience") as Audience,
    strength: one("strength") as "must" | "should",
    text: filled(unwrapped(lead), settings),
    why: filled(unwrapped(why.text), settings),
    ...(one("ack") !== undefined ? { ack: one("ack") as string } : {}),
    ...(one("enforcedBy") !== undefined ? { enforcedBy: one("enforcedBy") as string } : {}),
  }
  const wrong = shippedError(rule)
  if (wrong) throw new Error(`the rule ${wrong}`)
  return rule
}

/** The rules a folder of rule files holds for `settings`, one file per rule, in the order of the files' names. */
export function rulesFromFolder(dir: string, settings: Readonly<Record<string, string>> = {}): ShippedRule[] {
  let files: string[]
  try {
    files = readdirSync(dir).filter((f) => f.endsWith(".md") && statSync(join(dir, f)).isFile()).sort()
  } catch {
    throw new Error(`the rules folder ${basename(dir)}/ cannot be read`)
  }
  const out: ShippedRule[] = []
  for (const f of files) {
    let rule: ShippedRule | null
    try {
      rule = ruleFromFile(f, readFileSync(join(dir, f), "utf8"), settings)
    } catch (e) {
      throw new Error(`${basename(dir)}/${f}: ${(e as Error).message}`)
    }
    if (!rule) continue
    if (out.some((r) => r.name === rule.name)) {
      throw new Error(`${basename(dir)}/${f}: a second file holds the rule "${rule.name}" for the same settings — tell them apart with when`)
    }
    out.push(rule)
  }
  return out
}

/** The point this plugin declares: the rules plugins ship. */
export const rulesPoint: ExtensionPoint<ShippedRule> = {
  id: "rules",
  says:
    "a rule a plugin ships, active in every project that loads it beside the project's own rules items: one Markdown file per rule in a folder the plugin names (`contributes: { rules: \"rules/\" }`), its front matter `name`, `title`, `audience`, `strength`, and optionally `ack`, `enforcedBy` and `when`, its body the rule and a section `## Why`; a project retires one with the rules plugin's `retire` option",
  noun: "shipped rule",
  fromFolder: rulesFromFolder,
  key: (r) => r.name,
  renamed: (r, name) => ({ ...r, name }),
  validate: shippedError,
  document: (rs) => [
    "",
    "**Shipped rules**, active in every project that loads the plugin, listed by `naima rules`",
    ...table(
      ["Rule", "Title", "For", "Strength", "Enforced by", "Ack"],
      rs.map((r) => [code(r.name), r.title, r.audience, r.strength, r.enforcedBy ? code(r.enforcedBy) : "", r.ack ? code(r.ack) : ""]),
    ),
  ],
}

/** One rule, as `naima rules --json` prints it: a rules item, or a rule a plugin ships (`shippedBy`). */
export interface Rule {
  item: string
  title: string
  audience: string | null
  strength: string | null
  enforcedBy: string | null
  ack: string | null
  text: string
  /** The plugin that ships it; absent for the project's own rules items. */
  shippedBy?: string
}

/** A rule's text: its page without the title heading. */
export const ruleText = (item: Item): string => readReadme(item).replace(/^#[^\n]*\n/, "").trim()

const asRule = (item: Item): Rule => ({
  item: label(item),
  title: String(item.meta.title ?? ""),
  audience: fieldValue(item, read(AUDIENCE)) ?? null,
  strength: fieldValue(item, read(STRENGTH)) ?? null,
  enforcedBy: fieldValue(item, read(ENFORCED_BY)) ?? null,
  ack: fieldValue(item, read(ACK)) ?? null,
  text: ruleText(item),
})

const active = (ctx: Context): Item[] => ctx.repo.items.filter((i) => i.type === rulesType.id && i.meta.status === "active")

/** Every rule the loaded plugins ship, retired or not. */
const shipped = (ctx: Context): Contribution<ShippedRule>[] => ctx.registry.contributions("rules") as Contribution<ShippedRule>[]

const fromShipped = (c: Contribution<ShippedRule>): Rule => ({
  item: c.id,
  title: c.value.title,
  audience: c.value.audience,
  strength: c.value.strength,
  enforcedBy: c.value.enforcedBy ?? null,
  ack: c.value.ack ?? null,
  text: `${c.value.text}\n\nWhy: ${c.value.why}`,
  shippedBy: c.plugin,
})

/** The names `retire` holds that retire `c`: its short name or its qualified id. */
const retires = (retire: ReadonlySet<string>, c: Contribution<ShippedRule>): boolean => retire.has(c.name) || retire.has(c.id)

/** The active rules for `audience` — those for it and those for everyone; every one without an audience — `must` before `should`: the project's own, then those plugins ship and the project has not retired. */
export function activeRules(ctx: Context, audience?: Audience, retired: ReadonlySet<string> = new Set()): Rule[] {
  const rank = (r: Rule) => (r.strength === "must" ? 0 : r.strength === "should" ? 1 : 2)
  return [...active(ctx).map(asRule), ...shipped(ctx).filter((c) => !retires(retired, c)).map(fromShipped)]
    .filter((r) => !audience || r.audience === audience || r.audience === "everyone")
    .sort((a, b) => rank(a) - rank(b))
}

/** The exact line an agent must give back, from every listed rule that asks for one, in the order they are listed — null when none does. */
export function ackLine(rules: Rule[]): string | null {
  const phrases = rules.map((r) => r.ack).filter((a): a is string => !!a)
  return phrases.length ? `Acknowledge: ${phrases.join(" · ")}` : null
}

/** The first line `naima rules` prints, for `audience` or for all: what a copy of its output starts with. */
const listHeading = (audience?: Audience): string => `The project's rules${audience ? ` for ${audience}` : ""} (naima rules):`

function rulesRendered(rules: Rule[], heading: string): Rendered<Rule[]> {
  return rendered(rules, (rs) =>
    rs.length
      ? [
        heading,
        ...rs.flatMap((r) => [
          "",
          `${(r.strength ?? "?").toUpperCase()} · ${r.audience ?? "no audience"} · ${r.title} (${r.item}${r.shippedBy ? `, shipped by ${r.shippedBy}` : ""}${
            r.enforcedBy ? `, enforced by ${r.enforcedBy}` : ""
          }${r.ack ? `, ack ${JSON.stringify(r.ack)}` : ""})`,
          ...r.text.split("\n").map((l) => (l ? `    ${l}` : "")),
        ]),
        ...(ackLine(rs) ? ["", ackLine(rs) as string] : []),
      ]
      : [])
}

/** `rules check-ack <file|->`: the phrases missing from `text`, against the active rules for agents — empty when every one is present. */
export function missingAcks(ctx: Context, text: string, retired: ReadonlySet<string> = new Set()): string[] {
  return activeRules(ctx, "agents", retired)
    .map((r) => r.ack)
    .filter((a): a is string => !!a)
    .filter((phrase) => !text.includes(phrase))
}

function checkAck(args: string[], ctx: Context, retired: ReadonlySet<string>): number {
  const p = parse(args)
  const [src, ...extra] = p.positionals
  if (!src || extra.length) throw new Error("usage: naima rules check-ack <file|->")
  const text = src === "-" ? readFileSync(0, "utf8") : readFileSync(src, "utf8")
  const missing = missingAcks(ctx, text, retired)
  if (missing.length) {
    ctx.out(`missing acknowledgement${missing.length > 1 ? "s" : ""}: ${missing.join(" · ")}`)
    return 1
  }
  ctx.out("every acknowledgement is present")
  return 0
}

const command = (retired: ReadonlySet<string>): Command => ({
  name: "rules",
  says:
    "print the project's active rules, must before should, each with its text and reason, ending with the line an agent must acknowledge back; or check that text carries every one (rules check-ack)",
  enforces: "nothing: it only reads",
  usage: "rules [--audience <agents|people|everyone>] [--json] | rules check-ack <file|->",
  options: [
    { name: "--audience", says: "only the rules for that audience, and those for everyone" },
    { name: "--json", says: "print the rules as JSON: item, title, audience, strength, enforcedBy, ack, text" },
  ],
  examples: ["rules", "rules --audience agents", "rules --audience people --json", "rules check-ack reply.txt", "rules check-ack -"],
  run(args, ctx) {
    if (args[0] === "check-ack") return checkAck(args.slice(1), ctx, retired)
    const p = parse(args, { audience: { type: "string" }, json: { type: "boolean" } })
    const audience = str(p, "audience")
    if (p.positionals.length || (audience !== undefined && !AUDIENCES.includes(audience as Audience))) throw usageError(this)
    const rules = activeRules(ctx, audience as Audience | undefined, retired)
    if (bool(p, "json")) {
      ctx.out(JSON.stringify(rules, null, 2))
      return 0
    }
    const lines = rulesRendered(rules, listHeading(audience as Audience | undefined)).text()
    for (const l of lines.length ? lines : [`no active rules${audience ? ` for ${audience}` : ""} — naima new rules "<the rule>"`]) ctx.out(l)
    return 0
  },
})

const guide = (retired: ReadonlySet<string>): GuideSection => ({
  name: "rules",
  says: "the project's active rules for agents, read before anything else",
  subagents: true,
  render: (ctx) => rulesRendered(activeRules(ctx, "agents", retired), "Read first — the project's rules for agents (naima rules --audience agents):"),
})

/**
 * The markdown files tracked at the repository's root that are a copy of `naima rules` output — those whose first line
 * is its heading — and are no longer what it prints: an agent tool that imports such a file into its always-on
 * instructions reads the old rules, and misses those an update of Naima added.
 */
export function staleCopies(ctx: Context, retired: ReadonlySet<string>): { file: string; audience: Audience | undefined }[] {
  const listed = runGit(ctx.root, ["ls-files", "-z", "--", ":(glob)*.md"])
  if (!listed.ok) return []
  const headings = new Map<string, Audience | undefined>([[listHeading(), undefined], ...AUDIENCES.map((a) => [listHeading(a), a] as const)])
  const out: { file: string; audience: Audience | undefined }[] = []
  for (const file of listed.out.split("\0").filter(Boolean)) {
    let text: string
    try {
      text = readFileSync(join(ctx.root, file), "utf8")
    } catch {
      continue // listed but deleted in the working tree
    }
    const first = text.split("\n", 1)[0]?.trim() ?? ""
    if (!headings.has(first)) continue
    const audience = headings.get(first)
    const now = rulesRendered(activeRules(ctx, audience, retired), listHeading(audience)).text().join("\n")
    if (text.trim() !== now.trim()) out.push({ file, audience })
  }
  return out
}

const check = (retired: ReadonlySet<string>): Check => ({
  name: "rules",
  says:
    "every active rule has its text and a valid audience, and names as enforcedBy only a check or gate that exists; every name the retire option holds is a rule a loaded plugin ships; and a copy of naima rules kept in a markdown file at the repository's root, such as one an agent tool imports, is noted when it is no longer what naima rules prints",
  run(ctx) {
    const known = new Set(["checks", "gates"].flatMap((p) => ctx.registry.contributions(p).flatMap((c) => [c.name, c.id])))
    const ships = shipped(ctx)
    const unknown: Finding[] = [...retired].filter((name) => !ships.some((c) => retires(new Set([name]), c))).map((name) => ({
      level: "problem",
      message: `rules: the retire option names "${name}", which no loaded plugin ships — naima rules lists those shipped`,
    }))
    const badShipped: Finding[] = ships.filter((c) => c.value.enforcedBy && !known.has(c.value.enforcedBy)).map((c) => ({
      level: "problem",
      message: `${c.id}: the shipped rule names as enforcedBy "${c.value.enforcedBy}", which is no check or gate`,
    }))
    const stale: Finding[] = staleCopies(ctx, retired).map(({ file, audience }) => ({
      level: "note",
      message: `${file} is a copy of naima rules that is out of date, so whoever reads it misses rules added or changed since — write it again: naima rules${
        audience ? ` --audience ${audience}` : ""
      } > ${file}`,
    }))
    return [
      ...unknown,
      ...badShipped,
      ...stale,
      ...active(ctx).flatMap((item): Finding[] => {
        const out: Finding[] = []
        const text = ruleText(item)
        if (!text || text === PLACEHOLDER) {
          out.push({ level: "problem", item, message: `${label(item)}: an active rule with no text — write the rule and its reason on its page` })
        }
        const audience = item.meta[AUDIENCE.name]
        if (!AUDIENCES.includes(audience as Audience)) {
          out.push({
            level: "problem",
            item,
            message: `${label(item)}: an active rule ${audience === undefined ? "with no audience" : `for ${JSON.stringify(audience)}`} — naima set ${
              label(item)
            } audience=${AUDIENCES.join("|")}`,
          })
        }
        const by = fieldValue(item, read(ENFORCED_BY))
        if (by && !known.has(by)) out.push({ level: "problem", item, message: `${label(item)}: enforcedBy names "${by}", which is no check or gate` })
        return out
      }),
    ]
  },
})

/** The `retire` option: the shipped rules the project does not hold to, by name or qualified id. */
function readRetire(options: Record<string, unknown>): ReadonlySet<string> {
  const raw = options["retire"] ?? []
  if (!Array.isArray(raw) || raw.some((x) => typeof x !== "string" || !x.trim())) {
    throw new Error('rules: option retire must be a list of shipped rule names, such as ["long-work/long-work-through-naima-run"]')
  }
  return new Set(raw as string[])
}

export default function rules(options: Record<string, unknown> = {}): Plugin {
  const retired = readRetire(options)
  return {
    name: "rules",
    contract: CONTRACT,
    says: "the project's own rules, kept as items: shown to agents first by naima guide, listed by naima rules",
    about:
      "A project's rules — how an agent works here (quiet, simple, fast), how it reports, what it asks before doing — are tracker data, one `rules` item each, so every project carries its own. " +
      "A rule's page is the rule and its reason; `audience` says whom it binds (`agents`, `people`, `everyone`), `strength` how much (`must`, `should`), and `enforcedBy`, when set, the check or gate that holds it. " +
      "An active rule is shown; a retired one is kept as history. `naima rules --audience agents` is what an agent reads at the start of work, and `naima guide` prints it first. " +
      "`ack`, when a rule sets it, is the exact phrase an agent gives back in acknowledgement; `naima rules` and `naima guide` print every active one's, joined, as the line to give — `naima rules check-ack <file|->` checks that a piece of text carries them all, naming what is missing and exiting 1 if so. " +
      "A plugin may also ship rules (the `rules` point), one Markdown file each in a folder it names: each is active in every project that loads the plugin, listed beside the project's own with the plugin that ships it, and retired by naming it in the `retire` option rather than by editing it. " +
      "A markdown file at the repository's root whose first line is the heading `naima rules` prints is a copy of its output, kept for an agent tool that imports it; when it no longer matches, as after an update of Naima that ships new rules, `naima check` notes it with the command that writes it again.",
    options: [{ name: "retire", default: "[]", says: "the shipped rules this project does not hold to, each by its name or qualified id (`<plugin>/<name>`)" }],
    points: [rulesPoint],
    types: [rulesType],
    fields: [AUDIENCE, STRENGTH, ENFORCED_BY, ACK],
    commands: [command(retired)],
    checks: [check(retired)],
    guide: [guide(retired)],
  }
}
