// Model first, and how strictly the project applies it.
//
// The rule that behaviour with states or concurrency is modelled and verified
// before it is coded, the field that records at triage whether a change has
// such behaviour, the check that holds the rule, and the project's own choice
// of how strictly it applies: the planning option `modelFirst`.
//
//   strict    the rule is a must (the default, and what a new project starts with)
//   advisory  the rule is a should: a new protocol or new concurrency keeps the
//             must, and a change to behaviour that existed before the setting
//             was adopted (`modelFirstSince`) is exempt unless it rewrites it
//   deferred  model checking is not adopted yet: a todo for adopting it stands
//             on the gate or by the date the owner named (`modelFirstUntil`),
//             and naima hello says so until the owner decides
//
// `naima model-first` sets it; `naima init` proposes strict for a new project
// and advisory when Naima joins a repository that already holds substantial code.

import { readFileSync } from "node:fs"
import { extname, join } from "node:path"
import {
  type Check,
  type Command,
  type Context,
  createItem,
  DATA_FILE,
  type FieldDef,
  fieldValue,
  fieldValues,
  type Finding,
  gitOrNull,
  isOpen,
  type Item,
  label,
  parse,
  rendered,
  saveProse,
  setFields,
  str,
  type SummarySection,
  today,
  TRACKER_DIR,
  type TypeDef,
  usageError,
  writeJson,
} from "../../core/api.ts"

// ── the setting ───────────────────────────────────────────────────────────────

export const MODEL_FIRST_MODES = ["strict", "advisory", "deferred"] as const
export type ModelFirstMode = (typeof MODEL_FIRST_MODES)[number]

/** How strictly the project applies model first: the planning options `modelFirst`, `modelFirstSince` and `modelFirstUntil`. */
export interface ModelFirstSetting {
  mode: ModelFirstMode
  /** Whether the project chose it (the option is present), or runs on the default. */
  chosen: boolean
  /** The commit at which the setting was adopted: what existed there is existing code. */
  since?: string | undefined
  /** With deferred: the gate, or the date (YYYY-MM-DD), by which the owner decides. */
  until?: string | undefined
}

const DATE = /^\d{4}-\d{2}-\d{2}$/
const COMMIT = /^[0-9a-f]{40}$/

/** The planning options that set model first, validated: a wrong value stops the load with what it should be. */
export function readModelFirst(options: Record<string, unknown>): ModelFirstSetting {
  const mode = options["modelFirst"]
  const since = options["modelFirstSince"]
  const until = options["modelFirstUntil"]
  if (mode !== undefined && !MODEL_FIRST_MODES.includes(mode as ModelFirstMode)) {
    throw new Error(`planning: option modelFirst must be ${MODEL_FIRST_MODES.join(", ")}; got ${JSON.stringify(mode)}`)
  }
  if (since !== undefined && (typeof since !== "string" || !COMMIT.test(since))) {
    throw new Error(`planning: option modelFirstSince must be the full hash of the commit the setting was adopted at; got ${JSON.stringify(since)}`)
  }
  if (until !== undefined && (typeof until !== "string" || !until.trim())) {
    throw new Error(`planning: option modelFirstUntil must name a gate, or a date YYYY-MM-DD; got ${JSON.stringify(until)}`)
  }
  return {
    mode: (mode as ModelFirstMode | undefined) ?? "strict",
    chosen: mode !== undefined,
    ...(since !== undefined ? { since: since as string } : {}),
    ...(until !== undefined ? { until: until as string } : {}),
  }
}

// ── the rule ──────────────────────────────────────────────────────────────────

const RULE_BODY =
  'When behaviour has states or concurrency (a lifecycle, a protocol, a scheduler, a retry loop, two processes sharing data), it is modelled before any of its code is written, in proportion: each state machine is modelled on its own and kept small, and only what is not obvious is modelled, never the whole system at once and never what a test shows plainly. The model is in mCRL2, or a state machine encoded in mCRL2 (the guide gives a template), or another form a tool checks; a drawing or a description alone is not a model. Each property it must have is a `properties` item, and `naima verify` shows every one holds before the first line of its code is written. Its state space is minimised once and every property is checked on that, the LTS route (`verifierOptions` route lts) wherever the formula allows it, and a run already made on the same model and formula is reused, never recomputed. Where naima-codegen supports the language, every such state machine is generated from its model and checked against it, and the code around it is written to connect to the generated machine; elsewhere the code follows the model, and the model changes in the same change as the code it describes. The rule applies only when the behaviour has states or concurrency: a trivial change needs no model, and skipping one on behaviour that is not trivial is an exception, filed with its reason as a waiver of the model-first check (`naima waive model-first <item> --reason "<why>"`), which naima check lists at any time. Whoever triages a feature or a bug records whether its behaviour has states or concurrency (`naima set <item> stateful=true`, or `false`), and `naima check` notes a stateful change that landed with neither a model linked nor that waiver.'

const SETTINGS =
  " How strictly a project applies this rule is its own choice, set with `naima model-first`: strict, a must, the default for a new project; advisory, where the rule is a should, a change to code that existed before the setting was adopted is exempt unless it rewrites it, and a new protocol or new concurrency keeps the must (triage records which, `naima set <item> statefulKind=protocol`, `new` or `existing`); or deferred, where model checking is adopted later and a todo for adopting it stands on a gate or by a date the owner names."

const RULE_BASE = {
  name: "behaviour-designed-from-a-model",
  title: "Behaviour with states or concurrency is modelled and verified before it is coded",
  audience: "everyone",
  why:
    "behaviour with states fails in the orders of events nobody thought to test, and a model checker explores every order; a model checked only after the code describes the code, defects included, while one verified first is what the code is checked against. Small machines, each modelled alone and minimised once, check in seconds, so the rule costs little where it applies and nothing where it does not. An experiment with ten fresh agents found that, under the softer wording, four wrote a model before coding but none verified it first. A project that joins Naima with a large codebase cannot model it all at once, so it may make the rule advice for what already exists, or plan when to adopt it.",
  ack: "Model first mode on",
  enforcedBy: "model-first",
}

/** The rule that behaviour with states or concurrency starts from a model, as a project that applies it strictly holds it. */
export const MODEL_FIRST_RULE = { ...RULE_BASE, strength: "must" as const, text: RULE_BODY + SETTINGS }

const short = (commit: string | undefined): string => (commit ? ` at commit ${commit.slice(0, 12)}` : "")

/** The rule as the project's setting words it: one rule, whose strength and opening depend on the setting. */
export function modelFirstRule(s: ModelFirstSetting): typeof MODEL_FIRST_RULE | (typeof RULE_BASE & { strength: "should"; text: string }) {
  if (s.mode === "advisory") {
    return {
      ...RULE_BASE,
      strength: "should",
      text:
        `This project applies the rule as advice (\`naima model-first advisory\`, adopted${
          short(s.since)
        }): for a new protocol or new concurrency it stays a must, exactly as written here; for other new behaviour with states a model is advised, not required; and a change to behaviour that existed before the setting was adopted is exempt unless it rewrites it. Triage records which, \`naima set <item> statefulKind=protocol\`, \`new\` or \`existing\`; without it, a change whose files all existed at the adoption commit and none rewritten counts as existing. ` +
        RULE_BODY,
    }
  }
  if (s.mode === "deferred") {
    return {
      ...RULE_BASE,
      strength: "should",
      text:
        `This project has deferred model checking${
          s.until ? ` until ${s.until}` : ""
        } (\`naima model-first deferred\`): until then the rule is advice, the todo for adopting it stands on that gate or by that date, and \`naima hello\` says so until the owner chooses strict or advisory with \`naima model-first\`. ` +
        RULE_BODY,
    }
  }
  return MODEL_FIRST_RULE
}

// ── the fields ────────────────────────────────────────────────────────────────

/** Whether a change's behaviour has states or concurrency: recorded at triage, never guessed from the code. */
export const STATEFUL: FieldDef = {
  name: "stateful",
  kind: "boolean",
  says:
    "whether the behaviour this change adds or fixes has states or concurrency (a lifecycle, a protocol, a scheduler, a retry loop, two processes sharing data): recorded at triage, true or false; when true, the change starts from a model (model-first)",
  traits: ["fixable"],
}

/** Which kind of stateful change it is, for a project that applies model first as advice. */
export const STATEFUL_KIND: FieldDef = {
  name: "statefulKind",
  kind: "enum",
  says:
    "with stateful true, which kind of change it is, recorded at triage: it matters where model first is advisory, which keeps the must for a new protocol or concurrency and exempts existing code",
  values: {
    protocol: "adds a new protocol or new concurrency: the must holds in every setting",
    new: "adds other new behaviour with states: a model is required when strict, advised when advisory",
    existing: "changes behaviour that existed before the project adopted its model-first setting, without rewriting it: exempt when advisory",
  },
  traits: ["fixable"],
}

const FIXED_ON = { name: "fixedOn", kind: "date" } as const
const COMMITS = { name: "commits", kind: "strings" } as const
const GATE = "gate"

// ── the check ─────────────────────────────────────────────────────────────────

/** The verifier plugin's types, by id: a model, and a property checked on one. */
const MODEL_TYPES = ["models", "properties"]

/** Half its lines or more removed: the change rewrote the file rather than changed it. */
const REWRITTEN = 0.5

/**
 * Whether git shows the change touched only existing code: every file its commits changed outside the tracker existed
 * at the adoption commit, and none had half its lines or more removed. False when nothing can be told.
 */
export function changesExistingCode(ctx: Context, item: Item, since: string | undefined): boolean {
  if (!since) return false
  const listed = item.meta[COMMITS.name]
  const commits = (Array.isArray(listed) ? listed : []).filter((c): c is string => typeof c === "string" && /^[0-9a-f]{7,40}$/.test(c))
  if (!commits.length) return false
  let files = 0
  for (const commit of commits) {
    const stat = gitOrNull(ctx.root, "diff", "--numstat", `${commit}^1`, commit)
    if (stat === null) return false
    for (const line of stat.split("\n").filter(Boolean)) {
      const [, removed, path] = line.split("\t")
      if (!path || path.startsWith(`${TRACKER_DIR}/`)) continue
      files++
      const before = gitOrNull(ctx.root, "show", `${since}:${path}`)
      if (before === null) return false
      const lines = before.split("\n").length
      if (Number(removed) >= lines * REWRITTEN) return false
    }
  }
  return files > 0
}

const modelled = (ctx: Context, item: Item): boolean => ctx.repo.linksOf(item).some((l) => MODEL_TYPES.includes(ctx.repo.byId.get(l.id)?.type ?? ""))

const remedy = (item: Item): string =>
  `link the models or properties item it was designed from (naima link ${
    label(item)
  } <rel> <property>), or file the exception with its reason: naima waive model-first ${label(item)} --reason "<why it needs no model>"`

export function modelFirstCheck(setting: ModelFirstSetting): Check {
  return {
    name: "model-first",
    says:
      "a change triaged as having states or concurrency (stateful: true) that landed (fixedOn set) with no models or properties item linked to it, and no waiver of this check filed with its reason, is noted, as the project's setting (planning option modelFirst) says: strict notes every one; advisory notes a new protocol or concurrency as a must, other new behaviour as advice, and nothing on existing code; deferred notes the deferral and its planned todo instead of each change",
    run(ctx) {
      if (setting.mode === "deferred") return deferralFindings(ctx, setting)
      const out: Finding[] = []
      for (const item of ctx.repo.items) {
        if (fieldValue(item, STATEFUL) !== true || !fieldValue(item, FIXED_ON) || modelled(ctx, item)) continue
        let message = `${label(item)}: triaged stateful and landed with no model — ${remedy(item)}`
        if (setting.mode === "advisory") {
          const kind = fieldValue(item, STATEFUL_KIND)
          if (kind === "existing" || (kind === undefined && changesExistingCode(ctx, item, setting.since))) continue
          message = kind === "protocol"
            ? `${label(item)}: triaged stateful, a new protocol or concurrency, and landed with no model — the must holds even where model first is advisory: ${
              remedy(item)
            }`
            : `${label(item)}: triaged stateful and landed with no model — model first is advisory here, so a model is advised, not required: ${remedy(item)}`
        }
        out.push({ level: "note", item, subject: label(item), message })
      }
      return out
    },
  }
}

// ── deferring ─────────────────────────────────────────────────────────────────

/** The title of the todo that plans adopting model checking, filed once when the owner defers it. */
export const ADOPT_TITLE = "Decide how strictly this project applies model first, and adopt model checking"

const planned = (ctx: Context): Item | undefined => ctx.repo.items.find((i) => i.meta.title === ADOPT_TITLE && isOpen(ctx, i))

const isGate = (ctx: Context, name: string): boolean => {
  try {
    return ctx.registry.find("gates", name) !== undefined
  } catch {
    return false
  }
}

function deferralFindings(ctx: Context, s: ModelFirstSetting): Finding[] {
  const todo = planned(ctx)
  if (!s.until || !todo) {
    return [{
      level: "note",
      subject: "model-first",
      message: `model first is deferred with no ${
        !s.until ? "gate or date to decide by" : "todo planning its adoption"
      }: naima model-first deferred --until <gate|YYYY-MM-DD> files it`,
    }]
  }
  const overdue = DATE.test(s.until) && s.until < today(ctx)
  return [{
    level: "note",
    item: todo,
    subject: "model-first",
    message: overdue
      ? `model first was deferred until ${s.until}, which has passed: ask the owner to choose — naima model-first strict, or advisory (${label(todo)} plans it)`
      : `model first is deferred until ${s.until}: ${label(todo)} plans adopting it, and each stateful change is not checked until then`,
  }]
}

/** The type the adoption todo is filed as: todos, else the first creatable type with the trait follow-up. */
const todoType = (ctx: Context): TypeDef | undefined =>
  ctx.registry.types.get("todos") ?? [...ctx.registry.types.values()].find((t) => t.creatable !== false && t.traits?.includes("follow-up"))

const ADOPT_PAGE = (until: string, gate: boolean): string =>
  `# ${ADOPT_TITLE}\n\nThe owner deferred model checking ${
    gate ? `to the gate ${until}` : `until ${until}`
  }. Until then the model-first rule is advice and \`naima check\` does not note stateful changes one by one.\n\nBy then, the owner chooses how strictly the project applies model first:\n\n- strict: every change with states or concurrency starts from a verified model (\`naima model-first strict\`);\n- advisory: a model is advised, existing code is exempt unless rewritten, and a new protocol or concurrency keeps the must (\`naima model-first advisory\`).\n\nAdopting it means installing a model checker (\`naima tools\`) and modelling the next stateful change before its code.\n`

/** File the todo that plans adopting model checking, once, on the gate it names when `until` is a gate. */
export function fileAdoptionTodo(ctx: Context, until: string): string {
  const gate = isGate(ctx, until)
  const there = planned(ctx)
  if (there) {
    if (gate && !fieldValues(there, { name: GATE, kind: "enum" }).includes(until)) setFields(ctx, there, [[GATE, until]])
    return `already planned: ${label(there)}${gate ? `, on the gate ${until}` : ""}`
  }
  const type = todoType(ctx)
  if (!type) return `not filed, no type of this project carries the trait follow-up: ${ADOPT_TITLE}`
  const item = createItem(ctx, type, ADOPT_TITLE)
  saveProse(ctx, item, ADOPT_PAGE(until, gate))
  if (gate) setFields(ctx, ctx.repo.resolve(label(item)), [[GATE, until]])
  return `filed ${label(item)}${gate ? `, on the gate ${until}` : `, to decide by ${until}`}: tell the owner`
}

// ── setting it ────────────────────────────────────────────────────────────────

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v)

/** Write the planning options that set model first into naima.json: each given value set, an undefined one removed. */
export function writeModelFirst(ctx: Context, set: Record<string, string | undefined>): void {
  const path = join(ctx.trackerRoot, DATA_FILE)
  const raw = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>
  const plugins = isObject(raw["plugins"]) ? raw["plugins"] : {}
  const entry = isObject(plugins["planning"]) ? plugins["planning"] : {}
  const options: Record<string, unknown> = { ...(isObject(entry["options"]) ? entry["options"] : {}) }
  for (const [key, value] of Object.entries(set)) {
    if (value === undefined) delete options[key]
    else options[key] = value
  }
  readModelFirst(options)
  writeJson(path, { ...raw, plugins: { ...plugins, planning: { ...entry, options } } })
}

const head = (ctx: Context): string | undefined => gitOrNull(ctx.root, "rev-parse", "HEAD") ?? undefined

const describe = (s: ModelFirstSetting): string =>
  s.mode === "strict"
    ? "strict: the rule is a must"
    : s.mode === "advisory"
    ? `advisory${short(s.since)}: a should, existing code exempt unless rewritten, a new protocol or concurrency kept a must`
    : `deferred${s.until ? ` until ${s.until}` : ""}: model checking is adopted later`

export function modelFirstCommand(setting: ModelFirstSetting): Command {
  return {
    name: "model-first",
    says:
      "show or set how strictly the project applies model first (planning option modelFirst): strict, the rule a must; advisory, a should, with code that existed before the setting exempt unless rewritten and a new protocol or concurrency kept a must; deferred until a gate or a date the owner names, which files at once the todo that plans adopting model checking there",
    enforces: "the setting is the owner's choice: an agent sets it only after the owner said which; deferring always names a gate or a date and files its todo",
    usage: "model-first [strict | advisory | deferred --until <gate|YYYY-MM-DD>]",
    options: [{ name: "--until", says: "with deferred: the gate (or milestone) the adoption todo stands on, or the date by which the owner decides" }],
    examples: ["model-first", "model-first advisory", "model-first deferred --until v1", "model-first deferred --until 2027-03-01"],
    run(args, ctx) {
      const p = parse(args, { until: { type: "string" } })
      const [mode, ...rest] = p.positionals
      const until = str(p, "until")?.trim()
      if (rest.length || (mode !== undefined && !MODEL_FIRST_MODES.includes(mode as ModelFirstMode))) throw usageError(this)
      if (mode === undefined) {
        ctx.out(`model first: ${describe(setting)}${setting.chosen ? "" : " (the default: the project has not chosen)"}`)
        return 0
      }
      if ((mode === "deferred") !== (until !== undefined && until !== "")) throw usageError(this)
      if (mode === "deferred" && !isGate(ctx, until!) && !DATE.test(until!)) {
        throw new Error(`--until ${until} is neither a gate (naima gates lists them) nor a date YYYY-MM-DD`)
      }
      const next = { modelFirst: mode, modelFirstSince: head(ctx), modelFirstUntil: mode === "deferred" ? until : undefined }
      writeModelFirst(ctx, next)
      ctx.out(`model first is now ${describe({ mode: mode as ModelFirstMode, chosen: true, since: next.modelFirstSince, until })}`)
      if (mode === "deferred") ctx.out(fileAdoptionTodo(ctx, until!))
      else {
        const todo = planned(ctx)
        if (todo) ctx.out(`${label(todo)} planned this decision, which is now taken: close it`)
      }
      return 0
    },
  }
}

// ── init's proposal ───────────────────────────────────────────────────────────

/** Source files, by extension, that count as a project's code when Naima joins it. */
const SOURCE = new Set(
  ".ts .tsx .js .jsx .mjs .cjs .py .rs .go .java .kt .scala .c .h .cc .cpp .hpp .cs .swift .m .rb .php .ex .exs .erl .hs .ml .clj .lua .dart .zig .jl .r .sh"
    .split(" "),
)
/** Substantial code: this many source files, or this many lines of them. */
export const SUBSTANTIAL = { files: 20, lines: 2000 }

/** How much code the repository holds outside the tracker: its source files and their lines, as git tracks them. */
export function codeSize(root: string): { files: number; lines: number } {
  const listed = gitOrNull(root, "ls-files")
  if (!listed) return { files: 0, lines: 0 }
  let files = 0
  let lines = 0
  for (const path of listed.split("\n")) {
    if (!path || path.startsWith(`${TRACKER_DIR}/`) || !SOURCE.has(extname(path).toLowerCase())) continue
    files++
    if (lines < SUBSTANTIAL.lines) {
      try {
        lines += readFileSync(join(root, path), "utf8").split("\n").length
      } catch { /* a file listed but not on disk adds no lines */ }
    }
  }
  return { files, lines }
}

/** What init proposes: advisory when Naima joins a repository with substantial code, strict for a new project. */
export function proposedMode(root: string): { mode: ModelFirstMode; size: { files: number; lines: number } } {
  const size = codeSize(root)
  return { mode: size.files >= SUBSTANTIAL.files || size.lines >= SUBSTANTIAL.lines ? "advisory" : "strict", size }
}

/** The setup step: at init, a project that has not chosen gets init's proposal written, and the question for the owner said. */
export function modelFirstSetup(setting: ModelFirstSetting) {
  return {
    name: "model-first-setting",
    says:
      "at init, when the project has not chosen how strictly it applies model first and has no items yet: write init's proposal (strict for a new project, advisory when the repository already holds substantial code) and say the question to put to the owner, who may keep it, change it or defer it",
    install(ctx: Context): string[] {
      if (setting.chosen || ctx.repo.items.length) return []
      const { mode, size } = proposedMode(ctx.root)
      writeModelFirst(ctx, { modelFirst: mode, modelFirstSince: head(ctx) })
      const why = mode === "advisory"
        ? `Naima joins a repository that already holds ${size.files} source files: existing code is exempt until rewritten, and a new protocol or concurrency keeps the must`
        : "this is a new project"
      return [
        `model first is set to ${mode}, since ${why}. Ask the owner whether to keep it, make it ${
          mode === "advisory" ? "strict" : "advisory"
        }, or defer model checking to a gate or a date: naima model-first strict | advisory | deferred --until <gate|YYYY-MM-DD>`,
      ]
    },
  }
}

/** What naima hello says while model checking is deferred: until when, and the todo that plans it. */
export function modelFirstSection(setting: ModelFirstSetting): SummarySection {
  return {
    name: "model-first",
    hello: true,
    render: (ctx) => {
      if (setting.mode !== "deferred") return rendered([] as string[], (l) => l)
      const todo = planned(ctx)
      return rendered([
        `Model first is deferred${setting.until ? ` until ${setting.until}` : ""}${
          todo ? ` (${label(todo)} plans it)` : ""
        }: the owner has still to choose — naima model-first strict | advisory`,
      ], (l) => l)
    },
  }
}
