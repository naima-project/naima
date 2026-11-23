// The studies of a project, for the Models tab (develop/models-tab.md §2 and §3): a study is declared by a `%@ui begin` …
// `%@ui end` block in a `.mcrl2` file of the project, tracked or not yet ignored, and explained by its `%@say` lines. The
// stepper, observer and view it names are served from the declaring file's folder; the model it names is only read.
// The block may also declare what the tab's workbench needs (develop/models-tab.md §15): the folder of its property
// files, the specification they are checked on, and the commands that build the study and run its program.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { dirname, isAbsolute, join, relative, resolve } from "node:path"
import { gitPath, projectFiles } from "../../core/api.ts"
import { defaultStudies } from "./models.ts"

export interface SayLine {
  file: string
  line: number
  text: string
}

export interface Study {
  /** A slug of the declaring file's project-relative path. */
  id: string
  /**
   * Declared by a `%@ui` block, or a default study (models.ts): a naima-codegen project (its declaring file is its
   * codegen.toml) or a plain whole specification (its declaring file is itself).
   */
  kind: "declared" | "codegen" | "plain"
  /** The folder the list groups it under, relative to the project. */
  folder: string
  /** A naima-codegen project's generated TypeScript module, relative to its folder, or null: what its default study steps. */
  typescript: string | null
  /** How many values each id sort of its instance takes (`% @items 2`), for stepping its generated code. */
  sizes: Record<string, number>
  /** The declaring file, relative to the project, with forward slashes. */
  file: string
  title: string
  says: string
  /** Two or three sentences shown as the study's opening line, dismissible: what the machine is and why it matters. */
  intro: string
  /** The `%@situation <condition>: "<text>"` lines: what to say about the state the road has reached, or the step just taken. */
  situations: { when: string; text: string; line: number }[]
  /** The model's path relative to the project, or null. */
  model: string | null
  /** The paths below are relative to the declaring file's folder, with forward slashes. */
  stepper: string | null
  observer: string | null
  view: string | null
  config: Record<string, number | boolean>
  /** The named standard diagrams its view draws, as declared (`name: what it maps; …`); the tab checks the names. */
  diagrams: string
  /** The view's parts, each a card of its own (`id: title; …`); empty when the view is one card. */
  parts: { id: string; title: string }[]
  /** The folder of the study's saved paths (relative to the declaring file), or null: counterexamples, test paths, runs. */
  paths: string | null
  /** The property files (`.mcf`) of the folder `properties` names, relative to the declaring file's folder; empty when none. */
  properties: string[]
  /** The mCRL2 specification the properties are checked on, relative to the declaring file's folder, or null. */
  system: string | null
  /** Whether the declaring file's folder holds a naima-codegen project (`codegen.toml`): Generate runs naima-codegen there. */
  codegen: boolean
  /** The command that builds the study after a generation, and the one that runs its program, for this platform; null when not declared. */
  build: string | null
  run: string | null
  says_lines: SayLine[]
  /**
   * What each state variable is, in its author's words: the comment beside each parameter of the model's process, with
   * the section it is under; a `%@state <name>: "<text>"` line of the declaring file adds or replaces one.
   */
  state_notes: { name: string; section: string; note: string }[]
  /** Why the study cannot open, or is not as declared; empty when it is sound. */
  problems: string[]
}

const KEYS = [
  "title",
  "model",
  "stepper",
  "observer",
  "view",
  "config",
  "says",
  "intro",
  "diagrams",
  "parts",
  "paths",
  "properties",
  "system",
  "build",
  "build-windows",
  "run",
  "run-windows",
]
const BEGIN = /^%@ui\s+begin\s*$/
const END = /^%@ui\s+end\s*$/

/** The id of the study a file declares: lowercase letters, digits and dashes. */
export const studyId = (file: string): string => file.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")

const inside = (dir: string, rel: string): string | null => {
  if (!rel || isAbsolute(rel) || rel.includes("\u0000")) return null
  const full = resolve(dir, rel)
  const r = relative(dir, full)
  return r === "" || r.startsWith("..") || isAbsolute(r) ? null : full
}

const isFile = (p: string): boolean => {
  try {
    return statSync(p).isFile()
  } catch {
    return false
  }
}

const read = (p: string): string | null => {
  try {
    return readFileSync(p, "utf8")
  } catch {
    return null
  }
}

const saysIn = (file: string, text: string): SayLine[] => {
  const out: SayLine[] = []
  text.split(/\r?\n/).forEach((l, i) => {
    if (/^\s*%@say(\s|$)/.test(l)) {
      out.push({ file, line: i + 1, text: l.trim() })
    }
  })
  return out
}

/** The study a file declares, or null when it holds no `%@ui begin` line. */
function studyOf(root: string, file: string, text: string): Study | null {
  const lines = text.split(/\r?\n/)
  const begin = lines.findIndex((l) => BEGIN.test(l.trim()))
  if (begin < 0) return null
  const study: Study = {
    id: studyId(file),
    kind: "declared",
    folder: gitPath(dirname(file)),
    typescript: null,
    sizes: {},
    file,
    title: file,
    says: "",
    diagrams: "",
    parts: [],
    paths: null,
    properties: [],
    system: null,
    codegen: false,
    build: null,
    run: null,
    model: null,
    stepper: null,
    observer: null,
    view: null,
    config: {},
    says_lines: saysIn(file, text),
    intro: "",
    situations: situationsIn(text),
    state_notes: [],
    problems: [],
  }
  const dir = join(root, dirname(file))
  const values: Record<string, string> = {}
  let closed = false
  for (let n = begin + 1; n < lines.length; n++) {
    const l = lines[n]!.trim()
    if (END.test(l)) {
      closed = true
      break
    }
    if (l === "") continue
    const m = /^%\s+([A-Za-z][A-Za-z-]*)(?:\s+(.*))?$/.exec(l)
    if (!m) {
      if (/^%\s*$/.test(l)) continue
      study.problems.push(
        `line ${n + 1} of the %@ui block is not a "% key value" line`,
      )
      return study
    }
    const key = m[1]!.toLowerCase()
    if (!KEYS.includes(key)) {
      study.problems.push(`unknown key ${key} (line ${n + 1})`)
    } else values[key] = key === "intro" && values[key] ? `${values[key]} ${(m[2] ?? "").trim()}` : (m[2] ?? "").trim()
  }
  if (!closed) study.problems.push("the %@ui block has no %@ui end line")
  if (values["title"]) study.title = values["title"]
  study.says = values["says"] ?? ""
  study.intro = values["intro"] ?? ""
  study.diagrams = values["diagrams"] ?? ""
  for (
    const part of (values["parts"] ?? "").split(";").map((p) => p.trim())
      .filter(Boolean)
  ) {
    const m = /^([a-z][a-z0-9-]*)\s*:\s*(.+)$/.exec(part)
    if (!m) study.problems.push(`the part ${part} is not "id: title"`)
    else study.parts.push({ id: m[1]!, title: m[2]!.trim() })
  }
  for (const part of (values["config"] ?? "").split(/\s+/).filter(Boolean)) {
    const eq = /^([A-Za-z_][A-Za-z0-9_]*)=(.+)$/.exec(part)
    const v = eq?.[2]
    if (
      !eq || !(v === "true" || v === "false" || (/^-?\d+(\.\d+)?$/.test(v!)))
    ) {
      study.problems.push(
        `config entry ${part} is not name=number or name=true/false`,
      )
      continue
    }
    study.config[eq[1]!] = v === "true" ? true : v === "false" ? false : Number(v)
  }
  for (const key of ["stepper", "observer", "view"] as const) {
    const rel = values[key]
    if (!rel) {
      if (key === "stepper") study.problems.push("no stepper is declared")
      continue
    }
    const full = inside(dir, rel)
    if (full === null) {
      study.problems.push(
        `the ${key} ${rel} is outside the declaring file's folder`,
      )
      continue
    }
    study[key] = gitPath(relative(dir, full))
    if (!isFile(full)) {
      study.problems.push(`the ${key} file ${rel} does not exist`)
    }
  }
  if (values["paths"]) {
    const full = inside(dir, values["paths"])
    if (full === null) {
      study.problems.push(
        `the paths folder ${values["paths"]} is outside the declaring file's folder`,
      )
    } else study.paths = gitPath(relative(dir, full))
  }
  if (values["properties"]) {
    const full = inside(dir, values["properties"])
    if (full === null) {
      study.problems.push(
        `the properties folder ${values["properties"]} is outside the declaring file's folder`,
      )
    } else {
      try {
        study.properties = readdirSync(full).filter((f) => f.endsWith(".mcf"))
          .sort().map((f) => gitPath(relative(dir, join(full, f))))
      } catch {
        study.problems.push(
          `the properties folder ${values["properties"]} does not exist`,
        )
      }
    }
  }
  if (values["system"]) {
    const full = inside(dir, values["system"])
    if (full === null) {
      study.problems.push(
        `the system ${values["system"]} is outside the declaring file's folder`,
      )
    } else study.system = gitPath(relative(dir, full))
  }
  study.codegen = isFile(join(dir, "codegen.toml"))
  const windows = process.platform === "win32"
  for (const key of ["build", "run"] as const) {
    const v = (windows ? values[`${key}-windows`] : undefined) ?? values[key]
    study[key] = v ? v : null
  }
  const model = values["model"]
  if (model) {
    const full = resolve(dir, model)
    const r = relative(root, full)
    if (isAbsolute(model) || r.startsWith("..") || isAbsolute(r)) {
      study.problems.push(`the model ${model} is outside the project`)
    } else {
      study.model = gitPath(r)
      const modelText = study.model === file ? null : read(full)
      if (modelText !== null) {
        study.says_lines.push(...saysIn(study.model, modelText))
        study.situations.push(...situationsIn(modelText, study.model))
        study.state_notes = stateNotes(modelText)
      } else if (study.model !== file && !existsSync(full)) {
        study.problems.push(`the model file ${model} does not exist`)
      }
    }
  }
  // The declaring file's own notes on the state: added, or replacing the model's.
  for (
    const m of text.matchAll(
      /^%@state\s+([A-Za-z_][\w']*)\s*:\s*"((?:[^"\\]|\\.)*)"\s*$/gm,
    )
  ) {
    const at = study.state_notes.findIndex((n) => n.name === m[1])
    const note = {
      name: m[1]!,
      section: at >= 0 ? study.state_notes[at]!.section : "",
      note: m[2]!.replace(/\\(.)/g, "$1"),
    }
    if (at >= 0) study.state_notes[at] = note
    else study.state_notes.push(note)
  }
  return study
}

/**
 * The parameters of a model's process and their comments, read from its source: the first `proc <Name>(` with
 * parameters, one per line as `name: Sort, % comment`, and `% <section>` lines between them. A model written otherwise
 * gives no notes, which only leaves the state's rows without words.
 */
export function stateNotes(
  text: string,
): { name: string; section: string; note: string }[] {
  const out: { name: string; section: string; note: string }[] = []
  const lines = text.split(/\r?\n/)
  const start = lines.findIndex((l) =>
    /^proc\s+\w+\s*\(\s*$/.test(l.trim()) ||
    /^proc\s+\w+\s*\(\s*%/.test(l.trim())
  )
  if (start < 0) return out
  let section = ""
  for (let i = start + 1; i < lines.length; i++) {
    const l = lines[i]!.trim()
    if (/^\)\s*=/.test(l)) break
    const sec = /^%\s*(.+)$/.exec(l)
    if (sec) {
      section = sec[1]!.trim()
      continue
    }
    const p = /^([A-Za-z_][\w']*)\s*:[^%]*?(?:%\s*(.*))?$/.exec(l)
    if (p) out.push({ name: p[1]!, section, note: (p[2] ?? "").trim() })
  }
  return out
}

/**
 * Every study of the project at `root`: the declared ones, in the order of their files, then every other model in a
 * default study (models.ts); `program` is Naima's own folder, left out; `tracker` adds its property items' formulas.
 */
export function findStudies(root: string, program?: string, tracker?: string): Study[] {
  const declared = declaredStudies(root, program)
  return [...declared, ...defaultStudies(root, program, declared, tracker)]
}

/** The notes on a model's state: the comments beside its process's parameters, replaced or added to by its `%@state` lines. */
export function stateNotesOf(text: string): { name: string; section: string; note: string }[] {
  const notes = stateNotes(text)
  for (const m of text.matchAll(/^%@state\s+([A-Za-z_][\w']*)\s*:\s*"((?:[^"\\]|\\.)*)"\s*$/gm)) {
    const at = notes.findIndex((n) => n.name === m[1])
    const note = { name: m[1]!, section: at >= 0 ? notes[at]!.section : "", note: m[2]!.replace(/\\(.)/g, "$1") }
    if (at >= 0) notes[at] = note
    else notes.push(note)
  }
  return notes
}

/**
 * The `% key value` lines of a file's `%@ui` block, or null when it has none. A block that declares no stepper does not
 * declare a study of its own: it words the model's default study (models.ts), its title, its says and its properties.
 */
export function blockValues(text: string): Record<string, string> | null {
  const lines = text.split(/\r?\n/)
  const begin = lines.findIndex((l) => BEGIN.test(l.trim()))
  if (begin < 0) return null
  const out: Record<string, string> = {}
  for (const l of lines.slice(begin + 1)) {
    if (END.test(l.trim())) break
    if (l.trim() === "" || /^%\s*$/.test(l.trim())) continue
    const m = /^%\s+([A-Za-z][A-Za-z-]*)(?:\s+(.*))?$/.exec(l.trim())
    if (!m || !KEYS.includes(m[1]!.toLowerCase())) return null
    const key = m[1]!.toLowerCase()
    out[key] = key === "intro" && out[key] ? `${out[key]} ${(m[2] ?? "").trim()}` : (m[2] ?? "").trim()
  }
  return out
}

/** The `%@situation <condition>: "<text>"` lines of a file (see the guide's write-a-study-by-hand, section 7b). */
export function situationsIn(text: string, _file?: string): { when: string; text: string; line: number }[] {
  const out: { when: string; text: string; line: number }[] = []
  text.split(/\r?\n/).forEach((l, i) => {
    const m = /^\s*%@situation\s+(.+?)\s*:\s*"((?:[^"\\]|\\.)*)"\s*$/.exec(l)
    if (m) out.push({ when: m[1]!.trim(), text: m[2]!.replace(/\\(.)/g, "$1"), line: i + 1 })
  })
  return out
}

/**
 * What a block with no stepper says of its study's default study: its title, says, intro, situations, and the observer,
 * view, parts and diagrams of an explanation view. Paths are relative to the study's folder and must stay inside it.
 */
export function applyWords(study: Study, root: string, block: Record<string, string> | null, text: string): void {
  study.situations = situationsIn(text)
  if (!block) return
  if (block["title"]) study.title = block["title"]
  if (block["says"]) study.says = block["says"]
  study.intro = block["intro"] ?? ""
  study.diagrams = block["diagrams"] ?? ""
  const dir = join(root, dirname(study.file))
  for (const key of ["observer", "view"] as const) {
    const rel = block[key]
    if (!rel) continue
    const full = inside(dir, rel)
    if (full === null) study.problems.push(`the ${key} ${rel} is outside the study's folder`)
    else if (!isFile(full)) study.problems.push(`the ${key} file ${rel} does not exist`)
    else study[key] = gitPath(relative(dir, full))
  }
  for (const part of (block["parts"] ?? "").split(";").map((p) => p.trim()).filter(Boolean)) {
    const m = /^([a-z][a-z0-9-]*)\s*:\s*(.+)$/.exec(part)
    if (m) study.parts.push({ id: m[1]!, title: m[2]!.trim() })
    else study.problems.push(`the part ${part} is not "id: title"`)
  }
}

/** A well-formed block with no stepper in a whole specification or a naima-codegen core: it words a default study. */
export function wordsOnly(file: string, text: string): boolean {
  const block = blockValues(text)
  if (!block || block["stepper"] !== undefined) return false
  return /(^|\/)core\.mcrl2$/.test(file) || text.split(/\r?\n/).some((l) => /^\s*init\b/.test(l.replace(/%.*$/, "")))
}

/** The studies a `%@ui` block declares, in the order of their files. */
export function declaredStudies(root: string, program?: string): Study[] {
  const out: Study[] = []
  for (const file of projectFiles(root, program)) {
    if (!file.toLowerCase().endsWith(".mcrl2")) continue
    const text = read(join(root, file))
    if (text === null || !/^%@ui\s+begin\s*$/m.test(text)) continue
    if (wordsOnly(file, text)) continue
    const s = studyOf(root, file, text)
    if (s) out.push(s)
  }
  return out
}

/** The folder, absolute, of the files of the study `id`: its declaring file's, or null when there is no such study. */
export function studyFolder(
  root: string,
  program: string | undefined,
  id: string,
): string | null {
  const s = declaredStudies(root, program).find((x) => x.id === id) ?? findStudies(root, program).find((x) => x.id === id)
  return s ? join(root, dirname(s.file)) : null
}

/** A saved path of a study: its file's name, where it comes from, and its text, which the tab loads. */
export interface SavedPath {
  name: string
  /** Where it was found, from its file's first `% origin: …` line: the model checker, a test, model-based testing, a proof. */
  origin: string
  text: string
}

/**
 * The saved paths of a study: every `.trace` (one label per line, as mCRL2's tracepp prints a counterexample) and `.json`
 * (the tab's own path) file of its paths folder, which must be inside the declaring file's folder.
 */
export function savedPaths(root: string, study: Study): SavedPath[] {
  if (!study.paths) return []
  const dir = resolve(root, dirname(study.file))
  const folder = resolve(dir, study.paths)
  const r = relative(dir, folder)
  if (
    r.startsWith("..") || isAbsolute(r) || !existsSync(folder) ||
    !statSync(folder).isDirectory()
  ) return []
  const out: SavedPath[] = []
  for (const name of readdirSync(folder).sort()) {
    if (!/\.(trace|json)$/.test(name)) continue
    const text = readFileSync(join(folder, name), "utf8")
    const m = /^%\s*origin\s*:\s*(.+)$/m.exec(text) ??
      /"origin"\s*:\s*"([^"]+)"/.exec(text)
    out.push({ name, origin: m ? m[1]!.trim() : "saved", text })
  }
  return out
}
