// When an item's status came to refute what it verifies (a test marked failed, a property violated): the time its
// meta.json was last committed, or its file's time when it has changes not yet committed. A status is a result too,
// set by hand or by a run that records nothing else, so the screens that count failures weigh it against the item's
// recorded runs, the newer one standing (metrics/test-history.ts, verifier/history.ts).

import { statSync } from "node:fs"
import { join } from "node:path"
import { runGit } from "./git.ts"
import { refutes } from "./lifecycle.ts"
import type { Context, Item } from "./types.ts"

/** When the item's status, which refutes, was set, as an ISO time; null when its status does not refute. */
export function refutedAt(ctx: Context, item: Item): string | null {
  if (!refutes(ctx, item)) return null
  const meta = join(item.dir, "meta.json")
  const mtime = (): string => {
    try {
      return statSync(meta).mtime.toISOString()
    } catch {
      return new Date(0).toISOString()
    }
  }
  if (runGit(item.dir, ["status", "--porcelain", "--", "meta.json"]).out.trim()) return mtime()
  const log = runGit(item.dir, ["log", "-1", "--format=%cI", "--", "meta.json"])
  return log.ok && log.out.trim() ? new Date(log.out.trim()).toISOString() : mtime()
}
