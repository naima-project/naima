// Properties proven by formal-methods tools, tracked like any other item.
//
// A property item names a verifier (an adapter any plugin can contribute), a
// model file and a property. `naima verify` runs the adapter and attaches the
// run — verdict, output, counterexample, and one digest over every file it
// read and the tool's version — to the item. A property that `holds` is evidence exactly as a passed
// test is: it can `verify` a bug and close it.
//
// A verdict is only as good as what it was reached on, so `check` fails when
// a property claims to hold and the model, a file it includes or the tool's
// version has changed since its run.

import { createHash } from "node:crypto"
import { existsSync, readdirSync, readFileSync } from "node:fs"
import { isAbsolute, join, relative, resolve, sep } from "node:path"
import {
  ATTACHMENTS,
  bool,
  type Check,
  type Command,
  type Context,
  CONTRACT,
  fieldValue,
  type Finding,
  findPrivate,
  guardPrivate,
  hasTrait,
  type Item,
  label,
  linked,
  NO_PROGRESS,
  parse,
  type Plugin,
  privateContext,
  type Progress,
  progressFor,
  saveMeta,
  setFieldValue,
  storedLinks,
  str,
  usageError,
  writeFileAtomic,
  type WriteHook,
  writeJson,
} from "../../core/api.ts"
import { exampleRegex } from "./adapters/example-regex.ts"
import { type Verdict, type Verifier, verifiersPoint, type VerifyRequest, type VerifyResult } from "./contract.ts"

export type { Verdict, Verifier, VerifyRequest, VerifyResult } from "./contract.ts"

/** The gate this plugin contributes to the gates point: the shape that point takes, declared here since plugins never import each other. */
interface Gate {
  name: string
  title: string
  says: string
  decides: string
  evaluate(ctx: Context): { holds: boolean; blocking: Item[]; owed: Item[] }
}

const verifierOf = (ctx: Context, id: string): Verifier | undefined => ctx.registry.find<Verifier>("verifiers", id)?.value
const verifierIds = (ctx: Context): string[] => ctx.registry.contributions("verifiers").map((c) => c.name)

export const TYPE = "properties"
/** The type of a model as an artefact of its own: whether it is in development. */
export const MODELS = "models"
const DEVELOPMENT = "development"
const STABLE = "stable"

const LAST_RUN = { name: "lastRun", kind: "string" } as const
const VERIFIER_OPTIONS = { name: "verifierOptions", kind: "object" } as const

export interface RunRecord {
  verifier: string
  model: string
  modelSha256: string
  property: string
  /** The sha256 of the item's `verifierOptions`, keys sorted; absent in runs recorded before it was kept, meaning none. */
  optionsSha256?: string
  /** Every file the run read — the model and what it includes — from the project root, sorted, each with its sha256. Absent in runs recorded before it was kept: the model alone. */
  inputs?: RunInput[]
  /** The tool's version, as the adapter's `version` gave it; absent when the adapter declares none. */
  toolVersion?: string
  /** One digest over `inputs` and `toolVersion` (`digestOf`): what the run speaks for, in one value. */
  inputsSha256?: string
  verdict: Verdict
  output: string
  counterexample?: string
  /** How the adapter reached the verdict, as it said: a JSON object; absent when it said nothing. */
  details?: Record<string, unknown>
  /** Why the run was made although a run of the same identity was recorded (`naima verify --force "<reason>"`); absent otherwise. */
  forced?: string
  at: string
}

export interface RunInput {
  path: string
  sha256: string
}

const STATUS: Record<Verdict, string> = { holds: "holds", violated: "violated", error: "error", unknown: "error" }

const VERDICTS: readonly Verdict[] = ["holds", "violated", "error", "unknown"]

/** An adapter's answer held to the contract: anything outside it is an `error`, with an output that says why. */
export function inContract(id: string, result: unknown): VerifyResult {
  if (!result || typeof result !== "object") return { verdict: "error", output: `adapter "${id}" returned ${String(result)}, not a result` }
  const { verdict, output, counterexample, details } = result as Record<string, unknown>
  if (!VERDICTS.includes(verdict as Verdict)) {
    return {
      verdict: "error",
      output: `adapter "${id}" returned verdict ${JSON.stringify(verdict)}, outside the contract (${VERDICTS.join(", ")})${
        typeof output === "string" ? `: ${output}` : ""
      }`,
    }
  }
  if (typeof output !== "string") return { verdict: "error", output: `adapter "${id}" returned verdict ${String(verdict)} with no string output` }
  if (details !== undefined && !isObject(details)) return { verdict: "error", output: `adapter "${id}" returned details that are not a JSON object` }
  return {
    verdict: verdict as Verdict,
    output,
    ...(typeof counterexample === "string" ? { counterexample } : {}),
    ...(details !== undefined ? { details: details as Record<string, unknown> } : {}),
  }
}

const isObject = (v: unknown): boolean => !!v && typeof v === "object" && !Array.isArray(v)

const sha256 = (path: string): string => createHash("sha256").update(readFileSync(path)).digest("hex")

/** JSON with every object's keys sorted: the same options always hash the same. */
const canonical = (v: unknown): string =>
  Array.isArray(v)
    ? `[${v.map(canonical).join(",")}]`
    : v && typeof v === "object"
    ? `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`).join(",")}}`
    : JSON.stringify(v) ?? "null"

/** The options a property is verified with: its `verifierOptions` object, or none. */
const optionsOf = (item: Item): Record<string, unknown> => {
  const raw = fieldValue(item, VERIFIER_OPTIONS)
  return raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {}
}
const optionsHash = (options: Record<string, unknown>): string => createHash("sha256").update(canonical(options)).digest("hex")

/** The one digest a run keeps over everything it read and the tool that read it. */
export const digestOf = (inputs: readonly RunInput[], toolVersion: string | undefined): string =>
  createHash("sha256").update(canonical({ inputs: inputs.map((i) => [i.path, i.sha256]), toolVersion: toolVersion ?? null })).digest("hex")

/** The files a run on `item` reads, from the project root, sorted, the model always among them: what the adapter declares, or the model alone. */
async function inputsOf(ctx: Context, verifier: Verifier, item: Item, request: VerifyRequest): Promise<string[]> {
  const declared = verifier.inputs ? await verifier.inputs(request, ctx) : []
  const out = new Set<string>([String(item.meta["model"])])
  for (const abs of declared) {
    const rel = relative(ctx.root, abs)
    if (!modelPath(ctx.root, rel)) throw new Error(`${label(item)}: input ${abs} is outside the project — a model reads only files inside it`)
    out.add(rel.split(sep).join("/"))
  }
  return [...out].sort()
}

const modelTemplate = (title: string): string =>
  `# ${title}\n\nWhat the model describes, and what is being changed while it is in development.\n\nSet \`model\` (a path from the project root) in meta.json: every property whose \`model\` is that path is verified on it.\n`

const template = (title: string): string =>
  `# ${title}\n\nThe property in words, and why it matters.\n\nSet \`verifier\`, \`model\` (a path from the project root) and \`property\` in meta.json, then \`naima verify\`.\n`

/** A run record read back from disk, checked field by field; the reason when it is not one. */
function asRun(value: unknown): RunRecord | string {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "not a JSON object"
  const r = value as Record<string, unknown>
  const missing = ["verifier", "model", "modelSha256", "property", "output", "at"].filter((k) => typeof r[k] !== "string")
  if (missing.length) return `${missing.join(", ")} missing or not text`
  if (!VERDICTS.includes(r["verdict"] as Verdict)) return `verdict ${JSON.stringify(r["verdict"])} is not one of ${VERDICTS.join(", ")}`
  for (const k of ["optionsSha256", "counterexample", "toolVersion", "inputsSha256", "forced"]) {
    if (r[k] !== undefined && typeof r[k] !== "string") return `${k} is not text`
  }
  if (r["details"] !== undefined && !isObject(r["details"])) return "details is not a JSON object"
  const inputs = r["inputs"]
  if (
    inputs !== undefined &&
    (!Array.isArray(inputs) || !inputs.every((i) => i && typeof i === "object" && typeof i.path === "string" && typeof i.sha256 === "string"))
  ) {
    return "inputs is not a list of { path, sha256 }"
  }
  return r as unknown as RunRecord
}

/** `lastRun` names a file directly in the item's attachments/, never a path out of it. */
const isAttachmentName = (name: string): boolean => /^[^/\\]+$/.test(name) && name !== "." && name !== ".."

/** The item's last run: the record, why it cannot be trusted, or null when there is none. */
export function loadRun(item: Item): { run: RunRecord } | { problem: string } | null {
  const name = fieldValue(item, LAST_RUN)
  if (typeof name !== "string") return null
  if (!isAttachmentName(name)) return { problem: `lastRun ${JSON.stringify(name)} is not a file name in ${ATTACHMENTS}/` }
  const path = join(item.dir, ATTACHMENTS, name)
  if (!existsSync(path)) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"))
  } catch (e) {
    return { problem: `its run record ${ATTACHMENTS}/${name} is malformed: ${e instanceof Error ? e.message : String(e)}` }
  }
  const run = asRun(parsed)
  return typeof run === "string" ? { problem: `its run record ${ATTACHMENTS}/${name} is malformed: ${run}` } : { run }
}

/** The item's last run, when there is a trustworthy one. */
export function readRun(item: Item): RunRecord | null {
  const r = loadRun(item)
  return r && "run" in r ? r.run : null
}

/** One run kept in a property's attachments/: the file's name, and the record it holds. */
export interface KeptRun {
  name: string
  run: RunRecord
}

const RUN_FILE = /^run-.+\.json$/

/** The order of runs made in the same instant: `run-<stamp>.json` first, then `run-<stamp>-2.json`, and so on. */
const sequence = (name: string): number => Number(/Z-(\d+)\.json$/.exec(name)?.[1] ?? 1)

/** Every run recorded on the item that can be trusted, oldest first; a malformed record is left out, as `property-evidence` reports the one that matters. */
export function runsOf(item: Item): KeptRun[] {
  const dir = join(item.dir, ATTACHMENTS)
  if (!existsSync(dir)) return []
  const out: KeptRun[] = []
  for (const name of readdirSync(dir)) {
    if (!RUN_FILE.test(name)) continue
    try {
      const run = asRun(JSON.parse(readFileSync(join(dir, name), "utf8")))
      if (typeof run !== "string") out.push({ name, run })
    } catch {
      // not a record: nothing to reuse or to count as evidence
    }
  }
  return out.sort((a, b) => a.run.at.localeCompare(b.run.at) || sequence(a.name) - sequence(b.name))
}

/** A stamp no run of the item has yet: the instant, then `-2`, `-3`… for runs made in the same one, so a run never overwrites another. */
function freshStamp(dir: string, stamp: string): string {
  let out = stamp
  for (let n = 2; existsSync(join(dir, `run-${out}.json`)) || existsSync(join(dir, `counterexample-${out}.txt`)); n++) out = `${stamp}-${n}`
  return out
}

/** A verdict about the model: what a run of the same identity would say again. An error or an unknown says something about the run, so it is never reused. */
const conclusive = (v: Verdict): boolean => v === "holds" || v === "violated"

/** What identifies a run: the property, the verifier, the model path, the options, and one digest over every input and the tool's version. */
interface Identity {
  verifier: string
  model: string
  property: string
  optionsSha256: string
  inputsSha256: string
}

/** Whether `run` was made on exactly `identity`, its digest consistent with the inputs it lists. */
const madeOn = (run: RunRecord, identity: Identity): boolean =>
  run.verifier === identity.verifier && run.model === identity.model && run.property === identity.property &&
  (run.optionsSha256 ?? optionsHash({})) === identity.optionsSha256 && run.inputsSha256 === identity.inputsSha256 &&
  run.inputs !== undefined && digestOf(run.inputs, run.toolVersion) === run.inputsSha256

/** What `verifyItem` did: the verdict, and the recorded run it reused instead of running, when it did. */
export interface VerifyOutcome {
  verdict: Verdict
  /** The file in the item's attachments/ whose verdict was reused; absent when the verifier ran. */
  reused?: string
}

/** The model's absolute path, when `model` names a file inside the project; null for one that escapes it. */
export function modelPath(root: string, model: string): string | null {
  if (isAbsolute(model)) return null
  const abs = resolve(root, model)
  const rel = relative(root, abs)
  return rel === "" || rel.startsWith("..") || isAbsolute(rel) ? null : abs
}

/**
 * Run one property's verifier and attach the result. A conclusive run already recorded on the same identity —
 * inputs, tool version, options — is reused instead: the property takes its verdict and points to it. `force`, a
 * reason, runs it again and records the reason with the run.
 */
export async function verifyItem(ctx: Context, item: Item, progress: Progress = NO_PROGRESS, opts: { force?: string } = {}): Promise<VerifyOutcome> {
  const { verifier: id, model, property } = item.meta
  if (typeof id !== "string" || typeof model !== "string" || typeof property !== "string") {
    throw new Error(`${label(item)}: set verifier, model and property first`)
  }
  const verifier = verifierOf(ctx, id)
  if (!verifier) throw new Error(`${label(item)}: no verifier "${id}" — verifiers: ${verifierIds(ctx).join(", ")}`)
  const path = modelPath(ctx.root, model)
  if (!path) throw new Error(`${label(item)}: model ${model} is outside the project — model is a path from the project root`)
  if (!existsSync(path)) throw new Error(`${label(item)}: model ${model} does not exist`)
  const options = optionsOf(item)
  // The adapter's stages are reported as the property's: `<property>: <stage>` (specs/progress-long-work-says-how-far, §6).
  const own = label(item)
  const within: Progress = { ...progress, stage: (name, total, unit) => progress.stage(`${own}: ${name}`, total, unit) }
  progress.stage(own)
  const request = { model: path, property, options, progress: within }
  const inputs = (await inputsOf(ctx, verifier, item, request)).map((rel): RunInput => {
    const abs = resolve(ctx.root, rel)
    if (!existsSync(abs)) throw new Error(`${label(item)}: input ${rel} does not exist`)
    return { path: rel, sha256: sha256(abs) }
  })
  // A tool that cannot say its version (it is not installed, say) cannot run either: the run is an error that says why.
  let toolVersion: string | undefined
  let unversioned: string | undefined
  try {
    toolVersion = verifier.version ? await verifier.version(ctx) : undefined
  } catch (e) {
    unversioned = e instanceof Error ? e.message : String(e)
  }
  const identity: Identity = { verifier: id, model, property, optionsSha256: optionsHash(options), inputsSha256: digestOf(inputs, toolVersion) }
  if (opts.force === undefined && unversioned === undefined) {
    const known = runsOf(item).filter((k) => conclusive(k.run.verdict) && madeOn(k.run, identity)).pop()
    if (known) {
      const status = STATUS[known.run.verdict]
      if (item.meta.status !== status || fieldValue(item, LAST_RUN) !== known.name) {
        item.meta.status = status
        setFieldValue(item, LAST_RUN, known.name)
        saveMeta(ctx, item)
      }
      return { verdict: known.run.verdict, reused: known.name }
    }
  }
  const hash = sha256(path)
  let result: VerifyResult
  try {
    result = unversioned !== undefined ? { verdict: "error", output: unversioned } : inContract(id, await verifier.verify(request, ctx))
  } catch (e) {
    result = { verdict: "error", output: e instanceof Error ? e.message : String(e) }
  }
  const at = ctx.now().toISOString()
  const stamp = freshStamp(join(item.dir, ATTACHMENTS), at.replace(/[:.]/g, "-"))
  const record: RunRecord = {
    verifier: id,
    model,
    modelSha256: hash,
    property,
    optionsSha256: identity.optionsSha256,
    inputs,
    ...(toolVersion !== undefined ? { toolVersion } : {}),
    inputsSha256: identity.inputsSha256,
    verdict: result.verdict,
    output: result.output,
    at,
    ...(result.counterexample !== undefined ? { counterexample: result.counterexample } : {}),
    ...(result.details !== undefined ? { details: result.details } : {}),
    ...(opts.force !== undefined ? { forced: opts.force } : {}),
  }
  const name = `run-${stamp}.json`
  writeJson(join(item.dir, ATTACHMENTS, name), record)
  if (result.counterexample !== undefined) writeFileAtomic(join(item.dir, ATTACHMENTS, `counterexample-${stamp}.txt`), result.counterexample + "\n")
  item.meta.status = STATUS[result.verdict]
  setFieldValue(item, LAST_RUN, name)
  saveMeta(ctx, item)
  return { verdict: result.verdict }
}

const properties = (ctx: Context): Item[] => ctx.repo.items.filter((i) => i.type === TYPE)

/** Whether two `model` values name one file of the project. */
const sameModel = (ctx: Context, a: unknown, b: unknown): boolean => {
  if (typeof a !== "string" || typeof b !== "string") return false
  const pa = modelPath(ctx.root, a)
  return pa !== null && pa === modelPath(ctx.root, b)
}

/** The models item that marks `model` as in development, if one does. */
export const developing = (ctx: Context, model: unknown): Item | undefined =>
  ctx.repo.items.find((i) => i.type === MODELS && i.meta.status === DEVELOPMENT && sameModel(ctx, i.meta["model"], model))

/** Why `item` is not a property holding on a run of exactly what it has now; empty when it is. Only what can be said without starting the tool. */
function notCurrent(ctx: Context, item: Item): string[] {
  if (item.meta.status !== "holds") return [`${label(item)} [${item.meta.status}]`]
  const run = readRun(item)
  if (!run || run.verdict !== "holds") return [`${label(item)}: holds, but carries no holding run`]
  return staleness(ctx, item, run).map((why) => `${label(item)}: ${why}`)
}

const verify: Command = {
  name: "verify",
  says: "run the verifier of properties and attach each run as evidence",
  enforces:
    "a property holds only with a run of its verifier on exactly what it has now, attached as evidence; a model or input outside the project is refused; a conclusive run (holds or violated) already recorded on the same identity — every input's digest with the tool's version, and the options — is reused, not repeated, unless --force gives the reason to run it again",
  usage: 'verify <property>... | verify --all [--force "<reason>"]',
  long: {
    reports:
      "the properties done of those asked, with a rate and an ETA; within a property, each stage of its verifier with the count its tool exposes — for mCRL2 each tool, with the states lps2lts explores and the BES equations pbessolve generates",
  },
  options: [
    { name: "--all", says: "every property item" },
    { name: "--force", says: "run again even when a run of the same identity is recorded, for the reason given: kept with the new run" },
  ],
  examples: ["verify no-deadlock", "verify --all", 'verify no-deadlock --force "the first run was cut short by a reboot"'],
  async run(args, ctx) {
    const p = parse(args, { all: { type: "boolean" }, force: { type: "string" } })
    const items = bool(p, "all") ? properties(ctx) : p.positionals.map((r) => ctx.repo.resolve(r))
    if (!items.length) throw usageError(this)
    const given = str(p, "force")
    const force = given === undefined ? undefined : given.trim()
    if (force === "") throw new Error('--force needs the reason the recorded result is not enough: --force "<reason>"')
    const allowance = force === undefined ? undefined : guardPrivate("the reason", findPrivate(force, privateContext()), ctx.allowPrivate)
    let failing = 0
    for (const item of items) if (item.type !== TYPE) throw new Error(`${label(item)} is not a property`)
    const progress = progressFor((l) => ctx.err(l))
    try {
      for (const [i, item] of items.entries()) {
        progress.overall(i, items.length, "properties")
        const { verdict, reused } = await verifyItem(ctx, item, progress, force === undefined ? {} : { force: allowance ? `${force} ${allowance}` : force })
        if (verdict !== "holds") failing++
        const said = reused ? `  (reused ${ATTACHMENTS}/${reused}: a run on the same inputs, tool version and options)` : ""
        ctx.out(`${verdict.padEnd(9)} ${label(item)}  ${item.meta.title}${said}`)
      }
      progress.overall(items.length, items.length, "properties")
    } finally {
      progress.end()
    }
    return failing ? 1 : 0
  },
}

const verifiers: Command = {
  name: "verifiers",
  says: "list the verifier adapters every plugin contributes",
  enforces: "nothing: it only reads",
  usage: "verifiers",
  examples: ["verifiers"],
  run(_args, ctx) {
    for (const c of ctx.registry.contributions("verifiers")) ctx.out(`  ${c.name.padEnd(16)} ${(c.value as Verifier).says}`)
    return 0
  },
}

const evidence: Check = {
  name: "property-evidence",
  says:
    "a property names a known verifier and an existing model; one that holds carries a run of its current property, verifier, model and options, on every file it reads as it is now and the tool's version as it is now",
  async run(ctx) {
    const out: Finding[] = []
    const problem = (item: Item, message: string) => out.push({ level: "problem", message: `${label(item)}: ${message}`, item })
    for (const item of properties(ctx)) {
      const { verifier, model } = item.meta
      if (typeof verifier === "string" && !verifierIds(ctx).includes(verifier)) problem(item, `verifier "${verifier}" is not loaded`)
      const path = typeof model === "string" ? modelPath(ctx.root, model) : null
      if (typeof model === "string" && !path) problem(item, `model ${model} is outside the project — model is a path from the project root`)
      else if (path && !existsSync(path)) problem(item, `model ${String(model)} does not exist`)
      const loaded = loadRun(item)
      if (loaded && "problem" in loaded && !loaded.problem.startsWith("its run record")) problem(item, loaded.problem)
      if (item.meta.status !== "holds") continue
      if (loaded && "problem" in loaded && loaded.problem.startsWith("its run record")) {
        problem(item, `holds, but ${loaded.problem}`)
        continue
      }
      const run = loaded && "run" in loaded ? loaded.run : null
      if (!run) problem(item, "holds, but carries no run")
      else if (run.verdict !== "holds") problem(item, `holds, but its last run says ${run.verdict}`)
      else {
        const whys = [...staleness(ctx, item, run), ...(await toolStaleness(ctx, item, run, out))]
        const model = developing(ctx, item.meta["model"])
        for (const why of whys) {
          if (!model) problem(item, `${why} — run naima verify again`)
          else out.push({ level: "note", item, message: `${label(item)}: ${why} — ${label(model)} is in development, so this is informational` })
        }
      }
    }
    return out
  },
}

/**
 * Why `run` is not evidence for the property as `item` has it now: the
 * verdict speaks only for exactly what was run — the property, the adapter,
 * the model path and its contents, and the options. Empty when it is current.
 */
export function staleness(ctx: Context, item: Item, run: RunRecord): string[] {
  const out: string[] = []
  const { verifier, model, property } = item.meta
  if (run.property !== property) out.push(`holds for property ${JSON.stringify(run.property)}, not ${JSON.stringify(property)}`)
  if (run.verifier !== verifier) out.push(`holds by verifier ${JSON.stringify(run.verifier)}, not ${JSON.stringify(verifier)}`)
  const path = typeof model === "string" ? modelPath(ctx.root, model) : null
  if (run.model !== model) out.push(`holds on model ${run.model}, not ${String(model)}`)
  else if (path && existsSync(path) && run.modelSha256 !== sha256(path)) out.push("holds on a model that has changed since")
  if ((run.optionsSha256 ?? optionsHash({})) !== optionsHash(optionsOf(item))) out.push("holds with other verifierOptions than it has now")
  if (run.inputs) {
    if (run.inputsSha256 !== digestOf(run.inputs, run.toolVersion)) out.push("its run record's digest does not match the inputs and tool version it lists")
    const changed = run.inputs.filter((i) => i.path !== run.model).filter((i) => {
      const abs = modelPath(ctx.root, i.path)
      return !abs || !existsSync(abs) || sha256(abs) !== i.sha256
    })
    if (changed.length) out.push(`holds on inputs that have changed since: ${changed.map((i) => i.path).join(", ")}`)
  }
  return out
}

/**
 * What only the adapter can say about a run: whether the files the model reads
 * now are the ones it read, and whether the tool is the version that ran.
 * Asking may start the tool, so it runs in `check`, not in a write hook; an
 * adapter that cannot answer leaves a note.
 */
async function toolStaleness(ctx: Context, item: Item, run: RunRecord, findings: Finding[]): Promise<string[]> {
  const verifier = typeof item.meta["verifier"] === "string" ? verifierOf(ctx, item.meta["verifier"]) : undefined
  const path = typeof item.meta["model"] === "string" ? modelPath(ctx.root, item.meta["model"]) : null
  if (!verifier || !path || !existsSync(path) || typeof item.meta["property"] !== "string") return []
  const out: string[] = []
  const request = { model: path, property: item.meta["property"], options: optionsOf(item) }
  try {
    const now = await inputsOf(ctx, verifier, item, request)
    const was = (run.inputs ?? [{ path: run.model }]).map((i) => i.path)
    if (canonical(now) !== canonical(was)) out.push(`holds on inputs ${was.join(", ")}, but the model now reads ${now.join(", ")}`)
    if (verifier.version) {
      const version = await verifier.version(ctx)
      if (version !== run.toolVersion) {
        out.push(
          `holds by ${run.toolVersion === undefined ? "an unrecorded tool version" : `tool version ${JSON.stringify(run.toolVersion)}`}, not ${
            JSON.stringify(version)
          }`,
        )
      }
    }
  } catch (e) {
    findings.push({
      level: "note",
      item,
      message: `${label(item)}: verifier "${verifier.id}" could not say what the model reads or its version: ${e instanceof Error ? e.message : String(e)}`,
    })
  }
  return out
}

/** The trait of a type whose items are changes to the work: a bug, a todo, a feature, an archived one (the trackers plugin's). */
const CHANGE = "fixable"

/** The changes `item` proves: what it verifies or satisfies that is a change. */
const changesProved = (ctx: Context, item: Item): Item[] =>
  [...new Set([...linked(ctx, item, "verifies"), ...linked(ctx, item, "satisfies")])].filter((c) => hasTrait(ctx, c, CHANGE))

/** What a run's verdict speaks for, in one value: the digest over every input and the tool's version, or the model's alone in a run recorded before it. */
const readOn = (run: RunRecord): string => run.inputsSha256 ?? run.modelSha256

const failedFirst: Check = {
  name: "property-failed-first",
  says:
    "a property that holds and proves a change — it verifies or satisfies a bug, a todo or a feature — also carries a violated run of the same property, with its counterexample, on other inputs than those it holds on: the model before the change. A note, naming the property as its subject, so it can be waived with a reason",
  run(ctx) {
    const out: Finding[] = []
    for (const item of properties(ctx)) {
      if (item.meta.status !== "holds" || developing(ctx, item.meta["model"])) continue
      const changes = changesProved(ctx, item)
      const now = readRun(item)
      if (!changes.length || now?.verdict !== "holds") continue
      const red = runsOf(item).filter((k) =>
        k.run.verdict === "violated" && k.run.verifier === now.verifier && k.run.property === now.property && readOn(k.run) !== readOn(now)
      )
      if (red.some((k) => (k.run.counterexample ?? "").trim())) continue
      const subject = label(item)
      const what = red.length
        ? `its violated run on the model before the change (${red.map((k) => k.name).join(", ")}) kept no counterexample`
        : "no violated run of it on the model before the change is recorded"
      out.push({
        level: "note",
        item,
        subject,
        message: `${subject} holds and proves ${changes.map(label).join(", ")}, and ${what} — run naima verify on that model and keep its counterexample, ` +
          `or waive it with the reason: naima waive property-failed-first ${subject} --reason "<why>"`,
      })
    }
    return out
  },
}

const WITNESSES = "witnesses"
const WITNESSED_BY = "witnessed-by"

const witnessed: Check = {
  name: "property-witnessed",
  says:
    "a property that holds and proves a change is backed by a witness property that holds — one linked to it by witnesses, showing the new behaviour is reachable, so the property does not hold only because the situation never arises. A note, naming the property as its subject, so it can be waived with a reason; a witnesses link with an item that is not a property at either end is noted too",
  run(ctx) {
    const out: Finding[] = []
    for (const item of properties(ctx)) {
      if (item.meta.status !== "holds" || developing(ctx, item.meta["model"])) continue
      const changes = changesProved(ctx, item)
      if (!changes.length) continue
      const witnesses = linked(ctx, item, WITNESSED_BY).filter((w) => w.type === TYPE)
      if (witnesses.some((w) => w.meta.status === "holds")) continue
      const subject = label(item)
      const what = witnesses.length
        ? `none of its witnesses holds: ${witnesses.map((w) => `${label(w)} [${w.meta.status}]`).join(", ")} — run naima verify on them`
        : `no witness property backs it — file one that shows the new behaviour is reachable and link it (naima link <witness> ${WITNESSES} ${item.slug})`
      out.push({
        level: "note",
        item,
        subject,
        message: `${subject} proves ${
          changes.map(label).join(", ")
        }, and ${what}, or waive it with the reason: naima waive property-witnessed ${subject} --reason "<why>"`,
      })
    }
    for (const item of ctx.repo.items) {
      for (const l of storedLinks(item.meta)) {
        if (l.rel !== WITNESSES && l.rel !== WITNESSED_BY) continue
        const other = ctx.repo.byId.get(l.id)
        if (!other) continue
        const odd = [item, other].filter((i) => i.type !== TYPE)
        if (odd.length) {
          out.push({
            level: "note",
            item,
            message: `${label(item)} ${l.rel} ${label(other)}, and ${odd.map(label).join(" and ")} ${
              odd.length > 1 ? "are" : "is"
            } not a property: ${WITNESSES} links a witness property to the property it backs`,
          })
        }
      }
    }
    return out
  },
}

/** What a run was reached on: change any of them and the run no longer speaks for the property. */
const RUN_INPUTS = ["property", "model", "verifier", VERIFIER_OPTIONS.name] as const

const reopenOnChange: WriteHook = {
  name: "property-reopens-when-changed",
  says:
    "changing a property's property, model, verifier or verifierOptions sets its status back to open: the last run was reached on something else, and says nothing about it",
  beforeWrite(write) {
    const { item, before } = write
    if (write.kind !== "update" || item.type !== TYPE || !before) return
    if (RUN_INPUTS.some((f) => canonical(item.meta[f]) !== canonical(before[f]))) item.meta.status = "open"
  },
}

const holdsByVerifyOnly: WriteHook = {
  name: "holds-only-by-verify",
  says:
    "a property becomes holds only with a run that holds for exactly what it has now, as naima verify writes it; holds set by hand without one — naima set, naima new --set — is refused",
  beforeWrite(write, ctx) {
    const { item, before } = write
    if (write.kind === "move" || item.type !== TYPE || item.meta.status !== "holds" || before?.status === "holds") return
    const run = before ? readRun(item) : null // a new item has no attachments yet, so no run
    if (run?.verdict === "holds" && staleness(ctx, item, run).length === 0) return
    return `${label(item)}: holds is written by naima verify, with the run that proves it — run naima verify ${item.slug}`
  },
}

const leavesDevelopmentProved: WriteHook = {
  name: "leaves-development-proved",
  says:
    "a model leaves development (its models item becomes stable, or is created stable) only when at least one property is verified on it and every one holds on a run of exactly what it has now; refused otherwise, naming each property that does not",
  beforeWrite(write, ctx) {
    const { item, before } = write
    if (write.kind === "move" || item.type !== MODELS || item.meta.status !== STABLE || before?.status === STABLE) return
    const model = item.meta["model"]
    if (typeof model !== "string") return `${label(item)}: set model, the path of the model from the project root, before it leaves development`
    const ours = properties(ctx).filter((p) => sameModel(ctx, p.meta["model"], model))
    if (!ours.length) {
      return `${label(item)}: no property is verified on ${model}, so nothing shows it out of development — file its properties and verify them first`
    }
    const whys = ours.flatMap((p) => notCurrent(ctx, p))
    if (whys.length) return `${label(item)} cannot leave development: ${whys.join("; ")} — naima verify each, then set it stable again`
  },
}

const modelDevelopment: Check = {
  name: "model-development",
  says:
    "every models item names one model, and no two name the same; a stable model whose property does not hold on a run of what it has now is noted, since it either needs verifying or is in development again",
  run(ctx) {
    const out: Finding[] = []
    const models = ctx.repo.items.filter((i) => i.type === MODELS)
    for (const [n, m] of models.entries()) {
      const model = m.meta["model"]
      if (typeof model !== "string") {
        out.push({ level: "problem", item: m, message: `${label(m)} names no model — naima set ${m.slug} model=<path from the project root>` })
        continue
      }
      const twin = models.slice(n + 1).find((o) => sameModel(ctx, o.meta["model"], model))
      if (twin) out.push({ level: "problem", item: m, message: `${label(m)} and ${label(twin)} name one model, ${model} — keep one` })
      if (m.meta.status !== STABLE) continue
      const whys = properties(ctx).filter((p) => sameModel(ctx, p.meta["model"], model)).flatMap((p) => notCurrent(ctx, p))
      if (whys.length) {
        out.push({
          level: "note",
          item: m,
          message: `${label(m)} is stable, and not every property of it holds now: ${
            whys.join("; ")
          } — naima verify them, or set ${m.slug} status=${DEVELOPMENT} while the model changes`,
        })
      }
    }
    return out
  },
}

const allHold: Gate = {
  name: "properties",
  title: "Every property holds",
  says: "no property item is open, violated or in error",
  decides: "blocked by every properties item whose status is not holds; nothing is owed.",
  evaluate(ctx) {
    const blocking = properties(ctx).filter((i) => i.meta.status !== "holds")
    return { holds: blocking.length === 0, blocking, owed: [] }
  },
}

export default function verifier(): Plugin {
  return {
    name: "verifier",
    contract: CONTRACT,
    says: "properties checked by formal-methods tools, with each run attached as evidence",
    about:
      "A `properties` item names a `verifier` (an adapter any plugin can contribute), a `model` file (a path from the project root) and a `property` in the verifier's own language. " +
      "`naima verify` runs the adapter and attaches the run — verdict, output, the adapter's `details` of how it reached the verdict when it gives them, the model's sha256, and one digest over every file the run read (the model and what the adapter's `inputs` says it includes) and the tool's version (the adapter's `version`) — and the counterexample as its own file, then sets the status from the verdict. " +
      'A conclusive run (holds or violated) already recorded on the property with the same identity — verifier, model, property, `verifierOptions`, and the one digest over every input and the tool\'s version — is reused instead of repeated: `naima verify` says `reused` and names the run, and `--force "<reason>"` runs it again, keeping the reason with the new run. An error is never reused. Every run is kept, two made in the same instant included. ' +
      "A property that holds is evidence exactly as a passed test is: it can `verify` a bug and close it. A verdict is only as good as what it was reached on, so `naima check` fails when a property claims to hold and its property, verifier, model path, `verifierOptions`, model contents, any file it includes, the set of files it reads, or the tool's version have changed since the run. " +
      "A property that holds and proves a change — it verifies or satisfies a bug, a todo or a feature — is expected to carry a violated run of the same property, with its counterexample, on other inputs (`property-failed-first`), and to be backed by a witness property that holds, linked by `witnesses` (`property-witnessed`); both are notes that name the property, so either can be waived with its reason. " +
      "A `models` item marks a model, by its path in `model`, as in development: while it is, the staleness of its properties is a note rather than a problem and the two change checks ask nothing of them; it leaves development (status `stable`) only when every property verified on it holds on a run of exactly what it has now. " +
      "The shipped adapter, `example-regex`, is a stand-in that shows the shape of a real one; the opt-in `verifier-mcrl2` and `verifier-voxlogica` plugins contribute the real ones.",
    types: [
      {
        id: TYPE,
        dir: "properties",
        title: "Properties",
        says: "a property of the software, proven or refuted by a verifier",
        statuses: {
          open: { category: "open", says: "not yet verified" },
          holds: { category: "done", proves: true, says: "the last run on the current model holds" },
          violated: { category: "open", refutes: true, says: "the last run found a counterexample" },
          error: { category: "open", says: "the last run could not reach a verdict" },
        },
        initialStatus: "open",
        template,
      },
      {
        id: MODELS,
        dir: "models",
        title: "Models",
        says: "a model, or another artefact properties are verified on, named by its path in model: whether it is in development",
        statuses: {
          [DEVELOPMENT]: {
            category: "open",
            says:
              "changed across several landings: its properties' results are informational, their staleness a note, and the change checks ask nothing of them",
          },
          [STABLE]: { category: "done", says: "out of development: every property of the model held on a run of what it had when it left" },
        },
        initialStatus: DEVELOPMENT,
        template: modelTemplate,
      },
    ],
    fields: [
      { name: "verifier", kind: "string", says: "the adapter that checks it", appliesTo: [TYPE] },
      { name: "model", kind: "string", says: "the model or specification file, from the project root, and inside it", appliesTo: [TYPE, MODELS] },
      { name: "property", kind: "string", says: "the property, in the verifier's own language", appliesTo: [TYPE] },
      { name: "lastRun", kind: "string", says: "the attachment holding the last run: a file name in the item's attachments/", appliesTo: [TYPE] },
      { name: "verifierOptions", kind: "object", says: "options handed to the verifier with the model and the property, as a JSON object", appliesTo: [TYPE] },
    ],
    points: [verifiersPoint],
    contributes: { verifiers: [exampleRegex], gates: [allHold] },
    // Its gate is there when a gates plugin is: without one, nothing lists gates.
    optional: ["gates"],
    relations: [
      { name: WITNESSES, inverse: WITNESSED_BY, says: "is a witness property, showing that the behaviour is reachable, for" },
      { name: WITNESSED_BY, inverse: WITNESSES, says: "is backed by the witness property" },
    ],
    checks: [evidence, failedFirst, witnessed, modelDevelopment],
    commands: [verify, verifiers],
    hooks: [reopenOnChange, holdsByVerifyOnly, leavesDevelopmentProved],
  }
}
