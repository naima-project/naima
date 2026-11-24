// Reading the tracker: every registered type directory, every item in it.
// Nothing here writes; the context reads it again after every write.

import { existsSync, readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { message } from "./errors.ts"
import { listDirs, META } from "./item.ts"
import type { Finding, Item, Link, Meta, Registry, Repo, ResolvedLink } from "./types.ts"

/** The well-formed links an item stores. Malformed ones are reported by `check`, never followed. */
export function storedLinks(meta: Meta): Link[] {
  if (!Array.isArray(meta.links)) return []
  return meta.links.filter((l): l is Link => !!l && typeof l.rel === "string" && typeof l.id === "string")
}

/** Entries of a type directory that look like items and are not read as one: said, never skipped in silence. */
function notItems(typeDir: string, where: string): Finding[] {
  if (!existsSync(typeDir)) return []
  return readdirSync(typeDir, { withFileTypes: true }).flatMap((e): Finding[] => {
    if (e.isSymbolicLink()) return [{ level: "problem", message: `${where}/${e.name}: a symbolic link, not read as an item — an item is a directory` }]
    if (e.isDirectory() && e.name.startsWith("_")) {
      return [{ level: "problem", message: `${where}/${e.name}: not read as an item — a name starting with _ is never an item; rename it or move it out` }]
    }
    return []
  })
}

/**
 * Every item of the tracker at `trackerRoot`. `preread` holds the text of item files already known by path (a tracker read
 * out of git, contextAt): it is used instead of opening the file, which on Windows costs a scan of each fresh file.
 */
export function loadRepo(
  trackerRoot: string,
  registry: Registry,
  preread?: ReadonlyMap<string, string>,
  /** Item directories read from another place, by the directory they stand in: the trunk's copy of an item a line shows (core/trunk-writes.ts). */
  elsewhere?: ReadonlyMap<string, string>,
): Repo {
  const items: Item[] = []
  const unreadable: Finding[] = []
  for (const type of registry.types.values()) {
    unreadable.push(...notItems(join(trackerRoot, type.dir), type.dir))
    for (const slug of listDirs(join(trackerRoot, type.dir))) {
      const dir = elsewhere?.get(join(trackerRoot, type.dir, slug)) ?? join(trackerRoot, type.dir, slug)
      const where = `${type.dir}/${slug}`
      const path = join(dir, META)
      const known = preread?.get(path)
      if (known === undefined && !existsSync(path)) {
        unreadable.push({ level: "problem", message: `${where}: no ${META}` })
        continue
      }
      let meta: unknown
      try {
        meta = JSON.parse(known ?? readFileSync(path, "utf8"))
        if (!meta || typeof meta !== "object" || Array.isArray(meta)) throw new Error("not an object")
      } catch (e) {
        unreadable.push({ level: "problem", message: `${where}: ${META} is not a JSON object (${message(e)})` })
        continue
      }
      // What every item is read by. An item without them is reported, never handed to a command to crash on.
      const wrong = (["id", "title", "status"] as const).filter((k) => typeof (meta as Record<string, unknown>)[k] !== "string")
      if (wrong.length) {
        unreadable.push({ level: "problem", message: `${where}: ${META}: ${wrong.map((k) => `${k} is not a string`).join(", ")}` })
        continue
      }
      items.push({ type: type.id, slug, dir, meta: meta as Meta })
    }
  }

  const byId = new Map<string, Item>()
  for (const item of items) if (!byId.has(item.meta.id)) byId.set(item.meta.id, item)

  // Only one direction of a link is stored; the inverse is computed here, so
  // the two halves can never disagree.
  const incoming = new Map<string, ResolvedLink[]>()
  for (const item of items) {
    for (const link of storedLinks(item.meta)) {
      if (!byId.has(link.id)) continue
      const inverse = registry.relations.get(link.rel)?.inverse ?? link.rel
      const list = incoming.get(link.id) ?? []
      list.push({ rel: inverse, id: item.meta.id, implied: true })
      incoming.set(link.id, list)
    }
  }

  const resolve = (ref: string): Item => {
    // An empty fragment is a fragment of every slug: it must never pick "the only item".
    if (!ref.trim()) throw new Error("no item named: an item reference cannot be empty")
    const exact = byId.get(ref) ??
      items.find((i) => `${i.type}/${i.slug}` === ref) ??
      items.find((i) => `${registry.types.get(i.type)?.dir}/${i.slug}` === ref)
    if (exact) return exact
    const bySlug = items.filter((i) => i.slug === ref)
    const candidates = bySlug.length ? bySlug : items.filter((i) => i.slug.includes(ref) || i.meta.id.startsWith(ref))
    if (candidates.length === 1 && candidates[0]) return candidates[0]
    if (candidates.length === 0) throw new Error(`no item matches "${ref}"`)
    throw new Error(`"${ref}" is ambiguous: ${candidates.map((i) => `${i.type}/${i.slug}`).join(", ")}`)
  }

  const linksOf = (item: Item): ResolvedLink[] => [
    ...storedLinks(item.meta).map((l) => ({ ...l, implied: false })),
    ...(incoming.get(item.meta.id) ?? []),
  ]

  return { items, unreadable, byId, resolve, linksOf }
}
