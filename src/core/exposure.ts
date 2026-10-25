// Whether the tracker is exposed: readable by anyone, because it is committed
// in a repository whose origin is public, or because its own repository (sibling
// mode) has a public remote. An invariant, held on every write through the
// core's helpers (item.ts's write guard) and reported by `naima check`.
//
// A remote's visibility is asked of GitHub (visibility.ts) at most once a day
// and remembered with its time in the tracker repository's own git config,
// which is never committed: `naima-visibility.<key>.seen` holds
// "<visibility> <ISO time>". A probe that fails keeps the last answer known.
// What cannot be told (another host, offline, never answered) is not a
// refusal: the owner is asked once, and the answer is recorded in naima.json's
// `privateRemotes` as the remote's key, a hash, never its address.

import { createHash } from "node:crypto"
import { existsSync, realpathSync } from "node:fs"
import { dirname, resolve, sep } from "node:path"
import { readRaw } from "./config.ts"
import { NaimaError } from "./errors.ts"
import { gitOrNull, runGit } from "./git.ts"
import { DATA_DIR, DATA_FILE, TRACKER_DIR } from "./layout.ts"
import { withoutCredentials } from "./program.ts"
import { githubRepo, isLocalRemote, probeVisibility, type Visibility } from "./visibility.ts"
import { appliesTo } from "./fields.ts"
import { createItem, saveProse } from "./item.ts"
import { FOLLOW_UP } from "./updates.ts"
import type { Context } from "./types.ts"

/** naima.json's key: the remotes the owner said are private, by key. */
export const PRIVATE_REMOTES = "privateRemotes"
/** The git config section the cache lives in, in the tracker repository. */
export const CACHE_SECTION = "naima-visibility"
/** The git config key set while the tracker is seen exposed, cleared when the sweep todo is filed. */
export const EXPOSED_KEY = "naima.trackerExposed"
/** How long a remembered visibility is trusted before it is asked again: a day. */
export const REFRESH_MS = 24 * 60 * 60 * 1000

/** A remote that matters to the tracker's privacy. */
export interface Remote {
  name: string
  /** Its address, credentials removed. */
  url: string
  /** Its key: a hash of the address, what the cache and naima.json name it by. */
  key: string
}

/** Where a remote's visibility stands, and where the answer came from. */
export interface Seen extends Remote {
  visibility: Visibility
  from: "local" | "cache" | "probe" | "owner" | "none"
}

/** The tracker, private, exposed, or not known. */
export type Exposure =
  | { state: "private" }
  | { state: "exposed"; sibling: boolean; remotes: Seen[]; message: string }
  | { state: "unknown"; sibling: boolean; remotes: Seen[]; message: string }

/** What the exposure is read from: a context's places, and a clock. */
export interface Where {
  root: string
  trackerRoot: string
  trackerGit: string
  sibling: boolean
  now(): Date
}

/** The key of a remote address: the first 16 hex digits of the sha-256 of it without credentials. */
export const remoteKey = (url: string): string => createHash("sha256").update(withoutCredentials(url.trim())).digest("hex").slice(0, 16)

let probeOverride: ((url: string) => Promise<Visibility>) | null = null

/** Let a test (or the entry point, from its options) answer for GitHub; null restores the real probe. */
export function setVisibilityProbe(probe: ((url: string) => Promise<Visibility>) | null): void {
  probeOverride = probe
}

/**
 * The remotes the tracker's privacy depends on: the code repository's origin when the tracker is committed with
 * the code; every remote of the tracker's own repository in sibling mode.
 */
export function trackerRemotes(w: Pick<Where, "root" | "trackerGit" | "sibling">): Remote[] {
  const names = w.sibling ? (gitOrNull(w.trackerGit, "remote") ?? "").split("\n").filter(Boolean) : ["origin"]
  const out: Remote[] = []
  for (const name of names) {
    const url = gitOrNull(w.sibling ? w.trackerGit : w.root, "remote", "get-url", name)
    if (url) out.push({ name, url: withoutCredentials(url), key: remoteKey(url) })
  }
  return out
}

/** The remembered visibility of a remote and when it was asked; null when never. */
export function cached(trackerGit: string, key: string): { visibility: Visibility; at: Date } | null {
  const value = gitOrNull(trackerGit, "config", "--get", `${CACHE_SECTION}.${key}.seen`)
  const m = value?.match(/^(public|private|unknown|none) (\S+)$/)
  if (!m) return null
  const at = new Date(m[2] as string)
  return Number.isNaN(at.getTime()) ? null : { visibility: m[1] as Visibility, at }
}

function remember(trackerGit: string, key: string, visibility: Visibility, at: Date): void {
  runGit(trackerGit, ["config", `${CACHE_SECTION}.${key}.seen`, `${visibility} ${at.toISOString()}`])
}

/** The remote keys naima.json's privateRemotes holds. */
export function ownerPrivate(trackerRoot: string): string[] {
  try {
    const v = readRaw(trackerRoot)[PRIVATE_REMOTES]
    return Array.isArray(v) ? v.filter((k): k is string => typeof k === "string") : []
  } catch {
    return []
  }
}

/**
 * Ask GitHub again about every remote whose remembered visibility is older than a day (or every one, with
 * `force`), and remember the answers with their time: what the tick calls, at most once a day. A probe with no
 * answer keeps the visibility last known, and its time is still recorded, so an offline project is not asked
 * on every command. Returns the remotes as seen.
 */
export async function refreshVisibility(w: Where, opts: { force?: boolean } = {}): Promise<Seen[]> {
  const now = w.now()
  const out: Seen[] = []
  for (const r of trackerRemotes(w)) {
    if (isLocalRemote(r.url)) {
      out.push({ ...r, visibility: "private", from: "local" })
      continue
    }
    const known = cached(w.trackerGit, r.key)
    if (known && !opts.force && now.getTime() - known.at.getTime() < REFRESH_MS && known.at.getTime() <= now.getTime()) {
      out.push({ ...r, visibility: known.visibility, from: "cache" })
      continue
    }
    const asked = githubRepo(r.url) ? await (probeOverride ?? probeVisibility)(r.url) : "unknown"
    const visibility = asked === "unknown" && known && known.visibility !== "unknown" ? known.visibility : asked
    remember(w.trackerGit, r.key, visibility, now)
    out.push({ ...r, visibility, from: asked === visibility ? "probe" : "cache" })
  }
  return out
}

const shown = `${TRACKER_DIR}/${DATA_DIR}`

/** What to do about a tracker committed in a repository whose origin is public. */
export const MIGRATE_FIX =
  `naima init --private-tracker, which moves ${shown} into a git repository of its own on this machine, ignored by the code's, with its data and history kept; ` +
  `what is already in the public history stays there unless that history is rewritten, which is the owner's decision (docs/guide/private-tracker.md#move-an-existing-tracker-out)`

function exposedMessage(sibling: boolean, publics: Seen[]): string {
  if (!sibling) {
    const r = publics[0] as Seen
    return `the tracker is exposed: ${shown} is committed in a repository whose origin, ${r.url}, is public, so anyone can read every item, note and attachment — ` +
      `tell the owner, then fix it: ${MIGRATE_FIX}`
  }
  const each = publics.map((r) => {
    const repo = githubRepo(r.url)
    return `${r.name} (${r.url}): make it private${repo ? ` (gh repo edit ${repo} --visibility private --accept-visibility-change-consequences)` : ""}, ` +
      `or remove it (git -C ${shown} remote remove ${r.name})`
  })
  return `the tracker is exposed: its own repository, ${shown}, has a public remote, so anyone can read every item, note and attachment pushed there — ` +
    `tell the owner, then fix it: ${each.join("; ")}`
}

function unknownMessage(sibling: boolean, unknown: Seen[]): string {
  const which = unknown.map((r) => r.url).join(", ")
  const no = sibling ? `no: make that remote private, or remove it (git -C ${shown} remote remove <name>)` : `no: ${MIGRATE_FIX}`
  return `Naima cannot tell whether ${which}, where the tracker ${sibling ? "is pushed" : "is committed"}, is public. ` +
    `Ask the owner once: is it private? yes: naima init --remote-private (recorded in ${shown}/${DATA_FILE}, not asked again); ${no}`
}

/** The tracker's exposure from remotes already seen: public anywhere is exposed; unknown and not answered by the owner is unknown. */
export function exposureOf(w: Pick<Where, "trackerRoot" | "sibling">, seen: Seen[]): Exposure {
  const answered = new Set(ownerPrivate(w.trackerRoot))
  const remotes = seen.map((r): Seen => r.visibility === "unknown" && answered.has(r.key) ? { ...r, visibility: "private", from: "owner" } : r)
  const publics = remotes.filter((r) => r.visibility === "public")
  if (publics.length) return { state: "exposed", sibling: w.sibling, remotes, message: exposedMessage(w.sibling, publics) }
  const unknown = remotes.filter((r) => r.visibility === "unknown")
  if (unknown.length) return { state: "unknown", sibling: w.sibling, remotes, message: unknownMessage(w.sibling, unknown) }
  return { state: "private" }
}

/**
 * The tracker's exposure now: visibilities remembered for less than a day, the others asked again (five seconds
 * at most each, the last known kept when there is no answer), the owner's answers applied. While the tracker is
 * exposed it is marked so in the tracker repository's git config, for the sweep todo once it is private again.
 */
export async function trackerExposure(w: Where): Promise<Exposure> {
  const exposure = exposureOf(w, await refreshVisibility(w))
  if (exposure.state === "exposed") runGit(w.trackerGit, ["config", EXPOSED_KEY, "true"])
  return exposure
}

/** Whether the tracker was seen exposed and has not had its sweep todo filed since. */
export const wasExposed = (trackerGit: string): boolean => gitOrNull(trackerGit, "config", "--get", EXPOSED_KEY) === "true"

/** Forget that the tracker was exposed: its sweep todo is filed. */
export const clearExposed = (trackerGit: string): void => void runGit(trackerGit, ["config", "--unset", EXPOSED_KEY])

const realOf = (path: string): string => {
  let p = resolve(path)
  const rest: string[] = []
  while (!existsSync(p) && dirname(p) !== p) {
    rest.unshift(p.slice(dirname(p).length + 1))
    p = dirname(p)
  }
  try {
    p = realpathSync(p)
  } catch {
    // left as resolved
  }
  return [p, ...rest].join(sep)
}

/**
 * The guard the core's write helpers call before a write: refuses every write under the tracker while it is
 * exposed, and, while its visibility cannot be told, lets them through and says the owner's question once.
 */
export function writeGuard(trackerRoot: string, exposure: Exposure, err: (line: string) => void): (path?: string) => void {
  const top = realOf(trackerRoot)
  let asked = false
  return (path?: string) => {
    if (exposure.state === "private") return
    if (path !== undefined) {
      const at = realOf(path)
      if (at !== top && !at.startsWith(top + sep)) return
    }
    if (exposure.state === "exposed") throw new NaimaError(exposure.message, "exposed")
    if (!asked) {
      asked = true
      err(`naima: ${exposure.message}`)
    }
  }
}

/** The title of the todo filed once the tracker was exposed: what finds it again, so it is filed once. */
export const SWEEP_TITLE = "Sweep the tracker for private, strategic and confidential information"

const SWEEP_PAGE = `# ${SWEEP_TITLE}

The tracker was readable by anyone: committed in a repository whose origin is public, or pushed to a public
remote. It is private now, but what was published may already have been read or copied.

Read every item, every note and every attachment, and look for:

- private information: names of people, machines, addresses, home paths, credentials, private projects;
- strategy: plans, priorities, decisions and opinions not meant to be public;
- anything else confidential.

Paraphrase or remove each finding through the CLI (naima describe, naima set, naima note), never by editing the
files by hand. Then consider the history: the old versions stay in the public repository's history, and in every
clone of it, unless that history is rewritten. Rewriting it is the owner's decision: say what was found, and ask.
`

/**
 * File the sweep todo, once: in the type with the trait follow-up, at the highest priority the project's schema
 * allows (each rank term's `urgent` value, when its field applies to the type). Returns what it did, a line.
 */
export function fileSweepTodo(ctx: Context): string {
  const type = [...ctx.registry.types.values()].find((t) => t.creatable !== false && t.traits?.includes(FOLLOW_UP))
  if (!type) return `not filed, no type of this project carries the trait ${FOLLOW_UP}: ${SWEEP_TITLE}`
  const there = ctx.repo.items.find((i) => i.type === type.id && i.meta.title === SWEEP_TITLE)
  if (there) return `already filed: ${there.type}/${there.slug}, ${SWEEP_TITLE}`
  // The most urgent value of each rank term that declares one, when its field is an enum of this type holding it.
  const urgent: Record<string, string> = {}
  for (const term of ctx.registry.rank) {
    const def = ctx.registry.fields.get(term.name)
    if (term.urgent && def && appliesTo(def, type.id) && def.values && Object.hasOwn(def.values, term.urgent)) urgent[term.name] = term.urgent
  }
  const item = createItem(ctx, type, SWEEP_TITLE, urgent)
  saveProse(ctx, item, SWEEP_PAGE)
  const said = Object.entries(urgent).map(([k, v]) => `, ${k} ${v}`).join("")
  return `filed ${type.id}/${item.slug}${said}: ${SWEEP_TITLE} — tell the owner`
}
