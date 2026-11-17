// What makes the new UI live: a watch on the project that says when it
// changed, which the bridge's feed `changes` sends on (bridge.ts). It polls, so it runs the same on
// Deno, Node and Bun and on every system: the branches and tags from git (a new
// commit moves HEAD or a branch), and the tracker's files by their size and time
// (an item written, a claim posted). A change is said once things have settled:
// the watch waits `debounce` after the first difference it sees, reads again,
// and sends one event naming every kind that changed meanwhile.
//
// The event is a hint, never the data: the app's shell decides what to read
// again (live follows it, a selected commit of the past does not move), from the
// model develop/models/ui/shell/model/core.mcrl2 in the workshop.

import { readdirSync, statSync } from "node:fs"
import { readdir, stat } from "node:fs/promises"
import { join } from "node:path"
import { type Context, gitOrNull, headCommit, runGitAsync } from "../../core/api.ts"

/** What changed: HEAD moved (a new commit, a checkout), a branch or tag moved, the tracker's files changed. */
export type ChangeKind = "commit" | "branch" | "items"

export interface Change {
  kinds: ChangeKind[]
  /** HEAD after the change, when this is a git repository. */
  head: string | null
  /** When the change was seen, ISO 8601. */
  at: string
}

export interface Snapshot {
  head: string
  refs: string
  items: string
}

/** Every file under `dir`, with its size and time, in one string: a change of any is a change of the string. */
function filesSignature(dir: string): string {
  const out: string[] = []
  const walk = (d: string): void => {
    let entries
    try {
      entries = readdirSync(d, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      const p = join(d, e.name)
      if (e.isDirectory()) walk(p)
      else if (e.isFile()) {
        try {
          const s = statSync(p)
          out.push(`${p}\t${s.size}\t${s.mtimeMs}`)
        } catch {
          // gone between the listing and the stat: the next read sees it gone
        }
      }
    }
  }
  walk(dir)
  return out.sort().join("\n")
}

/** filesSignature, read without holding the thread: each folder's entries stated together, the server answering
 * requests meanwhile. On the workshop's tracker (some 7 000 files) the walk takes 100 to 500 ms. */
async function filesSignatureAsync(dir: string): Promise<string> {
  const out: string[] = []
  const walk = async (d: string): Promise<void> => {
    let entries
    try {
      entries = await readdir(d, { withFileTypes: true })
    } catch {
      return
    }
    const files: Promise<void>[] = []
    const dirs: string[] = []
    for (const e of entries) {
      const p = join(d, e.name)
      if (e.isDirectory()) dirs.push(p)
      else if (e.isFile()) {
        files.push(stat(p).then((s) => void out.push(`${p}\t${s.size}\t${s.mtimeMs}`), () => {}))
      }
    }
    await Promise.all(files)
    for (const sub of dirs) await walk(sub)
  }
  await walk(dir)
  return out.sort().join("\n")
}

/** What the watch compares: HEAD, the branches and tags, the tracker's files by size and time. The views' cache keeps
 * each answer with it (view-cache.ts). */
export function snapshot(ctx: Context): Snapshot {
  return {
    head: headCommit(ctx.root) ?? "",
    refs: gitOrNull(ctx.root, "for-each-ref", "--format=%(refname) %(objectname)", "refs/heads", "refs/tags") ?? "",
    items: filesSignature(ctx.trackerRoot),
  }
}

/** The snapshot, read without holding the thread: what the UI's server uses, so that a request is never kept waiting
 * by a walk of the tracker's files. */
export async function snapshotAsync(ctx: Context): Promise<Snapshot> {
  const [refs, items] = await Promise.all([
    runGitAsync(ctx.root, ["for-each-ref", "--format=%(refname) %(objectname)", "refs/heads", "refs/tags"], 30_000).then((r) => (r.ok ? r.out.trim() : "")),
    filesSignatureAsync(ctx.trackerRoot),
  ])
  return { head: headCommit(ctx.root) ?? "", refs, items }
}

const kindsBetween = (a: Snapshot, b: Snapshot): ChangeKind[] => [
  ...(a.head !== b.head ? ["commit" as const] : []),
  ...(a.refs !== b.refs ? ["branch" as const] : []),
  ...(a.items !== b.items ? ["items" as const] : []),
]

export interface Watch {
  stop(): void
}

/** Watch the project, every `interval` ms; call `changed` once per settled change. Each look is read without holding
 * the thread (snapshotAsync), one at a time: the next is timed from the end of the one before. */
export function watchProject(
  ctx: Context,
  changed: (c: Change) => void,
  opts: { interval?: number; debounce?: number } = {},
): Watch {
  const interval = opts.interval ?? 1000
  const debounce = opts.debounce ?? 300
  // The first look, taken as the watch starts: a change made from then on is said.
  let last: Promise<Snapshot> | Snapshot = snapshotAsync(ctx)
  let timer: ReturnType<typeof setTimeout> | null = null
  let stopped = false
  const later = (f: () => Promise<void>, ms: number): void => {
    if (stopped) return
    timer = setTimeout(() => void f().catch(() => later(tick, interval)), ms)
  }
  const tick = async (): Promise<void> => {
    if (stopped) return
    const before = await last
    const now = await snapshotAsync(ctx)
    if (stopped) return
    if (!kindsBetween(before, now).length) return later(tick, interval)
    // Something moved: wait for it to settle, then say every kind that changed since the last event.
    later(async () => {
      const settled = await snapshotAsync(ctx)
      if (stopped) return
      const kinds = kindsBetween(before, settled)
      last = settled
      if (kinds.length) changed({ kinds, head: settled.head || null, at: ctx.now().toISOString() })
      later(tick, interval)
    }, debounce)
  }
  later(tick, interval)
  return {
    stop() {
      stopped = true
      if (timer) clearTimeout(timer)
    },
  }
}
