// The records a piece of work's actual schedule is derived from, read at every call from what the project already
// keeps, nothing stored:
//
//   claim    a claim file (`claims/<uuid>.json`) first holding the piece, in a commit or on a worktree's disk: at the
//            earlier of that commit and the step it carries
//   step     each new step a claim carries (`claim --step`): at the instant it was posted
//   commit   each commit on the branch of a claim, while the claim holds the piece: the branch while it exists, and the
//            branch a landing merged (the marker's second parent) after it is gone
//   release  the piece leaving a claim (its file deleted, or the piece taken out) before it landed
//   land     a marker commit naming the piece in a Closes: or a Fixes: trailer
//   close    the piece's closedOn, or its fixedOn when no landing names it: a day, placed after the piece's last record of
//            that day, else at the day's start
//
// Silence is derived from the gaps: the plugin adds a quiet record where a piece went the stall window without one.
// Reading the claims across every ref is what makes the schedule actual as it happens: a step posted a minute ago on a
// worker's disk is read from that disk.

import { type BranchFile, type Context, fieldValue, gitOrNull, type Item, readAcrossBranches, textsAt, trackerPath } from "../../core/api.ts"
import type { ActualEvent } from "./types.ts"

const RS = "\x1e"
const US = "\x1f"
const GS = "\x1d"
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const DAY = /^\d{4}-\d{2}-\d{2}$/

interface ClaimText {
  branch?: unknown
  items?: unknown
  step?: unknown
}

interface ClaimVersion {
  branch: string
  items: Set<string>
  step?: { what: string; since: string }
}

/** A claim file's text, read as data: its branch, the ids it holds, and its step; null when it is not a claim. */
function claimOf(text: string | null): ClaimVersion | null {
  if (text === null) return null
  let raw: ClaimText
  try {
    raw = JSON.parse(text) as ClaimText
  } catch {
    return null
  }
  if (!raw || typeof raw !== "object" || typeof raw.branch !== "string" || !Array.isArray(raw.items)) return null
  const items = new Set<string>()
  for (const i of raw.items as unknown[]) {
    const id = (i as { id?: unknown } | null)?.id
    if (typeof id === "string") items.add(id)
  }
  const s = raw.step as { what?: unknown; since?: unknown } | undefined
  const step = s && typeof s.what === "string" && typeof s.since === "string" && !Number.isNaN(Date.parse(s.since))
    ? { what: s.what, since: new Date(s.since).toISOString() }
    : undefined
  return { branch: raw.branch, items, ...(step ? { step } : {}) }
}

/** The records of every piece, by item id, oldest first; `items` are the pieces asked about. */
export interface Records {
  byItem: Map<string, ActualEvent[]>
}

const iso = (s: string): string => new Date(s).toISOString()

/** One commit touching the claims, with the claim files it added, changed or deleted. */
interface ClaimCommit {
  commit: string
  at: string
  changes: { status: string; path: string }[]
}

function claimCommits(ctx: Context, dir: string): ClaimCommit[] {
  const out = gitOrNull(ctx.trackerGit, "log", "--all", "--full-history", "--no-renames", `--format=${RS}%H${US}%cI`, "--name-status", "--", dir) ?? ""
  return out.split(RS).flatMap((chunk) => {
    const [head = "", ...lines] = chunk.trim().split("\n")
    const [commit = "", at = ""] = head.split(US)
    if (!commit || Number.isNaN(Date.parse(at))) return []
    const changes = lines.flatMap((l) => {
      const [status = "", path = ""] = l.split("\t")
      return path.endsWith(".json") && /^[AMD]$/.test(status) ? [{ status, path }] : []
    })
    return [{ commit, at: iso(at), changes }]
  }).sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0))
}

/** A landing: a marker naming pieces by id in Closes: or Fixes: trailers. */
interface Landing {
  commit: string
  at: string
  parents: string[]
  subject: string
  names: string[]
}

function landings(ctx: Context): Landing[] {
  const fmt = `${RS}%H${US}%cI${US}%P${US}%s${US}%(trailers:key=Closes,key=Fixes,valueonly,separator=${GS})`
  const out = gitOrNull(ctx.root, "log", "--all", "-E", "--grep=^(Closes|Fixes): ", `--format=${fmt}`) ?? ""
  return out.split(RS).flatMap((chunk) => {
    const [commit = "", at = "", parents = "", subject = "", names = ""] = chunk.replace(/\n$/, "").split(US)
    if (!commit || Number.isNaN(Date.parse(at))) return []
    return [{
      commit,
      at: iso(at),
      parents: parents.split(" ").filter(Boolean),
      subject,
      names: names.split(GS).map((n) => n.trim()).filter(Boolean),
    }]
  })
}

/** The id a trailer value names: an id, or an item's `type/slug` or slug as it is now. */
function idNamed(ctx: Context, name: string): string | undefined {
  if (UUID.test(name)) return name.toLowerCase()
  try {
    return ctx.repo.resolve(name).meta.id
  } catch {
    return undefined
  }
}

/** The branch a marker landed, from its subject (`Land <branch>`), when it says one. */
const landedBranch = (l: Landing): string | undefined => l.subject.match(/^Land (\S+)/)?.[1]

/** The commits on a branch's own line from `since` on: each commit, its moment and subject. */
function branchCommits(ctx: Context, tip: string, since: string): { commit: string; at: string; subject: string }[] {
  const out = gitOrNull(ctx.root, "log", "--first-parent", `--since=${since}`, `--format=%H${US}%cI${US}%s`, tip, "--") ?? ""
  return out.split("\n").flatMap((line) => {
    const [commit = "", at = "", subject = ""] = line.split(US)
    return commit && !Number.isNaN(Date.parse(at)) ? [{ commit, at: iso(at), subject }] : []
  })
}

/** When a closed or fixed piece ended by its day: after its last record of that day, else at the day's start. */
function closeMoment(day: string, events: ActualEvent[]): string {
  const sameDay = events.filter((e) => e.at.slice(0, 10) === day).map((e) => e.at).sort()
  const last = sameDay[sameDay.length - 1]
  return last ? new Date(Date.parse(last) + 1000).toISOString() : `${day}T00:00:00.000Z`
}

/** At one moment, a claim comes first and its release last: the commit that releases a claim is no sign of life after it. */
const ORDER: Record<ActualEvent["kind"], number> = { claim: 0, step: 1, commit: 2, quiet: 3, release: 4, land: 5, close: 6 }
const byAt = (a: ActualEvent, b: ActualEvent): number => (a.at < b.at ? -1 : a.at > b.at ? 1 : ORDER[a.kind] - ORDER[b.kind])

/** The records of the pieces `items`, read from the claims, the branches, the landings and the items' own fields. */
export function recordsOf(ctx: Context, items: Item[]): Records {
  const wanted = new Set(items.map((i) => i.meta.id))
  const byItem = new Map<string, ActualEvent[]>()
  const push = (id: string, e: ActualEvent) => {
    if (!wanted.has(id)) return
    const list = byItem.get(id) ?? []
    list.push(e)
    byItem.set(id, list)
  }

  // The claims, version by version, as committed on any ref.
  const dir = trackerPath(ctx.trackerPrefix, "claims")
  const commits = claimCommits(ctx, dir)
  const names = commits.flatMap((c) => c.changes.map((ch) => (ch.status === "D" ? `${c.commit}^:${ch.path}` : `${c.commit}:${ch.path}`)))
  const texts = textsAt(ctx.trackerGit, names)
  /** Each claim file's last version seen, by path. */
  const last = new Map<string, ClaimVersion>()
  /** The windows in which a branch held a piece: [from, to?] by `branch\tid`. */
  const windows = new Map<string, { from: string; to?: string }[]>()
  const open = (branch: string, id: string, at: string) => {
    const k = `${branch}\t${id}`
    const w = windows.get(k) ?? []
    if (!w.length || w[w.length - 1]?.to !== undefined) w.push({ from: at })
    windows.set(k, w)
  }
  const shut = (branch: string, id: string, at: string) => {
    const w = windows.get(`${branch}\t${id}`)
    const cur = w?.[w.length - 1]
    if (cur && cur.to === undefined) cur.to = at
  }
  const seeVersion = (path: string, now: ClaimVersion | null, at: string, commit?: string) => {
    const before = last.get(path)
    if (now === null) {
      for (const id of before?.items ?? []) {
        push(id, {
          at,
          kind: "release",
          says: `the claim of ${before?.branch} went away`,
          ...(before ? { branch: before.branch } : {}),
          ...(commit ? { commit } : {}),
        })
        if (before) shut(before.branch, id, at)
      }
      last.delete(path)
      return
    }
    const claimedAt = now.step && now.step.since < at && !before ? now.step.since : at
    for (const id of now.items) {
      if (before?.items.has(id)) continue
      push(id, { at: claimedAt, kind: "claim", says: `claimed on ${now.branch}`, branch: now.branch, ...(commit ? { commit } : {}) })
      open(now.branch, id, claimedAt)
    }
    for (const id of before?.items ?? []) {
      if (now.items.has(id)) continue
      push(id, { at, kind: "release", says: `taken out of the claim of ${now.branch}`, branch: now.branch, ...(commit ? { commit } : {}) })
      shut(now.branch, id, at)
    }
    if (now.step && now.step.since !== before?.step?.since) {
      for (const id of now.items) push(id, { at: now.step.since, kind: "step", says: now.step.what, branch: now.branch })
    }
    last.set(path, now)
  }
  let n = 0
  for (const c of commits) {
    for (const ch of c.changes) {
      const text = texts[n++] ?? null
      seeVersion(ch.path, ch.status === "D" ? null : claimOf(text), c.at, c.commit)
    }
  }
  // What the claims hold now on every ref and worktree, committed or not: a step posted and not yet committed.
  const nowFiles: BranchFile[] = readAcrossBranches(ctx.trackerGit, dir, ".json")
  for (const f of nowFiles) {
    const v = claimOf(f.text)
    if (!v) continue
    const path = trackerPath(dir, f.name)
    const before = last.get(path)
    if (!before) seeVersion(path, v, v.step?.since ?? ctx.now().toISOString())
    else if (v.step && v.step.since !== before.step?.since) {
      for (const id of v.items) push(id, { at: v.step.since, kind: "step", says: v.step.what, branch: v.branch })
      last.set(path, { ...before, step: v.step })
    }
  }

  // The landings, and the branches they merged.
  const tipOf = new Map<string, string>()
  const landed = new Set<string>()
  for (const l of landings(ctx)) {
    const branch = landedBranch(l)
    if (branch && l.parents[1] && !tipOf.has(branch)) tipOf.set(branch, l.parents[1])
    for (const name of l.names) {
      const id = idNamed(ctx, name)
      if (!id) continue
      landed.add(id)
      push(id, { at: l.at, kind: "land", says: l.subject, commit: l.commit, ...(branch ? { branch } : {}) })
    }
  }

  // The commits on each claiming branch, inside the windows in which it held the piece.
  const branches = new Set([...windows.keys()].map((k) => k.split("\t")[0] ?? ""))
  for (const branch of branches) {
    const own = gitOrNull(ctx.root, "rev-parse", "--verify", "--quiet", `refs/heads/${branch}`)
    const tips = [own?.trim(), tipOf.get(branch)].filter((t): t is string => !!t)
    if (!tips.length) continue
    const held = [...windows].filter(([k]) => k.startsWith(`${branch}\t`))
    const from = held.flatMap(([, ws]) => ws.map((w) => w.from)).sort()[0]
    if (!from) continue
    const seen = new Set<string>()
    for (const tip of tips) {
      for (const c of branchCommits(ctx, tip, from)) {
        if (seen.has(c.commit)) continue
        seen.add(c.commit)
        for (const [k, ws] of held) {
          const id = k.split("\t")[1] ?? ""
          if (ws.some((w) => c.at >= w.from && (w.to === undefined || c.at <= w.to))) {
            push(id, { at: c.at, kind: "commit", says: c.subject, branch, commit: c.commit })
          }
        }
      }
    }
  }

  // The close, from the item's own fields.
  for (const item of items) {
    const id = item.meta.id
    const events = (byItem.get(id) ?? []).sort(byAt)
    const closedOn = fieldValue(item, { name: "closedOn", kind: "date" })
    const fixedOn = fieldValue(item, { name: "fixedOn", kind: "date" })
    const day = typeof closedOn === "string" && DAY.test(closedOn)
      ? closedOn
      : !landed.has(id) && typeof fixedOn === "string" && DAY.test(fixedOn)
      ? fixedOn
      : undefined
    if (day) events.push({ at: closeMoment(day, events), kind: "close", says: closedOn === day ? `closed on ${day}` : `fixed on ${day}` })
    if (events.length) byItem.set(id, dedupe(events.sort(byAt)))
  }
  return { byItem }
}

/** The same record read twice (a step committed and on disk, a landing seen from two refs) counted once. */
function dedupe(events: ActualEvent[]): ActualEvent[] {
  const seen = new Set<string>()
  return events.filter((e) => {
    const k = `${e.at}\t${e.kind}\t${e.commit ?? ""}\t${e.kind === "step" ? e.says : ""}`
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
}
