// The schedule plugin: the planned, expected and actual schedule of every piece of work, the drift and overlaps
// between them, the resource histogram, and how far Naima's predictions can be trusted (types.ts says the shape).
//
// The actual schedule is derived at every call from what the project already records (records.ts), through the
// machine of the workshop's model (machine.ts); the planned one is the proposals `naima schedule plan` and
// `naima schedule propose` write, one new file each (plans.ts); everything else is computed from the two (derive.ts).
// It shows and records proposals only: moving a planned bar in the interface is not part of it.
//
// It reads two options of the coordination plugin by name, silentAfter and maxWorkers, as defaults of its own
// stallAfter and capacity, and the dependency relation blocked-by of the core. The view is the `ui-views` view
// `schedule`, which the bridge's `data {view: "schedule"}` answers, and `naima view schedule`.

import {
  type Command,
  type Context,
  CONTRACT,
  type Item,
  label,
  linked,
  parse,
  type Plugin,
  type PluginOptions,
  rendered,
  str,
  usageError,
  type View,
} from "../../core/api.ts"
import { DEFAULT_HOURS, kindOf, scheduleOf, type ScheduleOptions } from "./derive.ts"
import { momentArg, proposer, readPlans, SCHEDULES, writePlan } from "./plans.ts"
import type { PieceSchedule, ScheduleData } from "./types.ts"

const SILENT_AFTER = 15
const MAX_WORKERS = 3
const TOLERANCE = 24

const positive = (v: unknown, name: string, what: string): number => {
  if (typeof v !== "number" || !Number.isFinite(v) || v <= 0) {
    throw new Error(`schedule: option ${name} must be a positive number, ${what}; got ${JSON.stringify(v)}`)
  }
  return v
}

/** The options, with coordination's silentAfter and maxWorkers as the defaults of stallAfter and capacity. */
function optionsOf(ctx: Context, own: PluginOptions): ScheduleOptions {
  const coord = ctx.config.plugins["coordination"]?.options ?? {}
  const silent = typeof coord["silentAfter"] === "number" ? coord["silentAfter"] : SILENT_AFTER
  const workers = typeof coord["maxWorkers"] === "number" ? coord["maxWorkers"] : MAX_WORKERS
  return {
    stallAfter: positive(own["stallAfter"] ?? silent, "stallAfter", "the minutes without a sign of life after which work counts as stalled"),
    tolerance: positive(own["tolerance"] ?? TOLERANCE, "tolerance", "the hours within which an end counts as on plan"),
    capacity: positive(own["capacity"] ?? workers, "capacity", "the most pieces of work that can run at once"),
  }
}

/** The schedule, for every piece or for those asked for by reference. */
function dataOf(ctx: Context, own: PluginOptions, refs: string[] = []): ScheduleData {
  const items = refs.length ? refs.map((r) => ctx.repo.resolve(r)) : ctx.repo.items
  return scheduleOf(ctx, readPlans(ctx), optionsOf(ctx, own), items)
}

const day = (m?: string): string => (m ? m.slice(0, 16).replace("T", " ") : "—")
const span = (s?: { start?: string; end?: string }): string => (s ? `${day(s.start)} → ${day(s.end)}` : "—")

function pieceLines(p: PieceSchedule): string[] {
  const who = p.planned
    ? `, by ${p.planned.by.name ?? p.planned.by.role} (${p.planned.by.role})${p.planned.revision > 1 ? `, revision ${p.planned.revision}` : ""}`
    : ""
  return [
    `${p.piece.ref}  [${p.actual.state}]`,
    `  planned   ${p.planned ? span(p.planned) : "none"}${who}`,
    `  expected  ${span(p.expected)}${p.expected ? `, confidence ${p.expected.confidence.level} (${p.expected.confidence.value})` : ""}`,
    `  actual    ${p.actual.start ? span(p.actual) : "not started"}${
      p.actual.segments.filter((s) => s.kind !== "work").length ? `, ${p.actual.segments.filter((s) => s.kind !== "work").length} stalls or pauses` : ""
    }`,
    ...(p.drift ? [`  drift     ${p.drift.says}`] : []),
  ]
}

function textOf(d: ScheduleData): string[] {
  if (!d.pieces.length) return ["no piece of work has a plan or a record yet — naima schedule propose <item> plans one"]
  const over = d.histogram.filter((h) => h.overAllocated)
  return [
    ...d.pieces.flatMap(pieceLines),
    "",
    ...d.overlaps.filter((o) => o.kind === "dependency").map((o) => `overlap: ${o.says}`),
    over.length
      ? `over-allocated days: ${over.length} of ${d.histogram.length}, capacity ${d.capacity} (${
        over.slice(0, 5).map((h) => `${h.day} ${h.demand}`).join(", ")
      }${over.length > 5 ? ", …" : ""})`
      : `over-allocated days: none of ${d.histogram.length}, capacity ${d.capacity}`,
    ...d.quality.map((q) =>
      `prediction quality, ${q.kind}: ${q.sample} judged, ${
        Math.round(q.withinTolerance * 100)
      }% within ${d.tolerance} h, mean end error ${q.meanEndError} h, confidence ${q.confidence.level}`
    ),
  ]
}

function markdownOf(d: ScheduleData): string[] {
  const cell = (s: string) => s.replace(/\|/g, "\\|")
  return [
    "| Piece | State | Planned | By | Expected | Confidence | Actual | Drift |",
    "| --- | --- | --- | --- | --- | --- | --- | --- |",
    ...d.pieces.map((p) =>
      `| ${cell(p.piece.ref)} | ${p.actual.state} | ${p.planned ? span(p.planned) : ""} | ${cell(p.planned?.by.name ?? p.planned?.by.role ?? "")} | ${
        span(p.expected)
      } | ${p.expected?.confidence.level ?? ""} | ${p.actual.start ? span(p.actual) : ""} | ${cell(p.drift?.says ?? "")} |`
    ),
  ]
}

const VIEW_SAYS =
  "the planned, expected and actual schedule of every piece of work that has a plan or a record, with its drift, the overlaps by dependency and by capacity, the resource histogram and the quality of past predictions"

function scheduleView(own: PluginOptions): View {
  return {
    name: "schedule",
    says: VIEW_SAYS,
    render(args, ctx) {
      return rendered(dataOf(ctx, own, args), textOf, markdownOf)
    },
  }
}

const esc = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")

/** The read-only view of `naima ui`: its data is what the Gantt draws; the new interface has a screen of its own for it. */
function scheduleUiView(own: PluginOptions) {
  return {
    name: "schedule",
    title: "Schedule",
    order: 5,
    screen: true,
    says: VIEW_SAYS,
    render(params: Record<string, string[]>, ctx: Context) {
      const d = dataOf(ctx, own, params["item"] ?? [])
      const rows = d.pieces.map((p) =>
        `<tr><td>${esc(p.piece.ref)}</td><td>${p.actual.state}</td><td>${esc(p.planned ? span(p.planned) : "")}</td><td>${esc(span(p.expected))}</td><td>${
          esc(p.actual.start ? span(p.actual) : "")
        }</td><td>${esc(p.drift?.says ?? "")}</td></tr>`
      )
      return {
        data: d,
        html: [
          "<h1>Schedule</h1>",
          d.pieces.length
            ? `<table><thead><tr><th>Piece</th><th>State</th><th>Planned</th><th>Expected</th><th>Actual</th><th>Drift</th></tr></thead><tbody>${
              rows.join("")
            }</tbody></table>`
            : "<p>No piece of work has a plan or a record yet.</p>",
        ].join("\n"),
      }
    },
  }
}

/** The proposal for a piece from the project's pace: the expected schedule a piece with no plan is given. */
function proposalOf(ctx: Context, own: PluginOptions, item: Item): { start: string; end: string; basis: string } {
  const d = dataOf(ctx, own)
  const p = d.pieces.find((q) => q.piece.id === item.meta.id)
  if (p?.expected && !p.planned) return { start: p.expected.start, end: p.expected.end, basis: `proposed from the project's pace: ${p.expected.basis}` }
  // A piece with no record yet, or one already planned: placed after what it waits on, for its kind's pace.
  const now = ctx.now().getTime()
  const after = linked(ctx, item, "blocked-by").map((b) => d.pieces.find((q) => q.piece.id === b.meta.id)?.expected?.end).filter((e): e is string => !!e)
  const from = Math.max(now, ...after.map((e) => Date.parse(e)))
  const kind = kindOf(item)
  const ended = d.pieces.filter((q) => q.piece.type === kind && q.actual.start && q.actual.end)
  const ms = ended.length
    ? [...ended.map((q) => Date.parse(q.actual.end as string) - Date.parse(q.actual.start as string))].sort((a, b) =>
      a - b
    )[Math.floor(ended.length / 2)] as number
    : DEFAULT_HOURS * 3_600_000
  const basis = ended.length ? `the median duration of ${ended.length} ended ${kind}` : `${DEFAULT_HOURS} h: no ended ${kind} to judge by yet`
  return {
    start: new Date(from).toISOString(),
    end: new Date(from + ms).toISOString(),
    basis: `proposed from the project's pace${after.length ? ", after what it waits on" : ""}: ${basis}`,
  }
}

function scheduleCommand(own: PluginOptions): Command {
  return {
    name: "schedule",
    says:
      "the schedule of the pieces of work: with no subcommand, what naima view schedule shows; plan records a planned schedule with the dates given, propose one from the project's pace, each with who proposed it",
    enforces:
      "a plan is one new file in schedules/, never rewritten: the first plan of a piece is kept as its baseline and a later one replaces it in force; a plan ends after it starts; who proposed it is the git user and the checkout's role",
    usage:
      'schedule [<item>...] [--json] | schedule plan <item> --start <when> --end <when> [--basis "<why>"] [--by <name>] | schedule propose <item>... [--by <name>]',
    options: [
      { name: "--start", says: "when the piece is planned to start: a day (its start) or a timestamp" },
      { name: "--end", says: "when the piece is planned to end: a day (its end) or a timestamp" },
      { name: "--basis", says: "how the dates were reached, in words", default: "given by hand" },
      { name: "--by", says: "who proposes, by name", default: "the git user" },
      { name: "--json", says: "print the schedule data, the shape of naima/src/plugins/schedule/types.ts" },
    ],
    examples: [
      "schedule",
      "schedule features/export --json",
      "schedule plan features/export --start 2026-11-04 --end 2026-11-05",
      "schedule propose features/export bugs/import-drops-rows",
    ],
    run(args, ctx) {
      const [sub, ...rest] = args
      if (sub === "plan") {
        const p = parse(rest, { start: { type: "string" }, end: { type: "string" }, basis: { type: "string" }, by: { type: "string" } })
        const [ref, ...more] = p.positionals
        const start = str(p, "start")
        const end = str(p, "end")
        if (!ref || more.length || !start || !end) throw usageError(this)
        const item = ctx.repo.resolve(ref)
        const where = writePlan(ctx, {
          item: item.meta.id,
          start: momentArg(start, "start", "--start"),
          end: momentArg(end, "end", "--end"),
          by: proposer(ctx, str(p, "by")),
          on: ctx.now().toISOString(),
          basis: str(p, "basis")?.trim() || "given by hand",
        })
        ctx.out(`planned ${label(item)}: wrote ${where}`)
        return 0
      }
      if (sub === "propose") {
        const p = parse(rest, { by: { type: "string" } })
        if (!p.positionals.length) throw usageError(this)
        for (const ref of p.positionals) {
          const item = ctx.repo.resolve(ref)
          const proposal = proposalOf(ctx, own, item)
          const where = writePlan(ctx, { item: item.meta.id, ...proposal, by: proposer(ctx, str(p, "by")), on: ctx.now().toISOString() })
          ctx.out(`proposed ${label(item)}: ${span(proposal)}, ${proposal.basis}; wrote ${where}`)
        }
        return 0
      }
      const p = parse(args, { json: { type: "boolean" } })
      const d = dataOf(ctx, own, p.positionals)
      if (p.values["json"] === true) ctx.out(JSON.stringify(d, null, 2))
      else for (const l of textOf(d)) ctx.out(l)
      return 0
    },
  }
}

export default function schedule(options: PluginOptions = {}): Plugin {
  return {
    name: "schedule",
    contract: CONTRACT,
    says: "the planned, expected and actual schedule of every piece of work, with drift, overlaps and the quality of predictions",
    about: "Every piece of work Naima tracks can carry three schedules on one time axis. The planned one is proposed when the work is planned, " +
      "by hand (`naima schedule plan`) or from the project's pace (`naima schedule propose`), and records who proposed it; the first plan stays as the baseline when a later one replaces it. " +
      "The actual one is derived as work happens from what the project already records: the claims and their posted steps, the commits on the claiming branch, the landings and the closes, with stalls where no sign of life came for the stall window and pauses where the claim went away before landing. " +
      "The expected one is Naima's forecast: the actual schedule once work started, otherwise placed after what the piece waits on, its length from the plan corrected by how plans of that kind of work turned out, or the median duration of that kind. " +
      "From the three come the drift of each piece, the overlaps (work that started while what it waits on had not ended; days on which more pieces ran than the capacity, the over-allocated days of the resource histogram) and the prediction quality per kind of work and month by month, which gives every forecast its confidence. " +
      "`naima view schedule` shows it; its data, the shape of naima/src/plugins/schedule/types.ts, is the `ui-views` view `schedule` the new interface's Gantt reads.",
    options: [
      { name: "stallAfter", says: "minutes without a sign of life after which work counts as stalled", default: "the coordination option silentAfter (15)" },
      { name: "tolerance", says: "hours within which an end counts as on plan", default: String(TOLERANCE) },
      {
        name: "capacity",
        says: "the most pieces of work that run at once, the resource histogram's capacity",
        default: "the coordination option maxWorkers (3)",
      },
    ],
    dirs: [SCHEDULES],
    commands: [scheduleCommand(options)],
    views: [scheduleView(options)],
    contributes: { "ui-views": [scheduleUiView(options)] },
    // The view is a screen of naima ui when the ui plugin is loaded; without it, still a command and a view.
    optional: ["ui-views"],
    home: import.meta.url,
  }
}
