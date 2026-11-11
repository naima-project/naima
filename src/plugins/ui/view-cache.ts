// The live views the bridge computed, kept on disk so that a UI opened again on a large project draws at once
// (bugs/large-tracker-ui-shows-only-reading-where): each answer is kept with the project's stamp, what the change
// feed watches (HEAD, the branches and tags, the tracker's files by size and time, live.ts), and given back only
// while the stamp is the same. A view can read more than the stamp says (another worktree's files, the clock), so the
// bridge reads a view it answered from here again soon after, and says a change when the answer moved.
//
// The cache is Naima's state folder for the clone (naima/views in the git directory), or the folder NAIMA_VIEW_CACHE
// names; none outside git. An entry that cannot be read is a miss, and a write that fails is skipped: the cache
// only ever saves time.

import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import process from "node:process"
import { type Context, stateDir, writeFileAtomic } from "../../core/api.ts"

/** The variable that names the folder the views are kept in, instead of the clone's state folder. */
export const VIEW_CACHE_ENV = "NAIMA_VIEW_CACHE"

export interface ViewCache {
  /** The answer kept for `key` at `stamp`, or undefined. */
  get(key: string, stamp: string): unknown
  /** Keep `data` as the answer for `key` at `stamp`. */
  put(key: string, stamp: string, data: unknown): void
  readonly dir: string
}

const hash = (s: string): string => createHash("sha256").update(s).digest("hex")

/** One string for a stamp of any shape: its hash. */
export const stampOf = (parts: Record<string, string>): string => hash(JSON.stringify(parts))

/** The views' cache for the project at `ctx`, in `dir` when given; null when there is nowhere to keep it. */
export function viewCache(ctx: Context, dir: string | null = process.env[VIEW_CACHE_ENV] || null): ViewCache | null {
  const state = dir ?? stateDir(ctx.root)
  if (!state) return null
  // One project's tracker can be read with more than one data folder: each has its own views.
  const folder = dir ? join(dir, hash(`${ctx.root}\n${ctx.trackerRoot}`).slice(0, 16)) : join(state, "views", hash(ctx.trackerRoot).slice(0, 16))
  const file = (key: string) => join(folder, `${hash(key).slice(0, 32)}.json`)
  return {
    dir: folder,
    get(key, stamp) {
      try {
        const kept = JSON.parse(readFileSync(file(key), "utf8")) as { key?: string; stamp?: string; data?: unknown }
        return kept.key === key && kept.stamp === stamp ? kept.data : undefined
      } catch {
        return undefined
      }
    },
    put(key, stamp, data) {
      try {
        writeFileAtomic(file(key), JSON.stringify({ key, stamp, data }))
      } catch {
        // A cache that cannot be written only costs the next first read its time.
      }
    },
  }
}
