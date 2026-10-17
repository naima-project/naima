// Gates: named release or merge conditions, backed by items.
//
// A gate is the set of items that must be settled before something may
// happen. It is configured, never hard-coded, in this plugin's options in the
// project's naima-tracker/naima-data/naima.json:
//
//   "plugins": { "gates": { "options": { "gates": {
//     "v1": { "title": "First public release", "says": "…", "holdsOn": "code" } } } } }
//
// holdsOn "code"  (default) the gate waits for code, not for proof: an item
//                 that is fixed and owes only its proving gesture, and the
//                 gestures themselves, are owed but do not block — unless
//                 refuted: a failed test, a violated property, blocks.
// holdsOn "proof" every open item on the gate blocks it.
// due, version    a gate with a date is a milestone: `naima gates` and
//                 `naima queue` say the days left, a check warns once it is
//                 past its date and does not hold.
// coverage        the coverage lists it requires (coverage.ts): each entry
//                 with NO TEST blocks it.
// fullSuite       a release gate: it holds only when every gate that is part
//                 of the full suite (`inFullSuite`, such as every property
//                 current and every test suite passing) holds too.
//
// `naima gate new|add|remove|show` declares a gate and puts items on it, so
// nobody edits naima.json by hand. An item whose type carries the `group`
// trait (an epic) stands on a gate for the items it groups (`has-part`).
//
// Any plugin may contribute gates through the contract; `naima gates` lists
// them all, whoever declared them.

import { readFileSync } from "node:fs"
import { join } from "node:path"
import {
  alongside,
  bool,
  type Check,
  code,
  type Command,
  type Context,
  CONTRACT,
  type Contribution,
  DATA_FILE,
  DEFAULT_DATA,
  type ExtensionPoint,
  fieldValue,
  fieldValues,
  type Finding,
  groupBy,
  isEvidenceType,
  isOpen,
  type Item,
  label,
  linked,
  type Migration,
  parse,
  type Plugin,
  refutes,
  rendered,
  setFields,
  str,
  type SummarySection,
  table,
  today,
  usageError,
  writeJson,
} from "../../core/api.ts"
import { type CoverageConfig, coverageLines, coverageOf, coverageReasons, coverageUiView, COVERS, readCoverage, staleCovers } from "./coverage.ts"
import { dependenciesAcyclic, dependenciesWaitOnWork, orderCommand, readyCommand, standsFor } from "./dependencies.ts"

export { type CoverageConfig, coverageOf, type CoverageRow } from "./coverage.ts"

export interface GateResult {
  holds: boolean
  /** What stops the gate. */
  blocking: Item[]
  /** What is still owed but does not stop it. */
  owed: Item[]
  /** What stops it that is no item, in words: a number past its bound. */
  reasons?: string[]
  /** The recorded evidence it stands on, in words: a record, a suite's run. */
  backedBy?: string[]
}

/** A named release or merge condition, backed by items: what any plugin contributes to the `gates` point. */
export interface GateDef {
  name: string
  title: string
  says: string
  /** How `evaluate` decides: what blocks the gate and what is only owed. */
  decides?: string
  /** Declared by the project's configuration, not the program: the program's reference leaves it out. */
  configured?: boolean
  /** A milestone's date, YYYY-MM-DD: `naima gates` says the days left. */
  due?: string
  /** The version a milestone ships as. */
  version?: string
  /** Part of the project's full suite: a gate declared with `fullSuite`, a release gate, holds only when this one does too. */
  inFullSuite?: boolean
  /** May be async: a gate backed by an external tool awaits it. */
  evaluate(ctx: Context): GateResult | Promise<GateResult>
}

const blank = (s: unknown): boolean => typeof s !== "string" || !s.trim()

/** The point this plugin declares: every plugin's gates, `naima gates` lists them all. */
export const gatesPoint: ExtensionPoint<GateDef> = {
  id: "gates",
  says:
    "a named release or merge condition, backed by items: `title`, `says`, `decides`, `evaluate(ctx) → { holds, blocking, owed }`; `inFullSuite` makes it part of the full suite a release gate (`fullSuite`) requires",
  noun: "gate",
  stored: true,
  key: (g) => g.name,
  renamed: (g, name) => ({ ...g, name }),
  validate: (v) => {
    const g = v as Partial<GateDef> | null
    if (!g || typeof g !== "object") return "is not an object"
    if (typeof g.name !== "string" || typeof g.title !== "string") return "has no name or title"
    if (g.inFullSuite !== undefined && typeof g.inFullSuite !== "boolean") return "has an inFullSuite that is not true or false"
    return typeof g.evaluate === "function" ? null : "has no evaluate function"
  },
  gaps: (g) => [...(blank(g.says) ? ["does not say what it is for"] : []), ...(blank(g.decides) ? ["does not say how it decides"] : [])],
  // A gate the project configures is the project's, not the program's: it is not in the program's reference.
  configured: (g) => g.configured === true,
  document: (gates) => [
    "",
    "**Gates**, listed by `naima gates`",
    ...table(
      ["Gate", "Title", "What it is for", "How it decides", "In the full suite"],
      gates.map((g) => [code(g.name), g.title, g.says, g.decides ?? "", g.inFullSuite ? "yes" : ""]),
    ),
  ],
}

/** Every gate any loaded plugin contributes, by name. */
export const gatesOf = (ctx: Context): Contribution<GateDef>[] => ctx.registry.contributions("gates") as Contribution<GateDef>[]

export interface GateConfig {
  title: string
  says?: string
  holdsOn?: "code" | "proof"
  /** A milestone's date, YYYY-MM-DD. */
  due?: string
  /** The version a milestone ships as. */
  version?: string
  /** The coverage lists it requires: each entry with NO TEST blocks it. */
  coverage?: string[]
  /** A release gate: it holds only when every gate that is part of the full suite (`inFullSuite`) holds too. */
  fullSuite?: boolean
}

const DATE = /^\d{4}-\d{2}-\d{2}$/
const isDate = (v: unknown): v is string => typeof v === "string" && DATE.test(v) && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v
/** A gate's name: what items carry as `gate=<name>`. */
const GATE_NAME = /^[a-z0-9][a-z0-9._-]*$/

function readOptions(options: Record<string, unknown>): Record<string, GateConfig> {
  const lists = readCoverage(options)
  const gates = options["gates"] ?? {}
  if (!gates || typeof gates !== "object" || Array.isArray(gates)) throw new Error("gates: options.gates must be an object")
  for (const [name, g] of Object.entries(gates as Record<string, unknown>)) {
    const c = g as Partial<GateConfig> | null
    if (!c || typeof c.title !== "string") throw new Error(`gates: gate "${name}" needs a title`)
    if (c.holdsOn !== undefined && c.holdsOn !== "code" && c.holdsOn !== "proof") throw new Error(`gates: gate "${name}": holdsOn is "code" or "proof"`)
    if (c.says !== undefined && typeof c.says !== "string") throw new Error(`gates: gate "${name}": says is a sentence`)
    if (c.due !== undefined && !isDate(c.due)) throw new Error(`gates: gate "${name}": due is a date, YYYY-MM-DD, got ${JSON.stringify(c.due)}`)
    if (c.version !== undefined && (typeof c.version !== "string" || !c.version.trim())) throw new Error(`gates: gate "${name}": version is a non-empty string`)
    if (c.coverage !== undefined) {
      if (!Array.isArray(c.coverage) || !c.coverage.every((l) => typeof l === "string")) {
        throw new Error(`gates: gate "${name}": coverage is a list of list names`)
      }
      for (const l of c.coverage) if (!Object.hasOwn(lists, l)) throw new Error(`gates: gate "${name}": coverage names no list "${l}"`)
    }
    if (c.fullSuite !== undefined && typeof c.fullSuite !== "boolean") throw new Error(`gates: gate "${name}": fullSuite is true or false`)
  }
  return gates as Record<string, GateConfig>
}

// The fields gates reads: its own, and the trackers' it cooperates through by name.
const GATE = { name: "gate", kind: "enum" } as const

/** The gates an item is on: one, several, or none. */
const onGates = (item: Item): string[] => fieldValues(item, GATE)
const FIXED_ON = { name: "fixedOn", kind: "date" } as const
const RUN_BY = { name: "runBy", kind: "enum" } as const
const HUMAN_BECAUSE = { name: "humanBecause", kind: "enum" } as const

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v)

/** Format 1 → 2: the project's gates, once a top-level key of naima.json, are this plugin's own options. */
export const moveGates: Migration = {
  from: 1,
  says: "the top-level gates key of naima.json moves to plugins.gates.options.gates",
  config({ gates, ...raw }) {
    if (gates === undefined || (isObject(gates) && !Object.keys(gates).length)) return raw
    const plugins = isObject(raw["plugins"]) ? raw["plugins"] : {}
    const entry = isObject(plugins["gates"]) ? plugins["gates"] : {}
    const options = isObject(entry["options"]) ? entry["options"] : {}
    return { ...raw, plugins: { ...plugins, gates: { ...entry, options: { ...options, gates } } } }
  },
}

/** Refuted, by its own status or by an item verifying it: evidence against it, which blocks under either rule. */
const refuted = (ctx: Context, item: Item): boolean => refutes(ctx, item) || linked(ctx, item, "verified-by").some((v) => refutes(ctx, v))

/** Fixed but unproven, or itself a proving gesture — and not refuted: owed, not blocking, under holdsOn "code". */
const owesOnlyProof = (ctx: Context, item: Item): boolean => !refuted(ctx, item) && (fieldValue(item, FIXED_ON) !== undefined || isEvidenceType(ctx, item.type))

export { GROUP } from "./dependencies.ts"

/** The items a gate waits for — those on it, a group standing for its members — or, with no gate named, every gate's. */
export function gatedItems(ctx: Context, name?: string): Item[] {
  const on = ctx.repo.items.filter((i) => (name === undefined ? onGates(i).length > 0 : onGates(i).includes(name)))
  return [...new Set(on.flatMap((i) => standsFor(ctx, i)))]
}

const DAY = 86_400_000
/** Whole days from today to `due`: negative once it is past. */
export const daysLeft = (ctx: Context, due: string): number => Math.round((Date.parse(`${due}T00:00:00Z`) - Date.parse(`${today(ctx)}T00:00:00Z`)) / DAY)
const days = (n: number): string => `${n} day${n === 1 ? "" : "s"}`

/** A milestone's date and version, in words — "version 0.9; due 2026-02-01, 17 days left" — or "" for a gate with neither. */
export function timing(ctx: Context, g: Pick<GateDef, "due" | "version">): string {
  const parts: string[] = []
  if (g.version) parts.push(`version ${g.version}`)
  if (g.due) {
    const n = daysLeft(ctx, g.due)
    parts.push(`due ${g.due}, ${n > 0 ? `${days(n)} left` : n === 0 ? "today" : `${days(-n)} overdue`}`)
  }
  return parts.join("; ")
}

/**
 * The full suite, as a release gate asks for it: every gate that is part of it, each evaluated, what blocks it and
 * what it owes joined, each reason said with the gate it comes from.
 */
export async function fullSuite(ctx: Context): Promise<GateResult & { parts: string[] }> {
  const parts = gatesOf(ctx).map((c) => c.value).filter((g) => g.inFullSuite === true)
  const blocking: Item[] = []
  const owed: Item[] = []
  const reasons: string[] = []
  const backedBy: string[] = []
  for (const g of parts) {
    const r = await g.evaluate(ctx)
    for (const i of r.blocking) if (!blocking.includes(i)) blocking.push(i)
    for (const i of r.owed) if (!owed.includes(i) && !r.blocking.includes(i)) owed.push(i)
    reasons.push(...(r.reasons ?? []).map((why) => `${g.name}: ${why}`))
    if (!r.holds && !r.blocking.length && !r.reasons?.length) reasons.push(`${g.name}: does not hold`)
    backedBy.push(...(r.backedBy ?? []))
  }
  return {
    holds: !blocking.length && !reasons.length,
    blocking,
    owed: owed.filter((i) => !blocking.includes(i)),
    reasons,
    backedBy,
    parts: parts.map((g) => g.name),
  }
}

/** A release gate's own result joined with the full suite's: its blocking items, owed items and reasons added to the gate's. */
async function withFullSuite(ctx: Context, own: GateResult): Promise<GateResult> {
  const suite = await fullSuite(ctx)
  const blocking = [...own.blocking, ...suite.blocking.filter((i) => !own.blocking.includes(i))]
  const owed = [...own.owed, ...suite.owed].filter((i, n, all) => !blocking.includes(i) && all.indexOf(i) === n)
  const why = [...(own.reasons ?? []), ...(suite.reasons ?? [])]
  return {
    holds: own.holds && suite.holds,
    blocking,
    owed,
    ...(why.length ? { reasons: why } : {}),
    ...(suite.backedBy?.length ? { backedBy: suite.backedBy } : {}),
  }
}

export function evaluateGate(ctx: Context, name: string, holdsOn: "code" | "proof"): GateResult {
  const open = gatedItems(ctx, name).filter((i) => isOpen(ctx, i))
  const blocking = holdsOn === "proof" ? open : open.filter((i) => !owesOnlyProof(ctx, i))
  const owed = open.filter((i) => !blocking.includes(i))
  return { holds: blocking.length === 0, blocking, owed }
}

/** Who can perform an item's proof: its own `runBy`, else that of an item verifying it. */
export function runByOf(ctx: Context, item: Item): string {
  const own = fieldValue(item, RUN_BY)
  if (own !== undefined) return own
  for (const v of linked(ctx, item, "verified-by")) {
    const theirs = fieldValue(v, RUN_BY)
    if (theirs !== undefined) return theirs
  }
  return ""
}

function printGate(ctx: Context, gate: GateDef, r: GateResult, hands = false): void {
  const when = timing(ctx, gate)
  ctx.out(
    `${gate.name} — ${gate.title}${gate.inFullSuite ? " [in the full suite]" : ""}${when ? ` (${when})` : ""}: ${
      r.holds ? "HOLDS" : `BLOCKED by ${r.blocking.length}`
    }${r.owed.length ? `, ${r.owed.length} owed` : ""}`,
  )
  const who = (i: Item) => (hands ? `  (${runByOf(ctx, i) || "unclassified"})` : "")
  for (const why of r.reasons ?? []) ctx.out(`  ✗ ${why}`)
  for (const by of r.backedBy ?? []) ctx.out(`  ✓ backed by ${by}`)
  for (const i of r.blocking) ctx.out(`  ✗ ${label(i)}  ${i.meta.title}${who(i)}`)
  for (const i of r.owed) ctx.out(`  · ${label(i)}  ${i.meta.title}${who(i)}`)
}

/** An item a gate waits for, as `naima gates --json` and the window give it. */
interface GateItemRow {
  ref: string
  title: string
  /** Whose hands its proof needs: its `runBy`, or "" when unclassified. */
  runBy: string
}

/** A gate and whether it holds, as `naima gates --json` prints it and the window's gates panel shows it. */
interface GateRow {
  gate: string
  title: string
  /** Its version and due date in words, or "". */
  when: string
  holds: boolean
  reasons: string[]
  /** The recorded evidence it stands on. */
  backedBy: string[]
  blocking: GateItemRow[]
  owed: GateItemRow[]
}

/** The gates named — every one when none is — each evaluated now: what `naima gates` prints and the gates panel shows. */
async function gateRows(ctx: Context, names: string[] = []): Promise<{ def: GateDef; result: GateResult; row: GateRow }[]> {
  const all = gatesOf(ctx).map((g) => g.name)
  return await Promise.all((names.length ? names : all).map(async (name) => {
    const def = ctx.registry.find<GateDef>("gates", name)?.value
    if (!def) throw new Error(`no gate "${name}" — gates: ${all.join(", ") || "none configured"}`)
    const result = await def.evaluate(ctx)
    const item = (i: Item): GateItemRow => ({ ref: label(i), title: i.meta.title, runBy: runByOf(ctx, i) })
    return {
      def,
      result,
      row: {
        gate: def.name,
        title: def.title,
        when: timing(ctx, def),
        holds: result.holds,
        reasons: result.reasons ?? [],
        backedBy: result.backedBy ?? [],
        blocking: result.blocking.map(item),
        owed: result.owed.map(item),
      },
    }
  }))
}

const gatesCommand: Command = {
  name: "gates",
  says: "every gate, whoever declared it, and whether it holds; --check exits 1 if one does not",
  enforces: "with --check, every listed gate holds: exit 1 if one does not",
  usage: "gates [name...] [--check] [--json]",
  options: [
    { name: "--check", says: "exit 1 when a listed gate does not hold" },
    { name: "--json", says: "print the gates as JSON: each one's name, title, timing, whether it holds, and the items blocking it or owed" },
  ],
  examples: ["gates", "gates first-public --check", "gates --json"],
  async run(args, ctx) {
    const p = parse(args, { check: { type: "boolean" }, json: { type: "boolean" } })
    const gates = await gateRows(ctx, p.positionals)
    if (bool(p, "json")) ctx.out(JSON.stringify(gates.map((g) => g.row), null, 2))
    else for (const g of gates) printGate(ctx, g.def, g.result)
    return bool(p, "check") && gates.some((g) => !g.result.holds) ? 1 : 0
  },
}

const esc = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")

/** The gates as a panel of the first screen of `naima ui`: the shape the `ui-views` point takes, declared here since plugins never import each other. */
const gatesUiView = {
  name: "gates",
  title: "Gates",
  says:
    "every gate and whether it holds, with the items blocking it and those owing only proof, as `naima gates` reports them; its data is `naima gates --json`",
  order: 0,
  panel: true,
  async render(_params: Record<string, string[]>, ctx: Context) {
    const rows = (await gateRows(ctx)).map((g) => g.row)
    const items = (what: string, list: GateItemRow[]) =>
      list.length
        ? `<details><summary>${list.length} ${what}</summary><ul>${
          list.map((i) => `<li><code>${esc(i.ref)}</code> ${esc(i.title)}${i.runBy ? ` <span class="by">(${esc(i.runBy)})</span>` : ""}</li>`).join("")
        }</ul></details>`
        : ""
    const html = rows.map((g) =>
      [
        `<h3>${esc(g.gate)} — ${esc(g.title)}</h3>`,
        `<p><strong class="${g.holds ? "holds" : "blocked"}">${g.holds ? "Holds" : `Blocked by ${g.blocking.length}`}</strong>${
          g.owed.length ? `, ${g.owed.length} owed` : ""
        }${g.when ? ` · ${esc(g.when)}` : ""}</p>`,
        ...(g.reasons.length ? [`<ul>${g.reasons.map((w) => `<li>${esc(w)}</li>`).join("")}</ul>`] : []),
        ...(g.backedBy.length ? [`<p>Backed by:</p><ul>${g.backedBy.map((w) => `<li>${esc(w)}</li>`).join("")}</ul>`] : []),
        items("blocking", g.blocking),
        items("owing only proof", g.owed),
      ].join("\n")
    )
    return {
      data: rows,
      html: html.length ? html.join("\n") : "<p>No gate is configured: <code>naima gate new</code> declares one.</p>",
      css: ".holds{color:#1a7f37}.blocked{color:#cf222e}.by{opacity:.75}details{margin:0 0 6px}h3{margin:12px 0 4px;font-size:1em}",
    }
  },
}

/** What `queue --role` reads of a role another plugin contributes to the `roles` point. */
interface RoleView {
  title: string
  refuses: string[]
  queue(ctx: Context): Item[]
}

const KIND = { name: "kind", kind: "string" } as const

function roleQueue(ctx: Context, name: string, gate: string | undefined): number {
  if (!ctx.registry.points.has("roles")) throw new Error("no roles in this project: the roles plugin is not loaded")
  const found = ctx.registry.find<RoleView>("roles", name)
  if (!found) throw new Error(`no role "${name}" — roles: ${ctx.registry.contributions("roles").map((c) => c.name).join(", ")}`)
  const on = gate === undefined ? undefined : new Set(gatedItems(ctx, gate))
  const items = found.value.queue(ctx).filter((i) => !on || on.has(i))
  ctx.out(`${found.name} — ${found.value.title}${gate ? ` on ${gate}` : ""}: ${items.length} open`)
  ctx.out(`  refuses: ${found.value.refuses.join("; ")}`)
  for (const i of items) {
    const kind = fieldValue(i, KIND)
    ctx.out(`  ${label(i)}  ${i.meta.title}${kind ? `  (${kind})` : ""}`)
  }
  return 0
}

const queue: Command = {
  name: "queue",
  says:
    "open items on a gate, split by whose hands the proof needs; at its foot, the summary sections that stand beside the work, such as the metrics. With --role, one role's queue instead",
  enforces: "nothing: it prints derived state, never stored",
  usage: "queue [gate] [--human] [--role <role>]",
  options: [
    { name: "--human", says: "also list the items that need a person or a build, with why" },
    {
      name: "--role",
      says: "list one role's open items, most urgent first — on the gate, when one is named, else every open item: a role any loaded plugin contributes",
    },
  ],
  examples: ["queue", "queue first-public --human", "queue --role tester", "queue first-public --role implementer"],
  async run(args, ctx) {
    const p = parse(args, { human: { type: "boolean" }, role: { type: "string" } })
    const gate = p.positionals[0]
    const role = str(p, "role")
    if (role !== undefined) return roleQueue(ctx, role, gate)
    const def = gate === undefined ? undefined : ctx.registry.find<GateDef>("gates", gate)?.value
    const when = def ? timing(ctx, def) : ""
    const open = gatedItems(ctx, gate).filter((i) => isOpen(ctx, i))
    const by = groupBy(open, (i) => {
      const who = runByOf(ctx, i)
      return who === "agent" || who === "agent-hands" ? "agent" : who || "unclassified"
    })
    const noCode = open.filter((i) => !owesOnlyProof(ctx, i)).length
    ctx.out(
      `${gate ?? "all gates"}${when ? ` (${when})` : ""}: ${open.length} open — ${
        ["agent", "human", "build", "unclassified"].map((b) => `${b} ${by.get(b)?.length ?? 0}`).join(", ")
      }`,
    )
    ctx.out(`  with no code yet: ${noCode}; owing only proof: ${open.length - noCode}`)
    if (bool(p, "human")) {
      for (const i of [...(by.get("human") ?? []), ...(by.get("build") ?? [])]) {
        const why = fieldValue(i, HUMAN_BECAUSE) ?? runByOf(ctx, i)
        ctx.out(`  ${label(i)}  ${i.meta.title}  (${why})`)
      }
    }
    for (const l of await alongside(ctx)) ctx.out(l)
    return 0
  },
}

const gatedProofIsGated: Check = {
  name: "gated-proof-is-gated",
  says: "an open item that verifies an open gated item carries a gate itself",
  run(ctx) {
    const out: Finding[] = []
    for (const item of ctx.repo.items) {
      if (onGates(item).length || !isOpen(ctx, item)) continue
      for (const target of linked(ctx, item, "verifies")) {
        if (onGates(target).length && isOpen(ctx, target)) {
          out.push({ level: "problem", message: `${label(item)} verifies ${label(target)} (gate ${onGates(target).join(", ")}) but has no gate`, item })
        }
      }
    }
    return out
  },
}

/** The gates the project configures, as they stand in its naima.json. */
const DATA_PATH = (ctx: Context): string => join(ctx.trackerRoot, DATA_FILE)

/** Declare a gate in naima.json, validated as the next load will read it; refused when one by that name exists. */
function declareGate(ctx: Context, name: string, gate: GateConfig): void {
  if (!GATE_NAME.test(name)) {
    throw new Error(`a gate's name is lowercase letters, digits, dots, dashes and underscores, starting with a letter or digit: got ${JSON.stringify(name)}`)
  }
  if (ctx.registry.find("gates", name)) throw new Error(`a gate "${name}" already exists — naima gate show ${name}`)
  const raw = JSON.parse(readFileSync(DATA_PATH(ctx), "utf8")) as Record<string, unknown>
  const plugins = isObject(raw["plugins"]) ? raw["plugins"] : {}
  const entry = isObject(plugins["gates"]) ? plugins["gates"] : {}
  const options = isObject(entry["options"]) ? entry["options"] : {}
  const current = isObject(options["gates"]) ? options["gates"] : {}
  if (Object.hasOwn(current, name)) throw new Error(`a gate "${name}" already exists — naima gate show ${name}`)
  const next = { ...options, gates: { ...current, [name]: gate } }
  readOptions(next)
  writeJson(DATA_PATH(ctx), { ...raw, plugins: { ...plugins, gates: { ...entry, options: next } } })
}

const findGate = (ctx: Context, name: string | undefined): GateDef => {
  const gate = name === undefined ? undefined : ctx.registry.find<GateDef>("gates", name)?.value
  if (!gate) throw new Error(`no gate "${name}" — gates: ${gatesOf(ctx).map((g) => g.name).join(", ") || 'none yet: naima gate new <name> "<title>"'}`)
  return gate
}

const gateCommand: Command = {
  name: "gate",
  says:
    "declare a gate — a milestone, with a date and a version — put items on it or take them off, and show one; writes go to naima.json and to the items, validated, through the write hooks",
  enforces: "writes to naima.json and to the items are validated and pass the write hooks",
  usage:
    'gate new <name> "<title>" [--says <s>] [--due YYYY-MM-DD] [--version <v>] [--holds-on code|proof] [--coverage <list>,...] [--full-suite] | gate add <gate> <item>... | gate remove <gate> <item>... | gate show <gate>',
  options: [
    { name: "--says", says: "gate new: what the gate is for, in one sentence" },
    { name: "--due", says: "gate new: the date it is due, YYYY-MM-DD, which makes it a milestone" },
    { name: "--version", says: "gate new: the version it ships as" },
    { name: "--holds-on", says: 'gate new: "code" (the default) waits for code and lets proof be owed; "proof" waits for every proof too' },
    { name: "--coverage", says: "gate new: the coverage lists it requires, comma-separated: each entry with NO TEST blocks it" },
    {
      name: "--full-suite",
      says:
        "gate new: a release gate, which holds only when every gate that is part of the full suite holds too: every property current, every test suite passing",
    },
  ],
  examples: [
    'gate new beta "Public beta" --says "the first outside users" --due 2026-12-01 --version 0.9',
    "gate add beta bugs/export-drops-alpha epics/onboarding",
    "gate remove beta bugs/export-drops-alpha",
    "gate show beta",
    'gate new v1 "First release" --version 1.0 --full-suite',
  ],
  async run(args, ctx) {
    const p = parse(args, {
      says: { type: "string" },
      due: { type: "string" },
      version: { type: "string" },
      "holds-on": { type: "string" },
      coverage: { type: "string" },
      "full-suite": { type: "boolean" },
    })
    const [sub, name, ...rest] = p.positionals
    if (sub === "new") {
      const title = rest[0]
      if (!name || !title?.trim() || rest.length > 1) throw usageError(this)
      const says = str(p, "says"), due = str(p, "due"), version = str(p, "version"), holdsOn = str(p, "holds-on")
      const coverage = str(p, "coverage")?.split(",").map((l) => l.trim()).filter(Boolean)
      const gate = {
        title: title.trim(),
        ...(says !== undefined ? { says } : {}),
        ...(due !== undefined ? { due } : {}),
        ...(version !== undefined ? { version } : {}),
        ...(holdsOn !== undefined ? { holdsOn } : {}),
        ...(coverage?.length ? { coverage } : {}),
        ...(bool(p, "full-suite") ? { fullSuite: true } : {}),
      } as GateConfig
      declareGate(ctx, name, gate)
      ctx.out(`gate ${name} declared in ${ctx.trackerDir}/${DATA_FILE} — put items on it: naima gate add ${name} <item>...`)
      return 0
    }
    if (sub === "add" || sub === "remove") {
      if (!rest.length) throw usageError(this)
      const gate = findGate(ctx, name)
      const items = rest.map((ref) => ctx.repo.resolve(ref))
      for (const item of items) {
        const on = onGates(item)
        if (sub === "add" && on.includes(gate.name)) continue
        if (sub === "remove" && !on.includes(gate.name)) throw new Error(`${label(item)} is not on gate ${gate.name}`)
        const next = sub === "add" ? [...on, gate.name] : on.filter((g) => g !== gate.name)
        setFields(ctx, item, [[GATE.name, next.join(",")]])
        ctx.out(`${label(item)}: ${sub === "add" ? "on" : "off"} gate ${gate.name}`)
      }
      return 0
    }
    if (sub === "show") {
      if (rest.length) throw usageError(this)
      const gate = findGate(ctx, name)
      const r = await gate.evaluate(ctx)
      printGate(ctx, gate, r, true)
      if (gate.says) ctx.out(`  for: ${gate.says}`)
      if (gate.decides) ctx.out(`  decides: ${gate.decides}`)
      return r.holds ? 0 : 1
    }
    throw usageError(this)
  },
}

const overdue: Check = {
  name: "milestone-overdue",
  says: "warns when a gate with a due date is past it and does not hold",
  async run(ctx) {
    const out: Finding[] = []
    for (const { value: g } of gatesOf(ctx)) {
      if (!g.due || daysLeft(ctx, g.due) >= 0) continue
      const r = await g.evaluate(ctx)
      if (r.holds) continue
      out.push({
        level: "note",
        message: `milestone ${g.name} (${g.title}) was due on ${g.due}, ${
          days(-daysLeft(ctx, g.due))
        } ago, and is blocked by ${r.blocking.length} — naima gate show ${g.name}`,
      })
    }
    return out
  },
}

/** `naima coverage`: every entry of the lists, with its test or NO TEST. */
function coverageCommand(lists: Record<string, CoverageConfig>): Command {
  return {
    name: "coverage",
    says: "each normative list the project declares — read from its source now, never copied — every entry with the test that proves it, or NO TEST",
    enforces: "nothing: it reads each list from its source every time, never a copy, and marks an entry no test proves NO TEST",
    usage: "coverage [list...] [--check] [--json]",
    options: [
      { name: "--check", says: "exit 1 when an entry has NO TEST, or a list's source cannot be read" },
      { name: "--json", says: "print each list as JSON: list, says, entries (entry, tests), error" },
    ],
    examples: ["coverage", "coverage paid --check"],
    run(args, ctx) {
      const p = parse(args, { check: { type: "boolean" }, json: { type: "boolean" } })
      const rows = coverageOf(ctx, lists, p.positionals.length ? p.positionals : undefined)
      if (bool(p, "json")) ctx.out(JSON.stringify(rows, null, 2))
      else if (!rows.length) ctx.out(`no coverage list — declare one in plugins.gates.options.coverage of ${ctx.trackerDir}/${DATA_FILE}`)
      else for (const l of rows.flatMap(coverageLines)) ctx.out(l)
      return bool(p, "check") && rows.some((r) => r.error || r.entries.some((e) => !e.tests.length)) ? 1 : 0
    },
  }
}

function coverageCheck(lists: Record<string, CoverageConfig>): Check {
  return {
    name: "coverage-lists",
    says: "a coverage list's source can be read; an item's covers names an entry its list holds",
    run(ctx) {
      const rows = coverageOf(ctx, lists)
      return [
        ...rows.flatMap((r): Finding[] =>
          r.error ? [{ level: "problem", message: `coverage ${r.list}: ${r.error} — fix plugins.gates.options.coverage.${r.list}, or the file` }] : []
        ),
        ...staleCovers(ctx, lists, rows).map(({ item, message }): Finding => ({ level: "note", item, message })),
      ]
    },
  }
}

export default function gates(options: Record<string, unknown> = {}): Plugin {
  const configured = readOptions(options)
  const lists = readCoverage(options)
  const defs: GateDef[] = Object.entries(configured).map(([name, c]) => ({
    name,
    configured: true,
    title: c.title,
    says: c.says ?? "",
    ...(c.due !== undefined ? { due: c.due } : {}),
    ...(c.version !== undefined ? { version: c.version } : {}),
    decides:
      ((c.holdsOn ?? "code") === "code"
        ? `blocked by every open item with gate=${name} that still owes code: no fixedOn, and not itself a proving gesture. Fixed items and open proving gestures are owed, not blocking — unless refuted: one whose status refutes (a failed test, a violated property), or one verified by such an item, blocks.`
        : `blocked by every open item with gate=${name}, proof included.`) +
      " An item whose type groups others (an epic) stands for the items it groups." +
      (c.coverage?.length
        ? ` Blocked too by every entry with NO TEST of the coverage list${c.coverage.length === 1 ? "" : "s"} ${c.coverage.join(", ")}.`
        : "") +
      (c.fullSuite
        ? " A release gate: it holds only when every gate that is part of the full suite holds too (naima gates marks them), their blocking items, owed items and reasons joining its own."
        : ""),
    evaluate: (ctx) => {
      const r = evaluateGate(ctx, name, c.holdsOn ?? "code")
      const reasons = c.coverage?.length ? coverageReasons(ctx, lists, c.coverage) : []
      const own = reasons.length ? { ...r, holds: false, reasons } : r
      // A gate that is not a release gate answers at once, as it always has; a release gate awaits its parts.
      return c.fullSuite ? withFullSuite(ctx, own) : own
    },
  }))
  const status: SummarySection = {
    name: "gates",
    async render(ctx) {
      const data = await Promise.all(
        gatesOf(ctx).map(async ({ value: g }) => {
          const r = await g.evaluate(ctx)
          return { gate: g.name, when: timing(ctx, g), holds: r.holds, blocking: r.blocking.map(label), owed: r.owed.map(label) }
        }),
      )
      return rendered(
        data,
        (gs) =>
          gs.map((g) =>
            `  ${g.gate.padEnd(16)} ${g.holds ? "holds" : `blocked by ${g.blocking.length}`}${g.owed.length ? `, ${g.owed.length} owed` : ""}${
              g.when ? ` (${g.when})` : ""
            }`
          ),
      )
    },
  }
  return {
    name: "gates",
    contract: CONTRACT,
    says: "named release conditions backed by items",
    about:
      "A gate is the set of items that must be settled before something may happen — a release, a merge. An item joins a gate by carrying `gate: <name>`. " +
      "Gates are configured, never hard-coded, and any plugin may contribute one through the contract; `naima gates` lists them all. " +
      "`naima gate new` declares one in the project's configuration and `naima gate add` puts items on it, so nobody edits naima.json by hand. " +
      "A gate with a `due` date (and, optionally, a `version`) is a milestone: `naima gates` and `naima queue` say the days left, and a check warns once it is overdue. " +
      "An item whose type carries the `group` trait — an epic — stands on a gate for the items it groups. " +
      "A coverage list is a normative list the project keeps elsewhere — paid features, limits, API endpoints — named by its source, a JSON file and a path in it, or files and a regular expression, and read from it on every run, never copied. " +
      "A proving item names the entry it proves in `covers`; `naima coverage` prints every entry with its test or NO TEST, `--check` exits 1 on one, and a gate that lists it in `coverage` is blocked by each.",
    options: [
      {
        name: "gates",
        says:
          `\`plugins.gates.options.gates\` in \`${DEFAULT_DATA}/${DATA_FILE}\`, written by \`naima gate new\`: gate name → { "title", "says", "holdsOn", "due", "version" }. due (YYYY-MM-DD) makes the gate a milestone; version is what it ships as. holdsOn "code" (the default) waits for code, not proof: a fixed item that owes only its proving gesture, and the gestures themselves, are owed but do not block. holdsOn "proof": every open item on the gate blocks it.`,
        default: "{}",
      },
      {
        name: "coverage",
        says:
          `\`plugins.gates.options.coverage\` in \`${DEFAULT_DATA}/${DATA_FILE}\`: list name → { "says", and one source: "json" (a file from the project root) with "path" (keys joined by dots, * for every element or value) and "key" (the field naming an entry when elements are objects, default id); or "files" (paths or patterns with * and **) with "pattern" (a regular expression; each match is an entry, its first group when it has one) }. A gate requires lists with "coverage": [names].`,
        default: "{}",
      },
    ],
    fields: [
      {
        name: COVERS.name,
        kind: COVERS.kind,
        says: "the entries of the coverage lists this proving item proves: `<entry>`, or `<list>:<entry>` to say which list; comma-separated",
      },
      {
        name: "gate",
        kind: "enum",
        says: "the gates this item is what is waited for: any gate a loaded plugin contributes — the project's own, or a plugin's — one, or a list of several",
        // Its values are every gate any loaded plugin contributes, configured or not; an item may be on several.
        valuesFrom: "gates",
        multiple: true,
      },
    ],
    points: [gatesPoint],
    // What it reads of the trackers' vocabulary: without it loaded, gates would decide on nothing.
    uses: { fields: [FIXED_ON.name, RUN_BY.name, HUMAN_BECAUSE.name], relations: ["verifies", "verified-by"] },
    contributes: { gates: defs, "ui-views": [gatesUiView, coverageUiView(lists)] },
    // The gates are a panel of naima ui, coverage a tab, when the ui plugin is loaded; without it, still a command.
    optional: ["ui-views"],
    migrations: [moveGates],
    rank: [{ name: "gate", score: (i) => (onGates(i).length ? 0 : 4) }],
    checks: [gatedProofIsGated, overdue, coverageCheck(lists), dependenciesAcyclic, dependenciesWaitOnWork],
    commands: [gatesCommand, gateCommand, queue, coverageCommand(lists), readyCommand(gatedItems), orderCommand(gatedItems)],
    summary: [status],
  }
}
