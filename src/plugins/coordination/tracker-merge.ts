// A merge of tracker items, field by field, for `naima line sync`: git merges the text of a tracker's files, so an
// item changed on both the trunk and the line (a note appended on each side, a fixed mark here and a gate there)
// stops the merge at a conflict even when nothing the two sides wrote disagrees. This merges what can be merged by
// the item's own structure, and leaves for a person only a field both sides changed to different values.
//
//   - `meta.json`, three-way by field: a field changed on one side only is taken from it, one changed alike on both
//     sides stays, one changed differently on both sides is a conflict;
//   - `README.md`, by its parts: the title and the description three-way as a field is; the Notes section as the union
//     of both sides' entries (each a `### ` heading and its text, never rewritten), in date order.
//
// Anything else a merge leaves unmerged (a claim, an event, an item moved on one side and changed on the other) is
// not touched.

import { isDeepStrictEqual } from "node:util"
import { joinProse, NOTES_HEADING, runGit, splitProse } from "../../core/api.ts"

/** A field or part both sides changed, to different values: what a person must settle. */
export interface FieldConflict {
  /** The file the conflict is in, from the project's root. */
  file: string
  /** The field, or `title` or `description` for a README's parts. */
  field: string
  /** What the side being merged into (the line) holds, and what the side merged in (the trunk) holds, in a few words. */
  ours: string
  theirs: string
}

const same = (a: unknown, b: unknown): boolean => isDeepStrictEqual(a, b)
const show = (v: unknown): string => {
  const s = v === undefined ? "(absent)" : typeof v === "string" ? v : JSON.stringify(v)
  return s.length > 80 ? `${s.slice(0, 77)}...` : s
}

/** Three-way merge of one value: the side that changed it, either when both agree, or a conflict. */
function pick<T>(base: T | undefined, ours: T | undefined, theirs: T | undefined): { value: T | undefined } | null {
  if (same(ours, theirs)) return { value: ours }
  if (same(ours, base)) return { value: theirs }
  if (same(theirs, base)) return { value: ours }
  return null
}

/** The merge of an item's fields, and the fields both sides changed differently (which keep the line's value in the result). */
export function mergeMeta(
  base: Record<string, unknown>,
  ours: Record<string, unknown>,
  theirs: Record<string, unknown>,
): { merged: Record<string, unknown>; conflicts: { field: string; ours: string; theirs: string }[] } {
  const merged: Record<string, unknown> = {}
  const conflicts: { field: string; ours: string; theirs: string }[] = []
  const keys: string[] = []
  for (const side of [ours, theirs, base]) for (const k of Object.keys(side)) if (!keys.includes(k)) keys.push(k)
  for (const k of keys) {
    const got = pick(base[k], ours[k], theirs[k])
    if (!got) {
      conflicts.push({ field: k, ours: show(ours[k]), theirs: show(theirs[k]) })
      if (ours[k] !== undefined) merged[k] = ours[k]
    } else if (got.value !== undefined) merged[k] = got.value
  }
  return { merged, conflicts }
}

/** The entries of a Notes section: each starts at a `### ` heading; text before the first one belongs to the first entry. */
function entriesOf(notes: string): string[] {
  const body = notes.replace(/\r\n/g, "\n").split("\n").slice(1).join("\n").trim()
  if (!body) return []
  const out: string[] = []
  for (const line of body.split("\n")) {
    if (/^###\s/.test(line) || !out.length) out.push(line)
    else out[out.length - 1] += `\n${line}`
  }
  return out.map((e) => e.trim())
}

/** The date an entry's heading starts with (`### 2026-11-15 — who`), or the empty string. */
const dateOf = (entry: string): string => /^###\s+(\d{4}-\d{2}-\d{2})/.exec(entry)?.[1] ?? ""

/** Both sides' entries, once each, in date order; entries of one date keep the line's, then the trunk's, order. */
export function mergeNotes(ours: string[], theirs: string[]): string[] {
  const all = [...ours]
  for (const e of theirs) if (!all.includes(e)) all.push(e)
  return all.map((e, i) => ({ e, i, d: dateOf(e) })).sort((a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : a.i - b.i)).map((x) => x.e)
}

/** The merge of an item's README: parts three-way, notes united. */
export function mergeReadme(
  base: string,
  ours: string,
  theirs: string,
): { merged: string; conflicts: { field: string; ours: string; theirs: string }[] } {
  const b = splitProse(base.replace(/\r\n/g, "\n"))
  const o = splitProse(ours.replace(/\r\n/g, "\n"))
  const t = splitProse(theirs.replace(/\r\n/g, "\n"))
  const conflicts: { field: string; ours: string; theirs: string }[] = []
  const part = (name: "title" | "description"): string => {
    const got = pick(b[name], o[name], t[name])
    if (got) return got.value ?? ""
    conflicts.push({ field: name, ours: show(o[name]), theirs: show(t[name]) })
    return o[name]
  }
  const title = part("title")
  const description = part("description")
  // An entry on one side only was appended there; one on the base's side that a side dropped stays dropped is not a case: notes are never rewritten.
  const entries = mergeNotes(entriesOf(o.notes), entriesOf(t.notes))
  const notes = entries.length ? `${NOTES_HEADING}\n\n${entries.join("\n\n")}` : ""
  return { merged: joinProse({ title, description, notes }), conflicts }
}

/**
 * An item's history merged by union: every line of both sides once, in the order they happened (each line says when).
 * The tracker's .gitattributes does this for a project that has it; a project made before it is merged here.
 */
function mergeHistory(ours: string, theirs: string): string {
  const seen = new Set<string>()
  const lines: { at: string; line: string; n: number }[] = []
  for (const line of `${ours}\n${theirs}`.split("\n")) {
    if (!line.trim() || seen.has(line)) continue
    seen.add(line)
    let at = ""
    try {
      at = String((JSON.parse(line) as { at?: unknown }).at ?? "")
    } catch {
      // a line that is no JSON keeps its place among the others
    }
    lines.push({ at, line, n: lines.length })
  }
  lines.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : a.n - b.n))
  return lines.map((l) => l.line).join("\n") + "\n"
}

/** The text of stage `n` of an unmerged path (1 base, 2 the line's, 3 the trunk's), or null when that side has none. */
function stage(root: string, n: 1 | 2 | 3, file: string): string | null {
  const r = runGit(root, ["show", `:${n}:${file}`])
  return r.ok ? r.out : null
}

/**
 * Resolve, in the merge in progress at `root`, every unmerged tracker file this module can merge: stage the merged
 * file and return it as resolved. A file with a field both sides changed differently is left unmerged and reported.
 * `dataDir` is the tracker's data folder from the project's root, with forward slashes.
 */
export function resolveTrackerConflicts(root: string, dataDir: string): { resolved: string[]; conflicts: FieldConflict[]; left: string[] } {
  const listed = runGit(root, ["diff", "--name-only", "--diff-filter=U", "-z", "--", dataDir || "."])
  const files = listed.ok ? listed.out.split("\0").filter(Boolean) : []
  const resolved: string[] = []
  const conflicts: FieldConflict[] = []
  const left: string[] = []
  for (const file of files) {
    const isMeta = file.endsWith("/meta.json")
    const isReadme = file.endsWith("/README.md")
    const isHistory = file.endsWith("/history.jsonl")
    const ours = isMeta || isReadme || isHistory ? stage(root, 2, file) : null
    const theirs = isMeta || isReadme || isHistory ? stage(root, 3, file) : null
    if (ours === null || theirs === null) {
      left.push(file)
      continue
    }
    const base = stage(root, 1, file)
    let text: string
    let found: { field: string; ours: string; theirs: string }[]
    try {
      if (isHistory) {
        text = mergeHistory(ours, theirs)
        found = []
      } else if (isMeta) {
        const r = mergeMeta(base === null ? {} : JSON.parse(base), JSON.parse(ours), JSON.parse(theirs))
        text = JSON.stringify(r.merged, null, 2) + "\n"
        found = r.conflicts
      } else {
        const r = mergeReadme(base ?? "", ours, theirs)
        text = r.merged
        found = r.conflicts
      }
    } catch {
      left.push(file)
      continue
    }
    if (found.length) {
      for (const c of found) conflicts.push({ file, ...c })
      continue
    }
    // Written through git, never by this process: the checkout is a sibling worktree, outside what the launcher lets
    // Naima write, and git is not fenced.
    if (stageText(root, file, text)) resolved.push(file)
    else left.push(file)
  }
  return { resolved, conflicts, left }
}

/** Make `text` the resolved content of an unmerged `file` (index and working tree), by git alone. Whether it could. */
function stageText(root: string, file: string, text: string): boolean {
  const made = runGit(root, ["hash-object", "-w", "--stdin", "--path", file], { input: text })
  if (!made.ok) return false
  const oid = made.out.trim()
  return runGit(root, ["update-index", "--add", "--cacheinfo", `100644,${oid},${file}`]).ok && runGit(root, ["checkout-index", "-f", "--", file]).ok
}

/** What is still unmerged anywhere in the working tree, as paths from the root. */
export function unmerged(root: string): string[] {
  const r = runGit(root, ["diff", "--name-only", "--diff-filter=U", "-z"])
  return r.ok ? r.out.split("\0").filter(Boolean) : []
}
