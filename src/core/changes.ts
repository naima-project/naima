// Change notes: one Markdown file per behaviour change, in a product's
// changes/ directory, named <date>-<slug>.md, whose front matter says what
// kind of change it is, what it touches, and what a project must do
// (changes/README.md in the product describes the format). A repository opts
// in with changes/config.json, which names the paths whose change is a change
// of behaviour. `naima update` reads the notes between the lock and its
// target, `naima land` and the check change-notes ask for one, and `naima
// changes` assembles release notes from them.
//
// The front matter is the strict subset of YAML core/frontmatter.ts reads.

import { parseFrontMatter } from "./frontmatter.ts"
import { runGit } from "./git.ts"

/** The directory a product's change notes are in. */
export const CHANGES = "changes"
/** The file that makes a repository one with change notes, and names its behaviour paths. */
export const CHANGES_CONFIG = `${CHANGES}/config.json`

/** The kinds of change, in the order they are shown: breaking first. */
export const NOTE_KINDS = ["breaking", "behaviour-change", "feature", "fix"] as const
export type NoteKind = (typeof NOTE_KINDS)[number]
/** What a change touches: the commands and options, how Naima is used, the workflows agents follow, the data. */
export const NOTE_AREAS = ["api", "usage", "workflow", "data"] as const
export type NoteArea = (typeof NOTE_AREAS)[number]

/** The lists a note may hold, besides affects; the first word of each entry of the first four is a verb. */
const VERBS = ["added", "changed", "removed", "renamed"] as const
const VERBED = ["commands", "options", "checks", "rules"] as const
const LISTS = ["affects", ...VERBED, "migrations"] as const
const SCALARS = ["title", "kind", "action"] as const
/** Every field of a change note's front matter: the format's own words, whatever a plugin calls the same. */
export const NOTE_FIELDS: readonly string[] = [...SCALARS, ...LISTS]

export interface ChangeNote {
  /** Its path in the product, `changes/<date>-<slug>.md`. */
  file: string
  title: string
  kind: NoteKind
  affects: NoteArea[]
  commands: string[]
  options: string[]
  checks: string[]
  rules: string[]
  migrations: string[]
  /** What a project must do after updating; null when nothing. */
  action: string | null
  /** The note's text, after the front matter, trimmed. */
  body: string
}

/** Whether `path` names a change note: `changes/<YYYY-MM-DD>-<slug>.md`, directly in the directory. */
export const isNotePath = (path: string): boolean => {
  const parts = path.split("/")
  if (parts.length !== 2 || parts[0] !== CHANGES) return false
  const name = parts[1] ?? ""
  return /^\d{4}-\d{2}-\d{2}-[a-z0-9][a-z0-9-]*\.md$/.test(name)
}

/** The change note `text` is, read from `file`; an error saying why when it is not one. */
export function parseChangeNote(file: string, text: string): ChangeNote {
  const { fields, body } = parseFrontMatter(text)
  for (const name of fields.keys()) {
    if (!(SCALARS as readonly string[]).includes(name) && !(LISTS as readonly string[]).includes(name)) {
      throw new Error(`${name} is not a field of a change note: ${[...SCALARS, ...LISTS].join(", ")}`)
    }
  }
  const one = (name: string, required: boolean): string | null => {
    const v = fields.get(name)
    if (v === undefined || v === "") {
      if (required) throw new Error(`${name} is missing`)
      return null
    }
    if (typeof v !== "string") throw new Error(`${name} is one line, not a list`)
    return v
  }
  const many = (name: string): string[] => {
    const v = fields.get(name)
    if (v === undefined) return []
    if (typeof v === "string") throw new Error(`${name} is a list: "${name}:" and then "  - " lines`)
    return v
  }
  const title = one("title", true) as string
  const kind = one("kind", true) as string
  if (!(NOTE_KINDS as readonly string[]).includes(kind)) throw new Error(`kind ${JSON.stringify(kind)} is not one of: ${NOTE_KINDS.join(", ")}`)
  const affects = many("affects")
  if (!affects.length) throw new Error(`affects is missing: one or more of ${NOTE_AREAS.join(", ")}`)
  const off = affects.filter((a) => !(NOTE_AREAS as readonly string[]).includes(a))
  if (off.length) throw new Error(`affects ${off.map((a) => JSON.stringify(a)).join(", ")} is not one of: ${NOTE_AREAS.join(", ")}`)
  const verbed = Object.fromEntries(VERBED.map((name) => {
    const entries = many(name)
    const bad = entries.filter((e) => !(VERBS as readonly string[]).includes(e.split(" ")[0] ?? "") || !e.includes(" "))
    if (bad.length) throw new Error(`${name} entries start with ${VERBS.join(", ")} and name what: ${bad.map((e) => JSON.stringify(e)).join(", ")}`)
    return [name, entries]
  })) as Record<(typeof VERBED)[number], string[]>
  for (const e of verbed.options.filter((e) => e.startsWith("renamed "))) {
    if (e.split(" ").length !== 4 || e.split(" ")[2] !== "to") throw new Error(`options: ${JSON.stringify(e)} is said "renamed <old path> to <new path>"`)
  }
  if (!body) throw new Error("the note has no text after its front matter")
  return { file, title, kind: kind as NoteKind, affects: affects as NoteArea[], ...verbed, migrations: many("migrations"), action: one("action", false), body }
}

/** The behaviour paths `repo` declares at `rev` in changes/config.json; null when it declares none. Paths ending in / are directories. */
export function behaviourOf(repo: string, rev: string): string[] | null {
  const r = runGit(repo, ["show", `${rev}:${CHANGES_CONFIG}`])
  if (!r.ok) return null
  let config: unknown
  try {
    config = JSON.parse(r.out)
  } catch (e) {
    throw new Error(`${CHANGES_CONFIG} at ${rev.slice(0, 12)} is not JSON: ${e instanceof Error ? e.message : String(e)}`)
  }
  const b = (config as { behaviour?: unknown } | null)?.behaviour
  if (!Array.isArray(b) || !b.every((p) => typeof p === "string" && p)) throw new Error(`${CHANGES_CONFIG}: behaviour is a list of paths`)
  return b as string[]
}

const under = (path: string, prefixes: readonly string[]): boolean => prefixes.some((p) => (p.endsWith("/") ? path.startsWith(p) : path === p))

/** The paths that differ between two commits of `repo`, with how: A added, M changed, D deleted. */
function differences(repo: string, from: string, to: string): { status: string; path: string }[] {
  const r = runGit(repo, ["diff", "--name-status", "--no-renames", "-z", from, to])
  if (!r.ok) throw new Error(`cannot compare ${from.slice(0, 12)} with ${to.slice(0, 12)} in ${repo}: ${r.err.split("\n")[0]}`)
  const parts = r.out.split("\0").filter((p) => p !== "")
  const out: { status: string; path: string }[] = []
  for (let i = 0; i + 1 < parts.length; i += 2) out.push({ status: parts[i] ?? "", path: parts[i + 1] ?? "" })
  return out
}

/**
 * The behaviour paths `repo` changes from `from` to `to`, when it adds no change note among them; empty when
 * it adds one, changes none, or declares no behaviour paths at `to`.
 */
export function unnoted(repo: string, from: string, to: string): string[] {
  const behaviour = behaviourOf(repo, to)
  if (!behaviour) return []
  const diff = differences(repo, from, to)
  if (diff.some((d) => d.status === "A" && isNotePath(d.path))) return []
  return diff.map((d) => d.path).filter((p) => under(p, behaviour)).sort()
}

/** The change notes `repo` adds from `from` to `to`, read at `to`, oldest first; and each one that is not a note, with why. */
export function notesBetween(repo: string, from: string, to: string): { notes: ChangeNote[]; unreadable: string[] } {
  const notes: ChangeNote[] = []
  const unreadable: string[] = []
  for (const d of differences(repo, from, to).filter((d) => d.status === "A" && isNotePath(d.path))) {
    const text = runGit(repo, ["show", `${to}:${d.path}`])
    try {
      if (!text.ok) throw new Error(text.err.split("\n")[0])
      notes.push(parseChangeNote(d.path, text.out))
    } catch (e) {
      unreadable.push(`${d.path}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }
  return { notes: notes.sort((a, b) => (a.file < b.file ? -1 : 1)), unreadable }
}

/** The groups notes are shown in: breaking, then those that ask an action, then features, behaviour changes and fixes. Empty groups left out. */
export function noteGroups(notes: readonly ChangeNote[]): { title: string; notes: ChangeNote[] }[] {
  const groups = [
    { title: "Breaking", notes: notes.filter((n) => n.kind === "breaking") },
    { title: "Action needed", notes: notes.filter((n) => n.kind !== "breaking" && n.action) },
    { title: "Features", notes: notes.filter((n) => n.kind === "feature" && !n.action) },
    { title: "Behaviour changes", notes: notes.filter((n) => n.kind === "behaviour-change" && !n.action) },
    { title: "Fixes", notes: notes.filter((n) => n.kind === "fix" && !n.action) },
  ]
  return groups.filter((g) => g.notes.length)
}

/** The notes as terminal lines: a heading, then each group and its notes' titles, with what to do. */
export function noteLines(notes: readonly ChangeNote[]): string[] {
  if (!notes.length) return []
  const out = [`Change notes, ${notes.length}, breaking first:`]
  for (const g of noteGroups(notes)) {
    out.push(`  ${g.title}:`)
    for (const n of g.notes) out.push(`    - ${n.title}${n.action ? ` — what to do: ${n.action}` : ""}`)
  }
  return out
}

/** The notes as Markdown release notes: a section per group, a subsection per note with its text and what to do. */
export function releaseNotes(notes: readonly ChangeNote[]): string[] {
  const out: string[] = []
  for (const g of noteGroups(notes)) {
    out.push(`## ${g.title}`, "")
    for (const n of g.notes) {
      out.push(`### ${n.title}`, "", n.body, "")
      if (n.action) out.push(`What to do: ${n.action.replace(/([^.!?])$/, "$1.")}`, "")
    }
  }
  return out
}

/** The rules the notes say were added, changed or removed, as they say it. */
export const changedRules = (notes: readonly ChangeNote[]): string[] => notes.flatMap((n) => n.rules)

/** An option a note renames (`to` its new path) or removes (`to` null). */
export interface OptionMove {
  from: string
  to: string | null
}

/** The option renames and removals the notes declare, in order. */
export function optionMoves(notes: readonly ChangeNote[]): OptionMove[] {
  const out: OptionMove[] = []
  for (const e of notes.flatMap((n) => n.options)) {
    const words = e.split(" ")
    if (words[0] === "renamed" && words[1] && words[3]) out.push({ from: words[1], to: words[3] })
    else if (words[0] === "removed" && words[1]) out.push({ from: words[1], to: null })
  }
  return out
}

type Json = Record<string, unknown>
const isObject = (v: unknown): v is Json => !!v && typeof v === "object" && !Array.isArray(v)

/** The object holding the last key of `path` in `raw`, and that key; null when a step is missing. */
function holder(raw: Json, path: string, make: boolean): { at: Json; key: string } | null {
  const keys = path.split(".")
  const key = keys.pop() as string
  let at: Json = raw
  for (const k of keys) {
    if (!isObject(at[k])) {
      if (!make) return null
      at[k] = {}
    }
    at = at[k] as Json
  }
  return { at, key }
}

/** Remove the objects `path` passes through that the removal left empty, from the innermost out, up to the plugins table. */
function prune(raw: Json, path: string): void {
  const keys = path.split(".").slice(0, -1)
  while (keys.length > 1) {
    const h = holder(raw, keys.join("."), false)
    if (!h || !isObject(h.at[h.key]) || Object.keys(h.at[h.key] as Json).length) return
    delete h.at[h.key]
    keys.pop()
  }
}

/**
 * naima.json with the mechanical changes made: each rename carries its value to the new path (never over one
 * set there already), each removal and each option `unread` (one the new Naima reads nowhere) is taken out.
 * Each change is said, with the value it held. `raw` itself is not changed.
 */
export function rewriteOptions(raw: Json, moves: readonly OptionMove[], unread: readonly string[]): { raw: Json; said: string[] } {
  const out = structuredClone(raw) as Json
  const said: string[] = []
  const done = new Set<string>()
  for (const m of moves) {
    const from = holder(out, m.from, false)
    if (!from || !Object.hasOwn(from.at, from.key)) continue
    const value = from.at[from.key]
    if (m.to === null) {
      delete from.at[from.key]
      prune(out, m.from)
      said.push(`removed ${m.from}, which was ${JSON.stringify(value)}`)
    } else {
      const to = holder(out, m.to, true) as { at: Json; key: string }
      if (Object.hasOwn(to.at, to.key)) {
        said.push(`not renamed: ${m.to} is set already, so ${m.from} stays as it is — decide which one holds`)
        continue
      }
      to.at[to.key] = value
      delete from.at[from.key]
      said.push(`renamed ${m.from} to ${m.to}, keeping its value ${JSON.stringify(value)}`)
    }
    done.add(m.from)
  }
  for (const path of unread) {
    if (done.has(path)) continue
    const h = holder(out, path, false)
    if (!h || !Object.hasOwn(h.at, h.key)) continue
    const value = h.at[h.key]
    delete h.at[h.key]
    prune(out, path)
    said.push(`removed ${path}, which was ${JSON.stringify(value)}: the new Naima reads it nowhere`)
  }
  return { raw: out, said }
}
