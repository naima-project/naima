// The Specs views of the new UI: the models a project's properties are checked on, and the properties themselves, read
// from the files as they are. Read only: nothing here runs a verifier or explores a state space.
//
// specs-models: every model area, a folder of develop/models (or wherever the properties' models are) that holds a
// model's sources: a naima-codegen project (a folder with codegen.toml, its generated systems and MANIFEST.json) or a
// plain mCRL2 model. For each: its files, what it is for (its opening comment), the sizes the last runs on it recorded,
// and for a codegen project the refinement the generator sets up (the model system and the refined one) with the checks
// of it the tracker records. With the parameter `file`, the text of one file inside an area.
//
// specs-properties: every property with its formula's text, its model, and what its last run recorded (the verdict,
// the state space's size, what was hidden, the counterexample when there is one), and the latest run with a
// counterexample even when a later run held.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { dirname, join, relative, resolve, sep } from "node:path"
import { ATTACHMENTS, type Context, type Item, label } from "../../core/api.ts"

/** What one recorded run says, in the shape the UI reads. */
export interface RunSummary {
  file: string
  verdict: string
  at: string
  /** The states and transitions of the state space explored, when the run recorded them. */
  states?: number
  transitions?: number
  /** The state space the property was decided on, after minimisation, and the equivalence used. */
  reduced?: { states?: number; transitions?: number; equivalence?: string; why?: string }
  /** The actions hidden before deciding, as recorded. */
  hidden?: string[]
  /** How long the run took, when recorded; else how long exploring the state space took. */
  seconds?: number
  secondsOf?: "run" | "exploration"
  commit?: string
  /** The counterexample as the verifier wrote it (an mCRL2 .aut text). */
  counterexample?: string
  route?: string
}

export interface PropertyRow {
  id: string
  ref: string
  title: string
  says?: string
  glosses?: Record<string, string>
  status: string
  verifier: string
  model: string
  property: string
  formula?: string
  area?: string
  runs: number
  last?: RunSummary
  /** The latest run that has a counterexample, when it is not the last. */
  failed?: RunSummary
}

export interface ModelFile {
  path: string
  role: "source" | "generated" | "formula" | "manifest" | "config" | "instance"
  bytes: number
}

export interface ModelSize {
  model: string
  at: string
  property: string
  states?: number
  transitions?: number
  reduced?: RunSummary["reduced"]
}

export interface RefinementCheck {
  ref: string
  title: string
  property: string
  verdict?: string
  at?: string
}

export interface ModelArea {
  path: string
  name: string
  kind: "codegen" | "plain"
  says: string
  /** The hand-written file whose opening comment `says` is, and which a reader opens first. */
  main?: string
  files: ModelFile[]
  sizes: ModelSize[]
  properties: number
  /** For a codegen project: what MANIFEST.json records. */
  manifest?: { systems: unknown; summands: unknown; typescript?: string }
  refinement?: {
    abstract: string
    refined: string
    observers?: string
    checks: RefinementCheck[]
    /** What the refinement item recorded for this pair, when one is: its sentence, relation and what it hides or renames. */
    says?: string
    relation?: string
    hidden?: string[]
    renamed?: Record<string, string>
    recorded?: string
  }
  /** Every refinement recorded with naima refine whose lower or upper model is in this area. */
  refinements: RecordedRefinement[]
}

/** A refinement item, as the Models screen reads it. */
export interface RecordedRefinement {
  ref: string
  lower: string
  upper: string
  relation?: string
  hidden?: string[]
  renamed?: Record<string, string>
  says?: string
}

/** Every refinement item. */
export function recordedRefinements(ctx: Context): RecordedRefinement[] {
  return ctx.repo.items.filter((i) => i.type === "refinements").map((i) => {
    const r: RecordedRefinement = { ref: label(i), lower: modelPath(i.meta["lower"]), upper: modelPath(i.meta["upper"]) }
    if (typeof i.meta["relation"] === "string") r.relation = i.meta["relation"]
    if (Array.isArray(i.meta["hidden"])) r.hidden = (i.meta["hidden"] as unknown[]).map(String)
    const ren = i.meta["renamed"]
    if (ren && typeof ren === "object" && !Array.isArray(ren)) r.renamed = ren as Record<string, string>
    if (typeof i.meta["says"] === "string") r.says = i.meta["says"]
    return r
  })
}

const RUN_FILE = /^run-.+\.json$/
const TEXT_KINDS = [".mcrl2", ".mcf", ".toml", ".json"]

const slash = (p: string) => p.split(sep).join("/")
const modelPath = (m: unknown) => String(m ?? "").split("#")[0]!.trim()

/** The comment a file opens with: its leading lines that start with `%` (mCRL2) or `#` (TOML), the generated header skipped. */
export function openingComment(text: string): string {
  const lines = text.split(/\r?\n/)
  const out: string[] = []
  let started = false
  let generated = false
  for (const raw of lines) {
    const t = raw.trim()
    const m = /^(%|#)\s?(.*)$/.exec(t)
    if (!m) {
      if (!t && !started) continue
      break
    }
    const body = m[2]!
    if (/^GENERATED (FILE|by)/.test(body)) generated = true
    if (generated) {
      // The generator's header ends at the line that says how to change the file, or at the first that is not its own.
      if (/^(naima-codegen generate, and commit|file name, the model's env)/.test(body) || /Do not edit\.$/.test(body)) generated = false
      continue
    }
    started = true
    out.push(body)
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim()
}

const readJson = (path: string): Record<string, unknown> | null => {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>
  } catch {
    return null
  }
}

const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined)

/** One run file, as the UI reads it. */
export function runSummary(file: string, r: Record<string, unknown>): RunSummary {
  const d = (r["details"] ?? {}) as Record<string, unknown>
  const lts = (d["lts"] ?? {}) as Record<string, unknown>
  const red = (d["reduced"] ?? null) as Record<string, unknown> | null
  const own = num(r["seconds"])
  const explored = num(lts["generationSeconds"])
  const out: RunSummary = { file, verdict: String(r["verdict"] ?? ""), at: String(r["at"] ?? "") }
  let states = num(lts["states"])
  let transitions = num(lts["transitions"])
  if (states === undefined && typeof r["output"] === "string") {
    // An older run recorded the size only in lps2lts's own line of its output.
    const m = /Done with state space generation \(\d+ levels?, (\d+) states? and (\d+) transitions?\)/.exec(r["output"])
    if (m) [states, transitions] = [Number(m[1]), Number(m[2])]
  }
  if (states !== undefined) out.states = states
  if (transitions !== undefined) out.transitions = transitions
  if (red) {
    out.reduced = {}
    const rs = num(red["states"]), rt = num(red["transitions"])
    if (rs !== undefined) out.reduced.states = rs
    if (rt !== undefined) out.reduced.transitions = rt
    if (typeof red["equivalence"] === "string") out.reduced.equivalence = red["equivalence"]
    if (typeof red["why"] === "string") out.reduced.why = red["why"]
  }
  if (Array.isArray(d["hidden"])) out.hidden = (d["hidden"] as unknown[]).map(String)
  if (own !== undefined) [out.seconds, out.secondsOf] = [own, "run"]
  else if (explored !== undefined) [out.seconds, out.secondsOf] = [explored, "exploration"]
  if (typeof r["commit"] === "string") out.commit = r["commit"]
  if (typeof r["counterexample"] === "string" && r["counterexample"].trim()) out.counterexample = r["counterexample"]
  if (typeof d["route"] === "string") out.route = d["route"]
  return out
}

/** The runs recorded on a property, oldest first, each with its file. */
function runsOf(item: Item): { file: string; run: Record<string, unknown> }[] {
  const dir = join(item.dir, ATTACHMENTS)
  if (!existsSync(dir)) return []
  return readdirSync(dir).filter((f) => RUN_FILE.test(f)).flatMap((f) => {
    const run = readJson(join(dir, f))
    return run && typeof run["at"] === "string" ? [{ file: f, run }] : []
  }).sort((a, b) => (String(a.run["at"]) < String(b.run["at"]) ? -1 : 1))
}

/** The model area a model file belongs to: the codegen project above a generated system, else the file's folder. */
export function areaOf(model: string): string {
  const p = modelPath(model)
  const g = p.indexOf("/generated/")
  if (g > 0) return p.slice(0, g)
  return dirname(p)
}

const inside = (root: string, p: string): boolean => {
  const r = relative(root, p)
  return r !== "" && !r.startsWith("..") && !r.startsWith(sep) && !/^[A-Za-z]:/.test(r)
}

/** The deepest folder every area is in: where the areas are looked for. */
function commonFolder(paths: string[]): string {
  if (!paths.length) return ""
  const split = paths.map((p) => p.split("/"))
  const out: string[] = []
  for (let i = 0;; i++) {
    const seg = split[0]![i]
    if (seg === undefined || !split.every((s) => s[i] === seg)) break
    out.push(seg)
  }
  return out.join("/")
}

/** Every file of an area, by its path from the project root, with its role. */
function filesOf(root: string, area: string, codegen: boolean): ModelFile[] {
  const out: ModelFile[] = []
  const walk = (rel: string, depth: number) => {
    let names: string[]
    try {
      names = readdirSync(join(root, rel)).sort()
    } catch {
      return
    }
    for (const n of names) {
      const r = `${rel}/${n}`
      let st
      try {
        st = statSync(join(root, r))
      } catch {
        continue
      }
      if (st.isDirectory()) {
        // A plain area's subfolders are areas of their own; a codegen project's are its parts.
        if (codegen && depth < 5) walk(r, depth + 1)
        continue
      }
      const ext = TEXT_KINDS.find((k) => n.endsWith(k))
      if (!ext) continue
      const gen = r.includes("/generated/")
      const role: ModelFile["role"] = n === "MANIFEST.json"
        ? "manifest"
        : gen
        ? "generated"
        : ext === ".mcf"
        ? "formula"
        : ext === ".toml"
        ? "config"
        : r.includes("/instances/")
        ? "instance"
        : "source"
      out.push({ path: r, role, bytes: st.size })
    }
  }
  walk(area, 0)
  return out
}

const isCodegen = (root: string, area: string) => existsSync(join(root, area, "codegen.toml"))

/** Every model area under `top`: a folder with codegen.toml, or one with an .mcrl2 file of its own. */
function areasUnder(root: string, top: string): string[] {
  const out: string[] = []
  const walk = (rel: string, depth: number) => {
    let names: string[]
    try {
      names = readdirSync(join(root, rel)).sort()
    } catch {
      return
    }
    if (names.includes("codegen.toml")) return void out.push(rel)
    if (names.some((n) => n.endsWith(".mcrl2"))) out.push(rel)
    if (depth >= 4) return
    for (const n of names) {
      if (n.startsWith(".")) continue
      try {
        if (statSync(join(root, rel, n)).isDirectory()) walk(`${rel}/${n}`, depth + 1)
      } catch {
        // gone between the listing and the look
      }
    }
  }
  walk(top, 0)
  return out
}

const propertiesOf = (ctx: Context, type: string) => ctx.repo.items.filter((i) => i.type === type)

/** The data of the specs-models view. */
export function modelsData(ctx: Context, type: string): { root: string; areas: ModelArea[] } {
  const props = propertiesOf(ctx, type)
  const named = props.map((p) => areaOf(String(p.meta["model"] ?? ""))).filter((a) => a && a !== ".")
  // The areas are looked for in the folder the properties' models share, one level up when they all share one area.
  let top = commonFolder([...new Set(named)])
  if (top && named.every((a) => a === top) && top.includes("/")) top = top.slice(0, top.lastIndexOf("/"))
  const found = top && existsSync(join(ctx.root, top)) ? areasUnder(ctx.root, top) : []
  const all = [...new Set([...found, ...named])].filter((a) => existsSync(join(ctx.root, a))).sort()
  const recorded = recordedRefinements(ctx)
  const areas = all.map((area): ModelArea => {
    const codegen = isCodegen(ctx.root, area)
    const files = filesOf(ctx.root, area, codegen)
    const mine = props.filter((p) => areaOf(String(p.meta["model"] ?? "")) === area)
    // The sizes: the latest run on each model file of the area.
    const latest = new Map<string, ModelSize>()
    for (const p of mine) {
      // The latest run on it that recorded the state space's size.
      const sized = runsOf(p).reverse().map((r) => ({ r, s: runSummary(r.file, r.run) })).find((x) => x.s.states !== undefined)
      if (!sized) continue
      const { r: last, s } = sized
      const m = modelPath(last.run["model"] ?? p.meta["model"])
      const was = latest.get(m)
      if (was && was.at >= s.at) continue
      const size: ModelSize = { model: m, at: s.at, property: label(p) }
      if (s.states !== undefined) size.states = s.states
      if (s.transitions !== undefined) size.transitions = s.transitions
      if (s.reduced) size.reduced = s.reduced
      latest.set(m, size)
    }
    let main: string | undefined
    let says = ""
    if (codegen) {
      main = files.find((f) => f.path === `${area}/model/core.mcrl2`)?.path
      // The Core's opening comment says what the machine does; the project's codegen.toml, how it is declared.
      says = (main ? openingComment(readFileSync(join(ctx.root, main), "utf8")) : "").replace(/^\S+\.mcrl2\s+--\s+/, "")
      if (!says) says = openingComment(readFileSync(join(ctx.root, area, "codegen.toml"), "utf8"))
    } else {
      const own = files.filter((f) => f.role === "source" && dirname(f.path) === area)
      main = (own.find((f) => f.path.endsWith(`/${area.split("/").pop()}.mcrl2`)) ?? own[0])?.path
      if (main) says = openingComment(readFileSync(join(ctx.root, main), "utf8"))
    }
    const out: ModelArea = {
      path: area,
      name: top && area.startsWith(top + "/") ? area.slice(top.length + 1) : area,
      kind: codegen ? "codegen" : "plain",
      says,
      files,
      sizes: [...latest.values()],
      properties: mine.length,
      refinements: recorded.filter((r) => [r.lower, r.upper].some((m) => m === area || m.startsWith(area + "/"))),
    }
    if (main) out.main = main
    if (codegen) {
      const manifest = readJson(join(ctx.root, area, "generated", "MANIFEST.json"))
      if (manifest) {
        const ts = Object.keys((manifest["files"] ?? {}) as Record<string, string>).find((f) =>
          /^typescript\/[^/]+\/[^/]+\.ts$/.test(f) && !f.endsWith(".svelte.ts")
        )
        out.manifest = { systems: manifest["systems"] ?? null, summands: manifest["summands"] ?? null }
        if (ts) out.manifest.typescript = ts.split("/")[1]!
      }
      const sys = `${area}/generated/model/systems`
      const abstract = files.find((f) => f.path.startsWith(sys) && /\/[a-z0-9-]+-model\.mcrl2$/.test(f.path))?.path
      const refined = files.find((f) => f.path.startsWith(sys) && /\/[a-z0-9-]+-refined\.mcrl2$/.test(f.path))?.path
      if (abstract && refined) {
        // The checks of the refinement the tracker records: a naima-codegen property on this project, or a property
        // whose formula is the generator's probe (the non-blocking check, decided on the probe system).
        const checks = props.filter((p) => {
          const m = modelPath(p.meta["model"])
          const f = String(p.meta["property"] ?? "")
          return (p.meta["verifier"] === "naima-codegen" && (m === `${area}/codegen.toml` || m === `${area}/model/codegen.toml`)) ||
            f === `${area}/generated/model/probe.mcf`
        }).map((p): RefinementCheck => {
          const last = runsOf(p).at(-1)
          const c: RefinementCheck = { ref: label(p), title: String(p.meta["title"] ?? ""), property: String(p.meta["property"] ?? "") }
          if (last) [c.verdict, c.at] = [String(last.run["verdict"] ?? ""), String(last.run["at"] ?? "")]
          return c
        })
        out.refinement = { abstract, refined, checks }
        const rec = recorded.find((r) => r.lower === refined && r.upper === abstract)
        if (rec) {
          out.refinement.recorded = rec.ref
          for (const k of ["says", "relation", "hidden", "renamed"] as const) if (rec[k] !== undefined) Object.assign(out.refinement, { [k]: rec[k] })
        }
        const obs = `${area}/model/observers.mcrl2`
        if (files.some((f) => f.path === obs)) out.refinement.observers = obs
      }
    }
    return out
  })
  return { root: top, areas }
}

/** The text of one file of a model area, refused for anything outside every area or of another kind. */
export function modelFile(ctx: Context, type: string, path: string): { path: string; text: string } {
  const p = slash(path).replace(/^\.\//, "")
  const abs = resolve(ctx.root, p)
  if (!inside(ctx.root, abs) || !TEXT_KINDS.some((k) => p.endsWith(k))) throw new Error(`${path} is not a model's file`)
  const { areas } = modelsData(ctx, type)
  if (!areas.some((a) => inside(resolve(ctx.root, a.path), abs))) throw new Error(`${path} is in no model's folder`)
  return { path: p, text: readFileSync(abs, "utf8") }
}

/** The data of the specs-properties view. */
export function propertiesData(ctx: Context, type: string): { properties: PropertyRow[] } {
  const formulas = new Map<string, string | undefined>()
  const formulaOf = (f: string): string | undefined => {
    if (!formulas.has(f)) {
      const abs = resolve(ctx.root, f)
      let text: string | undefined
      try {
        if (inside(ctx.root, abs) && statSync(abs).size < 64_000) text = readFileSync(abs, "utf8")
      } catch {
        text = undefined
      }
      formulas.set(f, text)
    }
    return formulas.get(f)
  }
  const properties = propertiesOf(ctx, type).map((p): PropertyRow => {
    const runs = runsOf(p)
    const model = modelPath(p.meta["model"])
    const property = String(p.meta["property"] ?? "")
    const row: PropertyRow = {
      id: String(p.meta["id"] ?? ""),
      ref: label(p),
      title: String(p.meta["title"] ?? ""),
      status: String(p.meta["status"] ?? ""),
      verifier: String(p.meta["verifier"] ?? ""),
      model,
      property,
      runs: runs.length,
    }
    if (typeof p.meta["says"] === "string" && p.meta["says"].trim()) row.says = p.meta["says"]
    const g = p.meta["glosses"]
    if (g && typeof g === "object" && !Array.isArray(g)) {
      // In the order they were written: a JSON object keeps its keys' order.
      row.glosses = Object.fromEntries(Object.entries(g as Record<string, unknown>).filter(([, v]) => typeof v === "string")) as Record<string, string>
    }
    if (property.endsWith(".mcf")) {
      const f = formulaOf(property)
      if (f !== undefined) row.formula = f
    }
    if (model) row.area = areaOf(model)
    const last = runs.at(-1)
    if (last) row.last = runSummary(last.file, last.run)
    const failed = [...runs].reverse().find((r) => typeof r.run["counterexample"] === "string" && String(r.run["counterexample"]).trim())
    if (failed && failed !== last) row.failed = runSummary(failed.file, failed.run)
    return row
  })
  return { properties }
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;")

/** The Models view of the Specs place. */
export const specsModelsView = (type: string) => ({
  name: "specs-models",
  title: "Models",
  order: 40,
  // The Specs place draws it as its Models screen: it is not also one of the UI's tabs.
  screen: true,
  says:
    "the models the properties are checked on: their files, what each is for, the sizes their runs recorded, and the refinements the generator sets up; with file=<path>, one file's text",
  render(params: Record<string, string[]>, ctx: Context) {
    const file = params["file"]?.[0]
    if (file) {
      const f = modelFile(ctx, type, file)
      return { data: { file: f }, html: `<pre>${esc(f.text)}</pre>` }
    }
    const d = modelsData(ctx, type)
    const html = d.areas.length
      ? `<ul>${d.areas.map((a) => `<li><code>${esc(a.name)}</code> ${esc(a.says.split("\n")[0] ?? "")}</li>`).join("")}</ul>`
      : "<p>No model is recorded yet.</p>"
    return { data: d, html }
  },
})

/** The Properties view of the Specs place. */
export const specsPropertiesView = (type: string) => ({
  name: "specs-properties",
  title: "Properties",
  order: 41,
  screen: true,
  says: "every property with its formula, its model and its last run: the verdict, the state space's size, and the counterexample when one was recorded",
  render(_params: Record<string, string[]>, ctx: Context) {
    const d = propertiesData(ctx, type)
    const html = d.properties.length
      ? `<table><tbody>${d.properties.map((p) => `<tr><td>${esc(p.title)}</td><td>${esc(p.last?.verdict ?? "not run")}</td></tr>`).join("")}</tbody></table>`
      : "<p>No property is recorded yet.</p>"
    return { data: d, html }
  },
})
