// The timeline: when a gate opened and passed, when an epic began and
// finished, each release and each session — every event derived at read time
// from the items and git, nothing stored. A gate opened is its first item
// reported (`created`), a gate passed its last item resolved (`closedOn`, else
// `fixedOn`) once none is open; an epic the same, from the items it groups; a
// release is a version tag; a session is its note; an item retired is its
// closedOn, with its reason (naima retire). What has no date is
// counted at the foot, never placed at a guess.
//
// Only what nothing derives — a decision taken outside the tracker, a build
// handed out, a policy, an outside fact — is a record: one file per event,
// `<data>/events/<date>-<uuid>.md`, written by `naima event`. A record carries
// the moment it happened (`at:`, as a session note does) when it is known, so
// the events of one day keep their order; one without it sorts first in its day.
//
// The diary (`naima diary`) is the project's story told from the same files:
// the records of kind `diary`, the decisions with their reasons, and the
// session notes, day by day, in order. The plugin ships the rule that agents
// keep it, one entry per decision taken with the owner or notable turn, and
// the check `diary-entries` notes a day with more entries than the option
// `diaryPerDay` allows, and an entry that only restates what the diary
// already shows.
//
// It reads other plugins' vocabulary by name and declares none of it used:
// without gates or epics loaded there are simply no gate or epic events.

import { randomUUID } from "node:crypto"
import { mkdirSync } from "node:fs"
import { join } from "node:path"
import {
  beforeTextWrite,
  type BranchFile,
  type Check,
  type Command,
  commitOn,
  type Context,
  fieldValue,
  fieldValues,
  type Finding,
  findPrivate,
  gitOrNull,
  guardPrivate,
  hasTrait,
  isOpen,
  isRetired,
  type Item,
  label,
  linked,
  parse,
  privateContext,
  readAcrossBranches,
  readReadme,
  rendered,
  str,
  trackerPath,
  usageError,
  type View,
  writeFileAtomic,
} from "../../core/api.ts"

/**
 * A retired item in words — `closed/x (title) retired on 2026-11-01: why; replaced by features/y` — from the fields and
 * the relation naima retire writes, read by name: plugins never import each other.
 */
function retiredSays(ctx: Context, item: Item): string {
  const on = typeof item.meta["closedOn"] === "string" ? ` on ${item.meta["closedOn"]}` : ""
  const why = typeof item.meta["retiredBecause"] === "string" ? `: ${item.meta["retiredBecause"]}` : ""
  const by = linked(ctx, item, "replaced-by").map(label)
  return `${label(item)} (${item.meta.title}) retired${on}${why}${by.length ? `; replaced by ${by.join(", ")}` : ""}`
}

export const EVENTS = "events"

export type EventKind = "gate opened" | "gate passed" | "epic opened" | "epic finished" | "release" | "session" | "record" | "retired"

export interface TimelineEvent {
  date: string
  /** The moment, as an ISO timestamp, when known: it orders the events of one day. */
  at?: string
  kind: EventKind
  /** What it is about: a gate's name, an epic's or a release's label, a session's branch. */
  subject: string
  /** In words: what it is and where its date comes from. */
  says: string
}

export interface Timeline {
  events: TimelineEvent[]
  /** What happened but carries no date, by kind: counted, never placed. */
  undated: Partial<Record<EventKind, number>>
}

const DATE = /^\d{4}-\d{2}-\d{2}$/
const isDate = (v: unknown): v is string => {
  if (typeof v !== "string" || !DATE.test(v)) return false
  const t = Date.parse(`${v}T00:00:00Z`)
  return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === v
}

const GATE = { name: "gate", kind: "enum" } as const
const CLOSED_ON = { name: "closedOn", kind: "date" } as const
const FIXED_ON = { name: "fixedOn", kind: "date" } as const
const GROUP = "group"
const HAS_PART = "has-part"
/** A tag that names a version: v1, 1.2, v0.9.0-rc.1. */
const VERSION_TAG = /^v?\d+(\.\d+)*([-+].*)?$/

const created = (i: Item): string | undefined => (isDate(i.meta["created"]) ? i.meta["created"] : undefined)
/** When an item was resolved: archived, else its code landed; undefined while open or when it says neither. */
const resolved = (ctx: Context, i: Item): string | undefined => {
  if (isOpen(ctx, i)) return undefined
  const d = fieldValue(i, CLOSED_ON) ?? fieldValue(i, FIXED_ON)
  return isDate(d) ? d : undefined
}

/** What an item stands for: itself, or — a group with members — its members, a nested group's too. */
function standsFor(ctx: Context, item: Item, seen: Set<Item> = new Set()): Item[] {
  if (seen.has(item)) return []
  seen.add(item)
  if (!hasTrait(ctx, item, GROUP)) return [item]
  const members = linked(ctx, item, HAS_PART)
  return members.length ? members.flatMap((m) => standsFor(ctx, m, seen)) : [item]
}

const min = (ds: string[]): string | undefined => ds.reduce<string | undefined>((a, d) => (a === undefined || d < a ? d : a), undefined)
const max = (ds: string[]): string | undefined => ds.reduce<string | undefined>((a, d) => (a === undefined || d > a ? d : a), undefined)
const items = (n: number): string => `${n} item${n === 1 ? "" : "s"}`

/** The opening and closing of a body of items — a gate's, an epic's — or what of them has no date. */
function span(
  ctx: Context,
  members: Item[],
  open: EventKind,
  close: EventKind,
  subject: string,
  title: string,
  out: Timeline,
): void {
  if (!members.length) return
  const count = (k: EventKind) => (out.undated[k] = (out.undated[k] ?? 0) + 1)
  const born = members.map(created)
  const first = min(born.filter((d): d is string => !!d))
  if (first && born.every(Boolean)) {
    out.events.push({ date: first, kind: open, subject, says: `${title}: the first of its ${items(members.length)} reported` })
  } else count(open)
  if (members.some((m) => isOpen(ctx, m))) return
  const ends = members.map((m) => resolved(ctx, m))
  const last = max(ends.filter((d): d is string => !!d))
  if (last && ends.every(Boolean)) {
    out.events.push({ date: last, kind: close, subject, says: `${title}: the last of its ${items(members.length)} resolved` })
  } else count(close)
}

interface RecordFile {
  date: string
  /** The moment it happened, ISO, when it was recorded with one. */
  at?: string
  kind: string
  title: string
  /** The whole text, of which `title` is the first line. */
  text: string
  file: string
  /** The items it is about, as recorded with `naima event --about`: their references, such as todos/<slug>. */
  about: string[]
}

/** A moment written as an ISO timestamp; anything else is no moment. */
const isMoment = (v: string): boolean => v !== "" && !Number.isNaN(Date.parse(v))

const FRONT = /^---\n([\s\S]*?)\n---\n/

/** A record's `about:` line, one line of JSON: the references it lists, nothing when it is absent or not a list of strings. */
function aboutField(v: string): string[] {
  if (!v) return []
  try {
    const l: unknown = JSON.parse(v)
    return Array.isArray(l) ? l.filter((x): x is string => typeof x === "string") : []
  } catch {
    return []
  }
}

/** What looks like an item's reference in a text: a type's folder, a slash and a slug. */
const CITED = /\b[a-z][a-z0-9-]*\/[a-z0-9][a-z0-9-]*/g

/** The references of the project's items, each as label() writes it. */
const refsOf = (ctx: Context): Set<string> => new Set(ctx.repo.items.map((i) => label(i)))

/** The items an entry is about: those given, then each item its text cites by reference, once, in order; a citation that names no item is left out. */
function aboutOf(refs: Set<string>, given: string[], text: string): string[] {
  const out = [...given]
  for (const m of text.matchAll(CITED)) if (refs.has(m[0]) && !out.includes(m[0])) out.push(m[0])
  return out
}

function parseRecord(f: BranchFile): RecordFile | null {
  const m = f.text.match(FRONT)
  if (!m?.[1]) return null
  const field = (k: string) => m[1]?.match(new RegExp(`^${k}:\\s*(.+)$`, "m"))?.[1]?.trim() ?? ""
  const date = field("date")
  const at = field("at")
  const text = f.text.slice(m[0].length).trim()
  const title = text.split("\n")[0]?.trim() ?? ""
  if (!isDate(date) || !title) return null
  return { date, ...(isMoment(at) ? { at } : {}), kind: field("kind") || "fact", title, text, file: f.name, about: aboutField(field("about")) }
}

/** What the write hooks add to a record, as front-matter lines: a string as it is, anything else as one line of JSON. */
export const frontLines = (record: Record<string, unknown>): string =>
  Object.entries(record).map(([k, v]) => `${k}: ${typeof v === "string" ? v : JSON.stringify(v)}\n`).join("")

/** The records of what nothing derives, on every branch. */
export const readRecords = (ctx: Context): RecordFile[] =>
  readAcrossBranches(ctx.trackerGit, trackerPath(ctx.trackerPrefix, EVENTS), ".md").map(parseRecord).filter((r): r is RecordFile => r !== null)

/** The version tags, each with the day of the commit it names. */
function releases(ctx: Context): { tag: string; date: string }[] {
  const out = gitOrNull(ctx.root, "for-each-ref", "refs/tags", "--format=%(refname:short)%09%(*committerdate:short)%09%(committerdate:short)")
  return (out ?? "").split("\n").flatMap((line) => {
    const [tag = "", peeled = "", own = ""] = line.split("\t")
    const date = peeled || own
    return VERSION_TAG.test(tag) && isDate(date) ? [{ tag, date }] : []
  })
}

/** A session note as the timeline and the diary read it. */
export interface SessionNote {
  date: string
  at?: string
  branch: string
  body: string
  /** The acknowledgement line the note begins with, when it carries one: not what the session did. */
  ack?: string
}

/** What a session note says the session did: its body, without the acknowledgement line it begins with. */
const told = (p: SessionNote): string => (p.ack && p.body.startsWith(p.ack) ? p.body.slice(p.ack.length) : p.body).trim()

/** Oldest first: by day, then by moment within the day -- one with no moment first -- the sort being stable. */
const byMoment = (a: { date: string; at?: string }, b: { date: string; at?: string }): number =>
  a.date < b.date ? -1 : a.date > b.date ? 1 : (a.at ?? "") < (b.at ?? "") ? -1 : (a.at ?? "") > (b.at ?? "") ? 1 : 0

/** Every event, derived from the items, git and the session notes, oldest first; `passes` gives the session notes. */
export function timelineOf(ctx: Context, passes: SessionNote[]): Timeline {
  const out: Timeline = { events: [], undated: {} }
  const titles = new Map(ctx.registry.contributions("gates").map((c) => [(c.value as { name: string }).name, (c.value as { title?: string }).title ?? ""]))
  const gated = new Map<string, Item[]>()
  for (const i of ctx.repo.items) for (const g of fieldValues(i, GATE)) gated.set(g, [...(gated.get(g) ?? []), i])
  for (const [g, on] of [...gated].sort(([a], [b]) => a.localeCompare(b))) {
    const members = [...new Set(on.flatMap((i) => standsFor(ctx, i)))]
    const t = titles.get(g)
    span(ctx, members, "gate opened", "gate passed", g, `gate ${g}${t ? ` (${t})` : ""}`, out)
  }
  for (const e of ctx.repo.items.filter((i) => hasTrait(ctx, i, GROUP))) {
    const members = linked(ctx, e, HAS_PART).filter((m) => m.meta.id !== e.meta.id)
    span(ctx, members, "epic opened", "epic finished", label(e), `${label(e)} (${e.meta.title})`, out)
  }
  // An item retired on the owner's word (naima retire): the day, the reason and what replaced it, from its own fields.
  for (const i of ctx.repo.items.filter((i) => isRetired(ctx, i))) {
    const d = fieldValue(i, CLOSED_ON)
    if (isDate(d)) out.events.push({ date: d, kind: "retired", subject: label(i), says: retiredSays(ctx, i) })
    else out.undated.retired = (out.undated.retired ?? 0) + 1
  }
  for (const r of releases(ctx)) out.events.push({ date: r.date, kind: "release", subject: r.tag, says: `version tag ${r.tag}` })
  for (const p of passes) {
    const first = told(p).split("\n").find((l) => l.trim())?.trim() ?? ""
    out.events.push({
      date: p.date,
      ...(p.at && isMoment(p.at) ? { at: p.at } : {}),
      kind: "session",
      subject: p.branch,
      says: `session note on ${p.branch}${first ? `: ${first}` : ""}`,
    })
  }
  for (const r of readRecords(ctx)) {
    out.events.push({ date: r.date, ...(r.at ? { at: r.at } : {}), kind: "record", subject: r.kind, says: `${r.kind}: ${r.title}` })
  }
  out.events.sort(byMoment)
  return out
}

const KIND_WIDTH = 13

const undatedLine = (u: Timeline["undated"]): string[] => {
  const parts = Object.entries(u).map(([k, n]) => `${k} ${n}`)
  return parts.length ? [`undated, not placed: ${parts.join(", ")} — an item without created, or resolved without closedOn or fixedOn`] : []
}

/** `naima view timeline`. */
export function timelineView(passes: (ctx: Context) => SessionNote[]): View {
  return {
    name: "timeline",
    says:
      "when each gate opened and passed, each epic began and finished, each release and session — derived from the items and git, nothing stored; undated ones counted at the foot",
    render(_args, ctx) {
      const t = timelineOf(ctx, passes(ctx))
      return rendered(
        t,
        (d) => [
          ...(d.events.length ? d.events.map((e) => `${e.date}  ${e.kind.padEnd(KIND_WIDTH)} ${e.says}`) : ["no events yet"]),
          ...undatedLine(d.undated),
        ],
        (d) => [
          "| Date | Event | What |",
          "| --- | --- | --- |",
          ...d.events.map((e) => `| ${e.date} | ${e.kind} | ${e.says.replace(/\|/g, "\\|")} |`),
          ...(undatedLine(d.undated).length ? ["", ...undatedLine(d.undated)] : []),
        ],
      )
    },
  }
}

const esc = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")

/** The timeline as a tab of `naima ui`: the shape the `ui-views` point takes, declared here since plugins never import each other. */
export function timelineUiView(passes: (ctx: Context) => SessionNote[]) {
  return {
    name: "timeline",
    title: "Timeline",
    // After the tabs of the work itself — the metrics first — whatever the load order.
    order: 10,
    says: "the project's events — gates, epics, releases, sessions, records — derived from the items and git, oldest first",
    render(_params: Record<string, string[]>, ctx: Context) {
      const t = timelineOf(ctx, passes(ctx))
      const rows = t.events.map((e) => `<tr><td>${e.date}</td><td>${esc(e.kind)}</td><td>${esc(e.says)}</td></tr>`)
      const foot = undatedLine(t.undated).map((l) => `<p class="foot">${esc(l)}</p>`)
      return {
        data: t,
        html: [
          "<h1>Timeline</h1>",
          t.events.length
            ? `<table><thead><tr><th>Date</th><th>Event</th><th>What</th></tr></thead><tbody>${rows.join("")}</tbody></table>`
            : "<p>No events yet.</p>",
          ...foot,
        ].join("\n"),
        css:
          "body{font-family:system-ui,sans-serif;margin:16px}table{border-collapse:collapse}td,th{text-align:left;padding:2px 12px 2px 0;vertical-align:top}td:first-child{white-space:nowrap}.foot{color:#888}",
      }
    },
  }
}

const pad = (n: number): string => String(n).padStart(2, "0")
/** The local day of a moment, YYYY-MM-DD. */
const localDay = (d: Date): string => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
/** The local time of a moment, HH:MM. */
const localTime = (iso: string): string => {
  const d = new Date(iso)
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/**
 * The moment an event of `date` happened, as an ISO timestamp: the one given --
 * a local time on that day, or a timestamp of that day -- else now when the
 * event is of today, else none: a moment on an earlier day would be a guess.
 */
function momentOf(date: string, given: string | undefined, now: Date): string | undefined {
  if (given === undefined) return localDay(now) === date ? now.toISOString() : undefined
  if (/^\d{2}:\d{2}(:\d{2})?$/.test(given)) {
    const local = new Date(`${date}T${given.length === 5 ? `${given}:00` : given}`)
    if (Number.isNaN(local.getTime())) throw new Error(`--at ${given}: not a time of day`)
    return local.toISOString()
  }
  if (!isMoment(given)) throw new Error(`--at is a time of day (HH:MM) or a timestamp, got ${JSON.stringify(given)}`)
  if (given.slice(0, 10) !== date) throw new Error(`--at ${given} is not on the event's day, ${date}`)
  return new Date(given).toISOString()
}

/** `naima event`: record what nothing derives, one file per event. */
export const eventCommand: Command = {
  name: "event",
  says:
    "record an event the timeline cannot derive — a decision taken elsewhere, a build handed out, a policy, an outside fact — as one new file; everything else on `naima view timeline` is derived",
  enforces: "an event has a YYYY-MM-DD date and a one-word kind, and is one new file; what the timeline derives is never recorded",
  usage: 'event <YYYY-MM-DD> "<what happened>" [--kind <kind>] [--at <HH:MM | ISO timestamp>] [--about <item>[,<item>...]]',
  options: [
    {
      name: "--kind",
      says: "what sort of event: decision, build, policy, fact, diary, finding (a stepping stone worth telling), or any word",
      default: "fact",
    },
    { name: "--about", says: "the items the event is about, by reference, separated by commas: each must name an item; naima diary <item> tells them" },
    {
      name: "--at",
      says:
        "the moment it happened: a local time on that day (HH:MM or HH:MM:SS), or a timestamp of that day; recorded so the events of one day keep their order",
      default: "now, for an event of today; none for an earlier day",
    },
  ],
  examples: [
    'event 2026-09-14 "Build 3 handed to the testers" --kind build',
    'event 2026-09-20 "The vendor ended support for v1"',
    'event 2026-10-05 "Work on the new engine starts from its requirements" --kind diary --at 09:30',
  ],
  run(args, ctx) {
    const p = parse(args, { kind: { type: "string" }, at: { type: "string" }, about: { type: "string" } })
    const [date, ...words] = p.positionals
    const text = words.join(" ").trim()
    if (!date || !text) throw usageError(this)
    if (!isDate(date)) throw new Error(`an event's date is YYYY-MM-DD, got ${JSON.stringify(date)}`)
    const kind = (str(p, "kind") ?? "fact").trim()
    if (!/^[a-z0-9][a-z0-9-]*$/.test(kind)) throw new Error(`an event's kind is one word of lowercase letters, digits and dashes, got ${JSON.stringify(kind)}`)
    const at = momentOf(date, str(p, "at"), ctx.now())
    const about = (str(p, "about") ?? "").split(",").map((r) => r.trim()).filter(Boolean)
    const refs = refsOf(ctx)
    for (const r of about) if (!refs.has(r)) throw new Error(`--about ${r}: no such item; name one by its reference, such as todos/<slug>`)
    const dir = join(ctx.trackerRoot, EVENTS)
    mkdirSync(dir, { recursive: true })
    const name = `${date}-${randomUUID()}.md`
    const allowance = guardPrivate("the event", findPrivate(text, privateContext()), ctx.allowPrivate)
    const record = frontLines(beforeTextWrite(ctx, "the event"))
    writeFileAtomic(
      join(dir, name),
      `---\ndate: ${date}\n${at ? `at: ${at}\n` : ""}kind: ${kind}\n${about.length ? `about: ${JSON.stringify(about)}\n` : ""}${record}---\n\n${
        [text, allowance].filter(Boolean).join("\n\n")
      }\n`,
    )
    ctx.out(`wrote ${ctx.trackerDir}/${EVENTS}/${name} — commit it ${commitOn(ctx.root)}`)
    return 0
  },
}

const DIARY = "diary"
/** The kind of a diary entry that marks a stepping stone worth telling: a counterexample that changed a spec, a metric that moved. */
const FINDING = "finding"
const DECISIONS = "decisions"
const DECIDED_ON = { name: "decidedOn", kind: "date" } as const

export interface DiaryEntry {
  date: string
  at?: string
  kind: "decision" | "diary" | "finding" | "session" | "delivery" | "retired"
  text: string
  /** The items the entry is about, by reference: its own item for a decision, a delivery or a retirement, those
   * recorded with `naima event --about`, and those its text cites by reference that name an item. */
  about: string[]
}

/** The first paragraph under a page's `## <heading>`, or nothing. */
function section(page: string, heading: string): string {
  const at = page.search(new RegExp(`^## ${heading}\\s*$`, "m"))
  if (at < 0) return ""
  const after = page.slice(at).split("\n").slice(1).join("\n").trim()
  return after.split(/\n\s*\n|\n## /)[0]?.replace(/\s+/g, " ").trim() ?? ""
}

/** Every dated decision, as the diary tells it: its title, and its reason when its page gives one. */
function decisionsOf(ctx: Context): { date: string; title: string; text: string; ref: string }[] {
  if (!ctx.registry.types.has(DECISIONS)) return []
  return ctx.repo.items.filter((i) => i.type === DECISIONS).flatMap((d) => {
    const date = fieldValue(d, DECIDED_ON) ?? created(d)
    if (!isDate(date)) return []
    const title = String(d.meta.title ?? "")
    const why = section(readReadme(d), "Why")
    return [{ date, title, text: why ? `${title}. Why: ${why}` : title, ref: label(d) }]
  })
}

const ARTIFACTS = "artifacts"
const DELIVERED_ON = { name: "deliveredOn", kind: "date" } as const

/** Every artifact delivered, on the day it was: its title and label, at the moment its madeFrom records when it does. */
function deliveriesOf(ctx: Context): DiaryEntry[] {
  if (!ctx.registry.types.has(ARTIFACTS)) return []
  return ctx.repo.items.filter((i) => i.type === ARTIFACTS).flatMap((a): DiaryEntry[] => {
    const date = fieldValue(a, DELIVERED_ON)
    if (!date || !isDate(date)) return []
    const made = a.meta["madeFrom"]
    const at = made && typeof made === "object" ? (made as { at?: unknown }).at : undefined
    return [{
      date,
      ...(typeof at === "string" && isMoment(at) ? { at } : {}),
      kind: "delivery",
      text: `Delivered: ${a.meta.title} (${label(a)})`,
      about: [label(a)],
    }]
  })
}

/** Every item retired on the owner's word, on the day it was: what it was, why, and what replaced it. */
const retirementsOf = (ctx: Context): DiaryEntry[] =>
  ctx.repo.items.filter((i) => isRetired(ctx, i)).flatMap((i): DiaryEntry[] => {
    const date = fieldValue(i, CLOSED_ON)
    return isDate(date) ? [{ date, kind: "retired", text: `Retired: ${retiredSays(ctx, i)}`, about: [label(i)] }] : []
  })

/** The diary: records of kind diary, decisions with their reasons, artifacts delivered, items retired, session notes -- oldest first. */
export function diaryOf(ctx: Context, passes: SessionNote[]): DiaryEntry[] {
  const refs = refsOf(ctx)
  const out: DiaryEntry[] = decisionsOf(ctx).map((d) => ({ date: d.date, kind: "decision", text: d.text, about: aboutOf(refs, [d.ref], d.text) }))
  out.push(...deliveriesOf(ctx))
  out.push(...retirementsOf(ctx))
  for (const r of readRecords(ctx).filter((r) => r.kind === DIARY || r.kind === FINDING)) {
    const text = r.text.replace(/\s+/g, " ")
    out.push({ date: r.date, ...(r.at ? { at: r.at } : {}), kind: r.kind === FINDING ? "finding" : "diary", text, about: aboutOf(refs, r.about, text) })
  }
  for (const p of passes) {
    const body = told(p).replace(/\s+/g, " ")
    if (body) {
      out.push({ date: p.date, ...(p.at && isMoment(p.at) ? { at: p.at } : {}), kind: "session", text: `${p.branch}: ${body}`, about: aboutOf(refs, [], body) })
    }
  }
  return out.sort(byMoment)
}

/** An item as the diary view lists it: the day, its reference and its title. */
export interface DiaryItem {
  date: string
  ref: string
  title: string
}

/** The diary view's data: the entries, then what the project did that nothing tells in words: the version tags, and
 * the items filed and closed, each on its day. */
export interface DiaryData {
  entries: DiaryEntry[]
  releases: { date: string; tag: string }[]
  filed: DiaryItem[]
  closed: DiaryItem[]
}

/** The diary's data, as the diary view gives it. */
export function diaryDataOf(ctx: Context, passes: SessionNote[]): DiaryData {
  const item = (i: Item, date: string): DiaryItem => ({ date, ref: label(i), title: String(i.meta.title ?? "") })
  const filed = ctx.repo.items.flatMap((i) => {
    const d = created(i)
    return d ? [item(i, d)] : []
  })
  const closed = ctx.repo.items.flatMap((i) => {
    const d = resolved(ctx, i)
    return d && !isRetired(ctx, i) ? [item(i, d)] : []
  })
  const byDate = (a: { date: string }, b: { date: string }) => a.date.localeCompare(b.date)
  return { entries: diaryOf(ctx, passes), releases: releases(ctx).sort(byDate), filed: filed.sort(byDate), closed: closed.sort(byDate) }
}

/** `naima view diary`: the diary as data, for the UI's diary screen. */
export function diaryView(passes: (ctx: Context) => SessionNote[]): View {
  return {
    name: "diary",
    says: "the diary's entries, each with the items it is about, with the version tags and the items filed and closed on each day: what the diary screen draws",
    render(_args, ctx) {
      const d = diaryDataOf(ctx, passes(ctx))
      const line = (e: DiaryEntry) => `${e.date}  ${e.kind.padEnd(8)}  ${e.text}${e.about.length ? `  [${e.about.join(", ")}]` : ""}`
      return rendered(
        d,
        (x) => [
          ...(x.entries.length ? x.entries.map(line) : ["the diary is empty"]),
          `${x.releases.length} releases, ${x.filed.length} items filed, ${x.closed.length} closed`,
        ],
        (x) => [
          "| Date | Kind | What | About |",
          "| --- | --- | --- | --- |",
          ...x.entries.map((e) => `| ${e.date} | ${e.kind} | ${e.text.replace(/\|/g, "\\|")} | ${e.about.join(", ")} |`),
        ],
      )
    },
  }
}

/** The diary as a view of `naima ui`, the data its diary screen reads (`data` with the view `diary`): the shape of
 * `naima view diary --json`, with the entries as a plain list for the page that has no screen. */
export function diaryUiView(passes: (ctx: Context) => SessionNote[]) {
  return {
    name: "diary",
    title: "Diary",
    order: 11,
    screen: true,
    says: "the diary's entries, each with the items it is about, with the version tags and the items filed and closed on each day",
    render(_params: Record<string, string[]>, ctx: Context) {
      const d = diaryDataOf(ctx, passes(ctx))
      const rows = d.entries.map((e) => `<tr><td>${e.date}</td><td>${esc(e.kind)}</td><td>${esc(e.text)}</td></tr>`)
      return {
        data: d,
        html: [
          "<h1>Diary</h1>",
          rows.length
            ? `<table><thead><tr><th>Date</th><th>Kind</th><th>What</th></tr></thead><tbody>${rows.join("")}</tbody></table>`
            : "<p>The diary is empty.</p>",
        ].join("\n"),
      }
    },
  }
}

/** `naima diary`: the project's story, day by day. */
export function diaryCommand(passes: (ctx: Context) => SessionNote[]): Command {
  return {
    name: "diary",
    says:
      "the project's story, day by day and in order: events recorded with --kind diary, every decision with its reason, every artifact delivered, every item retired with its reason, every session note; nothing stored but those files",
    enforces: "nothing: it reads the records, the decisions, the artifacts, the retired items and the session notes, and writes nothing",
    usage: "diary [<item>] [--from <YYYY-MM-DD>] [--to <YYYY-MM-DD>] [--findings] [--json]",
    options: [
      { name: "--from", says: "the first day to tell" },
      { name: "--to", says: "the last day to tell" },
      { name: "--findings", says: "tell only the findings, the stepping stones recorded with --kind finding" },
      { name: "--json", says: "print the entries as data, each with the items it is about" },
    ],
    examples: [
      "diary",
      "diary --from 2026-10-05",
      "diary features/the-new-engine",
      "diary --findings",
      'event 2026-10-05 "The plan was entered" --kind diary --about features/the-new-engine',
    ],
    run(args, ctx) {
      const p = parse(args, { from: { type: "string" }, to: { type: "string" }, findings: { type: "boolean" }, json: { type: "boolean" } })
      const from = str(p, "from")
      const to = str(p, "to")
      for (const d of [from, to]) if (d !== undefined && !isDate(d)) throw new Error(`a day is YYYY-MM-DD, got ${JSON.stringify(d)}`)
      const [about] = p.positionals
      if (about !== undefined && !refsOf(ctx).has(about)) throw new Error(`no item ${JSON.stringify(about)}: name one by its reference, such as todos/<slug>`)
      const entries = diaryOf(ctx, passes(ctx)).filter((e) =>
        (from === undefined || e.date >= from) && (to === undefined || e.date <= to) && (about === undefined || e.about.includes(about)) &&
        (p.values["findings"] !== true || e.kind === "finding")
      )
      if (p.values["json"] === true) {
        ctx.out(JSON.stringify(entries, null, 2))
        return 0
      }
      if (!entries.length) {
        ctx.out('the diary is empty -- naima event <day> "<what happened>" --kind diary')
        return 0
      }
      let day = ""
      for (const e of entries) {
        if (e.date !== day) {
          if (day) ctx.out("")
          day = e.date
          ctx.out(day)
        }
        ctx.out(`  ${e.at ? localTime(e.at) : "--:--"}  ${e.kind.padEnd(8)}  ${e.text}${e.about.length ? `  (about ${e.about.join(", ")})` : ""}`)
      }
      return 0
    },
  }
}

const DIARY_PER_DAY = 5

/** The coordination option `diaryPerDay`: how many diary entries a day may hold before the check notes it. */
export function readDiaryPerDay(options: Record<string, unknown>): number {
  const v = options["diaryPerDay"] ?? DIARY_PER_DAY
  if (typeof v !== "number" || !Number.isInteger(v) || v < 1) {
    throw new Error(
      `coordination: option diaryPerDay must be a positive whole number, the diary entries a day may hold before naima check notes it; got ${
        JSON.stringify(v)
      }`,
    )
  }
  return v
}

/** Text reduced to its words, lowercase, so that a restatement is found whatever its spacing and punctuation. */
const words = (s: string): string => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim()

/** `diary-entries`: a crowded day, and an entry that only restates what the diary already shows -- as notes, never failing. */
export function diaryCheck(passes: (ctx: Context) => SessionNote[], perDay: number): Check {
  return {
    name: "diary-entries",
    says:
      "as notes, never failing: a day with more diary entries than the coordination option diaryPerDay (5 by default), and a diary entry that only restates a session note of its day or a decision taken that day, which naima diary already shows",
    run(ctx) {
      const out: Finding[] = []
      const rule = "rule coordination/agents-keep-the-diary"
      const records = readRecords(ctx).filter((r) => r.kind === DIARY)
      const byDay = new Map<string, number>()
      for (const r of records) byDay.set(r.date, (byDay.get(r.date) ?? 0) + 1)
      for (const [day, n] of [...byDay].sort(([a], [b]) => a.localeCompare(b))) {
        if (n <= perDay) continue
        out.push({
          level: "note",
          message:
            `diary: ${day} has ${n} diary entries, more than ${perDay} — one entry per decision taken with the owner or notable turn, the related turns of one conversation in one (${rule}; the limit is the coordination option diaryPerDay)`,
        })
      }
      const refs = refsOf(ctx)
      for (const r of readRecords(ctx)) {
        for (const ref of r.about.filter((x) => !refs.has(x))) {
          out.push({
            level: "note",
            message:
              `${ctx.trackerDir}/${EVENTS}/${r.file}: its about names ${ref}, which is no item (moved or renamed?): the diary cannot point at it (${rule})`,
          })
        }
      }
      const notes = passes(ctx)
      const decisions = decisionsOf(ctx)
      for (const r of records) {
        const said = words(r.text)
        if (!said) continue
        const where = `${ctx.trackerDir}/${EVENTS}/${r.file} (${JSON.stringify(r.title)})`
        const note = notes.find((p) => p.date === r.date && words(p.body).includes(said))
        const decision = decisions.find((d) => d.date === r.date && words(d.text).includes(said))
        if (note) {
          out.push({
            level: "note",
            message: `${where}: a diary entry that only restates the session note of ${r.date} on ${note.branch}, which naima diary already shows (${rule})`,
          })
        } else if (decision) {
          out.push({
            level: "note",
            message: `${where}: a diary entry that only restates the decision ${
              JSON.stringify(decision.title)
            }, which naima diary already shows with its reason (${rule})`,
          })
        }
      }
      return out
    },
  }
}
