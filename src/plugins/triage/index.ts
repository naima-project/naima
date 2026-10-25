// Four fields an item is ranked by, and no more.
//
//   priority    when:               now · next · later · parked
//   impact      who notices:        blocker · high · medium · low
//   effort      what it costs:      S · M · L · XL
//   confidence  do we understand it: measured · diagnosed · reported · unclear
//
// Effort is never derived: nothing in a report says what a fix costs, and a
// size guessed from the wording is how an XL hides inside an S. Whatever is
// derived is stamped `triagedBy: "derived"` so a human value is never
// overwritten and the share of inference stays visible.

import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import {
  bool,
  byUrgency,
  cell,
  type Check,
  type Command,
  type Context,
  CONTRACT,
  enumRank,
  type FieldDef,
  fieldValue,
  type Finding,
  type GuideSection,
  isOpen,
  type Item,
  label,
  pairs,
  parse,
  type Plugin,
  positiveInt,
  type RankTerm,
  readAcrossBranches,
  readReadme,
  rendered,
  saveMeta,
  setFields,
  type SummarySection,
  today,
  trackerPath,
  usageError,
  type View,
  type WriteHook,
} from "../../core/api.ts"

export const FIELDS: FieldDef[] = [
  {
    name: "priority",
    kind: "enum",
    says: "when",
    values: {
      now: "being worked on, or the next thing anyone should pick up",
      next: "this cycle, once now is clear",
      later: "real, agreed, not scheduled",
      parked: "deliberately not being done; the reason is on the page",
    },
  },
  {
    name: "impact",
    kind: "enum",
    says: "if this stays as it is, who notices",
    values: {
      blocker: "stops a release, or loses someone's work",
      high: "a newcomer would hit it and not come back",
      medium: "noticeable, worked around",
      low: "cosmetic, or only we would notice",
    },
  },
  {
    name: "effort",
    kind: "enum",
    says: "what it costs — never derived",
    values: { S: "under an hour", M: "half a day", L: "a day or two", XL: "more, or unknown until broken up" },
  },
  {
    name: "confidence",
    kind: "enum",
    says: "do we understand the item",
    values: { measured: "reproduced and measured", diagnosed: "the cause is known", reported: "as reported, not yet looked at", unclear: "nobody knows yet" },
  },
  { name: "triagedBy", kind: "enum", says: "set to derived when a tool inferred the fields", values: { derived: "inferred by naima triage derive" } },
  { name: "triagedOn", kind: "date", says: "when a person last triaged the item" },
  {
    name: "reopensWhen",
    kind: "string",
    says: "on a parked, wontfix or dropped item: what would make it worth re-arguing — prose, or a link to the item or document that would",
  },
]

const TRIAGE = ["priority", "impact", "effort", "confidence"] as const
const enumRef = (name: string) => ({ name, kind: "enum" }) as const
const IMPACT = enumRef("impact")
const PRIORITY = enumRef("priority")
const EFFORT = enumRef("effort")
const CONFIDENCE = enumRef("confidence")
const TRIAGED_BY = enumRef("triagedBy")
const TRIAGED_ON = { name: "triagedOn", kind: "date" } as const
const REOPENS_WHEN = { name: "reopensWhen", kind: "string" } as const
const field = (name: string) => FIELDS.find((f) => f.name === name)

/** A parked, wontfix or dropped item: deliberately not being worked on now. */
const DEFERRED_STATUSES = new Set(["wontfix", "dropped"])
export const isDeferred = (item: Item): boolean => fieldValue(item, PRIORITY) === "parked" || DEFERRED_STATUSES.has(String(item.meta.status ?? ""))

const DAY = 86_400_000
const DEFAULT_MAX_NOW_AGE_DAYS = 3

/** Whole days since an item's priority was last confirmed: `triagedOn`, or `created` for one never triaged. */
function ageDays(ctx: Context, item: Item): number {
  const since = fieldValue(item, TRIAGED_ON) ?? String(item.meta["created"] ?? today(ctx))
  return Math.max(0, Math.round((Date.parse(`${today(ctx)}T00:00:00Z`) - Date.parse(`${since}T00:00:00Z`)) / DAY))
}

/**
 * Every item id any branch's claim names, read the same way `naima claims`
 * does — directly off `<data>/claims/*.json` across every local branch —
 * without depending on the coordination plugin being loaded.
 */
function claimedItemIds(ctx: Context): Set<string> {
  const ids = new Set<string>()
  for (const f of readAcrossBranches(ctx.trackerGit, trackerPath(ctx.trackerPrefix, "claims"), ".json")) {
    try {
      const items = (JSON.parse(f.text) as { items?: { id?: unknown }[] }).items ?? []
      for (const e of items) if (typeof e?.id === "string") ids.add(e.id)
    } catch {
      // an unreadable claim file names nobody: skip it, as `naima claims` does
    }
  }
  return ids
}

/** `options.maxNowAgeDays`: how many days a `now` item may sit unclaimed before `unclaimed-now-item-aging` notes it. */
function readMaxNowAgeDays(options: Record<string, unknown>): number {
  const raw = options["maxNowAgeDays"]
  if (raw === undefined) return DEFAULT_MAX_NOW_AGE_DAYS
  if (typeof raw !== "number" || !Number.isInteger(raw) || raw < 1) {
    throw new Error(`triage: options.maxNowAgeDays is a whole number of days, got ${JSON.stringify(raw)}`)
  }
  return raw
}

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v)

/** One authoritative or retired document, as `plugins.triage.options.documents` declares it. */
export interface DocEntry {
  path: string
  says: string
  retired: boolean
}

/** `options.documents`: path → { says, retired }. A project's own list of which status documents to trust. */
export function readDocuments(options: Record<string, unknown>): DocEntry[] {
  const raw = options["documents"] ?? {}
  if (!isObject(raw)) throw new Error('triage: options.documents must be an object: path → { "says", "retired" }')
  return Object.entries(raw).map(([path, v]) => {
    if (!isObject(v) || typeof v["says"] !== "string") {
      throw new Error(`triage: options.documents["${path}"] must be { "says": "a line about it", "retired"?: true }`)
    }
    if (v["retired"] !== undefined && typeof v["retired"] !== "boolean") throw new Error(`triage: options.documents["${path}"].retired must be true or false`)
    return { path, says: v["says"], retired: v["retired"] === true }
  })
}

const EVIDENCE = new Set(["measured", "verified", "reproduced", "confirmed"])
/** Any form of an evidence verb: "unable to reproduce" negates evidence as surely as "not reproduced". */
const EVIDENCE_STEM = /^(measur|verif|reproduc|confirm)/
const NEGATION = new Set([
  "not",
  "never",
  "no",
  "nobody",
  "cannot",
  "unable",
  "without",
  "can't",
  "couldn't",
  "wasn't",
  "weren't",
  "isn't",
  "aren't",
  "didn't",
  "doesn't",
  "don't",
  "hasn't",
  "haven't",
  "won't",
])
/** How many words before an evidence verb a negation still reverses it: "could not be reproduced". */
const NEGATION_REACH = 3

/** Confidence read off the page's own words; the only field derived from prose. */
export function confidenceFrom(body: string): string {
  const t = body.toLowerCase().replace(/’/g, "'")
  const words = t.split(/[^a-z']+/).filter(Boolean)
  const negated = (i: number): boolean => words.slice(Math.max(0, i - NEGATION_REACH), i).some((w) => NEGATION.has(w))
  if (/undiagnosed|nobody knows|\bunclear\b/.test(t) || words.some((w, i) => EVIDENCE_STEM.test(w) && negated(i))) return "unclear"
  if (words.some((w) => EVIDENCE.has(w))) return "measured"
  if (/\bcause\b|\bmechanism\b|\bdiagnos|\bbecause\b/.test(t)) return "diagnosed"
  return "reported"
}

/** The rank an unset value takes: the middle of the field's scale, or its worst (last) value. */
export function fallbackRank(name: string, as: "middle" | "worst"): number {
  const last = Object.keys(field(name)?.values ?? {}).length - 1
  return as === "worst" ? last : last / 2
}

// An unset impact or priority is not known to be either end, so it counts as the middle; an unset effort
// counts as the largest size, so an item nobody has sized sinks instead of passing every sized L and XL.
const rank: RankTerm[] = [
  { name: "impact", score: (i) => enumRank(field("impact"), fieldValue(i, IMPACT), fallbackRank("impact", "middle")) * 1.5 },
  { name: "priority", score: (i) => enumRank(field("priority"), fieldValue(i, PRIORITY), fallbackRank("priority", "middle")) * 1.2, urgent: "now" },
  { name: "effort", score: (i) => enumRank(field("effort"), fieldValue(i, EFFORT), fallbackRank("effort", "worst")) * 0.3 },
]

const openItems = (ctx: Context): Item[] => ctx.repo.items.filter((i) => isOpen(ctx, i))

/** One `triage <sub>`: its own usage, so a misuse is answered with the line that fits it. */
interface Subcommand {
  usage: string
  run(args: string[], ctx: Context): number
}

const coverage: Subcommand = {
  usage: "triage",
  run(args, ctx) {
    if (args.length) throw usageError(this)
    ctx.out(`  ${"type".padEnd(12)} open  ${TRIAGE.map((f) => f.padStart(10)).join(" ")}   derived`)
    for (const type of ctx.registry.types.values()) {
      const mine = openItems(ctx).filter((i) => i.type === type.id)
      if (!mine.length) continue
      const cells = TRIAGE.map((f) => String(mine.filter((i) => i.meta[f] !== undefined).length).padStart(10)).join(" ")
      ctx.out(`  ${type.id.padEnd(12)} ${String(mine.length).padStart(4)}  ${cells}   ${mine.filter((i) => fieldValue(i, TRIAGED_BY) === "derived").length}`)
    }
    return 0
  },
}

const SUBCOMMANDS: Record<string, Subcommand> = {
  set: {
    usage: "triage set <item> field=value...",
    run(args, ctx) {
      const [ref, ...assignments] = args
      if (!ref?.trim() || !assignments.length) throw usageError(this)
      const item = ctx.repo.resolve(ref)
      // Triaging is a person's judgement even when it confirms a value: stamped today, and no longer inference.
      const judged: [string, string][] = [
        [TRIAGED_ON.name, today(ctx)],
        ...(fieldValue(item, TRIAGED_BY) === "derived" ? [[TRIAGED_BY.name, ""] as [string, string]] : []),
      ]
      setFields(ctx, item, [...pairs(assignments), ...judged])
      ctx.out(`${label(item)}: ${assignments.join(" ")}`)
      return 0
    },
  },
  missing: {
    usage: "triage missing",
    run(args, ctx) {
      if (args.length) throw usageError(this)
      const unsized = openItems(ctx).filter((i) => !fieldValue(i, EFFORT))
      ctx.out(`${unsized.length} open items without effort — the field only a person can set:`)
      for (const i of byUrgency(ctx, unsized)) ctx.out(`  ${label(i)}  ${i.meta.title}`)
      return 0
    },
  },
  derive: {
    usage: "triage derive [--write]",
    run(args, ctx) {
      const p = parse(args, { write: { type: "boolean" } })
      if (p.positionals.length) throw usageError(this)
      const write = bool(p, "write")
      let touched = 0
      for (const item of openItems(ctx)) {
        const decided = fieldValue(item, TRIAGED_BY) !== "derived" && TRIAGE.some((f) => item.meta[f] !== undefined)
        if (decided || fieldValue(item, CONFIDENCE)) continue
        touched++
        if (write) saveMeta(ctx, { ...item, meta: { ...item.meta, [CONFIDENCE.name]: confidenceFrom(readReadme(item)), [TRIAGED_BY.name]: "derived" } })
      }
      ctx.out(`${touched} items ${write ? "updated" : "would change (dry run — pass --write)"}; effort is never derived`)
      return 0
    },
  },
}

/**
 * A person's change to a triage field, by any command, is triage: it stamps
 * `triagedOn` and stops being inference. A write that marks itself derived
 * (triage derive) stamps nothing: triagedOn is when a person last looked.
 */
const stampTriage: WriteHook = {
  name: "triage-stamps-its-date",
  says:
    "a change to priority, impact, effort or confidence — by naima set, triage set, or any command — stamps triagedOn with today and drops triagedBy: derived; a write triage derive marks derived stamps nothing",
  beforeWrite(write, ctx) {
    if (write.kind === "move") return
    const meta = write.item.meta
    const was: Record<string, unknown> = write.before ?? {}
    if (!TRIAGE.some((f) => JSON.stringify(meta[f]) !== JSON.stringify(was[f]))) return
    if (meta[TRIAGED_BY.name] === "derived" && was[TRIAGED_BY.name] !== "derived") return
    delete meta[TRIAGED_BY.name]
    meta[TRIAGED_ON.name] = today(ctx)
  },
}

const triage: Command = {
  name: "triage",
  says: "coverage of the four fields; set them; list what needs a human; derive what the page proves",
  enforces: "the four fields take only their declared values, through the write hooks; derive writes only with --write",
  usage: [coverage, ...Object.values(SUBCOMMANDS)].map((s) => s.usage).join(" | "),
  options: [{ name: "--write", says: "with derive: save the derived values instead of reporting them" }],
  examples: ["triage", "triage set export-drops impact=high priority=now effort=M", "triage missing", "triage derive --write"],
  run(args, ctx) {
    const [sub, ...rest] = args
    if (sub === undefined) return coverage.run([], ctx)
    const found = Object.hasOwn(SUBCOMMANDS, sub) ? SUBCOMMANDS[sub] : undefined
    if (!found) throw usageError(this)
    return found.run(rest, ctx)
  },
}

/** One row of the urgency queue: what `view next` derives, once, for every format. */
interface NextRow {
  ref: string
  title: string
  impact: string | null
  priority: string | null
  effort: string | null
  /** Days since priority was last confirmed (`triagedOn`, or `created` if never triaged). */
  age: number
  /** No branch's claim names this item. */
  unclaimed: boolean
}

const nextRows = (ctx: Context, n: number): NextRow[] => {
  const held = claimedItemIds(ctx)
  return byUrgency(ctx, openItems(ctx)).slice(0, n).map((i) => ({
    ref: label(i),
    title: i.meta.title,
    impact: fieldValue(i, IMPACT) ?? null,
    priority: fieldValue(i, PRIORITY) ?? null,
    effort: fieldValue(i, EFFORT) ?? null,
    age: ageDays(ctx, i),
    unclaimed: !held.has(i.meta.id),
  }))
}

/** A line's age suffix: the days waited, flagged when it is a `now` item nobody holds. */
const ageSuffix = (r: NextRow): string => `${r.age}d${r.priority === "now" && r.unclaimed ? " unclaimed" : ""}`

const rowLine = (r: NextRow): string => `  ${[r.impact, r.priority, r.effort].map((v) => (v ?? "·").padEnd(8)).join("")}${r.ref}  ${r.title}  (${ageSuffix(r)})`
const rowsTable = (rows: NextRow[]): string[] =>
  rows.length
    ? [
      "| Impact | Priority | Effort | Age | Item | Title |",
      "|---|---|---|---|---|---|",
      ...rows.map((r) => `| ${r.impact ?? ""} | ${r.priority ?? ""} | ${r.effort ?? ""} | ${ageSuffix(r)} | ${r.ref} | ${cell(r.title)} |`),
    ]
    : []

const next: View = {
  name: "next",
  says: "open items, most urgent first",
  render(args, ctx) {
    return rendered(nextRows(ctx, positiveInt(args[0], 15, "next")), (rows) => rows.map(rowLine), rowsTable)
  },
}

const esc = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")

/** What is next, as a panel of the first screen of `naima ui`: the shape the `ui-views` point takes, declared here since plugins never import each other. */
const nextUiView = {
  name: "next",
  title: "Next up",
  says: "the open items, most urgent first, ranked as `naima view next` ranks them; `?n=` says how many (15); its data is `naima view --json next`",
  order: 10,
  panel: true,
  render(params: Record<string, string[]>, ctx: Context) {
    const rows = nextRows(ctx, positiveInt(params["n"]?.[0], 15, "next"))
    const cells = (r: NextRow) =>
      [r.impact ?? "", r.priority ?? "", r.effort ?? "", ageSuffix(r)].map((v) => `<td>${esc(v)}</td>`).join("") +
      `<td><code>${esc(r.ref)}</code></td><td>${esc(r.title)}</td>`
    return {
      data: rows,
      html: rows.length
        ? `<table class="next"><thead><tr>${
          ["Impact", "Priority", "Effort", "Age", "Item", "Title"].map((h) => `<th scope="col">${h}</th>`).join("")
        }</tr></thead><tbody>${rows.map((r) => `<tr>${cells(r)}</tr>`).join("")}</tbody></table>`
        : "<p>Nothing is open.</p>",
      css: "table.next{border-collapse:collapse}table.next th,table.next td{padding:2px 12px 2px 0;text-align:left;vertical-align:top}",
    }
  },
}

const parked: View = {
  name: "parked",
  says: "every parked, wontfix or dropped item, with what would reopen it",
  render(args, ctx) {
    if (args.length) throw usageError({ usage: "view parked" })
    const rows = ctx.repo.items.filter(isDeferred).map((i) => ({
      ref: label(i),
      title: i.meta.title,
      status: String(i.meta.status ?? ""),
      reopensWhen: fieldValue(i, REOPENS_WHEN) ?? null,
    }))
    return rendered(
      rows,
      (
        rs,
      ) => (rs.length
        ? rs.map((r) => `  [${r.status}] ${r.ref}  ${r.title}${r.reopensWhen ? ` — reopens when: ${r.reopensWhen}` : " — reopensWhen not set"}`)
        : [
          "no parked, wontfix or dropped items",
        ]),
      (rs) =>
        rs.length
          ? [
            "| Status | Item | Title | Reopens when |",
            "|---|---|---|---|",
            ...rs.map((r) => `| ${r.status} | ${r.ref} | ${cell(r.title)} | ${r.reopensWhen ? cell(r.reopensWhen) : ""} |`),
          ]
          : [],
    )
  },
}

/** A deferred item's page is still exactly the template it was created with: nobody has said why. No default to compare against, no finding. */
const deferredSaysWhy: Check = {
  name: "deferred-says-why",
  says: "a parked, wontfix or dropped item's page says why — not left as the template it was created with",
  run: (ctx) =>
    ctx.repo.items
      .filter(isDeferred)
      .filter((i) => {
        const template = ctx.registry.types.get(i.type)?.template
        return !!template && readReadme(i).trim() === template(String(i.meta.title ?? "")).trim()
      })
      .map((i): Finding => ({
        level: "problem",
        message: `${label(i)} is parked, wontfix or dropped, and its page is still the unfilled template — say why, and set reopensWhen`,
        item: i,
      })),
}

const top: SummarySection = {
  name: "next up",
  render(ctx) {
    const open = openItems(ctx)
    const data = {
      next: open.length ? nextRows(ctx, 5) : [],
      untriaged: open.filter((i) => TRIAGE.every((f) => i.meta[f] === undefined)).length,
      unsized: open.filter((i) => !fieldValue(i, EFFORT)).length,
    }
    const tail = (d: typeof data) => `(${d.untriaged} untriaged, ${d.unsized} without effort — naima triage missing)`
    return rendered(
      data,
      (d) => (d.next.length ? [...d.next.map(rowLine), `  ${tail(d)}`] : []),
      (d) => (d.next.length ? [...rowsTable(d.next), "", tail(d)] : []),
    )
  },
}

/** `naima guide`: which documents are authoritative, and which are retired — so a status document never competes with the trackers. */
function documentsGuide(options: Record<string, unknown>): GuideSection {
  return {
    name: "authoritative-documents",
    says: "which documents are authoritative, and which are retired",
    render: (_ctx) => {
      const docs = readDocuments(options)
      const current = docs.filter((d) => !d.retired)
      const retired = docs.filter((d) => d.retired)
      const line = (d: DocEntry) => `  ${d.path} — ${d.says}`
      return rendered(
        docs,
        () =>
          docs.length
            ? [
              "Authoritative documents (naima guide) — update these, never start a parallel status document:",
              ...current.map(line),
              ...(retired.length ? ["  retired:", ...retired.map(line)] : []),
            ]
            : [],
      )
    },
  }
}

/** A `now` item open past `options.maxNowAgeDays` with no branch's claim on it: visible to a check without anyone asking the queue. */
function unclaimedAgingNow(options: Record<string, unknown>): Check {
  const maxAge = readMaxNowAgeDays(options)
  return {
    name: "unclaimed-now-item-aging",
    says: `a \`now\` item open past options.maxNowAgeDays (${maxAge}) with nobody's claim on it`,
    run: (ctx) => {
      const held = claimedItemIds(ctx)
      return openItems(ctx)
        .filter((i) => fieldValue(i, PRIORITY) === "now" && !held.has(i.meta.id) && ageDays(ctx, i) > maxAge)
        .map((i): Finding => ({
          level: "note",
          message: `${label(i)} has been \`now\` and unclaimed for ${ageDays(ctx, i)} days (over ${maxAge}) — nobody holds it`,
          item: i,
        }))
    },
  }
}

/** A retired document still named from a current one: the two keep competing instead of one replacing the other. */
function retiredStillLinked(options: Record<string, unknown>): Check {
  return {
    name: "retired-document-still-linked",
    says: "no current authoritative document still names a retired one",
    run: (ctx) => {
      const docs = readDocuments(options)
      const current = docs.filter((d) => !d.retired)
      const retired = docs.filter((d) => d.retired)
      const out: Finding[] = []
      for (const doc of current) {
        const file = join(ctx.root, doc.path)
        if (!existsSync(file)) continue
        const text = readFileSync(file, "utf8")
        for (const r of retired) {
          if (text.includes(r.path)) out.push({ level: "note", message: `${doc.path} still names the retired document ${r.path}` })
        }
      }
      return out
    },
  }
}

export default function triagePlugin(options: Record<string, unknown> = {}): Plugin {
  readDocuments(options) // validated eagerly: a bad naima.json is caught when the plugin loads, not when guide or check happen to run
  readMaxNowAgeDays(options) // same: a bad options.maxNowAgeDays is caught when the plugin loads
  return {
    name: "triage",
    contract: CONTRACT,
    says: "priority, impact, effort, confidence; the urgency ranking built from them; parked, wontfix and dropped deferrals; authoritative documents",
    about:
      "Four fields rank an item, and no more. `effort` is never derived: nothing in a report says what a fix costs, and a size guessed from the wording is how an XL hides inside an S. " +
      '`triage derive` infers only `confidence`, from the page\'s own words — an evidence verb negated up to three words before it ("could not be reproduced") reads as `unclear`, never `measured` — and stamps `triagedBy: derived` so a value a person set is never overwritten. ' +
      "Urgency is the sum of every plugin's rank terms, lower first; this plugin adds impact (×1.5), priority (×1.2) and effort (×0.3), each by its value's rank; an unset impact or priority counts as the middle of its scale, an unset effort as its largest size (XL), so an item nobody has sized sinks. " +
      "A parked priority, or a wontfix or dropped status, is a deferral: `reopensWhen` says what would make it worth re-arguing, `naima view parked` lists every one, and a page still left as its unfilled template is a problem. " +
      '`options.documents` in naima.json (`plugins.triage.options.documents`) names which documents are authoritative and which are retired — path → { "says", "retired" }; `naima guide` prints the list, and a check notes a retired one still named from a current one. ' +
      "`naima view next` (and the summary it feeds) carries an age column, derived at read time from `triagedOn` or `created`, never stored; a `now` item no branch's claim names is marked unclaimed, and `unclaimed-now-item-aging` notes one open past `options.maxNowAgeDays` (default 3).",
    options: [
      { name: "maxNowAgeDays", says: "how many days a `now` item may sit unclaimed before a check notes it", default: String(DEFAULT_MAX_NOW_AGE_DAYS) },
    ],
    fields: FIELDS,
    rank,
    commands: [triage],
    views: [next, parked],
    // What is next is a panel of naima ui when the ui plugin is loaded; without it, still a view.
    contributes: { "ui-views": [nextUiView] },
    optional: ["ui-views"],
    summary: [top],
    hooks: [stampTriage],
    checks: [deferredSaysWhy, retiredStillLinked(options), unclaimedAgingNow(options)],
    guide: [documentsGuide(options)],
  }
}
