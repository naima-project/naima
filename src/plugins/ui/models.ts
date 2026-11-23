// Every mCRL2 model of a project, for the Models tab (develop/models-default-study.md §1): besides the studies a `%@ui`
// block declares (studies.ts), each naima-codegen project (a folder with a codegen.toml) and each other tracked `.mcrl2`
// file that is a whole specification (one with an init) opens in a default study, with the tab's cards and no view.
// Their properties are the `.mcf` files beside them, and the formulas of the project's property items that name the
// model or its system as theirs.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { basename, dirname, join, relative, resolve } from "node:path"
import { gitPath, projectFiles } from "../../core/api.ts"
import { applyWords, blockValues, situationsIn, wordsOnly, stateNotesOf, type Study, studyId } from "./studies.ts"

const read = (p: string): string | null => {
  try {
    return readFileSync(p, "utf8")
  } catch {
    return null
  }
}

const isDir = (p: string): boolean => {
  try {
    return statSync(p).isDirectory()
  } catch {
    return false
  }
}

const mcfIn = (dir: string, from: string): string[] => {
  try {
    return readdirSync(dir).filter((f) => f.endsWith(".mcf")).sort().map((f) => gitPath(relative(from, join(dir, f))))
  } catch {
    return []
  }
}

/** A whole specification: one with an init outside comments. */
export const isWhole = (text: string): boolean => text.split(/\r?\n/).some((l) => /^\s*init\b/.test(l.replace(/%.*$/, "")))

/** The first sentence of a text's leading comment lines (`%` in mCRL2, `#` in TOML), without the marker. */
export function headingOf(text: string, marker: "%" | "#"): string {
  const lines: string[] = []
  for (const l of text.split(/\r?\n/)) {
    const t = l.trim()
    if (!t.startsWith(marker)) {
      if (t === "" && lines.length === 0) continue
      break
    }
    const body = t.replace(/^[%#]+\s?/, "").trim()
    if (body.startsWith("@")) continue
    lines.push(body)
  }
  const joined = lines.join(" ").replace(/\s+/g, " ").trim()
  // A heading often opens with the file's name and a dash ("core.mcrl2 -- the …"): the words after it say what it is.
  // References in parentheses are left out of a title, as is a naima-codegen project's opening formula.
  const words = joined.replace(/^\S+\.(mcrl2|toml)\s+(--|—|-)\s+/, "").replace(/\s*\([^()]*\)/g, "")
  const end = /[.:;](\s|$)/.exec(words)
  let first = (end ? words.slice(0, end.index) : words).trim()
  first = first.replace(/^the interface declaration of (the )?/i, "").replace(/\s+and its project table$/, "")
  first = first.charAt(0).toUpperCase() + first.slice(1)
  return first.length > 160 ? first.slice(0, 157).trimEnd() + "…" : first
}

/** The first group of a codegen.toml's [systems.groups] table and its first instance: the system stepped and checked. */
export function firstGroup(toml: string): { group: string; instance: string | null } | null {
  const at = toml.search(/^\[systems\.groups\]\s*$/m)
  if (at < 0) return null
  for (const l of toml.slice(at).split(/\r?\n/).slice(1)) {
    if (/^\s*\[/.test(l)) break
    const m = /^\s*([A-Za-z0-9_-]+)\s*=\s*\[\s*"([^"]+)"/.exec(l)
    if (m) return { group: m[1]!, instance: m[2]! }
  }
  return null
}

/** The backends a codegen.toml chooses, and its TypeScript module's name when one is generated. */
export function typescriptOf(toml: string): string | null {
  const backends = /^\s*backends\s*=\s*\[([^\]]*)\]/m.exec(toml)?.[1] ?? ""
  if (!/"typescript"/.test(backends)) return null
  return /^\s*typescript_module\s*=\s*"([^"]+)"/m.exec(toml)?.[1] ?? null
}

/** The sizes an instance file declares (`% @items 2`): how many values each id sort takes. */
export function instanceSizes(text: string): Record<string, number> {
  const out: Record<string, number> = {}
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*%\s*@([a-z][a-z0-9_]*)\s+(\d+)\s*$/.exec(line)
    if (m) out[m[1]!] = Number(m[2])
  }
  return out
}

/** The property files of the project's open property items, by the model or system they name, from the root. */
export function propertyItems(tracker: string | undefined): Map<string, string[]> {
  const out = new Map<string, string[]>()
  if (!tracker) return out
  const dir = join(tracker, "properties")
  let names: string[]
  try {
    names = readdirSync(dir)
  } catch {
    return out
  }
  for (const name of names) {
    const text = read(join(dir, name, "meta.json"))
    if (!text) continue
    try {
      const meta = JSON.parse(text) as { model?: unknown; property?: unknown }
      if (typeof meta.model !== "string" || typeof meta.property !== "string" || !meta.property.endsWith(".mcf")) continue
      const list = out.get(meta.model) ?? []
      if (!list.includes(meta.property)) list.push(meta.property)
      out.set(meta.model, list)
    } catch {
      continue
    }
  }
  return out
}

const blank = (file: string, kind: "codegen" | "plain"): Study => ({
  id: studyId(file),
  file,
  kind,
  folder: gitPath(dirname(dirname(file))),
  title: file,
  says: "",
  intro: "",
  situations: [],
  diagrams: "",
  parts: [],
  paths: "paths",
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
  says_lines: [],
  state_notes: [],
  problems: [],
  typescript: null,
  sizes: {},
})

const saysIn = (file: string, text: string) => text.split(/\r?\n/).flatMap((l, i) => (/^\s*%@say(\s|$)/.test(l) ? [{ file, line: i + 1, text: l.trim() }] : []))

/**
 * The default studies of the project at `root`: its naima-codegen projects and its other whole specifications, those a
 * declared study already covers left out (its model, its system, or a codegen project holding its declaring file).
 */
export function defaultStudies(root: string, program: string | undefined, declared: readonly Study[], tracker?: string): Study[] {
  const files = projectFiles(root, program)
  const items = propertyItems(tracker)
  const covered = new Set<string>()
  const declaredDirs = new Set<string>()
  for (const s of declared) {
    covered.add(s.file)
    if (s.model) covered.add(s.model)
    if (s.system) covered.add(gitPath(relative(root, resolve(root, dirname(s.file), s.system))))
    declaredDirs.add(gitPath(dirname(s.file)))
  }
  const projects = files.filter((f) => basename(f) === "codegen.toml").map((f) => gitPath(dirname(f)))
  const inProject = (f: string) => projects.some((p) => f === p || f.startsWith(p + "/"))
  const fromRoot = (dir: string, rels: string[]) => rels.map((p) => gitPath(relative(dir, resolve(root, p))))
  const out: Study[] = []
  for (const dir of projects) {
    if ([...declaredDirs].some((d) => d === dir || d.startsWith(dir + "/"))) continue
    const toml = read(join(root, dir, "codegen.toml")) ?? ""
    const s = blank(`${dir}/codegen.toml`, "codegen")
    s.folder = gitPath(dirname(dir))
    s.title = headingOf(toml, "#") || basename(dir)
    s.codegen = true
    s.model = `${dir}/model/core.mcrl2`
    const core = read(join(root, s.model))
    if (core === null) s.problems.push("the project has no model/core.mcrl2")
    else {
      s.says_lines = saysIn(s.model, core)
      s.state_notes = stateNotesOf(core)
      const beside = files.filter((g) => g.endsWith(".mcrl2") && gitPath(dirname(g)) === dir && !g.endsWith("core.mcrl2"))
      const words = [s.model, ...beside].map((g) => ({ g, t: g === s.model ? core : read(join(root, g)) }))
        .find((x) => x.t !== null && wordsOnly(x.g, x.t))
      if (words) {
        s.says_lines.push(...(words.g === s.model ? [] : saysIn(words.g, words.t!)))
        applyWords(s, root, blockValues(words.t!), words.t!)
      }
    }
    const group = firstGroup(toml)
    if (group) {
      s.system = `generated/model/systems/${group.group}-refined.mcrl2`
      if (!existsSync(join(root, dir, s.system))) s.problems.push(`its system ${s.system} is not generated yet: Generate makes it`)
      const inst = group.instance ? read(join(root, dir, "model", "instances", `${group.instance}.mcrl2`)) : null
      if (inst) s.sizes = instanceSizes(inst)
    } else s.problems.push("its codegen.toml declares no [systems.groups]: there is no system to step or check")
    s.properties = mcfIn(join(root, dir, "model", "properties"), join(root, dir))
    const sys = s.system ? `${dir}/${s.system}` : null
    for (const m of [s.model, ...(sys ? [sys] : [])]) {
      for (const p of fromRoot(join(root, dir), items.get(m) ?? [])) if (!s.properties.includes(p)) s.properties.push(p)
    }
    const ts = typescriptOf(toml)
    if (ts && existsSync(join(root, dir, "generated", "typescript", ts, `${ts}.ts`))) s.typescript = `generated/typescript/${ts}/${ts}.ts`
    out.push(s)
  }
  // The models a words-only block of another file names are worded there, so they are not listed twice.
  const wordedBy = (f: string, text: string): string | null => {
    const block = /^%@ui\s+begin\s*$/m.test(text) ? blockValues(text) : null
    if (!block || block["stepper"] !== undefined || isWhole(text) || !block["model"]) return null
    const full = resolve(root, dirname(f), block["model"])
    const t = relative(root, full).startsWith("..") ? null : read(full)
    return t !== null && isWhole(t) ? gitPath(relative(root, full)) : null
  }
  const worded = new Set<string>()
  for (const f of files) {
    const t = f.toLowerCase().endsWith(".mcrl2") && !inProject(f) ? read(join(root, f)) : null
    const w = t === null ? null : wordedBy(f, t)
    if (w) worded.add(w)
  }
  for (const f of files) {
    if (!f.toLowerCase().endsWith(".mcrl2") || inProject(f) || covered.has(f)) continue
    const text = read(join(root, f))
    if (text === null) continue
    const block = /^%@ui\s+begin\s*$/m.test(text) ? blockValues(text) : null
    if (block && block["stepper"] !== undefined) continue
    // A file that is not a whole specification but has a words-only block names the model it words, beside it or below it.
    let target = f
    if (!isWhole(text)) {
      const w = wordedBy(f, text)
      if (w === null) continue
      target = w
    } else if (worded.has(f)) continue
    const modelText = target === f ? text : read(join(root, target)) ?? ""
    const s = blank(f, "plain")
    s.folder = gitPath(dirname(f))
    s.title = headingOf(text, "%") || basename(f)
    applyWords(s, root, block, text)
    s.model = target
    s.system = block?.["system"] || gitPath(relative(dirname(f), target))
    s.says_lines = saysIn(f, text)
    if (target !== f) s.says_lines.push(...saysIn(target, modelText))
    s.state_notes = stateNotesOf(modelText)
    if (target !== f) {
      for (const n of stateNotesOf(text)) {
        const at = s.state_notes.findIndex((x) => x.name === n.name)
        if (at < 0) s.state_notes.push(n)
        else if (n.note) s.state_notes[at] = n
      }
    }
    const here = join(root, dirname(f))
    // Several whole specifications in one folder keep their paths apart, each in a folder of its name.
    const siblings = files.filter((g) => g !== f && gitPath(dirname(g)) === gitPath(dirname(f)) && g.endsWith(".mcrl2"))
    s.paths = siblings.length ? `paths/${basename(f, ".mcrl2")}` : "paths"
    s.properties = [...mcfIn(here, here), ...(isDir(join(here, "properties")) ? mcfIn(join(here, "properties"), here) : [])]
    const named = block?.["properties"]
    if (named && isDir(join(here, named))) for (const p of mcfIn(join(here, named), here)) if (!s.properties.includes(p)) s.properties.push(p)
    for (const p of fromRoot(here, items.get(f) ?? [])) if (!s.properties.includes(p)) s.properties.push(p)
    out.push(s)
  }
  return out
}
