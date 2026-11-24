// What a development line closes when it lands, besides the items its landings name with Fixes: trailers: the items whose
// own record on the line's tip is settled (a property that holds, a test that passed, a requirement that is met) and
// whose copy on the trunk is not yet. The trunk's copy of them reads open, so a goal counted from the trunk would call
// them left; each is fixed or proved on the line, closing at the release, as an item fixed on the line is.

import { join } from "node:path"
import type { Context, Item } from "./types.ts"
import { gitOrNull, runGit, textsAt, trunk } from "./git.ts"

/** A record the line changed against its base, as its tip has it: the item, and when (seconds) the line last touched it. */
export interface TipRecord {
  readonly item: Item
  readonly at: number
}

/**
 * The tip of `branch`. A line's is read from the one for-each-ref of every line's tips that fixedOnLine asks too (asked once
 * within a read scope), not a process for each of the goals, most of which have no line.
 */
function lineTip(root: string, branch: string): string | null {
  if (!branch.startsWith("refs/heads/line/")) return gitOrNull(root, "rev-parse", "--verify", "--quiet", `${branch}^{commit}`)
  for (const l of (gitOrNull(root, "for-each-ref", "--format=%(refname) %(objectname)", "refs/heads/line/") ?? "").split("\n")) {
    const [ref, sha] = l.split(" ")
    if (ref === branch && sha) return sha
  }
  return null
}

const memo = new Map<string, Map<string, TipRecord>>()

/**
 * The records the line `branch` changed against its base, as its tip has them, by item id: an item the line made, or one it
 * moved on (its status, its goal, a move to the closed ones). Read from git alone, in a few calls however many items the
 * line changed. Empty when there is no such line.
 */
export function recordsOnTip(ctx: Context, branch: string): Map<string, TipRecord> {
  const main = trunk(ctx.root)
  if (!main) return new Map()
  const tip = lineTip(ctx.root, branch)
  // Asked for every goal, and most have no line: the trunk's tip is looked for only when the line has one.
  if (!tip) return new Map()
  const tipOfMain = gitOrNull(ctx.root, "rev-parse", "--verify", "--quiet", `${main}^{commit}`)
  if (!tipOfMain) return new Map()
  const key = `${ctx.root}\0${ctx.trackerDir}\0${tip}\0${tipOfMain}`
  const kept = memo.get(key)
  if (kept) return kept
  const dirs = new Map([...ctx.registry.types.values()].map((t) => [t.dir, t]))
  const prefix = ctx.trackerDir ? `${ctx.trackerDir}/` : ""
  const diff = runGit(ctx.root, ["diff", "--name-only", "--no-renames", "-z", `${tipOfMain}...${tip}`, "--", ctx.trackerDir || "."])
  const changed = (diff.ok ? diff.out.split("\0") : []).flatMap((p) => {
    if (!p.startsWith(prefix) || !p.endsWith("/meta.json")) return []
    const [dir, , file, extra] = p.slice(prefix.length).split("/")
    return dirs.has(dir ?? "") && file === "meta.json" && extra === undefined ? [{ path: p, type: dirs.get(dir!)! }] : []
  })
  const texts = textsAt(ctx.root, changed.map((c) => `${tip}:${c.path}`))
  // When each record was last touched on the line: one log of the line's commits, newest first.
  const log = runGit(ctx.root, ["log", "--no-renames", "--format=%x01%ct", "--name-only", "-z", `${tipOfMain}..${tip}`, "--", ctx.trackerDir || "."])
  const touched = new Map<string, number>()
  for (const part of (log.ok ? log.out : "").split("\x01")) {
    const [t = "", ...paths] = part.split(/\0|\n/)
    for (const p of paths) if (p && !touched.has(p)) touched.set(p, Number(t) || 0)
  }
  const out = new Map<string, TipRecord>()
  changed.forEach((c, i) => {
    try {
      const meta = JSON.parse(texts[i] ?? "null") as Item["meta"] | null
      if (!meta || typeof meta.id !== "string" || typeof meta.title !== "string" || typeof meta.status !== "string") return
      const slug = c.path.slice(prefix.length).split("/")[1]!
      out.set(meta.id, { item: { type: c.type.id, slug, dir: join(ctx.trackerRoot, c.type.dir, slug), meta }, at: touched.get(c.path) ?? 0 })
    } catch { /* a record that is not JSON proves nothing */ }
  })
  memo.set(key, out)
  return out
}

/**
 * The ids of the items settled on `branch`, by a done status or by a fixedOn date, each with when (seconds) the line last touched its record: its status on the
 * line's tip is a done one. Whether the trunk's copy of it is open is the reader's to say.
 */
export function closedOnTip(ctx: Context, branch: string): Map<string, number> {
  const out = new Map<string, number>()
  for (const [id, r] of recordsOnTip(ctx, branch)) {
    const status = ctx.registry.types.get(r.item.type)?.statuses
    const fixed = typeof r.item.meta["fixedOn"] === "string" && r.item.meta["fixedOn"] !== ""
    if (fixed || (status && Object.hasOwn(status, r.item.meta.status) && status[r.item.meta.status]!.category === "done")) out.set(id, r.at)
  }
  return out
}
