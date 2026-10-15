// The invariants the core owns, and running every plugin's alongside them.
// A problem fails `naima check`; a note is for a human and never fails it.

import { existsSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { groupBy } from "./collections.ts"
import { message } from "./errors.ts"
import { formatCheck } from "./format.ts"
import { appliesTo, fieldError, fieldsOf, isOpenList, offList } from "./fields.ts"
import { isUuid, README, titleWords } from "./item.ts"
import { label } from "./lifecycle.ts"
import { brokenEntryLinks } from "./pointer.ts"
import { storedLinks } from "./repo.ts"
import type { Check, CheckOptions, Context, Finding, Item } from "./types.ts"
import { unreadOptions } from "./updates.ts"

const problem = (message: string, item?: Finding["item"]): Finding => (item ? { level: "problem", message, item } : { level: "problem", message })
const note = (message: string): Finding => ({ level: "note", message })

const readable: Check = {
  name: "readable",
  says:
    "every item directory has a README.md and a meta.json that parses to an object whose id, title and status are strings; no symbolic link or _-prefixed directory sits unread among the items",
  run: (ctx) => [
    ...ctx.repo.unreadable,
    ...ctx.repo.items.filter((i) => !existsSync(join(i.dir, README))).map((i) => problem(`${label(i)}: no ${README}`, i)),
  ],
}

const identity: Check = {
  name: "identity",
  says: "every item has a permanent uuid, a title and a status its type declares; ids are unique",
  run(ctx) {
    const out: Finding[] = []
    const seen = new Map<string, string>()
    for (const item of ctx.repo.items) {
      const where = label(item)
      const { id, title, status } = item.meta
      if (!isUuid(id)) out.push(problem(`${where}: id ${JSON.stringify(id)} is not a uuid`, item))
      else if (seen.has(id)) out.push(problem(`${where}: shares its id with ${seen.get(id)} — an id names one item`, item))
      else seen.set(id, where)
      if (typeof title !== "string" || !title.trim()) out.push(problem(`${where}: no title`, item))
      const statuses = ctx.registry.types.get(item.type)?.statuses ?? {}
      if (typeof status !== "string" || !Object.hasOwn(statuses, status)) {
        out.push(problem(`${where}: status ${JSON.stringify(status)} is not one of: ${Object.keys(statuses).join(", ")}`, item))
      }
    }
    return out
  },
}

const fields: Check = {
  name: "fields",
  says: "every declared field holds a value of its declared kind",
  run(ctx) {
    const out: Finding[] = []
    for (const item of ctx.repo.items) {
      for (const def of fieldsOf(ctx.registry, item)) {
        const error = fieldError(def, item.meta[def.name])
        if (error) out.push(problem(`${label(item)}: ${def.name} ${JSON.stringify(item.meta[def.name])} ${error}`, item))
      }
    }
    return out
  },
}

const values: Check = {
  name: "values",
  says:
    "every value of a field with an open list of values — area or kind, once the project declares their values — is on its list; a value off it is a note naming the items that hold it, which are never rewritten",
  run(ctx) {
    const out: Finding[] = []
    for (const def of ctx.registry.fields.values()) {
      if (!isOpenList(def)) continue
      const holders = new Map<string, Item[]>()
      for (const item of ctx.repo.items) {
        if (!appliesTo(def, item.type)) continue
        for (const v of offList(def, item.meta[def.name])) holders.set(v, [...(holders.get(v) ?? []), item])
      }
      const list = Object.keys(def.values ?? {}).join(", ")
      for (const [v, items] of holders) {
        out.push(note(
          `${def.name} "${v}" is not on its list (${list}): ${items.length} item${items.length === 1 ? "" : "s"} — ${items.map(label).join(", ")}. ` +
            `Define it under extends in naima.json, in the commit that first uses it, or set those items to a value on the list`,
        ))
      }
    }
    return out
  },
}

const links: Check = {
  name: "links",
  says: "every link uses a declared relation and names an existing item other than its own",
  run(ctx) {
    const out: Finding[] = []
    const relations = [...ctx.registry.relations.keys()]
    for (const item of ctx.repo.items) {
      const where = label(item)
      const raw = item.meta.links
      if (raw === undefined) continue
      if (!Array.isArray(raw)) {
        out.push(problem(`${where}: links is not a list`, item))
        continue
      }
      for (const l of raw as unknown[]) {
        const link = l as { rel?: unknown; id?: unknown }
        if (typeof link?.rel !== "string" || typeof link.id !== "string") {
          out.push(problem(`${where}: malformed link ${JSON.stringify(l)}`, item))
          continue
        }
        if (!ctx.registry.relations.has(link.rel)) out.push(problem(`${where}: relation "${link.rel}" is not one of: ${relations.join(", ")}`, item))
        if (link.id === item.meta.id) out.push(problem(`${where}: links to itself`, item))
        else if (!ctx.repo.byId.has(link.id)) out.push(problem(`${where}: ${link.rel} names ${link.id}, which is no item`, item))
        else {
          // The other item also stores the inverse: one link, written twice. Reported once, from the lower id.
          const other = ctx.repo.byId.get(link.id) as Item
          const inverse = ctx.registry.relations.get(link.rel)?.inverse
          const twice = inverse !== undefined && storedLinks(other.meta).some((l) => l.rel === inverse && l.id === item.meta.id)
          if (twice && item.meta.id < other.meta.id) {
            out.push(
              problem(`${where}: both directions of one link are stored — ${link.rel} ${label(other)}, and its inverse on ${label(other)}; unlink one`, item),
            )
          }
        }
      }
    }
    return out
  },
}

const layout: Check = {
  name: "layout",
  says: "every directory under the tracker root belongs to an item type or a plugin",
  run(ctx) {
    if (!existsSync(ctx.trackerRoot)) return [note(`${ctx.trackerDir}/ does not exist yet`)]
    return readdirSync(ctx.trackerRoot, { withFileTypes: true })
      .filter((e) => e.isDirectory() && !e.name.startsWith(".") && !ctx.registry.dirs.has(e.name))
      .map((e) => problem(`${ctx.trackerDir}/${e.name}/ belongs to no loaded type or plugin — a misspelled type, or a plugin that is not loaded`))
  },
}

const duplicates: Check = {
  name: "duplicates",
  says: "items of one type with the same title are linked as duplicates, or reported",
  run(ctx) {
    const groups = groupBy(ctx.repo.items, (item) => `${item.type}:${titleWords(item.meta.title).join(" ")}`)
    const out: Finding[] = []
    for (const items of groups.values()) {
      if (items.length < 2) continue
      const ids = items.map((i) => i.meta.id)
      const linked = items.every((i) => ctx.repo.linksOf(i).some((l) => l.rel === "duplicate-of" && ids.includes(l.id)))
      if (!linked) out.push(note(`possible duplicates, not linked: ${items.map(label).join(", ")}`))
    }
    return out
  },
}

const entryPointers: Check = {
  name: "entry-pointers",
  says:
    "every agent-harness entry file naima.json configures (entryFiles; sensible defaults absent it) names no path or link, plain-text or markdown, that is missing from disk",
  run: (ctx) => brokenEntryLinks(ctx.root, ctx.config.entryFiles).map((b) => problem(`${b.file}: names ${JSON.stringify(b.target)}, which does not exist`)),
}

const unreadOptionsCheck: Check = {
  name: "unread-options",
  says: "every option naima.json's plugins table sets is one its loaded plugin declares: an option no plugin reads any more is noted, by name",
  run: (ctx) =>
    unreadOptions(ctx.config.plugins, ctx.registry.plugins).map(({ plugin, key, path }) =>
      note(`${path} is set, and ${plugin} reads no option ${key} — it has no effect: naima plugin set ${plugin} ${key}= removes it`)
    ),
}

export const coreChecks: Check[] = [readable, identity, fields, values, links, layout, duplicates, entryPointers, unreadOptionsCheck, formatCheck()]

export interface CheckReport {
  problems: Finding[]
  notes: Finding[]
}

/**
 * Run every check, in load order, awaiting the ones that are async — with `staged`, only those that read the
 * change staged for the next commit. A check that throws or rejects is itself a problem, never a crash.
 */
export async function runChecks(ctx: Context, options: CheckOptions = {}): Promise<CheckReport> {
  const findings: Finding[] = []
  for (const check of ctx.registry.checks) {
    if (options.staged && check.staged !== true) continue
    try {
      findings.push(...await check.run(ctx, options))
    } catch (e) {
      findings.push(problem(`check "${check.name}" failed to run: ${message(e)}`))
    }
  }
  return { problems: findings.filter((f) => f.level === "problem"), notes: findings.filter((f) => f.level === "note") }
}
