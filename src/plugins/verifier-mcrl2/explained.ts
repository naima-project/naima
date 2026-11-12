// The check `explained-formal-work`: formal work a person can read. Every mCRL2 property says in one sentence what
// must hold (`says`, at most 35 words) and glosses every modality and fixpoint of its formula; every hand-written
// model file opens with a comment saying what it models and, in a paragraph that begins "Leaves out", what it leaves
// out, and each of its process and action declarations has a comment of one line, directly above it or at the end of
// its first line; and every pair of models a naima-codegen MANIFEST.json relates by refinement (a system group's
// `<group>-refined.mcrl2` and `<group>-model.mcrl2`) has its `refinements` item. It reads files and items only.
//
// Its findings are notes unless the plugin's option `explained` is `problem`, which a project sets once its material
// is up to the rule.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { dirname, join, relative, resolve, sep } from "node:path"
import { type Check, type Context, type Finding, type Item, label } from "../../core/api.ts"
import { parseFormula, type StateFrm } from "./formula.ts"

/** The longest `says` sentence the rule allows, in words. */
export const SAYS_WORDS = 35

/** A part's text as glosses are matched: every white space dropped (as the verifier plugin's `naima explain` does). */
const partKey = (s: string): string => s.replace(/\s+/g, "")

/** A part's key without the brackets around it, which the parser's spans may or may not include. */
const bare = (s: string): string => {
  let k = partKey(s)
  for (;;) {
    const open = k.match(/^\(+/)?.[0].length ?? 0, close = k.match(/\)+$/)?.[0].length ?? 0
    // An unbalanced leading bracket belongs to an enclosing group; balanced outer ones are dropped.
    let depth = 0, outer = k.startsWith("(")
    for (let i = 0; i < k.length && outer; i++) {
      depth += k[i] === "(" ? 1 : k[i] === ")" ? -1 : 0
      if (depth === 0 && i < k.length - 1) outer = false
    }
    if (outer && k.endsWith(")")) k = k.slice(1, -1)
    else if (open > close) k = k.slice(open - close)
    else return k
  }
}

/** Each modality and fixpoint of a formula: its whole text and its head (`[R]`, `<R>`, `mu X.`, `nu X(n: Nat = 0).`). */
export function headsOf(src: string): { head: string; whole: string }[] {
  const out: { head: string; whole: string }[] = []
  const walk = (s: StateFrm): void => {
    switch (s.k) {
      case "box":
      case "dia":
      case "mu":
      case "nu": {
        const head = src.slice(s.at.from, s.f.at.from).replace(/^[\s(]+|[\s(]+$/g, "")
        out.push({ head, whole: src.slice(s.at.from, s.at.to) })
        return walk(s.f)
      }
      case "not":
        return walk(s.f)
      case "and":
      case "or":
      case "imp":
        walk(s.l)
        return walk(s.r)
      case "quant":
        return walk(s.body)
    }
  }
  walk(parseFormula(src))
  return out
}

/** The heads of `src` that no gloss names, by the head's text or the whole part's. */
export function unglossed(src: string, glossed: readonly string[]): string[] {
  const have = new Set(glossed.map(bare))
  const missing = headsOf(src).filter((h) => !have.has(bare(h.head)) && !have.has(bare(h.whole))).map((h) => h.head.replace(/\s+/g, " "))
  return [...new Set(missing)]
}

/** One declaration of an `act` or `proc` section: the line it starts on (from 1), its first name, whether a comment says it. */
export interface Declaration {
  section: "act" | "proc"
  name: string
  line: number
  commented: boolean
}

const SECTIONS = new Set(["sort", "cons", "map", "var", "eqn", "act", "proc", "init", "glob"])

/**
 * The action and process declarations of an mCRL2 specification. The text is scanned as tokens, comments apart:
 * a section keyword at the top level starts a section; in `act` and `proc`, each declaration runs to its `;`.
 */
export function declarationsOf(text: string): Declaration[] {
  const lines = text.split(/\r?\n/)
  const code = lines.map((l) => (l.includes("%") ? l.slice(0, l.indexOf("%")) : l))
  const isComment = (i: number) => i >= 0 && lines[i]!.trim().startsWith("%")
  const trailing = (i: number) => lines[i]!.includes("%") && code[i]!.trim() !== ""
  const out: Declaration[] = []
  let section = ""
  let depth = 0
  let atStart = false
  for (let n = 0; n < code.length; n++) {
    const re = /[A-Za-z_][A-Za-z0-9_']*|[()[\]{};]|\S/g
    for (let m = re.exec(code[n]!); m; m = re.exec(code[n]!)) {
      const t = m[0]
      if (depth === 0 && SECTIONS.has(t)) {
        section = t
        atStart = true
        continue
      }
      if ("([{".includes(t)) depth++
      else if (")]}".includes(t)) depth = Math.max(0, depth - 1)
      if (depth === 0 && t === ";") {
        atStart = true
        continue
      }
      if (atStart && (section === "act" || section === "proc")) {
        out.push({ section, name: t, line: n + 1, commented: isComment(n - 1) || trailing(n) })
      }
      atStart = false
    }
  }
  return out
}

/** The comment a file opens with: its first lines that start with `%`, blank lines before them skipped. */
export function openingComment(text: string): string {
  const out: string[] = []
  for (const raw of text.split(/\r?\n/)) {
    const t = raw.trim()
    if (!t.startsWith("%")) {
      if (!t && !out.length) continue
      break
    }
    out.push(t.replace(/^%+\s?/, ""))
  }
  return out.join("\n").trim()
}

/** What is missing from one hand-written model file, in words; empty when nothing is. */
export function modelGaps(text: string, leavesOut = true): string[] {
  const out: string[] = []
  const opening = openingComment(text)
  if (/GENERATED (FILE|by)/.test(opening)) return out
  if (!opening) out.push("it opens with no comment saying what it models and what it leaves out")
  else if (leavesOut && !/(^|\n)\s*leaves out\b/i.test(opening)) {
    out.push('its opening comment has no paragraph beginning "Leaves out" saying what the model leaves out')
  }
  const bare = declarationsOf(text).filter((d) => !d.commented)
  if (bare.length) {
    const said = bare.slice(0, 8).map((d) => `${d.section} ${d.name} (line ${d.line})`).join(", ")
    out.push(
      `${bare.length} declaration${bare.length === 1 ? " has no comment of its own" : "s have no comment of their own"}: ${said}${
        bare.length > 8 ? ", ..." : ""
      }`,
    )
  }
  return out
}

const slash = (p: string) => p.split(sep).join("/")
const modelOf = (item: Item) => String(item.meta["model"] ?? "").split("#")[0]!.trim()

/** The naima-codegen project a model belongs to (the folder above `generated/`, or the one with codegen.toml), or null. */
function codegenRoot(ctx: Context, model: string): string | null {
  const g = model.indexOf("/generated/")
  if (g > 0) return model.slice(0, g)
  let d = dirname(model)
  for (let i = 0; i < 3 && d && d !== "."; i++, d = dirname(d)) if (existsSync(join(ctx.root, d, "codegen.toml"))) return d
  return null
}

/** Every `.mcrl2` file under a folder, from the project root, generated ones left out. */
function mcrl2Under(ctx: Context, folder: string, deep: boolean): string[] {
  const out: string[] = []
  const walk = (rel: string, depth: number) => {
    let names: string[]
    try {
      names = readdirSync(join(ctx.root, rel)).sort()
    } catch {
      return
    }
    for (const n of names) {
      const r = `${rel}/${n}`
      if (n === "generated" || n.startsWith(".")) continue
      let dir = false
      try {
        dir = statSync(join(ctx.root, r)).isDirectory()
      } catch {
        continue
      }
      if (dir) {
        if (deep && depth < 4) walk(r, depth + 1)
      } else if (n.endsWith(".mcrl2")) out.push(r)
    }
  }
  walk(folder, 0)
  return out
}

/**
 * Whether a model file must say what it leaves out: every one but a codegen project's helpers, which set up what the
 * model's own files describe (its initial state, its observers, an instance).
 */
export const needsLeavesOut = (file: string): boolean => !/(^|\/)(codegen-init|observers)\.mcrl2$/.test(file) && !file.includes("/instances/")

/** The hand-written model files of the project's mCRL2 properties: a codegen project's sources, else each model's folder. */
export function modelFiles(ctx: Context, props: readonly Item[]): string[] {
  const files = new Set<string>()
  for (const p of props) {
    const m = modelOf(p)
    if (!m) continue
    const root = codegenRoot(ctx, m)
    if (root) { for (const f of mcrl2Under(ctx, root, true)) files.add(f) }
    else if (!m.includes("/generated/")) { for (const f of mcrl2Under(ctx, dirname(m), false)) files.add(f) }
  }
  return [...files].sort()
}

/** The pairs of models each codegen project's MANIFEST.json relates by refinement: [lower, upper]. */
export function manifestRefinements(ctx: Context, props: readonly Item[]): [string, string][] {
  const roots = new Set(props.map((p) => codegenRoot(ctx, modelOf(p))).filter((r): r is string => !!r))
  // Every codegen project in the folder the properties' models share, those no property names yet included.
  const dirs = props.map((p) => dirname(modelOf(p)).split("/")).filter((d) => d[0] && d[0] !== ".")
  const top: string[] = []
  for (let i = 0; dirs.length && dirs.every((d) => d[i] !== undefined && d[i] === dirs[0]![i]); i++) top.push(dirs[0]![i]!)
  const walk = (rel: string, depth: number) => {
    let names: string[]
    try {
      names = readdirSync(join(ctx.root, rel))
    } catch {
      return
    }
    if (names.includes("codegen.toml")) return void roots.add(rel)
    if (depth < 4) { for (const n of names) if (!n.startsWith(".") && n !== "generated") walk(`${rel}/${n}`, depth + 1) }
  }
  if (top.length) walk(top.join("/"), 0)
  const out: [string, string][] = []
  for (const root of [...roots].sort()) {
    let manifest: { files?: Record<string, unknown>; systems?: { group?: unknown }[] }
    try {
      manifest = JSON.parse(readFileSync(join(ctx.root, root, "generated", "MANIFEST.json"), "utf8"))
    } catch {
      continue
    }
    const files = Object.keys(manifest.files ?? {})
    for (const s of manifest.systems ?? []) {
      const g = String(s.group ?? "")
      const lower = `model/systems/${g}-refined.mcrl2`, upper = `model/systems/${g}-model.mcrl2`
      if (g && files.includes(lower) && files.includes(upper)) out.push([`${root}/generated/${lower}`, `${root}/generated/${upper}`])
    }
  }
  return out
}

/** The words of a sentence, as the rule counts them. */
const words = (s: string) => s.split(/\s+/).filter(Boolean).length

/** The check, its findings at `level`. */
export function explainedCheck(level: "note" | "problem"): Check {
  return {
    name: "explained-formal-work",
    says:
      `every mCRL2 property has its says sentence (at most ${SAYS_WORDS} words) and a gloss for every modality and fixpoint of its formula; every hand-written model file opens with a comment saying what it models and, in a paragraph beginning "Leaves out", what it leaves out (a codegen project's initial state, observers and instances only with the first), and each process and action declaration has its comment; every pair of models a codegen MANIFEST.json relates by refinement has its refinements item (naima refine). Notes, unless the plugin's option explained is problem`,
    run(ctx) {
      const out: Finding[] = []
      const props = ctx.repo.items.filter((i) => i.type === "properties" && i.meta["verifier"] === "mcrl2")
      for (const p of props) {
        const gaps: string[] = []
        const says = typeof p.meta["says"] === "string" ? p.meta["says"].trim() : ""
        if (!says) gaps.push("no says sentence")
        else if (words(says) > SAYS_WORDS) gaps.push(`its says sentence has ${words(says)} words, over ${SAYS_WORDS}`)
        const g = p.meta["glosses"]
        const glossed = g && typeof g === "object" && !Array.isArray(g) ? Object.keys(g) : []
        const prop = String(p.meta["property"] ?? "")
        const abs = resolve(ctx.root, prop)
        let src = prop
        try {
          if (prop.endsWith(".mcf") && existsSync(abs)) src = readFileSync(abs, "utf8")
        } catch {
          // unreadable: property-evidence says so
        }
        try {
          const missing = unglossed(src, glossed)
          if (missing.length) gaps.push(`no gloss for ${missing.map((m) => `\`${m}\``).join(", ")}`)
          const text = partKey(src)
          const stale = glossed.filter((k) => !text.includes(partKey(k)))
          if (stale.length) gaps.push(`glosses for parts no longer in its formula: ${stale.map((m) => `\`${m}\``).join(", ")}`)
        } catch {
          // a formula the parser does not read is no gap of explanation
        }
        if (gaps.length) {
          out.push({
            level,
            item: p,
            subject: p.slug,
            message: `${label(p)}: ${gaps.join("; ")} — naima explain ${p.slug} --says "..." --gloss "<part>=<phrase>"`,
          })
        }
      }
      for (const f of modelFiles(ctx, props)) {
        let text: string
        try {
          text = readFileSync(join(ctx.root, f), "utf8")
        } catch {
          continue
        }
        const gaps = modelGaps(text, needsLeavesOut(f))
        if (gaps.length) out.push({ level, subject: slash(relative(ctx.root, join(ctx.root, f))), message: `${f}: ${gaps.join("; ")}` })
      }
      const recorded = ctx.repo.items.filter((i) => i.type === "refinements").map((i) => `${i.meta["lower"]} ${i.meta["upper"]}`)
      for (const [lower, upper] of manifestRefinements(ctx, props)) {
        if (!recorded.includes(`${lower} ${upper}`)) {
          out.push({
            level,
            subject: lower,
            message:
              `${lower} refines ${upper}, by its MANIFEST.json, and no refinement records it — naima refine ${lower} ${upper} --relation "..." --says "..."`,
          })
        }
      }
      return out
    },
  }
}
