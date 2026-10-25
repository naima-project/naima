// The core's own contributions, declared through the same contract as any
// plugin: the generic fields and relations, the invariants, and the commands
// that work on any item type.

import { existsSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { bool, pairs, parse, str, strs, usageError } from "./args.ts"
import { coreChecks, runChecks } from "./check.ts"
import { groupBy } from "./collections.ts"
import { appliesTo, fieldValue, isOpenList, parseFieldValue } from "./fields.ts"
import { currentBranch, gitOrNull, isGitRepo } from "./git.ts"
import {
  ATTACHMENTS,
  createItem,
  isUuid,
  joinProse,
  moveItem,
  NOTES_HEADING,
  README,
  readReadme,
  saveMeta,
  saveProse,
  significantWords,
  splitProse,
  today,
  type WriteOptions,
} from "./item.ts"
import { byUrgency, isEvidenceType, isOpen, label, proves, refutes } from "./lifecycle.ts"
import { CONTRACT } from "./contract.ts"
import { shortOrId } from "./names.ts"
import { readText, writeFileAtomic } from "./files.ts"
import { addedPrivate, allowanceLine, privateContext, type PrivateFinding, privateRefusal } from "./private.ts"
import { asRendered, type Format, linesAs, rendered } from "./rendered.ts"
import { flagsOf } from "./vocabulary.ts"
import { waive, WAIVERS } from "./waivers.ts"
import { LEVEL, messagesCommand, messagesType } from "./messages.ts"
import type { Command, Context, Contribution, FieldDef, Item, Plugin, Rendered, SummarySection, TypeDef, View, Write, WriteHook } from "./types.ts"

export function typeOrThrow(ctx: Context, id: string | undefined): TypeDef {
  const type = id ? ctx.registry.types.get(id) : undefined
  if (!type) throw new Error(`unknown type ${JSON.stringify(id)} — types: ${[...ctx.registry.types.keys()].join(", ")}`)
  return type
}

/**
 * The fields `field=value` pairs give an item of `type`, validated against the
 * registry, applied to a copy of `meta`. Throws on the first invalid pair and
 * writes nothing, so a caller can validate before anything exists on disk.
 */
export function withFields<M extends Record<string, unknown>>(ctx: Context, type: string, meta: M, assignments: [string, string][]): M {
  const next: Record<string, unknown> = { ...meta }
  for (const [name, raw] of assignments) {
    if (name === "status") {
      const statuses = ctx.registry.types.get(type)?.statuses ?? {}
      if (!Object.hasOwn(statuses, raw)) throw new Error(`status "${raw}" is not one of: ${Object.keys(statuses).join(", ")}`)
      next["status"] = raw
      continue
    }
    if (name === "title") {
      if (!raw.trim()) throw new Error("title cannot be empty")
      next["title"] = raw
      continue
    }
    const def = ctx.registry.fields.get(name)
    if (!def || !appliesTo(def, type)) {
      const known = [...ctx.registry.fields.values()].filter((f) => appliesTo(f, type)).map((f) => f.name)
      throw new Error(`"${name}" is not a field of ${type} — fields: status, title, ${known.join(", ")}`)
    }
    if (raw === "") delete next[name]
    else next[name] = parseFieldValue(def, raw)
  }
  return next as M
}

/**
 * Set `field=value` pairs on an item, validated against the registry, through
 * every plugin's write hooks; nothing is written, and `item` is left as it
 * was, unless every pair is valid and no hook refuses.
 */
export function setFields(ctx: Context, item: Item, assignments: [string, string][], opts: WriteOptions = {}): void {
  const next: Item = { ...item, meta: withFields(ctx, item.type, item.meta, assignments) }
  // A rename keeps the page's `# ` title line in step with meta.json's title, in the same write,
  // so no agent has to remember to edit the page by hand (features/renaming-item-keeps-page-s-title-line).
  const prose = next.meta.title !== item.meta.title ? splitProse(readReadme(item)) : null
  if (prose?.title) saveProse(ctx, next, joinProse({ ...prose, title: `# ${next.meta.title}` }), opts)
  else saveMeta(ctx, next, opts)
  item.meta = next.meta
}

export function addLink(ctx: Context, from: Item, rel: string, to: Item): boolean {
  if (!ctx.registry.relations.has(rel)) throw new Error(`relation "${rel}" is not one of: ${[...ctx.registry.relations.keys()].join(", ")}`)
  if (from.meta.id === to.meta.id) throw new Error("an item cannot link to itself")
  // Stored here, or stored on `to` as the inverse: either way the link already exists.
  if (ctx.repo.linksOf(from).some((l) => l.rel === rel && l.id === to.meta.id)) return false
  const next: Item = { ...from, meta: { ...from.meta, links: [...(from.meta.links ?? []), { rel, id: to.meta.id }] } }
  saveMeta(ctx, next)
  from.meta = next.meta
  return true
}

const SECTION = { name: "section", kind: "string" } as const

const line = (item: Item): string => `  ${item.meta.status.padEnd(9)} ${item.meta.title}  — ${label(item)}`

/**
 * Items, of any type, whose title shares at least half of `title`'s
 * significant words — a hint for a human or agent about to file a report,
 * never a block: `new --dedupe` prints these before writing, and still
 * writes (features/capture-now-act-later-top-level-behaviour,
 * todos/deferral-reason-becomes-check-parked-wontfix-must).
 */
export function likelyDuplicatesOf(ctx: Context, type: string, title: string): Item[] {
  const words = new Set(significantWords(title))
  if (!words.size) return []
  return ctx.repo.items
    .filter((i) => i.type === type)
    .filter((i) => {
      const shared = significantWords(i.meta.title).filter((w) => words.has(w)).length
      return shared > 0 && shared * 2 >= words.size
    })
}

const newCommand: Command = {
  name: "new",
  says: "open an item",
  enforces:
    "every field is validated against its type's declarations before the item exists, and every write hook runs: a typo or a refusal leaves nothing behind; an archive type takes no new item",
  usage: 'new <type> "<title>" [--section <s>] [--set field=value]... [--dedupe]',
  options: [
    { name: "--section", says: "the heading the item is grouped under on its board" },
    { name: "--set", says: "a field=value pair to set on the new item; repeatable" },
    { name: "--dedupe", says: "print items of the same type with a similar title before writing; never blocks" },
  ],
  examples: [
    'new bugs "Export drops the alpha channel"',
    'new tests "Export keeps the alpha channel" --set runBy=agent --section export',
    'new todos "Retry export on timeout" --dedupe',
  ],
  run(args, ctx) {
    const p = parse(args, { section: { type: "string" }, set: { type: "string", multiple: true }, dedupe: { type: "boolean" } })
    const [typeId, title] = p.positionals
    const type = typeOrThrow(ctx, typeId)
    if (type.creatable === false) throw new Error(`${type.id} is an archive: items arrive by being moved there, not by being opened`)
    if (!title?.trim()) throw usageError(this)
    const section = str(p, "section")
    // Every assignment is validated before the item exists: a typo leaves nothing behind.
    const fields = withFields(ctx, type.id, section ? { section } : {}, pairs(strs(p, "set")))
    if (bool(p, "dedupe")) {
      const likely = likelyDuplicatesOf(ctx, type.id, title.trim())
      if (likely.length) {
        ctx.out("similar titles, which may be the same thing or only related — link one if it is the same, or file anyway:")
        for (const item of likely) ctx.out(line(item))
        // Said apart from the list, so the new item is never read as one of its own duplicates.
        ctx.out("filed anyway, as a new item:")
      }
    }
    const item = createItem(ctx, type, title.trim(), fields, { authored: true })
    ctx.out(`${ctx.trackerDir}/${type.dir}/${item.slug}/  ${item.meta.id}`)
    return 0
  },
}

/** A link of an item, as `naima show --json` gives it: the other end's title and status, and whether it is evidence — an item of a type that can prove — and proves or refutes now. */
export interface ItemLink {
  rel: string
  /** What the relation says, read from this item's side. */
  says: string
  id: string
  /** The other end, or null when it is not in the tracker. */
  ref: string | null
  title: string | null
  status: string | null
  /** Derived from the other end's stored link, not stored on this item. */
  implied: boolean
  evidence: boolean
  proves: boolean
  refutes: boolean
}

/** One item, as `naima show --json` prints it and the window's item view shows it: its fields, its links both ways, its attachments, its prose. */
export interface ItemData {
  id: string
  ref: string
  type: string
  title: string
  status: string
  /** Every other field of meta.json, as stored. */
  fields: Record<string, unknown>
  links: ItemLink[]
  /** The files of its attachments/ directory: the evidence attached to it. */
  attachments: string[]
  readme: string
}

/** One item, read now: what `naima show` prints. */
export function itemData(ctx: Context, item: Item): ItemData {
  const { id, title, status, links: _links, ...fields } = item.meta
  const att = join(item.dir, ATTACHMENTS)
  return {
    id,
    ref: label(item),
    type: item.type,
    title,
    status,
    fields,
    links: ctx.repo.linksOf(item).map((l) => {
      const other = ctx.repo.byId.get(l.id)
      return {
        rel: l.rel,
        says: ctx.registry.relations.get(l.rel)?.says ?? l.rel,
        id: l.id,
        ref: other ? label(other) : null,
        title: other?.meta.title ?? null,
        status: other?.meta.status ?? null,
        implied: l.implied === true,
        evidence: other ? isEvidenceType(ctx, other.type) : false,
        proves: other ? proves(ctx, other) : false,
        refutes: other ? refutes(ctx, other) : false,
      }
    }),
    attachments: existsSync(att) ? readdirSync(att).filter((f) => !f.startsWith(".")).sort() : [],
    readme: readReadme(item).trimEnd(),
  }
}

const show: Command = {
  name: "show",
  says: "print one item: fields, links in both directions, attachments, prose",
  enforces: "nothing: it only reads",
  usage: "show <item> [--json]",
  options: [{
    name: "--json",
    says:
      "print the item as JSON: its fields, its links with the other end's title and status and whether it is evidence that proves or refutes, its attachments, its prose",
  }],
  examples: ["show export-drops", "show bugs/export-drops-alpha-channel", "show export-drops --json"],
  run(args, ctx) {
    const p = parse(args, { json: { type: "boolean" } })
    const ref = p.positionals[0]
    if (!ref?.trim()) throw usageError(this)
    const d = itemData(ctx, ctx.repo.resolve(ref))
    if (bool(p, "json")) {
      ctx.out(JSON.stringify(d, null, 2))
      return 0
    }
    ctx.out(`${d.title}\n${d.ref}  ${d.id}  [${d.status}]`)
    for (const [k, v] of Object.entries(d.fields)) ctx.out(`  ${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`)
    for (const l of d.links) ctx.out(`  ${l.says} ${l.ref ? `${l.ref} [${l.status}]` : l.id}${l.implied ? "  (inverse)" : ""}`)
    if (d.attachments.length) ctx.out(`  attachments: ${d.attachments.join(", ")}`)
    ctx.out("")
    ctx.out(d.readme)
    return 0
  },
}

const list: Command = {
  name: "list",
  says: "list items, most urgent first",
  enforces: "nothing: it only reads",
  usage: "list [type] [--open]",
  options: [{ name: "--open", says: "only items whose status is in the open category" }],
  examples: ["list", "list bugs --open"],
  run(args, ctx) {
    const p = parse(args, { open: { type: "boolean" } })
    const typeId = p.positionals[0]
    if (typeId) typeOrThrow(ctx, typeId)
    const items = ctx.repo.items.filter((i) => (!typeId || i.type === typeId) && (!bool(p, "open") || isOpen(ctx, i)))
    for (const item of byUrgency(ctx, items)) ctx.out(line(item))
    ctx.out(`${items.length} item${items.length === 1 ? "" : "s"}`)
    return 0
  },
}

const set: Command = {
  name: "set",
  says: "set fields on an item; an empty value removes the field",
  enforces:
    "every pair is validated against the declared fields and passes every write hook (a status moves only along its type's transitions, and each plugin's own hooks); nothing is written unless all pass",
  usage: "set <item> field=value...",
  examples: ["set export-drops status=partial area=export", "set export-drops area="],
  run(args, ctx) {
    const [ref, ...rest] = parse(args).positionals
    if (!ref?.trim() || !rest.length) throw usageError(this)
    const item = ctx.repo.resolve(ref)
    setFields(ctx, item, pairs(rest), { authored: true })
    ctx.out(`${label(item)}: ${rest.join(" ")}`)
    return 0
  },
}

const link: Command = {
  name: "link",
  says: "link two items; only this direction is stored, the inverse is derived",
  enforces: "the relation is a declared one and an item never links to itself; only one direction is stored",
  usage: "link <from> <relation> <to>",
  examples: ["link export-keeps verifies export-drops", "link export-drops blocked-by release-notes"],
  run(args, ctx) {
    const [from, rel, to] = parse(args).positionals
    if (!from || !rel || !to) throw usageError(this)
    const a = ctx.repo.resolve(from)
    const b = ctx.repo.resolve(to)
    ctx.out(addLink(ctx, a, rel, b) ? `${label(a)} ${rel} ${label(b)}` : "already linked")
    return 0
  },
}

const unlink: Command = {
  name: "unlink",
  says: "remove a stored link; a target that no longer exists is named by its id",
  enforces: "only a stored link is removed: an inverse is derived, never stored",
  usage: "unlink <from> <relation> <to>",
  examples: ["unlink export-keeps verifies export-drops", "unlink export-keeps verifies 0b8e6c3a-5f1d-4c2e-9a7b-3d4e5f6a7b8c"],
  run(args, ctx) {
    const [from, rel, to] = parse(args).positionals
    if (!from || !rel || !to) throw usageError(this)
    const a = ctx.repo.resolve(from)
    // A link may outlive its target: a full id that no item has still names the stored link.
    const b = isUuid(to) && !ctx.repo.items.some((i) => i.meta.id === to) ? null : ctx.repo.resolve(to)
    const id = b ? b.meta.id : to
    const target = b ? label(b) : to
    const stored = a.meta.links ?? []
    const kept = stored.filter((l) => !(l.rel === rel && l.id === id))
    if (kept.length === stored.length) throw new Error(`${label(a)} stores no "${rel}" link to ${target}`)
    const { links: _links, ...rest } = a.meta
    saveMeta(ctx, { ...a, meta: kept.length ? { ...rest, links: kept } : rest })
    ctx.out(`removed ${label(a)} ${rel} ${target}`)
    return 0
  },
}

/** The text a prose command writes: its `--file`, else its arguments after the item, trimmed; a usage error when empty. */
function proseText(cmd: Command, file: string | undefined, words: string[]): string {
  const text = (file ? readText(file) : words.join(" ")).trim()
  if (!text) throw usageError(cmd)
  return text
}

/** The lines of `text` that are markdown headings, outside fenced code blocks. */
const headings = (text: string): string[] => {
  let fenced = false
  return text.split("\n").filter((l) => {
    if (/^\s*(```|~~~)/.test(l)) fenced = !fenced
    else if (!fenced && /^#{1,6}\s/.test(l)) return true
    return false
  })
}

/** Who writes a note: `--by`, else git's user.name in a git project; refused when neither says. */
function author(ctx: Context, by: string | undefined): string {
  const who = by?.trim() || (isGitRepo(ctx.root) ? gitOrNull(ctx.root, "config", "user.name") : null)
  if (!who) throw new Error("say who writes the note: --by <name>, or set git's user.name")
  return who
}

const note: Command = {
  name: "note",
  says:
    "append a dated, attributed note to an item's Notes section: the writer's own words, never a person's message pasted in; earlier notes are never rewritten",
  enforces: "notes are append-only and attributed: the writer is named, earlier notes are never rewritten, and a note holds no heading of its own",
  usage: 'note <item> "<text>" [--by <who>] | note <item> --file <f> [--by <who>]',
  options: [
    { name: "--by", says: "who writes the note; without it, git's user.name" },
    { name: "--file", says: "read the note from a file instead of the arguments; - reads standard input" },
  ],
  examples: ['note export-drops "Reproduced on a 16-bit PNG; 8-bit keeps alpha." --by "triage agent"', "note export-drops --file finding.md"],
  run(args, ctx) {
    const p = parse(args, { by: { type: "string" }, file: { type: "string" } })
    const [ref, ...words] = p.positionals
    if (!ref?.trim()) throw usageError(this)
    const text = proseText(this, str(p, "file"), words)
    if (headings(text).length) throw new Error(`a note sits under its own dated heading, so it holds none: write it without "${headings(text)[0]}"`)
    const item = ctx.repo.resolve(ref)
    const who = author(ctx, str(p, "by"))
    const branch = isGitRepo(ctx.root) ? currentBranch(ctx.root) : "HEAD"
    const entry = `### ${today(ctx)} — ${who}${branch === "HEAD" ? "" : `, on ${branch}`}\n\n${text}`
    const prose = splitProse(readReadme(item))
    saveProse(ctx, item, joinProse({ ...prose, notes: [prose.notes || NOTES_HEADING, entry].join("\n\n") }), { authored: true })
    ctx.out(`${label(item)}: note added`)
    return 0
  },
}

const describe: Command = {
  name: "describe",
  says: "replace an item's description, keeping its title line and its Notes section",
  enforces: "the title line and the Notes section stay as they are: a description holding a title or a Notes section is refused",
  usage: 'describe <item> "<text>" | describe <item> --file <f>',
  options: [{ name: "--file", says: "read the description from a file instead of the arguments; - reads standard input" }],
  examples: ['describe export-drops "Export to PNG loses the alpha channel; done when every bit depth keeps it."', "describe export-drops --file triaged.md"],
  run(args, ctx) {
    const p = parse(args, { file: { type: "string" } })
    const [ref, ...words] = p.positionals
    if (!ref?.trim()) throw usageError(this)
    const text = proseText(this, str(p, "file"), words)
    const hs = headings(text)
    if (/^#\s/.test(text)) throw new Error(`the title is not part of the description: change it with naima set ${ref} title="..."`)
    if (hs.some((h) => h.trimEnd() === NOTES_HEADING)) throw new Error(`a description holds no ${NOTES_HEADING} section: notes are added with naima note`)
    const item = ctx.repo.resolve(ref)
    const prose = splitProse(readReadme(item))
    saveProse(ctx, item, joinProse({ ...prose, title: prose.title || `# ${item.meta.title}`, description: text }), { authored: true })
    ctx.out(`${label(item)}: description replaced`)
    return 0
  },
}

const move: Command = {
  name: "move",
  says: "move an item to another type, keeping its id and links; refuses a status or field the new type does not declare",
  enforces: "the id and links are kept; a status or field the new type does not declare is refused unless --force",
  usage: "move <item> <type> [--force]",
  options: [{ name: "--force", says: "move it even with a status or a field the new type does not declare, kept as they are" }],
  examples: ["move export-drops features", "move export-drops features --force"],
  run(args, ctx) {
    const p = parse(args, { force: { type: "boolean" } })
    const [ref, typeId] = p.positionals
    if (!ref?.trim() || !typeId?.trim()) throw usageError(this)
    const item = ctx.repo.resolve(ref)
    const to = typeOrThrow(ctx, typeId)
    if (to.id === item.type) throw new Error(`${label(item)} is already a ${to.id} item`)
    const force = bool(p, "force")
    if (!force && !Object.hasOwn(to.statuses, item.meta.status)) {
      throw new Error(`${to.id} does not have a status "${item.meta.status}" — statuses: ${Object.keys(to.statuses).join(", ")} (--force keeps it as it is)`)
    }
    // Unknown fields are kept and not checked, everywhere (the core's own rule); only a field the
    // registry does know, and ties to other types, is a reason to refuse a move.
    const { id: _id, title: _title, status: _status, created: _created, links: _links, ...rest } = item.meta
    const strays = Object.keys(rest).filter((k) => {
      const def = ctx.registry.fields.get(k)
      return def !== undefined && !appliesTo(def, to.id)
    })
    if (!force && strays.length) {
      throw new Error(`${to.id} does not declare field(s) ${strays.join(", ")} on ${label(item)} (--force keeps them as they are)`)
    }
    const moved = moveItem(ctx, item, to, { force })
    ctx.out(`${ctx.trackerDir}/${to.dir}/${moved.slug}/  ${moved.meta.id}`)
    return 0
  },
}

const check: Command = {
  name: "check",
  says: "run every invariant; exit 1 on any problem",
  enforces: "every invariant the loaded plugins declare (their checks): exit 1 on any problem; with --staged, the ones the pre-commit hook runs",
  usage: "check [--staged] [--all-worktrees]",
  options: [
    { name: "--staged", says: "run only the checks that read the change staged for the next commit: what the pre-commit hook runs" },
    { name: "--all-worktrees", says: "the coordinator's view: every worktree's missing claim is a problem, not only the one being checked" },
  ],
  examples: ["check", "check --staged", "check --all-worktrees"],
  async run(args, ctx) {
    const p = parse(args, { staged: { type: "boolean" }, "all-worktrees": { type: "boolean" } })
    if (p.positionals.length) throw usageError(this)
    const staged = bool(p, "staged")
    const { problems, notes } = await runChecks(ctx, { staged, allWorktrees: bool(p, "all-worktrees") })
    const count = staged ? ctx.registry.checks.filter((c) => c.staged === true).length : ctx.registry.checks.length
    ctx.out(`${ctx.repo.items.length} items, ${count} ${staged ? "staged-change " : ""}checks`)
    if (notes.length) {
      ctx.out("\nnotes (not failures):")
      for (const n of notes) ctx.out(`  · ${n.message}`)
    }
    if (problems.length) {
      ctx.out(`\nFAILED (${problems.length}):`)
      for (const p of problems) ctx.out(`  ✗ ${p.message}`)
      return 1
    }
    ctx.out("\nall invariants hold")
    return 0
  },
}

/** An item on a board, as `naima board --json` gives it. */
export interface BoardRow {
  id: string
  ref: string
  title: string
  status: string
}

/** A type's board, as `naima board --json` prints it and the window's board view shows it: its open items by section, most urgent first; its done ones when asked for. */
export interface BoardData {
  type: string
  title: string
  open: number
  done: number
  /** The open items by section, sections by name, the items with none last under "". */
  sections: { section: string; items: BoardRow[] }[]
  /** The done items, with --all; absent otherwise. */
  closed?: BoardRow[]
}

/** A board is derived on demand and never stored. */
export function boardData(ctx: Context, type: TypeDef, all: boolean): BoardData {
  const items = ctx.repo.items.filter((i) => i.type === type.id)
  const open = byUrgency(ctx, items.filter((i) => isOpen(ctx, i)))
  const row = (i: Item): BoardRow => ({ id: i.meta.id, ref: label(i), title: i.meta.title, status: i.meta.status })
  const sections = [...groupBy(open, (item) => fieldValue(item, SECTION) ?? "")]
    .sort(([a], [b]) => (a === "" ? 1 : b === "" ? -1 : a.localeCompare(b)))
    .map(([section, group]) => ({ section, items: group.map(row) }))
  return {
    type: type.id,
    title: type.title,
    open: open.length,
    done: items.length - open.length,
    sections,
    ...(all ? { closed: items.filter((i) => !isOpen(ctx, i)).map(row) } : {}),
  }
}

const boardLine = (r: BoardRow): string => `  ${r.status.padEnd(9)} ${r.title}  — ${r.ref}`

export function renderBoard(ctx: Context, type: TypeDef, all: boolean): string[] {
  const d = boardData(ctx, type, all)
  const out = [`# ${d.title}`, "", `${d.open} open, ${d.done} done`]
  for (const s of d.sections) out.push("", `## ${s.section || "(no section)"}`, ...s.items.map(boardLine))
  if (d.closed?.length) out.push("", "## done", ...d.closed.map(boardLine))
  return out
}

/** The summary sections that stand beside the work — `alongside: true` — each under its name: the foot of a board or a queue. */
export async function alongside(ctx: Context): Promise<string[]> {
  const out: string[] = []
  for (const c of ctx.registry.contributions("summary")) {
    const section = c.value as SummarySection
    if (section.alongside !== true) continue
    const lines = asRendered(await section.render(ctx), `summary section "${c.name}"`).text()
    if (lines.length) out.push("", `── ${shortOrId(ctx, "summary", c)}`, ...lines)
  }
  return out
}

/** What the summary sections say of where the project is going (their `goals`), rendered now: what `naima hello` says after the update check, before what waits on the owner. */
export async function goalsAtSessionStart(ctx: Context): Promise<string[]> {
  const out: string[] = []
  for (const c of ctx.registry.contributions("summary")) {
    const section = c.value as SummarySection
    if (section.goals) out.push(...asRendered(await section.goals(ctx), `summary section "${c.name}" goals`).text())
  }
  return out
}

/** The summary sections marked `hello: true`, rendered now, their lines as they are: what `naima hello` says after the update check. */
export async function atSessionStart(ctx: Context): Promise<string[]> {
  const out: string[] = []
  for (const c of ctx.registry.contributions("summary")) {
    const section = c.value as SummarySection
    if (section.hello === true) out.push(...asRendered(await section.render(ctx), `summary section "${c.name}"`).text())
  }
  return out
}

const board: Command = {
  name: "board",
  says: "print a type's board, grouped by section, most urgent first; at its foot, the summary sections that stand beside the work, such as the metrics",
  enforces: "nothing: it prints derived state, never stored",
  usage: "board <type> [--all] [--json]",
  options: [
    { name: "--all", says: "also list the items whose status is done" },
    { name: "--json", says: "print the board as JSON: the open items by section, most urgent first, and the done ones with --all; the foot is the summary's" },
  ],
  examples: ["board bugs", "board todos --all", "board bugs --json"],
  async run(args, ctx) {
    const p = parse(args, { all: { type: "boolean" }, json: { type: "boolean" } })
    const type = typeOrThrow(ctx, p.positionals[0])
    if (bool(p, "json")) {
      ctx.out(JSON.stringify(boardData(ctx, type, bool(p, "all")), null, 2))
      return 0
    }
    for (const l of renderBoard(ctx, type, bool(p, "all"))) ctx.out(l)
    for (const l of await alongside(ctx)) ctx.out(l)
    return 0
  },
}

/** The format the leading --json or --markdown of `args` asks for, and the arguments after them. */
function formatOf(args: string[]): { format: Format; rest: string[] } {
  let format: Format = "text"
  let at = 0
  for (; at < args.length; at++) {
    const flag = args[at]
    if (flag === "--json") format = "json"
    else if (flag === "--markdown") format = "markdown"
    else break
  }
  return { format, rest: args.slice(at) }
}

const view: Command = {
  name: "view",
  says: "print a plugin view — as text, its data as JSON, or markdown; without a name, list them",
  enforces: "nothing: it prints derived state, never stored",
  usage: "view [--json | --markdown] [name] [args...]",
  options: [
    { name: "--json", says: "print the view's data as JSON, as the view derived it" },
    { name: "--markdown", says: "print the view as markdown, or as its text when it has no markdown of its own" },
  ],
  examples: ["view", "view next 10", "view --json next 10"],
  async run(args, ctx) {
    const { format, rest: [name, ...rest] } = formatOf(args)
    const views = ctx.registry.contributions("views")
    if (!name) {
      for (const c of views) ctx.out(`  ${shortOrId(ctx, "views", c).padEnd(16)} ${(c.value as View).says}`)
      return 0
    }
    const v = ctx.registry.find<View>("views", name)?.value
    if (!v) throw new Error(`no view "${name}" — views: ${views.map((c) => shortOrId(ctx, "views", c)).join(", ")}`)
    for (const l of linesAs(asRendered(await v.render(rest, ctx), `view "${name}"`), format)) ctx.out(l)
    return 0
  },
}

/** Every plugin's summary section, rendered now, under the name `naima summary` prints it with: what the command and the window both show. */
export function summarySections(ctx: Context): Promise<{ name: string; rendering: Rendered }[]> {
  return Promise.all(
    ctx.registry.contributions("summary").map(async (c) => ({
      name: shortOrId(ctx, "summary", c),
      rendering: asRendered(await (c.value as SummarySection).render(ctx), `summary section "${c.name}"`),
    })),
  )
}

const summary: Command = {
  name: "summary",
  says: "where the project stands, in one screen: every plugin's section",
  enforces: "nothing: it prints derived state, never stored",
  usage: "summary [--json | --markdown]",
  options: [
    { name: "--json", says: "print the sections as one JSON object, section name to the data it rendered" },
    { name: "--markdown", says: "print each section under its own heading, as markdown" },
  ],
  examples: ["summary", "summary --json", "summary --markdown"],
  async run(args, ctx) {
    const p = parse(args, { json: { type: "boolean" }, markdown: { type: "boolean" } })
    if (bool(p, "json") && bool(p, "markdown")) throw usageError(this)
    const sections = await summarySections(ctx)
    if (bool(p, "json")) {
      ctx.out(JSON.stringify(Object.fromEntries(sections.map((s) => [s.name, s.rendering.data])), null, 2))
      return 0
    }
    const markdown = bool(p, "markdown")
    for (const s of sections) {
      const lines = linesAs(s.rendering, markdown ? "markdown" : "text")
      if (!lines.length) continue
      ctx.out(markdown ? `## ${s.name}\n` : `── ${s.name}`)
      for (const l of lines) ctx.out(l)
      ctx.out()
    }
    return 0
  },
}

const plugins: Command = {
  name: "plugins",
  says:
    "list loaded plugins, the extension points each declares, what each uses of the others, and what each contributes to every point; a contribution's qualified id is <plugin>/<name>, shown when its short name is shared or renamed",
  enforces: "nothing: it only reads",
  usage: "plugins",
  examples: ["plugins"],
  run(_args, ctx) {
    for (const p of ctx.registry.plugins) {
      ctx.out(`${p.name} — ${p.says}`)
      if (p.points?.length) ctx.out(`  ${"points".padEnd(10)} ${p.points.map((pt) => pt.id).join(", ")}`)
      const uses = Object.entries(p.uses ?? {}).filter(([, refs]) => refs.length)
      if (uses.length) ctx.out(`  ${"uses".padEnd(10)} ${uses.map(([id, refs]) => `${id} ${refs.join(", ")}`).join("; ")}`)
      for (const kind of ctx.registry.points.keys()) {
        const mine = ctx.registry.contributions(kind).filter((c) => c.plugin === p.name)
        // The short name a person types, and the qualified id when it differs from <plugin>/<name> or the short name is shared.
        const said = mine.map((c) => (shortOrId(ctx, kind, c) === c.name && c.id === `${p.name}/${c.name}` ? c.name : `${c.name} (${c.id})`))
        if (said.length) ctx.out(`  ${kind.padEnd(10)} ${said.join(", ")}`)
      }
    }
    return 0
  },
}

/** What `c` declares it starts: its `runs`, the external programs any contribution may name. */
const runsOf = (c: Contribution): string[] => {
  const runs = (c.value as { runs?: unknown } | null)?.runs
  return Array.isArray(runs) ? runs.filter((r): r is string => typeof r === "string") : []
}

/** Every contribution, to any point, that declares programs it starts. */
const starting = (ctx: Context): { point: string; c: Contribution }[] =>
  [...ctx.registry.points.keys()].flatMap((point) => ctx.registry.contributions(point).filter((c) => runsOf(c).length).map((c) => ({ point, c })))

/** The programs the loaded contributions declare they start: what the launcher grants besides git. */
export const declaredRuns = (ctx: Context): string[] => [...new Set(starting(ctx).flatMap(({ c }) => runsOf(c)))].sort()

const runs: Command = {
  name: "runs",
  says: "list the external programs the loaded contributions declare they start (a model checker, say), which the launcher allows besides git",
  enforces: "nothing: it lists the programs the launcher allows besides git; the launcher refuses any other",
  usage: "runs [--json]",
  options: [{ name: "--json", says: "print them as one JSON list: what the launcher reads" }],
  examples: ["runs", "runs --json"],
  run(args, ctx) {
    const p = parse(args, { json: { type: "boolean" } })
    const tools = declaredRuns(ctx)
    if (bool(p, "json")) ctx.out(JSON.stringify(tools))
    else if (!tools.length) ctx.out("no contribution starts a program: the launcher allows git alone")
    else for (const { point, c } of starting(ctx)) ctx.out(`  ${point.padEnd(10)} ${c.id.padEnd(24)} ${runsOf(c).join(", ")}`)
    return 0
  },
}

/** Every value an item holds of a field: one string, or each string of a list. */
const heldValues = (v: unknown): string[] => (typeof v === "string" ? [v] : Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [])

/** A field's list of values, each with how many items hold it, then the values held that are not on it. */
function valueLines(ctx: Context, def: FieldDef): string[] {
  const counts = new Map<string, number>()
  for (const item of ctx.repo.items) {
    if (!appliesTo(def, item.type)) continue
    for (const v of heldValues(item.meta[def.name])) counts.set(v, (counts.get(v) ?? 0) + 1)
  }
  const listed = Object.entries(def.values ?? {})
  const off = [...counts.keys()].filter((v) => !Object.hasOwn(def.values ?? {}, v)).sort()
  const width = Math.max(...[...listed.map(([v]) => v), ...off].map((v) => v.length), 8)
  const row = (v: string, said: string) => `  ${v.padEnd(width)} ${String(counts.get(v) ?? 0).padStart(4)}  ${said}`
  const meaning = (v: string, says: string): string => {
    const title = def.titles?.[v]
    return title && says && title !== says ? `${title} — ${says}` : title || says
  }
  return [
    `${def.name} — ${def.kind === "enum" ? "fixed" : "open"} list`,
    ...listed.map(([v, says]) => row(v, meaning(v, says))),
    ...off.map((v) => row(v, "not on the list")),
  ]
}

const types: Command = {
  name: "types",
  says: "list item types, their statuses and fields, then every field's list of values with how many items hold each",
  enforces: "nothing: it only reads",
  usage: "types",
  examples: ["types"],
  run(_args, ctx) {
    for (const t of ctx.registry.types.values()) {
      ctx.out(`${t.id} (${ctx.trackerDir}/${t.dir}/) — ${t.says}`)
      for (const [name, s] of Object.entries(t.statuses)) {
        ctx.out(`  ${name.padEnd(10)} ${[s.category, ...flagsOf(s)].join(", ")} — ${s.says}`)
      }
      const fields = [...ctx.registry.fields.values()].filter((f) => appliesTo(f, t.id)).map((f) => f.name)
      ctx.out(`  fields: ${fields.join(", ")}`)
    }
    const listed = [...ctx.registry.fields.values()].filter((f) => (f.kind === "enum" || isOpenList(f)) && Object.keys(f.values ?? {}).length)
    if (listed.length) ctx.out("")
    for (const def of listed) for (const line of valueLines(ctx, def)) ctx.out(line)
    return 0
  },
}

const counts: SummarySection = {
  name: "items",
  render(ctx) {
    const rows = [...ctx.registry.types.values()].flatMap((t) => {
      const mine = ctx.repo.items.filter((i) => i.type === t.id)
      const open = mine.filter((i) => isOpen(ctx, i)).length
      return mine.length ? [{ type: t.id, open, done: mine.length - open }] : []
    })
    return rendered(
      rows,
      (rs) => rs.map((r) => `  ${r.type.padEnd(12)} ${String(r.open).padStart(4)} open  ${String(r.done).padStart(4)} done`),
      (rs) => (rs.length ? ["| Type | Open | Done |", "|---|---|---|", ...rs.map((r) => `| ${r.type} | ${r.open} | ${r.done} |`)] : []),
    )
  },
}

/** A type's transitions, held on every write: a status moves only to one its type allows from where it is. */
const statusMoves: WriteHook = {
  name: "status-moves",
  says:
    "a status moves only to one its type's transitions allow from the status it has; a status the transitions do not name moves to any, and --force takes the move on",
  beforeWrite(write, ctx) {
    const { item, before } = write
    if (write.kind !== "update" || !before || before.status === item.meta.status || write.force) return
    const allowed = ctx.registry.types.get(item.type)?.transitions
    const to = allowed && Object.hasOwn(allowed, before.status) ? allowed[before.status] : undefined
    if (!to || to.includes(item.meta.status)) return
    return `${label(item)}: from ${before.status} its status moves to ${to.join(", ") || "nothing"}, not ${item.meta.status}`
  },
}

/** The Notes section only grows: a prose write that changes or drops a note already there is refused, unless --force. */
const notesAppendOnly: WriteHook = {
  name: "notes-append-only",
  says: "a write of an item's prose keeps its Notes section as it was and may only add after it; --force takes a rewrite on",
  beforeWrite(write) {
    if (write.prose === undefined || write.force) return
    const was = splitProse(readReadme(write.item)).notes
    if (splitProse(write.prose).notes.startsWith(was)) return
    return `${label(write.item)}: the Notes section is append-only — add a note with naima note, or pass --force to rewrite it`
  },
}

/** Every string an item's fields hold, by its path: `title`, `links.0.rel`. */
function fieldStrings(value: unknown, path = ""): Map<string, string> {
  const out = new Map<string, string>()
  if (typeof value === "string") out.set(path, value)
  else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) for (const [p, s] of fieldStrings(v, path ? `${path}.${k}` : k)) out.set(p, s)
  }
  return out
}

/** The reasons let through by the writes under way, for afterWrite to record in the item's notes. */
const allowed = new WeakMap<Write, string>()

const privateInfrastructure: WriteHook = {
  name: "private-infrastructure",
  says:
    "a write of an item's title, fields or prose that adds a machine name, an IP address, a URI with a port, a home-directory path, the user's name or a word of the private list is refused, each finding listed with the placeholder to write instead; --allow-private \"<reason>\" lets a deliberate mention through and records the reason in the item's notes",
  beforeWrite(write, ctx) {
    const pc = privateContext()
    const found: { what: string; findings: PrivateFinding[] }[] = []
    const before = fieldStrings(write.kind === "create" ? {} : write.before ?? {})
    for (const [path, value] of fieldStrings(write.item.meta)) {
      const findings = addedPrivate(before.get(path) ?? "", value, pc)
      if (findings.length) found.push({ what: `field ${path}`, findings })
    }
    if (write.prose !== undefined) {
      const findings = addedPrivate(readReadme(write.item), write.prose, pc)
      if (findings.length) found.push({ what: "README.md", findings })
    }
    if (!found.length) return
    const all = found.flatMap((f) => f.findings)
    if (ctx.allowPrivate === undefined) {
      return found.map((f) => privateRefusal(`${label(write.item)} ${f.what}`, f.findings)).join("\n")
    }
    allowed.set(write, allowanceLine(ctx.allowPrivate, all))
  },
  afterWrite(write, ctx) {
    const line = allowed.get(write)
    if (line === undefined) return
    allowed.delete(write)
    const prose = splitProse(readReadme(write.item))
    const entry = `### ${today(ctx)} — naima\n\n${line}`
    writeFileAtomic(join(write.item.dir, README), joinProse({ ...prose, notes: [prose.notes || NOTES_HEADING, entry].join("\n\n") }))
  },
}

export const corePlugin: Plugin = {
  name: "core",
  contract: CONTRACT,
  says: "items, fields, links and the invariants every project has",
  about: "An item is a directory under `<tracker>/<TYPE>/<slug>/`: `README.md` for the prose, `meta.json` for the fields, `attachments/` for the evidence. " +
    "`meta.json` always holds `id` (a permanent uuid), `title` and `status` (one the item's type declares), and optionally `links`, a list of `{ rel, id }`. The slug may change; the id may not, and links hold ids. " +
    "An item reference on the command line is an id, `type/slug`, a slug, or a fragment of a slug that matches one item. " +
    "Fields are typed by the plugin that declares them — `string`, `strings` (comma-separated on the command line), `date` (YYYY, YYYY-MM or YYYY-MM-DD), `enum` (values in rank order), `boolean`, `number`, `object` (a JSON object, written as JSON on the command line) — and unknown fields are kept and not checked. " +
    "Only one direction of a link is stored; the inverse is derived when read. Boards, queues, gate states and summaries are derived when asked and never stored. " +
    "An item is open or done by its status's category; urgency is the sum of every plugin's rank terms, and done items sink. " +
    'A check\'s finding can be waived when it is accepted rather than fixed: `naima waive <check> <subject> --reason "<why>"` writes one file under `waivers/` naming the check, the subject, the reason, who and when. ' +
    "A waived finding is not a failure; every `naima check` lists the waivers in use as notes, and notes a waiver whose subject no longer exists or no longer fails. " +
    "Only a check that names the subject of its findings can be waived.",
  fields: [
    { name: "section", kind: "string", says: "the heading the item is grouped under on its board" },
    { name: "created", kind: "date", says: "when the item was opened" },
    { name: "tags", kind: "strings", says: "free labels a person puts on an item" },
    LEVEL,
  ],
  relations: [
    { name: "relates-to", inverse: "relates-to", says: "is related to" },
    { name: "duplicate-of", inverse: "duplicate-of", says: "describes the same thing as" },
    { name: "blocks", inverse: "blocked-by", says: "must be resolved before" },
    { name: "blocked-by", inverse: "blocks", says: "waits on" },
  ],
  types: [messagesType],
  dirs: [WAIVERS],
  checks: coreChecks,
  commands: [newCommand, show, list, set, note, describe, link, unlink, move, check, waive, board, view, summary, plugins, types, runs, messagesCommand],
  summary: [counts],
  hooks: [statusMoves, notesAppendOnly, privateInfrastructure],
}
