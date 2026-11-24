// Tracker writes made from a development line's checkout by the person at the UI. The rule (core/trunk-only.ts) stands:
// a line writes no tracker data of its own. What the UI does is run the write in the trunk's checkout and show it at
// once: the item's files there are read in place of the line's own until the line's copy changes, which is its next
// sync. The overlay is a file in Naima's state folder (shared by the worktrees of the clone), read by every context of
// that checkout, so every view and every worker draws the same item. Writes through an overlaid item are refused: the
// line never changes the trunk's files (core/item.ts).

import { createHash } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join, relative, resolve, sep } from "node:path"
import { gitOrNull, runGit, trunk } from "./git.ts"
import { stateDir } from "./tick.ts"
import { developmentLine } from "./trunk-only.ts"

const FILE = "trunk-writes.json"

/** One item the trunk holds newer than the line's checkout: where the line has it, where the trunk has it, and the line's copy when the trunk's was taken. */
interface Entry {
  root: string
  /** The item's directory below the tracker's data folder, with forward slashes. */
  dir: string
  /** The item's directory in the trunk's checkout. */
  from: string
  /** What the line's copy of the item's files was: the entry ends when it is not any more (the line has synced). */
  base: string
}

const fileOf = (root: string): string | null => {
  const state = stateDir(root)
  return state ? join(state, FILE) : null
}

const readEntries = (file: string): Entry[] => {
  try {
    const all = JSON.parse(readFileSync(file, "utf8")) as unknown
    return Array.isArray(all) ? (all as Entry[]).filter((e) => e && typeof e.root === "string" && typeof e.dir === "string" && typeof e.from === "string") : []
  } catch {
    return []
  }
}

/** A hash of what an item directory holds that the UI draws: its fields and its description. */
function copyOf(dir: string): string {
  const h = createHash("sha1")
  for (const f of ["meta.json", "README.md"]) {
    const p = join(dir, f)
    h.update(existsSync(p) ? readFileSync(p) : "-")
  }
  return h.digest("hex")
}

/**
 * The items of the checkout at `root` (its tracker data in `data`) that the trunk's checkout holds newer, as the line's
 * directory of each and the trunk's: what the reading of the tracker takes in place. An entry whose line copy changed
 * since (the line synced) or whose trunk copy is gone is dropped from the file.
 */
export function trunkOverlay(root: string, data: string): Map<string, string> | undefined {
  const file = fileOf(root)
  if (!file || !existsSync(file)) return undefined
  const all = readEntries(file)
  const mine = all.filter((e) => resolve(e.root) === resolve(root))
  if (!mine.length) return undefined
  const alive = mine.filter((e) => existsSync(e.from) && copyOf(join(data, ...e.dir.split("/"))) === e.base)
  if (alive.length !== mine.length) {
    try {
      writeFileSync(file, JSON.stringify([...all.filter((e) => resolve(e.root) !== resolve(root)), ...alive], null, 2) + "\n")
    } catch { /* kept as it is: read again next time */ }
  }
  return alive.length ? new Map(alive.map((e) => [join(data, ...e.dir.split("/")), e.from])) : undefined
}

/** What the overlay of `root` says, for a stamp of what the views read: empty when there is none. */
export const trunkOverlayStamp = (root: string): string => {
  const file = fileOf(root)
  return file && existsSync(file) ? readFileSync(file, "utf8") : ""
}

/** Remember that the trunk holds the items `dirs` (below the data folder, forward slashes) newer than the checkout at `root`, in `data`. */
export function rememberTrunkWrite(root: string, data: string, trunkData: string, dirs: readonly string[]): void {
  const file = fileOf(root)
  if (!file) return
  mkdirSync(dirname(file), { recursive: true })
  const keep = readEntries(file).filter((e) => resolve(e.root) !== resolve(root) || !dirs.includes(e.dir))
  const added = dirs.map((dir): Entry => ({ root, dir, from: join(trunkData, ...dir.split("/")), base: copyOf(join(data, ...dir.split("/"))) }))
  writeFileSync(file, JSON.stringify([...keep, ...added], null, 2) + "\n")
}

/** Whether `path` is inside the tracker's data folder `data`. */
export const insideData = (data: string, path: string): boolean => {
  const r = relative(resolve(data), resolve(path))
  return r === "" || (!r.startsWith("..") && !r.split(sep).includes(".."))
}

/** The trunk's checkout of the clone `root` belongs to: the main worktree when it stands on the trunk; else why there is none. */
export function trunkCheckout(root: string): { path: string } | { why: string } {
  const main = trunk(root)
  if (!main) return { why: "the trunk's branch is not known" }
  const listed = runGit(root, ["worktree", "list", "--porcelain"])
  if (!listed.ok) return { why: "the clone's checkouts cannot be listed" }
  for (const block of listed.out.split(/\n\s*\n/)) {
    const path = /^worktree (.+)$/m.exec(block)?.[1]
    const branch = /^branch refs\/heads\/(.+)$/m.exec(block)?.[1]
    if (path && branch === main) return { path }
  }
  return { why: `no checkout stands on the trunk (${main})` }
}

/** What a write from the line at `root` must be told: where the trunk's checkout and its data folder are, or why the write cannot go there. */
export function trunkSide(root: string, data: string): { onLine: false } | { onLine: true; checkout: string; data: string } | { onLine: true; why: string } {
  if (!developmentLine(root)) return { onLine: false }
  const found = trunkCheckout(root)
  if ("why" in found) return { onLine: true, why: `${found.why}: the change is saved only on the trunk, and there is no checkout of it to save it in` }
  const rel = relative(root, data)
  if (rel.startsWith("..")) return { onLine: false }
  return { onLine: true, checkout: found.path, data: join(found.path, rel) }
}

/** The files of `paths` (relative to `cwd`) that git sees changed in the checkout at `cwd`; empty when clean. */
export function dirtyIn(cwd: string, paths: readonly string[]): string[] {
  const out = gitOrNull(cwd, "status", "--porcelain", "--", ...paths)
  return out ? out.split("\n").filter(Boolean).map((l) => l.slice(3)) : []
}
