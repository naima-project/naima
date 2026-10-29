// Discussions: what needs time with a person, not a quick answer, and the
// meetings that gather it.
//
// A discussion is an item of its own: the topic, the question or questions,
// the options, and, once decided, the decision. It links the items it is about
// with `concerns`. Its status is open until the decision is recorded with
// `naima decide <discussion> "<decision>"`, then decided; a decided discussion
// without a decision is refused.
//
// A meeting is a gate, contributed through the gates point: its agenda is the
// discussions on it (`gate=<meeting>`), and it holds once every one is decided.
// It names who it needs; by default it takes place whenever they are present,
// and it may carry a date instead. Meetings are configured, in this plugin's
// options in naima.json, written by `naima meeting new`:
//
//   "plugins": { "discussions": { "options": { "meetings": {
//     "owner": { "title": "With the owner", "needs": ["owner"], "on": "2026-11-03" } } } } }
//
// `naima hello` names each meeting with open discussions, so the agent opens
// with its agenda when the people it needs are there.
//
// No model: a discussion has two states, open and decided, and one way between
// them; a meeting's verdict is derived from its discussions on every read.

import { readFileSync } from "node:fs"
import { join } from "node:path"
import {
  addLink,
  type Check,
  type Command,
  type Context,
  CONTRACT,
  createItem,
  DATA_FILE,
  DEFAULT_DATA,
  fieldValue,
  fieldValues,
  type Finding,
  isOpen,
  type Item,
  label,
  linked,
  parse,
  type Plugin,
  rendered,
  saveProse,
  setFields,
  str,
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
const GATE = { name: "gate", kind: "enum" } as const
const FOLLOW_UP_TYPE = "todos"

const discussionsType: TypeDef = {
  id: "discussions",
  dir: "discussions",
  title: "Discussions",
  says:
    "a question that needs time with a person, not a quick answer: the topic, the question, the options, and the decision once taken; on a meeting's agenda",
  statuses: {
    open: { category: "open", says: "not decided yet: it waits for a meeting with the people it needs" },
    decided: { category: "done", says: "decided: the decision is recorded in its decision field" },
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
/** A meeting's agenda: the discussions on it, open ones first. */
const agendaOf = (ctx: Context, name: string): Item[] => ctx.repo.items.filter((i) => isDiscussion(i) && fieldValues(i, GATE).includes(name))
const openAgenda = (ctx: Context, name: string): Item[] => agendaOf(ctx, name).filter((i) => isOpen(ctx, i))

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

function agendaLines(ctx: Context, name: string, m: MeetingConfig): string[] {
  const all = agendaOf(ctx, name)
  const open = all.filter((i) => isOpen(ctx, i))
  const out = [`${name} — ${m.title} (needs ${needsOf(m).join(", ")}; ${whenOf(m)}): ${open.length} open of ${all.length}`]
  for (const d of open) {
    const about = linked(ctx, d, CONCERNS).map(label)
    out.push(`  ✗ ${label(d)}  ${d.meta.title}${about.length ? `  (about ${about.join(", ")})` : ""}`)
  }
  for (const d of all.filter((i) => !isOpen(ctx, i))) out.push(`  ✓ ${label(d)}  ${d.meta.title}: ${fieldValue(d, DECISION) ?? ""}`)
  return out
}

/** Whether a meeting is due now: always without a date, from its date on with one. */
const dueNow = (ctx: Context, m: MeetingConfig): boolean => !m.on || m.on <= today(ctx)

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
    usage: 'meeting [<name>] | meeting new <name> "<title>" [--needs <who>,...] [--on YYYY-MM-DD] | meeting add <meeting> <discussion>...',
    options: [
      { name: "--needs", says: "meeting new: who must be present, comma-separated; the owner when not given" },
      { name: "--on", says: "meeting new: a fixed date, YYYY-MM-DD; without one, it takes place whenever the people it needs are present" },
    ],
    examples: [
      "meeting",
      'meeting new owner "With the owner"',
      'meeting new review "Design review" --needs owner,reviewer --on 2026-11-03',
      "meeting add owner discussions/plugin-names",
      "meeting owner",
    ],
    run(args, ctx) {
      const p = parse(args, { needs: { type: "string" }, on: { type: "string" } })
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
      const chosen = sub !== undefined ? [meetingOrThrow(sub)] : Object.entries(meetings)
      if (!chosen.length) ctx.out('no meetings — declare one: naima meeting new <name> "<title>"')
      for (const [n, m] of chosen) for (const l of agendaLines(ctx, n, m)) ctx.out(l)
      return 0
    },
  }
}

const decideCommand: Command = {
  name: "decide",
  says: "record the decision a discussion reached and mark it decided; a follow-up is filed only with the owner's yes",
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
      addLink(ctx, ctx.repo.resolve(label(item)), CONCERNS, ctx.repo.resolve(label(todo)))
      ctx.out(`${label(todo)}: filed, the follow-up of ${label(item)}`)
    } else {
      ctx.out(`follow-up work, if any, is filed only on the owner's yes: naima decide … --follow-up "<title>" --consent "<their yes>"`)
    }
    return 0
  },
}

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
    says: "a decided discussion records its decision; an open one is on a meeting's agenda, or it waits for no one",
    run(ctx) {
      const out: Finding[] = []
      for (const d of ctx.repo.items.filter(isDiscussion)) {
        if (!isOpen(ctx, d) && !fieldValue(d, DECISION)) {
          out.push({ level: "problem", item: d, message: `${label(d)} is decided but records no decision — naima set ${d.slug} decision="<decision>"` })
        }
        if (isOpen(ctx, d) && !fieldValues(d, GATE).some((g) => Object.hasOwn(meetings, g))) {
          out.push({ level: "note", item: d, message: `${label(d)} is on no meeting's agenda — naima meeting add <meeting> ${d.slug}` })
        }
      }
      return out
    },
  }
}

/** What `naima hello` says: each meeting due now with open discussions, and that the agent opens with its agenda. */
function helloSection(meetings: Record<string, MeetingConfig>): SummarySection {
  return {
    name: "meetings",
    hello: true,
    render(ctx) {
      const rows = Object.entries(meetings)
        .filter(([, m]) => dueNow(ctx, m))
        .map(([name, m]) => ({ meeting: name, title: m.title, needs: needsOf(m), open: openAgenda(ctx, name).map(label) }))
        .filter((r) => r.open.length)
      return rendered(
        rows,
        (rs) =>
          rs.map((r) =>
            `Meeting ${r.meeting} (${r.title}) has ${r.open.length} open discussion${r.open.length === 1 ? "" : "s"}: when ${r.needs.join(" and ")} ${
              r.needs.length > 1 ? "are" : "is"
            } here, open with its agenda — naima meeting ${r.meeting}.`
          ),
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
      "`naima meeting new` declares one, `naima meeting add` puts discussions on its agenda, `naima meeting` shows the agendas, and `naima hello` names each meeting with open discussions so the agent opens with its agenda. " +
      "Deciding files follow-up work only with the owner's yes (`--follow-up` with `--consent`).",
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
      { name: DECISION.name, kind: DECISION.kind, says: "what the discussion decided, recorded by naima decide", appliesTo: [discussionsType.id] },
      { name: DECISION_ON.name, kind: DECISION_ON.kind, says: "when the discussion was decided, stamped by naima decide", appliesTo: [discussionsType.id] },
    ],
    relations: [
      { name: CONCERNS, inverse: CONCERNED_BY, says: "is a discussion about" },
      { name: CONCERNED_BY, inverse: CONCERNS, says: "is discussed in" },
    ],
    uses: { fields: [GATE.name] },
    contributes: { gates: Object.entries(meetings).map(([name, m]) => meetingGate(name, m)) },
    commands: [meetingCommand(meetings), decideCommand],
    hooks: [hook],
    checks: [checks(meetings)],
    summary: [helloSection(meetings)],
  }
}
