// Due runs: nothing runs unattended. A long run — the full suite, or one
// declared in the `longRuns` option, such as a model's verification — is due
// when what it covers is not current, or when it has not succeeded within its
// declared threshold. Nothing starts it: `naima hello` and `naima summary` say
// so, one line each; `naima run due` files each as one todo, marked by the
// field `dueRun`, and marks that todo done once the run is current; the owner
// decides when it starts. A run on a schedule would compete, unseen, with the
// work on the same machine, so there is none (docs/guide/rules.md).

import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import {
  addLink,
  type Context,
  createItem,
  EXIT,
  type FieldDef,
  isOpen,
  type Item,
  joinProse,
  label,
  messageId,
  NOTES_HEADING,
  privateContext,
  readReadme,
  redactPrivate,
  refutes,
  rendered,
  saveProse,
  setFields,
  splitProse,
  type SummarySection,
  type TickJob,
  today,
} from "../../core/api.ts"
import { ensureRunsDir, NAME, parseDuration, parseSize, readSpec, runsDir, showDuration, SUBCOMMANDS, view, writeJsonAtomic } from "./records.ts"
import type { Host } from "./remote.ts"

/** A long run: declared in the `longRuns` option, or the full suite, implied when nothing declares it. */
export interface LongRun {
  name: string
  /** A command line for the shell (one element), or a program and its arguments; empty for the implied full suite. */
  command: string[]
  budgetTime: string
  budgetDisk?: string
  creates: string[]
  host?: string
  noProgress?: string
  /** As declared, `<n>s|m|h|d`, and in milliseconds: it is due once its last success is older. */
  within?: string
  withinMs?: number
  /** It covers every gate of the full suite. */
  fullSuite: boolean
  /** The gates it brings current, by name. */
  gates: string[]
  /** A model's path: it covers every property verified on it. */
  model?: string
  /** The items it covers, by reference. */
  items: string[]
  /** The full suite, said by nothing in `longRuns`: no command, no threshold. */
  implied?: boolean
}

/** The name the full suite goes by. */
export const FULL_SUITE = "full-suite"

/** The field that marks a todo as asking for a due run, by its name: how `naima run due` finds it again. */
export const DUE_FIELD: FieldDef = {
  name: "dueRun",
  kind: "string",
  says: "the long run this todo asks the owner to start; naima run due marks it done once that run is current",
  appliesTo: ["todos"],
}

/** The long runs the `longRuns` option declares, each checked whole. */
export function readLongRuns(options: Record<string, unknown>, hosts: Map<string, Host>): LongRun[] {
  const raw = options["longRuns"] ?? {}
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error(
      'long-work: option longRuns must be an object: run name → { "command", "budgetTime", and "within", "fullSuite", "gates", "model" or "items" }',
    )
  }
  const out: LongRun[] = []
  for (const [name, v] of Object.entries(raw as Record<string, unknown>)) {
    const at = `long-work: long run "${name}"`
    if (!NAME.test(name) || (SUBCOMMANDS as readonly string[]).includes(name)) {
      throw new Error(`${at}: "${name}" is not a run name — lowercase letters, digits, ".", "_" and "-", and none of ${SUBCOMMANDS.join(", ")}`)
    }
    const d = (v && typeof v === "object" && !Array.isArray(v) ? v : {}) as Record<string, unknown>
    const text = (k: string): string | undefined => {
      const x = d[k]
      if (x !== undefined && (typeof x !== "string" || !x.trim())) throw new Error(`${at}: ${k} must be text`)
      return x as string | undefined
    }
    const list = (k: string): string[] => {
      const x = d[k] ?? []
      if (!Array.isArray(x) || !x.every((e) => typeof e === "string" && e.trim())) throw new Error(`${at}: ${k} is a list of names`)
      return x as string[]
    }
    const budgetTime = text("budgetTime")
    if (budgetTime === undefined) throw new Error(`${at} needs budgetTime, how long one run may last`)
    if (parseDuration(budgetTime) === null) throw new Error(`${at}: budgetTime: "${budgetTime}" is not a duration`)
    const within = text("within")
    const withinMs = within === undefined ? undefined : parseDuration(within)
    if (withinMs === null) throw new Error(`${at}: within: "${within}" is not a duration — <n>s, <n>m, <n>h or <n>d`)
    const budgetDisk = text("budgetDisk")
    if (budgetDisk !== undefined && parseSize(budgetDisk) === null) throw new Error(`${at}: budgetDisk: "${budgetDisk}" is not a size`)
    const creates = list("creates")
    if (budgetDisk !== undefined && !creates.length) throw new Error(`${at}: budgetDisk measures what it creates — declare creates`)
    const host = text("host")
    if (host !== undefined && !hosts.has(host)) throw new Error(`${at}: host "${host}" is not declared in hosts`)
    const noProgress = text("noProgress")
    const fullSuite = d["fullSuite"] ?? false
    if (typeof fullSuite !== "boolean") throw new Error(`${at}: fullSuite is true or false`)
    const gates = list("gates")
    const model = text("model")
    const items = list("items")
    if (within === undefined && !fullSuite && !gates.length && model === undefined && !items.length) {
      throw new Error(`${at} is never due: declare within, fullSuite, gates, model or items`)
    }
    const c = d["command"]
    const command = typeof c === "string" ? [c] : c
    if (!Array.isArray(command) || !command.length || !command.every((w) => typeof w === "string" && w.length) || !command[0]!.trim()) {
      throw new Error(`${at} needs a command: a shell line, or a program and its arguments`)
    }
    out.push({
      name,
      command: command as string[],
      budgetTime,
      ...(budgetDisk !== undefined ? { budgetDisk } : {}),
      creates,
      ...(host !== undefined ? { host } : {}),
      ...(noProgress !== undefined ? { noProgress } : {}),
      ...(within !== undefined ? { within, withinMs: withinMs! } : {}),
      fullSuite,
      gates,
      ...(model !== undefined ? { model } : {}),
      items,
    })
  }
  return out
}

/** The arguments of `naima run` that start a declared long run with its budgets. */
export const startArgs = (r: LongRun): string[] => [
  r.name,
  "--budget-time",
  r.budgetTime,
  ...(r.budgetDisk !== undefined ? ["--budget-disk", r.budgetDisk] : []),
  ...r.creates.flatMap((c) => ["--creates", c]),
  ...(r.host !== undefined ? ["--host", r.host] : []),
  ...(r.noProgress !== undefined ? ["--no-progress", r.noProgress] : []),
  "--",
  ...r.command,
]

/** Beside the records: for each run name, when its last successful run started, kept when its record is cleaned. */
const SUCCEEDED_FILE = "succeeded.json"

function remembered(tracker: string): Record<string, string> {
  try {
    return JSON.parse(readFileSync(join(runsDir(tracker), SUCCEEDED_FILE), "utf8")) as Record<string, string>
  } catch {
    return {}
  }
}

/** Remember that the run `name`, started at `started`, succeeded: `naima run clean` calls it before removing the record. */
export function rememberSuccess(tracker: string, name: string, started: string): void {
  const file = join(ensureRunsDir(tracker), SUCCEEDED_FILE)
  writeJsonAtomic(file, { ...remembered(tracker), [name]: started })
}

/** The record of `name` here: in progress (a remote one counts until it is cleaned), and when its last success started. */
function recordOf(tracker: string, name: string): { going: boolean; succeeded?: string } {
  const dir = join(runsDir(tracker), name)
  const spec = existsSync(dir) ? readSpec(dir) : null
  const kept = remembered(tracker)[name]
  if (!spec) return kept ? { going: false, succeeded: kept } : { going: false }
  if (spec.host) return { going: true }
  const v = view(dir, Date.now())
  if (!v.over) return { going: true }
  const succeeded = v.state === "succeeded" ? spec.started : kept
  return succeeded ? { going: false, succeeded } : { going: false }
}

/** A gate as the gates point holds it: declared here, since plugins never import each other. */
interface GateLike {
  name: string
  inFullSuite?: boolean
  evaluate(ctx: Context): GateOutcome | Promise<GateOutcome>
}
interface GateOutcome {
  holds: boolean
  blocking: Item[]
  owed: Item[]
  reasons?: string[]
}

/** A long run that is due: why, the items it covers that are not current, and when it last succeeded here. */
export interface Due {
  run: LongRun
  reasons: string[]
  stale: Item[]
  lastRan?: string
}

/** How many to name in a line before saying how many more. */
const NAMED = 3

const some = (words: string[]): string => {
  const shown = words.slice(0, NAMED).join(", ")
  return words.length > NAMED ? `${shown} and ${words.length - NAMED} more` : shown
}

/**
 * Every long run — those declared, and the full suite when nothing declares it and some gate is part of it — with
 * the due ones and why. An item is not current when a gate of the full suite names it, or, with no gate to ask,
 * while it is open; one whose last verdict refutes it waits on a fix, not a run, and is left out. A run in progress
 * is not due: it is what brings it current.
 */
export async function dueRuns(ctx: Context, declared: readonly LongRun[], tracker: string): Promise<{ runs: LongRun[]; due: Due[] }> {
  const gates = ctx.registry.contributions("gates").map((c) => c.value as GateLike)
  const outcomes = new Map<string, GateOutcome>()
  const outcome = async (g: GateLike): Promise<GateOutcome> => {
    if (!outcomes.has(g.name)) outcomes.set(g.name, await g.evaluate(ctx))
    return outcomes.get(g.name)!
  }
  const suite = gates.filter((g) => g.inFullSuite === true)
  const behind = new Set<string>()
  for (const g of suite) for (const i of [...(await outcome(g)).blocking, ...(await outcome(g)).owed]) behind.add(String(i.meta.id))
  const stale = (i: Item): boolean => !refutes(ctx, i) && (behind.has(String(i.meta.id)) || isOpen(ctx, i))
  const runs = [...declared]
  if (suite.length && !declared.some((r) => r.fullSuite || r.name === FULL_SUITE)) {
    runs.push({ name: FULL_SUITE, command: [], budgetTime: "", creates: [], fullSuite: true, gates: [], items: [], implied: true })
  }
  const due: Due[] = []
  for (const run of runs) {
    const record = recordOf(tracker, run.name)
    if (record.going) continue
    const reasons: string[] = []
    const covered: Item[] = []
    const named = run.fullSuite ? [...suite] : []
    for (const name of run.gates) {
      const g = gates.find((x) => x.name === name)
      if (!g) reasons.push(`no gate is named ${name}`)
      else if (!named.includes(g)) named.push(g)
    }
    for (const g of named) {
      const r = await outcome(g)
      if (r.holds) continue
      covered.push(...r.blocking, ...r.owed)
      reasons.push(...(r.reasons ?? []))
    }
    if (run.model !== undefined) covered.push(...ctx.repo.items.filter((i) => i.type === "properties" && i.meta["model"] === run.model))
    for (const ref of run.items) {
      try {
        covered.push(ctx.repo.resolve(ref))
      } catch {
        reasons.push(`no item ${ref}`)
      }
    }
    const behindNow = [...new Map(covered.filter(stale).map((i) => [String(i.meta.id), i])).values()]
    if (behindNow.length) reasons.unshift(`not current: ${some(behindNow.map(label))}`)
    const age = record.succeeded ? Date.now() - Date.parse(record.succeeded) : null
    if (run.withinMs !== undefined) {
      if (age === null) reasons.push("it has not run here")
      else if (age > run.withinMs) reasons.push(`it last ran ${showDuration(age)} ago, longer than its ${run.within}`)
    }
    if (!reasons.length) continue
    due.push({ run, reasons, stale: behindNow, ...(record.succeeded ? { lastRan: record.succeeded } : {}) })
  }
  return { runs, due }
}

/** A due run in one line: why, and that the owner decides when it starts. */
export function dueLine(d: Due): string {
  const said = d.reasons.length > NAMED ? [...d.reasons.slice(0, NAMED), `${d.reasons.length - NAMED} more`] : d.reasons
  const last = d.lastRan && !said.some((r) => r.startsWith("it last ran")) ? `; it last ran ${showDuration(Date.now() - Date.parse(d.lastRan))} ago` : ""
  const how = d.run.implied ? "" : `: naima run ${d.run.name}`
  return `Long run ${d.run.name} is due: ${said.join("; ")}${last}. Ask the owner before starting it${how}.`
}

/** The summary section, also said by `naima hello`: one line per due run. */
export const dueSection = (declared: readonly LongRun[], tracker: (ctx: Context) => string): SummarySection => ({
  name: "due-runs",
  hello: true,
  async render(ctx) {
    const { due } = await dueRuns(ctx, declared, tracker(ctx))
    return rendered(due, (ds) => ds.map(dueLine))
  },
})

/**
 * The tick's job: once an hour, whichever naima process wins the hour, find the due runs and say each to the owner,
 * once a day, as a message — so a long session hears of one without waiting for the next session start. Starts nothing.
 */
export const dueJob = (declared: readonly LongRun[], tracker: (ctx: Context) => string): TickJob => ({
  name: "due-runs",
  says: "find the long runs that are due and tell the owner, once a day each, that they wait on their decision; starts none",
  every: "hour",
  timeoutMs: 60_000,
  async run(ctx) {
    const { due } = await dueRuns(ctx, declared, tracker(ctx))
    return { ok: true, notices: due.map((d) => ({ id: messageId("due-run", d.run.name, today(ctx)), level: "info" as const, text: dueLine(d) })) }
  },
})

/** What a due run's todo says: why it is due, what it covers, how it starts, and who decides. */
function page(ctx: Context, d: Due): string {
  const clean = (text: string): string => redactPrivate(text.split(ctx.root).join("<root>"), privateContext())
  const how = d.run.implied
    ? "The full suite is every gate a release gate waits for (`naima gate show <release>` says what each one asks); it is not declared in the long-work plugin's `longRuns` option, so there is no single command for it."
    : `It starts with \`naima run ${d.run.name}\`, which runs \`${d.run.command.join(" ")}\` with a time budget of ${d.run.budgetTime}.`
  return clean(
    `The long run \`${d.run.name}\` is due:\n\n${d.reasons.map((r) => `- ${r}`).join("\n")}\n\n${how}\n\n` +
      "Nothing starts it on its own: the owner decides when, because a run nobody watches competes with the work on the same machine. " +
      "`naima run due` marks this todo done once the run is current.",
  )
}

/**
 * `naima run due`: file each due run as one todo, marked by `dueRun`, linked to the items it covers that are not
 * current; leave one already open as it is, adding links; mark done the open todo of a run now current, and drop the
 * one of a run no longer declared. Starts nothing.
 */
export async function fileDue(ctx: Context, declared: readonly LongRun[], tracker: string): Promise<number> {
  const { runs, due } = await dueRuns(ctx, declared, tracker)
  const type = ctx.registry.types.get("todos")
  if (!type) {
    for (const d of due) ctx.out(dueLine(d))
    if (due.length) ctx.out("no todos type is loaded to file them in")
    return EXIT.OK
  }
  const marked = ctx.repo.items.filter((i) => i.type === "todos" && typeof i.meta[DUE_FIELD.name] === "string" && isOpen(ctx, i))
  for (const d of due) {
    const open = marked.find((i) => i.meta[DUE_FIELD.name] === d.run.name)
    const todo = open ?? createItem(ctx, type, `Long run ${d.run.name} is due`, { [DUE_FIELD.name]: d.run.name })
    if (!open) saveProse(ctx, todo, joinProse({ ...splitProse(readReadme(todo)), description: page(ctx, d) }))
    for (const i of d.stale) addLink(ctx, todo, "relates-to", i)
    ctx.out(`${d.run.name}: due — ${open ? "already filed as" : "filed"} ${label(todo)}`)
  }
  for (const todo of marked) {
    const name = String(todo.meta[DUE_FIELD.name])
    if (due.some((d) => d.run.name === name)) continue
    const known = runs.some((r) => r.name === name)
    if (known && recordOf(tracker, name).going) continue
    const why = known ? "The long run is current: nothing it covers is out of date." : "No long run of this name is declared any more."
    const prose = splitProse(readReadme(todo))
    saveProse(ctx, todo, joinProse({ ...prose, notes: [prose.notes || NOTES_HEADING, `### ${today(ctx)} — naima run due\n\n${why}`].join("\n\n") }))
    setFields(ctx, todo, [["status", known ? "done" : "dropped"]])
    ctx.out(`${name}: ${known ? "current" : "no longer declared"} — ${label(todo)} marked ${known ? "done" : "dropped"}`)
  }
  if (!due.length && !marked.length) ctx.out("no long run is due")
  return EXIT.OK
}
