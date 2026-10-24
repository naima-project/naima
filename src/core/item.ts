// Items on disk: one directory each, `meta.json` for fields, `README.md` for prose.

import { randomUUID } from "node:crypto"
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import { join, relative } from "node:path"
import { NaimaError } from "./errors.ts"
import { writeFileAtomic } from "./files.ts"
import { dirsAcrossBranches } from "./git.ts"
import type { Context, Item, Meta, TextWrite, TypeDef, Write } from "./types.ts"

export const META = "meta.json"
export const README = "README.md"
export const ATTACHMENTS = "attachments"

const STOP_WORDS = new Set(["a", "an", "the", "of", "to", "in", "on", "and", "or", "is", "are", "be", "for", "with", "it", "its"])

/**
 * The words of a title, in any script: lowercased, compatibility-normalised,
 * with the accents of Latin letters dropped (so "Café" is "cafe") and every
 * other letter and digit kept. What slugs and the duplicate check compare.
 */
export function titleWords(text: string): string[] {
  return text
    .normalize("NFKD")
    .replace(/(\p{Script=Latin})\p{M}+/gu, "$1")
    .normalize("NFC")
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
}

/** `titleWords`, minus the ones too common to tell titles apart — what a slug and a duplicate hint both compare. */
export function significantWords(text: string): string[] {
  return titleWords(text).filter((w) => !STOP_WORDS.has(w))
}

/** A readable directory name. Slugs may change; ids may not. */
export function slugify(text: string, maxWords = 7): string {
  const words = significantWords(text)
  return [...words.slice(0, maxWords).join("-")].slice(0, 60).join("").replace(/-+$/, "") || "item"
}

/** `slug`, or the first `slug-<n>` free in `taken`. Compared without case: a case-insensitive file system holds one of `a` and `A`. */
export function uniqueSlug(slug: string, taken: Set<string>): string {
  const lower = new Set([...taken].map((s) => s.toLowerCase()))
  const free = (s: string): boolean => !lower.has(s.toLowerCase())
  if (free(slug)) return slug
  for (let n = 2;; n++) if (free(`${slug}-${n}`)) return `${slug}-${n}`
}

/**
 * Make a new, empty directory under `base` named `slug` or the first free
 * suffix of it, and return the name used. The directory is created without
 * `recursive`, so it fails on one that exists — made in another case, or by a
 * concurrent run between the listing and the write — and the next suffix is
 * tried instead of writing into someone else's item.
 */
function claimDir(base: string, slug: string, elsewhere: Set<string> = new Set()): string {
  mkdirSync(base, { recursive: true })
  const taken = new Set([...listDirs(base), ...elsewhere])
  for (;;) {
    const name = uniqueSlug(slug, taken)
    try {
      mkdirSync(join(base, name))
      return name
    } catch (e) {
      if ((e as { code?: unknown }).code !== "EEXIST") throw e
      taken.add(name)
    }
  }
}

export const isUuid = (s: unknown): s is string => typeof s === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(s)

export const today = (ctx: Context): string => ctx.now().toISOString().slice(0, 10)

let generation = 0

/**
 * How many writes the helpers of this module have made in this process. A
 * context's repo is re-read when it moves, so a write is seen by the next read
 * without anyone having to remember to reload.
 */
export const writes = (): number => generation

/** Write a value as JSON, atomically (writeFileAtomic). */
export function writeJson(path: string, value: unknown): void {
  writeFileAtomic(path, JSON.stringify(value, null, 2) + "\n")
  generation++
}

export function readReadme(item: Item): string {
  const path = join(item.dir, README)
  return existsSync(path) ? readFileSync(path, "utf8") : ""
}

/** What a write helper is asked on top of the item: `force`, a command's `--force` (Write.force). */
export interface WriteOptions {
  force?: boolean
  /** The write carries text its writer authored (Write.authored). */
  authored?: boolean
}

/** The flags of a write, from its options. */
const flags = (opts: WriteOptions): { force: boolean; authored?: true } => ({ force: opts.force === true, ...(opts.authored ? { authored: true } : {}) })

/** The fields an item has on disk: what a write hook compares against. Null when there is no readable object. */
function onDisk(dir: string): Meta | null {
  try {
    const value: unknown = JSON.parse(readFileSync(join(dir, META), "utf8"))
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Meta) : null
  } catch {
    return null
  }
}

/**
 * Every plugin's `beforeWrite`, in load order. The first refusal stops the
 * write before anything is on disk; a hook that refuses without saying why is
 * a bug in that hook, reported as one.
 */
function beforeWrite(ctx: Context, write: Write): void {
  for (const hook of ctx.registry.hooks) {
    const refusal = hook.beforeWrite?.(write, ctx)
    if (refusal === undefined) continue
    if (typeof refusal !== "string" || !refusal.trim()) {
      throw new TypeError(`write hook "${hook.name}" refused a write of ${write.item.type}/${write.item.slug} without saying why — a refusal is a sentence`)
    }
    throw new NaimaError(`${refusal} (refused by ${hook.name})`, "vetoed")
  }
}

function afterWrite(ctx: Context, write: Write): void {
  for (const hook of ctx.registry.hooks) hook.afterWrite?.(write, ctx)
}

/**
 * Every plugin's `beforeText` on a write of free text or a file that is not an item's — a session note, an event,
 * an attachment — before anything is on disk. The first refusal stops it; the record the hooks filled is returned,
 * for the writer to store with the text.
 */
export function beforeTextWrite(ctx: Context, what: string): Record<string, unknown> {
  const text: TextWrite = { what, record: {} }
  for (const hook of ctx.registry.hooks) {
    const refusal = hook.beforeText?.(text, ctx)
    if (refusal === undefined) continue
    if (typeof refusal !== "string" || !refusal.trim()) {
      throw new TypeError(`write hook "${hook.name}" refused a write of ${what} without saying why — a refusal is a sentence`)
    }
    throw new NaimaError(`${refusal} (refused by ${hook.name})`, "vetoed")
  }
  return text.record
}

/**
 * The heading of the section that holds an item's notes: dated, attributed
 * entries that `naima note` appends and nothing rewrites.
 */
export const NOTES_HEADING = "## Notes"

/** A README cut in three: the title line, the description, and the Notes section (its heading to the next `## ` heading, or the end). */
export interface Prose {
  title: string
  description: string
  notes: string
}

/** The lines of `text` that are headings, by index: a line in a fenced code block is not one. */
function headingLines(lines: string[]): number[] {
  const at: number[] = []
  let fenced = false
  lines.forEach((l, i) => {
    if (/^\s*(```|~~~)/.test(l)) fenced = !fenced
    else if (!fenced && /^#{1,6}\s/.test(l)) at.push(i)
  })
  return at
}

/** Split a README into its title, its description and its Notes section; any part it lacks is empty. */
export function splitProse(text: string): Prose {
  const lines = text.split("\n")
  const headings = headingLines(lines)
  const titleAt = headings[0] === 0 && /^#\s/.test(lines[0] ?? "") ? 0 : -1
  const notesAt = headings.find((i) => lines[i]?.trimEnd() === NOTES_HEADING) ?? -1
  const notesEnd = notesAt < 0 ? -1 : headings.find((i) => i > notesAt && /^##\s/.test(lines[i] ?? "")) ?? lines.length
  const title = titleAt === 0 ? lines[0]! : ""
  const notes = notesAt < 0 ? "" : lines.slice(notesAt, notesEnd).join("\n").trim()
  const rest = lines.filter((_, i) => i !== titleAt && (notesAt < 0 || i < notesAt || i >= notesEnd))
  return { title, description: rest.join("\n").trim(), notes }
}

/** A README from its three parts, each separated by one blank line. */
export const joinProse = (p: Prose): string => [p.title, p.description, p.notes].filter((s) => s.trim()).join("\n\n") + "\n"

/**
 * Write an item's README, through every plugin's write hooks, as an `update`
 * whose `prose` is the text about to be written: a hook may refuse it or change
 * it. Its fields are written too when a hook changed them.
 */
export function saveProse(ctx: Context, item: Item, prose: string, opts: WriteOptions = {}): void {
  const write: Write = { kind: "update", item: { ...item, meta: { ...item.meta } }, before: onDisk(item.dir), ...flags(opts), prose }
  beforeWrite(ctx, write)
  writeFileAtomic(join(item.dir, README), write.prose ?? prose)
  generation++
  if (JSON.stringify(write.item.meta) !== JSON.stringify(write.before)) writeJson(join(item.dir, META), write.item.meta)
  item.meta = write.item.meta
  afterWrite(ctx, write)
}

/** Write an item's fields, through every plugin's write hooks. */
export function saveMeta(ctx: Context, item: Item, opts: WriteOptions = {}): void {
  const write: Write = { kind: "update", item, before: onDisk(item.dir), ...flags(opts) }
  beforeWrite(ctx, write)
  writeJson(join(item.dir, META), item.meta)
  afterWrite(ctx, write)
}

export function listDirs(path: string): string[] {
  if (!existsSync(path)) return []
  return readdirSync(path, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith(".") && !e.name.startsWith("_"))
    .map((e) => e.name)
    .sort()
}

const defaultTemplate = (title: string): string => `# ${title}\n\nDescribe it here.\n`

/**
 * The slug a new item takes, and the names it must not: a slug another local
 * branch already holds under the same type is taken too, so two branches that
 * open an item with one title do not both write `<type>/<slug>/` and meet in
 * an add/add conflict. When the other branches cannot be read, the slug ends
 * in the first eight characters of the item's uuid, which no other branch can
 * pick. Only the local branches: a branch not yet fetched is not seen.
 */
function slugFor(ctx: Context, base: string, title: string, id: string): { wanted: string; elsewhere: Set<string> } {
  const slug = slugify(title)
  const elsewhere = dirsAcrossBranches(ctx.trackerGit, relative(ctx.trackerGit, base))
  return elsewhere ? { wanted: slug, elsewhere } : { wanted: `${slug}-${id.slice(0, 8)}`, elsewhere: new Set() }
}

/** Open a new item, through every plugin's write hooks. Writes only inside its own new directory, and nothing when a hook refuses. */
export function createItem(ctx: Context, type: TypeDef, title: string, fields: Record<string, unknown> = {}, opts: WriteOptions = {}): Item {
  const base = join(ctx.trackerRoot, type.dir)
  const id = randomUUID()
  const { wanted, elsewhere } = slugFor(ctx, base, title, id)
  const meta: Meta = { id, title, status: type.initialStatus, created: today(ctx), ...fields }
  const write: Write = { kind: "create", item: { type: type.id, slug: wanted, dir: join(base, wanted), meta }, before: null, ...flags(opts) }
  beforeWrite(ctx, write)
  const slug = claimDir(base, wanted, elsewhere)
  const dir = join(base, slug)
  mkdirSync(join(dir, ATTACHMENTS))
  writeFileSync(join(dir, ATTACHMENTS, ".gitkeep"), "")
  writeFileSync(join(dir, README), (type.template ?? defaultTemplate)(title))
  const item: Item = { type: type.id, slug, dir, meta: write.item.meta }
  writeJson(join(dir, META), item.meta)
  write.item = item
  afterWrite(ctx, write)
  return item
}

/**
 * Move an item to another type's directory, keeping its id and slug, and
 * write its fields there as `item.meta` holds them: one write, through every
 * plugin's write hooks, so a refusal leaves the item where it was.
 */
export function moveItem(ctx: Context, item: Item, to: TypeDef, opts: WriteOptions = {}): Item {
  const write: Write = { kind: "move", item, before: onDisk(item.dir), to, force: opts.force === true }
  beforeWrite(ctx, write)
  const base = join(ctx.trackerRoot, to.dir)
  mkdirSync(base, { recursive: true })
  const slug = uniqueSlug(item.slug, new Set(listDirs(base)))
  const dir = join(base, slug)
  renameSync(item.dir, dir)
  const moved: Item = { type: to.id, slug, dir, meta: item.meta }
  writeJson(join(dir, META), moved.meta)
  write.item = moved
  afterWrite(ctx, write)
  return moved
}
