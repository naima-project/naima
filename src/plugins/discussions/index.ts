// Discussions: what needs time with a person, not a quick answer, and the
// meetings that gather it.
//
// A discussion is an item of its own: the topic, the question or questions,
// the options, and, once decided, the decision. It links the items it is about
// with `concerns`. Like any item it takes a priority, a gate or milestone, and
// an optional date (`due`); a later priority or a date to come defers it, and
// it stays queued. Its status is open until the decision is recorded with
// `naima decide <discussion> "<decision>"`, then decided; a decided discussion
// without a decision is refused. Deciding writes only fields Naima fills and a
// status flagged `filled`, so the trunk guard takes it on the trunk, during a
// meeting.
//
// A meeting is a gate, contributed through the gates point: its agenda is the
// discussions on it (`gate=<meeting>`), and it holds once every one is decided.
// `naima meeting <m>` orders the agenda: what is due or urgent now first, then
// what blocks a release or a milestone, then the rest, then what is deferred.
// It names who it needs; by default it takes place whenever they are present,
// and it may carry a date instead. Meetings are configured, in this plugin's
// options in naima.json, written by `naima meeting new`:
//
//   "plugins": { "discussions": { "options": { "meetings": {
//     "owner": { "title": "With the owner", "needs": ["owner"], "on": "2026-11-03" } } } } }
//
// `naima meeting <m> --close` ends a meeting: it groups the decisions not yet
// turned into work into packages, one per open item they concern, and, with
// the owner's yes, records each package's choice on its item as a `ready`
// record: queued (the default) or to start now. The ready queue is what the
// coordinator starts on its own whenever a worker slot is free.
//
// `naima hello` names each meeting with open discussions, so the agent opens
// with its agenda when the people it needs are there.
//
// The model: develop/models/meeting/meeting.mcrl2 in the workshop, with its
// properties (nothing starts without the owner's yes, no work starts during a
// meeting, approved work is started).

import { readFileSync } from "node:fs"
import { join } from "node:path"
import {
  addLink,
  bool,
  byUrgency,
  type Check,
  type Command,
  type Context,
  CONTRACT,
  createItem,
  DATA_FILE,
  DEFAULT_DATA,
  fieldValue,
  fieldValues,
  FILLED,
  type Finding,
  isOpen,
  type Item,
  label,
  linked,
  parse,
  type Plugin,
  READY,
  type ReadyRecord,
  readyRecord,
  rendered,
  saveMeta,
  saveProse,
  setFields,
  setFieldValue,
  str,
  strs,
  type SummarySection,
  today,
  type TypeDef,
  usageError,
  type WriteHook,
  writeJson,
} from "../../core/api.ts"

const CONCERNS = "concerns"
const CONCERNED_BY = "concerned-by"
const DECISION = { name: "decision", kind: "string" } as const
const DECISION_ON = { name: "decisionOn", kind: "date" } as const
const PACKAGED = { name: "packaged", kind: "date" } as const
const GATE = { name: "gate", kind: "enum" } as const
const DUE = { name: "due", kind: "date" } as const
const PRIORITY = { name: "priority", kind: "enum" } as const
/** The priorities that defer a discussion: it stays queued, after the rest. */
const DEFERRING = ["later", "parked"]
const FOLLOW_UP_TYPE = "todos"

const discussionsType: TypeDef = {
  id: "discussions",
  dir: "discussions",
  title: "Discussions",
  says:
    "a question that needs time with a person, not a quick answer: the topic, the question, the options, and the decision once taken; on a meeting's agenda",
  statuses: {
    open: { category: "open", says: "not decided yet: it waits for a meeting with the people it needs" },
    decided: { category: "done", says: "decided: the decision is recorded in its decision field", flags: [FILLED] },
  },
  initialStatus: "open",
  template: (title) =>
    `# ${title}\n\n## The question\n\nWhat has to be decided, in one or two sentences.\n\n## Options\n\n- The choices seen so far, each with what it costs.\n\n## To read before\n\nThe items and pages that give the context.\n`,
}

/** A meeting as the project configures it. */
export interface MeetingConfig {
  title: string
  /** Who it needs: the people who must be present. */
  needs?: string[]
  /** A fixed date, YYYY-MM-DD; without one, it takes place whenever the people it needs are present. */
  on?: string
}

const DATE = /^\d{4}-\d{2}-\d{2}$/
const isDate = (v: unknown): v is string => typeof v === "string" && DATE.test(v) && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v
const NAME = /^[a-z0-9][a-z0-9._-]*$/
const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v)

function readMeetings(options: Record<string, unknown>): Record<string, MeetingConfig> {
  const meetings = options["meetings"] ?? {}
  if (!isObject(meetings)) throw new Error("discussions: options.meetings must be an object")
  for (const [name, m] of Object.entries(meetings)) {
    if (!NAME.test(name)) throw new Error(`discussions: meeting "${name}": a name is lowercase letters, digits, dots, dashes and underscores`)
    if (!isObject(m) || typeof m["title"] !== "string" || !m["title"].trim()) throw new Error(`discussions: meeting "${name}" needs a title`)
    const needs = m["needs"]
    if (needs !== undefined && (!Array.isArray(needs) || !needs.length || !needs.every((n) => typeof n === "string" && n.trim()))) {
      throw new Error(`discussions: meeting "${name}": needs is a non-empty list of names`)
    }
    if (m["on"] !== undefined && !isDate(m["on"])) throw new Error(`discussions: meeting "${name}": on is a date, YYYY-MM-DD, got ${JSON.stringify(m["on"])}`)
  }
  return meetings as Record<string, MeetingConfig>
}

const needsOf = (m: MeetingConfig): string[] => m.needs ?? ["owner"]
const whenOf = (m: MeetingConfig): string => (m.on ? `on ${m.on}` : `whenever ${needsOf(m).join(" and ")} ${needsOf(m).length > 1 ? "are" : "is"} present`)

const isDiscussion = (i: Item): boolean => i.type === discussionsType.id
/** A meeting's agenda: the discussions on it. */
const agendaOf = (ctx: Context, name: string): Item[] => ctx.repo.items.filter((i) => isDiscussion(i) && fieldValues(i, GATE).includes(name))
const openAgenda = (ctx: Context, name: string): Item[] => agendaOf(ctx, name).filter((i) => isOpen(ctx, i))

/** Where an open discussion stands on the agenda, in the order the meeting takes them. */
export type Place = "now" | "blocks" | "rest" | "deferred"
const PLACES: Place[] = ["now", "blocks", "rest", "deferred"]
const PLACE_SAYS: Record<Place, string> = {
  now: "due or urgent now",
  blocks: "blocks a release or a milestone",
  rest: "the rest",
  deferred: "deferred: a later priority, or a date to come",
}

/** The gates other than meetings a discussion is on — the releases and milestones it blocks — with their dates. */
function blockedGates(ctx: Context, d: Item, meetings: Record<string, MeetingConfig>): { name: string; due?: string }[] {
  const out: { name: string; due?: string }[] = []
  for (const g of fieldValues(d, GATE)) {
    const found = Object.hasOwn(meetings, g) ? undefined : ctx.registry.find<{ due?: unknown }>("gates", g)
    if (!found) continue
    const due = found.value?.due
    out.push({ name: g, ...(isDate(due) ? { due } : {}) })
  }
  return out
}

function placeOf(ctx: Context, d: Item, meetings: Record<string, MeetingConfig>): Place {
  const due = fieldValue(d, DUE), priority = fieldValue(d, PRIORITY)
  if (due && due > today(ctx)) return "deferred"
  if ((due && due <= today(ctx)) || priority === "now") return "now"
  if (priority && DEFERRING.includes(priority)) return "deferred"
  return blockedGates(ctx, d, meetings).length ? "blocks" : "rest"
}

/** The open discussions of a meeting in the order it takes them: due or urgent now, what blocks a release or a milestone (soonest first), the rest, then the deferred. */
export function orderedAgenda(ctx: Context, name: string, meetings: Record<string, MeetingConfig>): { item: Item; place: Place }[] {
  const soonest = (d: Item): string => blockedGates(ctx, d, meetings).map((g) => g.due ?? "9999").sort()[0] ?? "9999"
  const key = (d: Item, place: Place): string =>
    place === "now" ? (fieldValue(d, DUE) ?? "9999") : place === "blocks" ? soonest(d) : place === "deferred" ? (fieldValue(d, DUE) ?? "9999") : ""
  return openAgenda(ctx, name)
    .map((item) => ({ item, place: placeOf(ctx, item, meetings) }))
    .sort((a, b) =>
      PLACES.indexOf(a.place) - PLACES.indexOf(b.place) || key(a.item, a.place).localeCompare(key(b.item, b.place)) ||
      String(a.item.meta["created"] ?? "").localeCompare(String(b.item.meta["created"] ?? "")) || a.item.slug.localeCompare(b.item.slug)
    )
}

/** The gate a meeting contributes: the shape the gates point takes, declared here since plugins never import each other. */
interface MeetingGate {
  name: string
  configured: true
  title: string
  says: string
  decides: string
  evaluate(ctx: Context): { holds: boolean; blocking: Item[]; owed: Item[] }
}

const meetingGate = (name: string, m: MeetingConfig): MeetingGate => ({
  name,
  configured: true,
  title: m.title,
  says: `a meeting with ${needsOf(m).join(" and ")}, ${whenOf(m)}: its agenda is the discussions on it`,
  decides: `blocked by every open discussion with gate=${name}; holds once each one is decided (naima decide).`,
  evaluate: (ctx) => {
    const blocking = openAgenda(ctx, name)
    return { holds: blocking.length === 0, blocking, owed: [] }
  },
})

const DATA_PATH = (ctx: Context): string => join(ctx.trackerRoot, DATA_FILE)

/** Write a meeting into naima.json, validated as the next load reads it. */
function declareMeeting(ctx: Context, name: string, meeting: MeetingConfig, known: Record<string, MeetingConfig>): void {
  if (ctx.registry.find("gates", name) || Object.hasOwn(known, name)) throw new Error(`a gate or meeting "${name}" already exists — naima gates`)
  const raw = JSON.parse(readFileSync(DATA_PATH(ctx), "utf8")) as Record<string, unknown>
  const plugins = isObject(raw["plugins"]) ? raw["plugins"] : {}
  const entry = isObject(plugins["discussions"]) ? plugins["discussions"] : {}
  const options = isObject(entry["options"]) ? entry["options"] : {}
  const current = isObject(options["meetings"]) ? options["meetings"] : {}
  if (Object.hasOwn(current, name)) throw new Error(`a meeting "${name}" already exists — naima meeting show ${name}`)
  const next = { ...options, meetings: { ...current, [name]: meeting } }
  readMeetings(next)
  writeJson(DATA_PATH(ctx), { ...raw, plugins: { ...plugins, discussions: { ...entry, options: next } } })
}

function agendaLines(ctx: Context, name: string, m: MeetingConfig, meetings: Record<string, MeetingConfig>): string[] {
  const all = agendaOf(ctx, name)
  const ordered = orderedAgenda(ctx, name, meetings)
  const out = [`${name} — ${m.title} (needs ${needsOf(m).join(", ")}; ${whenOf(m)}): ${ordered.length} open of ${all.length}`]
  let n = 0
  for (const place of PLACES) {
    const here = ordered.filter((o) => o.place === place)
    if (!here.length) continue
    out.push(`  ${PLACE_SAYS[place]}:`)
    for (const { item: d } of here) {
      const about = linked(ctx, d, CONCERNS).map(label)
      const why = [
        ...(fieldValue(d, DUE) ? [`due ${fieldValue(d, DUE)}`] : []),
        ...(fieldValue(d, PRIORITY) ? [`priority ${fieldValue(d, PRIORITY)}`] : []),
        ...blockedGates(ctx, d, meetings).map((g) => `blocks ${g.name}${g.due ? ` (${g.due})` : ""}`),
      ]
      out.push(
        `  ${place === "deferred" ? "-" : `${++n}.`} ✗ ${label(d)}  ${d.meta.title}${about.length ? `  (about ${about.join(", ")})` : ""}${
          why.length ? `  [${why.join("; ")}]` : ""
        }`,
      )
    }
  }
  for (const d of all.filter((i) => !isOpen(ctx, i))) out.push(`  ✓ ${label(d)}  ${d.meta.title}: ${fieldValue(d, DECISION) ?? ""}`)
  return out
}

/** Whether a meeting is due now: always without a date, from its date on with one. */
const dueNow = (ctx: Context, m: MeetingConfig): boolean => !m.on || m.on <= today(ctx)

/** A work package: an open item and the decisions about it not yet turned into work. */
interface Package {
  item: Item
  decisions: Item[]
}

/** The decisions of a meeting not yet turned into work, grouped by the open item each concerns; those concerning none apart. */
function packagesOf(ctx: Context, name: string): { packages: Package[]; loose: Item[] } {
  const decided = agendaOf(ctx, name).filter((d) => !isOpen(ctx, d) && !fieldValue(d, PACKAGED))
  const byItem = new Map<string, Package>()
  const loose: Item[] = []
  for (const d of decided) {
    const work = [...linked(ctx, d, CONCERNS), ...linked(ctx, d, CONCERNED_BY)].filter((i) => !isDiscussion(i) && isOpen(ctx, i))
    if (!work.length) loose.push(d)
    for (const w of work) {
      const pkg = byItem.get(w.meta.id) ?? { item: w, decisions: [] }
      if (!pkg.decisions.includes(d)) pkg.decisions.push(d)
      byItem.set(w.meta.id, pkg)
    }
  }
  const order = byUrgency(ctx, [...byItem.values()].map((k) => k.item))
  return { packages: order.map((i) => byItem.get(i.meta.id)!), loose }
}

/** The packages a list of references names, refused when one is not a package of this close. */
function namedPackages(ctx: Context, refs: string[], packages: Package[], option: string): Set<string> {
  const out = new Set<string>()
  for (const ref of refs.flatMap((r) => r.split(",")).map((r) => r.trim()).filter(Boolean)) {
    const item = ctx.repo.resolve(ref)
    if (!packages.some((p) => p.item === item || p.item.meta.id === item.meta.id)) {
      throw new Error(`${option} ${label(item)}: not a package of this close — packages: ${packages.map((p) => label(p.item)).join(", ") || "none"}`)
    }
    out.add(item.meta.id)
  }
  return out
}

/**
 * The end of a meeting: the decisions not yet turned into work, grouped into packages by the open item they concern.
 * Without --consent it proposes them and writes nothing; with it, it records the owner's choice on each package's item
 * (a ready record, queued unless --start names it; nothing for one --skip names) and marks every decision packaged.
 */
function closeMeeting(ctx: Context, name: string, m: MeetingConfig, p: ReturnType<typeof parse>): number {
  const { packages, loose } = packagesOf(ctx, name)
  const start = namedPackages(ctx, strs(p, "start"), packages, "--start")
  const skip = namedPackages(ctx, strs(p, "skip"), packages, "--skip")
  for (const id of start) if (skip.has(id)) throw new Error(`${label(ctx.repo.byId.get(id)!)} is both started and skipped: choose one`)
  const consent = str(p, "consent")?.trim()
  const open = openAgenda(ctx, name).length
  if (!packages.length && !loose.length) {
    ctx.out(
      `${name}: no decision waits to become work${
        open ? `; ${open} discussion${open === 1 ? "" : "s"} stay${open === 1 ? "s" : ""} open, for the next meeting` : ""
      }`,
    )
    return 0
  }
  const choice = (pkg: Package): string => skip.has(pkg.item.meta.id) ? "not now" : start.has(pkg.item.meta.id) ? "start now" : "queue (the default)"
  if (!consent) {
    const count = new Set(packages.flatMap((k) => k.decisions)).size
    ctx.out(
      `Closing ${name} — ${m.title}: ${count} decision${count === 1 ? "" : "s"} become work in ${packages.length} package${packages.length === 1 ? "" : "s"}.`,
    )
    packages.forEach((pkg, n) => {
      ctx.out(`  ${n + 1}. ${label(pkg.item)}  ${pkg.item.meta.title}  → ${choice(pkg)}`)
      for (const d of pkg.decisions) ctx.out(`       ${label(d)}: ${fieldValue(d, DECISION) ?? ""}`)
    })
    if (loose.length) {
      ctx.out(`  decided, with no open item to do: ${loose.map(label).join(", ")} — to make work of one, file it and link it concerns, then close again`)
    }
    if (open) ctx.out(`  still open, for the next meeting: ${open}`)
    ctx.out("Ask the owner about each package, one per message: queue it (the default) or start it now. Then record the answers:")
    ctx.out(`  naima meeting ${name} --close --consent "<their yes, restated>" [--start <item>,...] [--skip <item>,...]`)
    return 0
  }
  const on = today(ctx)
  for (const pkg of packages) {
    const item = ctx.repo.resolve(label(pkg.item))
    if (skip.has(item.meta.id)) {
      ctx.out(`${label(item)}: not now — the decisions are kept, no work is queued`)
      continue
    }
    const prev = readyRecord(item)
    const record: ReadyRecord = {
      on,
      meeting: name,
      decisions: [...new Set([...(prev?.decisions ?? []), ...pkg.decisions.map((d) => d.meta.id)])],
      consent,
      ...(start.has(item.meta.id) || prev?.start ? { start: true } : {}),
    }
    setFieldValue(item, READY, record as unknown as Record<string, unknown>)
    saveMeta(ctx, item)
    ctx.out(`${label(item)}: ${record.start ? "to start now" : "queued, ready for implementation"}`)
  }
  for (const d of new Set([...packages.flatMap((k) => k.decisions), ...loose])) {
    setFields(ctx, ctx.repo.resolve(label(d)), [[PACKAGED.name, on]])
  }
  if (loose.length) ctx.out(`decided, nothing to queue: ${loose.map(label).join(", ")}`)
  ctx.out("The ready queue: naima queue --ready. The coordinator starts the next item whenever a worker slot is free, without asking.")
  return 0
}

function meetingCommand(meetings: Record<string, MeetingConfig>): Command {
  const meetingOrThrow = (name: string | undefined): [string, MeetingConfig] => {
    const m = name === undefined ? undefined : meetings[name]
    if (!name || !m) throw new Error(`no meeting "${name}" — meetings: ${Object.keys(meetings).join(", ") || 'none yet: naima meeting new <name> "<title>"'}`)
    return [name, m]
  }
  return {
    name: "meeting",
    says: "declare a meeting — who it needs, and a date or whenever they are present — put discussions on its agenda, and show the agenda",
    enforces: "only a discussion goes on a meeting's agenda, and a meeting is written to naima.json validated, as the next load reads it",
    usage:
      'meeting [<name>] | meeting <name> --close [--consent "<the owner\'s yes>"] [--start <item>,...] [--skip <item>,...] | meeting new <name> "<title>" [--needs <who>,...] [--on YYYY-MM-DD] | meeting add <meeting> <discussion>...',
    options: [
      {
        name: "--close",
        says:
          "end the meeting: group the decisions not yet turned into work into packages, one per open item they concern, and propose them; with --consent, record each package's choice on its item: queued (the default) or to start now",
      },
      { name: "--consent", says: "--close: the owner's yes to the packages, restated: recorded on each item's ready record" },
      { name: "--start", says: "--close: the packages (their items) the owner said to start now; comma-separated or repeated" },
      { name: "--skip", says: "--close: the packages the owner said not to queue now; comma-separated or repeated" },
      { name: "--needs", says: "meeting new: who must be present, comma-separated; the owner when not given" },
      { name: "--on", says: "meeting new: a fixed date, YYYY-MM-DD; without one, it takes place whenever the people it needs are present" },
    ],
    examples: [
      "meeting",
      'meeting new owner "With the owner"',
      'meeting new review "Design review" --needs owner,reviewer --on 2026-11-03',
      "meeting add owner discussions/plugin-names",
      "meeting owner",
      "meeting owner --close",
      'meeting owner --close --consent "yes, queue them; start the export fix now" --start bugs/export-alpha',
    ],
    run(args, ctx) {
      const p = parse(args, {
        needs: { type: "string" },
        on: { type: "string" },
        close: { type: "boolean" },
        consent: { type: "string" },
        start: { type: "string", multiple: true },
        skip: { type: "string", multiple: true },
      })
      const [sub, name, ...rest] = p.positionals
      if (sub === "new") {
        const title = rest[0]?.trim()
        if (!name || !title || rest.length > 1) throw usageError(this)
        const needs = str(p, "needs")?.split(",").map((s) => s.trim()).filter(Boolean)
        const on = str(p, "on")
        declareMeeting(ctx, name, { title, ...(needs?.length ? { needs } : {}), ...(on !== undefined ? { on } : {}) }, meetings)
        ctx.out(`meeting ${name} declared in ${ctx.trackerDir}/${DATA_FILE} — put discussions on its agenda: naima meeting add ${name} <discussion>...`)
        return 0
      }
      if (sub === "add") {
        if (!rest.length) throw usageError(this)
        const [meeting] = meetingOrThrow(name)
        for (const ref of rest) {
          const item = ctx.repo.resolve(ref)
          if (!isDiscussion(item)) throw new Error(`${label(item)} is not a discussion — file one: naima new discussions "<topic>"`)
          const on = fieldValues(item, GATE)
          if (!on.includes(meeting)) setFields(ctx, item, [[GATE.name, [...on, meeting].join(",")]])
          ctx.out(`${label(item)}: on the agenda of ${meeting}`)
        }
        return 0
      }
      if (sub !== undefined && (name !== undefined || rest.length)) throw usageError(this)
      if (bool(p, "close")) {
        if (sub === undefined) throw usageError(this)
        const [n, m] = meetingOrThrow(sub)
        return closeMeeting(ctx, n, m, p)
      }
      if (str(p, "consent") !== undefined || strs(p, "start").length || strs(p, "skip").length) throw usageError(this)
      const chosen = sub !== undefined ? [meetingOrThrow(sub)] : Object.entries(meetings)
      if (!chosen.length) ctx.out('no meetings — declare one: naima meeting new <name> "<title>"')
      for (const [n, m] of chosen) for (const l of agendaLines(ctx, n, m, meetings)) ctx.out(l)
      return 0
    },
  }
}

const decideCommand = (meetings: Record<string, MeetingConfig>): Command => ({
  name: "decide",
  says:
    "record the decision a discussion reached and mark it decided — a commit the trunk takes, during a meeting; a follow-up is filed only with the owner's yes",
  enforces:
    "a discussion is decided only with its decision recorded; follow-up work is filed only with --consent, the owner's yes restated, and linked from the discussion",
  usage: 'decide <discussion> "<decision>" [--follow-up "<title>" --consent "<the owner\'s yes, restated>"]',
  options: [
    { name: "--follow-up", says: `the title of a ${FOLLOW_UP_TYPE} item to file for the work the decision calls for; needs --consent` },
    { name: "--consent", says: "the owner's yes to filing the follow-up, restated: recorded on its page" },
  ],
  examples: [
    'decide discussions/plugin-names "Call them playbooks"',
    'decide discussions/meeting-time "Whenever the owner is present" --follow-up "Say the agenda at session start" --consent "yes, file it"',
  ],
  run(args, ctx) {
    const p = parse(args, { "follow-up": { type: "string" }, consent: { type: "string" } })
    const [ref, decision, ...rest] = p.positionals
    if (!ref || !decision?.trim() || rest.length) throw usageError(this)
    const followUp = str(p, "follow-up")?.trim(), consent = str(p, "consent")?.trim()
    if (followUp !== undefined && !consent) {
      throw new Error('follow-up work is filed only on the owner\'s yes: ask them, then pass --consent "<their yes, restated>"')
    }
    if (followUp === "") throw usageError(this)
    const item = ctx.repo.resolve(ref)
    if (!isDiscussion(item)) throw new Error(`${label(item)} is not a discussion`)
    if (!isOpen(ctx, item)) throw new Error(`${label(item)} is already decided: ${fieldValue(item, DECISION) ?? ""}`)
    setFields(ctx, item, [[DECISION.name, decision.trim()], [DECISION_ON.name, today(ctx)], ["status", "decided"]])
    ctx.out(`${label(item)}: decided — ${decision.trim()}`)
    if (followUp) {
      const type = ctx.registry.types.get(FOLLOW_UP_TYPE)
      if (!type) throw new Error(`no ${FOLLOW_UP_TYPE} type is loaded to file the follow-up in`)
      const todo = createItem(ctx, type, followUp)
      saveProse(ctx, todo, `# ${followUp}\n\nThe work the decision of ${label(item)} calls for: ${decision.trim()}\n\nFiled with the owner's yes: ${consent}\n`)
      // Linked from the new item, so the discussion's own file changes only in what deciding fills: the trunk takes it.
      addLink(ctx, ctx.repo.resolve(label(todo)), CONCERNED_BY, ctx.repo.resolve(label(item)))
      ctx.out(`${label(todo)}: filed, the follow-up of ${label(item)}`)
    } else {
      ctx.out(`follow-up work, if any, is filed only on the owner's yes: naima decide … --follow-up "<title>" --consent "<their yes>"`)
    }
    const meeting = fieldValues(item, GATE).find((g) => Object.hasOwn(meetings, g))
    if (meeting) {
      const left = openAgenda(ctx, meeting).length
      ctx.out(
        left
          ? `${meeting}: ${left} open — ask the next, one per message, and start no work until the meeting closes (naima meeting ${meeting})`
          : `${meeting}: nothing left open — close the meeting: naima meeting ${meeting} --close`,
      )
    }
    return 0
  },
})

const hook: WriteHook = {
  name: "discussion-decided",
  says: "a discussion is decided only with its decision recorded",
  beforeWrite(write) {
    if (write.kind === "move" || !isDiscussion(write.item)) return
    const m = write.item.meta
    if (m.status === "decided" && (typeof m[DECISION.name] !== "string" || !String(m[DECISION.name]).trim())) {
      return `a discussion is decided only with its decision: naima decide ${write.item.slug} "<decision>"`
    }
  },
}

function checks(meetings: Record<string, MeetingConfig>): Check {
  return {
    name: "discussions",
    says:
      "a decided discussion records its decision; an open one is on a meeting's agenda, or it waits for no one; a decision taken in a meeting is turned into work when the meeting closes",
    run(ctx) {
      const out: Finding[] = []
      for (const d of ctx.repo.items.filter(isDiscussion)) {
        if (!isOpen(ctx, d) && !fieldValue(d, DECISION)) {
          out.push({ level: "problem", item: d, message: `${label(d)} is decided but records no decision — naima set ${d.slug} decision="<decision>"` })
        }
        if (isOpen(ctx, d) && !fieldValues(d, GATE).some((g) => Object.hasOwn(meetings, g))) {
          out.push({ level: "note", item: d, message: `${label(d)} is on no meeting's agenda — naima meeting add <meeting> ${d.slug}` })
        }
        const meeting = fieldValues(d, GATE).find((g) => Object.hasOwn(meetings, g))
        if (!isOpen(ctx, d) && meeting && !fieldValue(d, PACKAGED)) {
          out.push({ level: "note", item: d, message: `${label(d)} is decided and not yet turned into work — naima meeting ${meeting} --close` })
        }
      }
      return out
    },
  }
}

/** What `naima hello` says: each meeting due now with discussions to take, how it runs, and the decisions waiting for its close. */
function helloSection(meetings: Record<string, MeetingConfig>): SummarySection {
  return {
    name: "meetings",
    hello: true,
    render(ctx) {
      const rows = Object.entries(meetings)
        .filter(([, m]) => dueNow(ctx, m))
        .map(([name, m]) => {
          const ordered = orderedAgenda(ctx, name, meetings)
          return {
            meeting: name,
            title: m.title,
            needs: needsOf(m),
            open: ordered.filter((o) => o.place !== "deferred").map((o) => label(o.item)),
            deferred: ordered.filter((o) => o.place === "deferred").map((o) => label(o.item)),
            toClose: packagesOf(ctx, name).packages.map((k) => label(k.item)),
          }
        })
        .filter((r) => r.open.length || r.toClose.length)
      return rendered(
        rows,
        (rs) =>
          rs.flatMap((r) => {
            const who = `${r.needs.join(" and ")} ${r.needs.length > 1 ? "are" : "is"}`
            return [
              ...(r.open.length
                ? [
                  `Meeting ${r.meeting} (${r.title}) has ${r.open.length} discussion${r.open.length === 1 ? "" : "s"} to take${
                    r.deferred.length ? ` (${r.deferred.length} more deferred)` : ""
                  }: when ${who} here, open with its agenda, in its order — naima meeting ${r.meeting} — one question per message, each answer recorded at once (naima decide), no work started until it closes; ${
                    r.needs.join(" and ")
                  } decide${r.needs.length > 1 ? "" : "s"} when to stop, and what is left stays queued.`,
                ]
                : []),
              ...(r.toClose.length
                ? [
                  `Meeting ${r.meeting}: decisions wait to become work (${
                    r.toClose.join(", ")
                  }) — close it: naima meeting ${r.meeting} --close, then ask about each package, queue (the default) or start now.`,
                ]
                : []),
            ]
          }),
      )
    },
  }
}

export default function discussions(options: Record<string, unknown> = {}): Plugin {
  const meetings = readMeetings(options)
  return {
    name: "discussions",
    contract: CONTRACT,
    says: "discussions: questions that need time with a person, gathered on the agenda of meetings",
    about:
      'A discussion is an item of its own (`naima new discussions "<topic>"`): the question, the options, and, once decided, the decision, recorded with `naima decide <discussion> "<decision>"`. ' +
      "It links the items it is about with `concerns`. A meeting is a gate whose agenda is the discussions on it: it names who it needs, takes place whenever they are present unless it has a date, and holds once every discussion on it is decided. " +
      "Like any item a discussion takes a priority, a gate or milestone, and an optional date (`due`): `naima meeting <m>` orders the agenda, what is due or has priority now first, then what blocks a release or a milestone (soonest first), then the rest; a later or parked priority, or a date to come, defers it, and it stays queued, last. " +
      "`naima meeting new` declares one, `naima meeting add` puts discussions on its agenda, `naima meeting` shows the agendas, and `naima hello` names each meeting with discussions to take so the agent opens with its agenda. " +
      "Deciding writes only fields Naima fills and the status `decided`, flagged `filled`, so the trunk guard takes it on the trunk; it files follow-up work only with the owner's yes (`--follow-up` with `--consent`), linked from the new item. " +
      "`naima meeting <m> --close` ends a meeting: it groups the decisions not yet turned into work into packages, one per open item they concern, and proposes them; with `--consent`, the owner's yes restated, it records the choice on each item as a `ready` record, queued by default or to start now (`--start`), nothing for a package `--skip` names, and marks each decision `packaged`. " +
      "`naima queue --ready` lists the ready queue, and the coordinator starts the next item on it whenever a worker slot is free.",
    options: [
      {
        name: "meetings",
        says:
          `\`plugins.discussions.options.meetings\` in \`${DEFAULT_DATA}/${DATA_FILE}\`, written by \`naima meeting new\`: meeting name → { "title", "needs" (who must be present; the owner by default), "on" (a date, YYYY-MM-DD; without one, whenever they are present) }. Each meeting is a gate of that name.`,
        default: "{}",
      },
    ],
    types: [discussionsType],
    fields: [
      {
        name: DECISION.name,
        kind: DECISION.kind,
        filled: true,
        says: "what the discussion decided, recorded by naima decide",
        appliesTo: [discussionsType.id],
      },
      {
        name: DECISION_ON.name,
        kind: DECISION_ON.kind,
        filled: true,
        says: "when the discussion was decided, stamped by naima decide",
        appliesTo: [discussionsType.id],
      },
      {
        name: PACKAGED.name,
        kind: PACKAGED.kind,
        filled: true,
        says: "when the decision was turned into work, stamped by naima meeting <m> --close",
        appliesTo: [discussionsType.id],
      },
    ],
    // A discussion may carry a date: due, it comes first on the agenda; to come, it is deferred until then.
    extends: [{ field: DUE.name, appliesTo: [discussionsType.id] }],
    relations: [
      { name: CONCERNS, inverse: CONCERNED_BY, says: "is a discussion about" },
      { name: CONCERNED_BY, inverse: CONCERNS, says: "is discussed in" },
    ],
    uses: { fields: [GATE.name, DUE.name] },
    contributes: { gates: Object.entries(meetings).map(([name, m]) => meetingGate(name, m)) },
    commands: [meetingCommand(meetings), decideCommand(meetings)],
    hooks: [hook],
    checks: [checks(meetings)],
    summary: [helloSection(meetings)],
  }
}
