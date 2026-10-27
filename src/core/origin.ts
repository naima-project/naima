// Where an item comes from: who asked for it and in what role, who filed it,
// in which session, when and on which branch, and the item it was derived
// from. `origin` is written once, when the item is created, and never changed
// afterwards (features/every-item-records-origin-who-asked-what).
//
// A session is what `naima hello` starts: it gives the session an id, kept
// beside the tick's state in the clone's git directory, never committed, one
// per worktree; a worktree with no session of its own records the main
// worktree's, so a worker's filings count in the session of the coordinator
// that started it. An agent tool's own session id is used when its adapter
// passes one (`naima hello --hook <tool>`), and `NAIMA_SESSION` overrides
// both. Every write of an item in a session is appended to that session's
// log, which `naima origin <session>` reads with the items it filed:
//
//   <git common dir>/naima/origin/
//     current-<worktree>.json   the session a worktree is in: { id, started }
//     <session>.jsonl           one line per write: { at, kind, id, ref }

import { createHash, randomUUID } from "node:crypto"
import { appendFileSync, existsSync, mkdirSync, readFileSync, realpathSync } from "node:fs"
import { dirname, join, relative, resolve } from "node:path"
import { ADAPTERS } from "./adapters/index.ts"
import { bool, parse, usageError } from "./args.ts"
import { writeFileAtomic } from "./files.ts"
import { currentBranch, gitOrNull, isGitRepo, runGit } from "./git.ts"
import { META, saveMeta } from "./item.ts"
import { label } from "./lifecycle.ts"
import { tickDir } from "./tick.ts"
import type { Command, Context, FieldDef, Item, OriginRequest, WriteHook } from "./types.ts"

/** Who can ask for an item, or file one. */
export const ROLES = ["owner", "coordinator", "worker", "agent", "person", "unknown"] as const
export type Role = typeof ROLES[number]

/** An item's origin, as meta.json holds it. */
export interface Origin {
  askedBy: Role
  /** The name of the person who asked, when askedBy is person. */
  person?: string
  filedBy: { name?: string; role: Role }
  session?: string
  /** The instant it was filed, ISO 8601. */
  on: string
  branch?: string
  /** The id of the item it was derived from. */
  from?: string
  /** Inferred from git by `naima origin --backfill`, not recorded when the item was filed. */
  inferred?: true
  /** For an inferred origin: the commit that added the item, its first 12 hex digits. */
  commit?: string
}

export const ORIGIN: FieldDef = {
  name: "origin",
  kind: "object",
  says:
    "where the item comes from, written once by naima new and never changed: { askedBy: owner, coordinator, worker, agent, person (with person: the name) or unknown; filedBy: { name, role }; session: the session it was filed in; on: the instant; branch; from: the id of the item it was derived from }, with inferred: true and commit when naima origin --backfill read it from git",
}

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v)

/** An item's origin, or undefined when it has none. */
export const originOf = (item: Item): Origin | undefined => (isObject(item.meta[ORIGIN.name]) ? item.meta[ORIGIN.name] as unknown as Origin : undefined)

// ── sessions ─────────────────────────────────────────────────────────────────

/** The folder of the sessions and their logs, beside the tick's: null outside git. */
export function sessionsDir(root: string): string | null {
  const tick = tickDir(root)
  return tick ? join(dirname(tick), "origin") : null
}

/** The key of a git directory: a worktree's own, or the clone's common one for the main worktree. */
const keyOf = (gitDir: string): string => createHash("sha256").update(resolve(gitDir)).digest("hex").slice(0, 12)

/** This worktree's git directory and the clone's common one, absolute; null outside git. */
function gitDirs(root: string): { own: string; common: string } | null {
  const own = gitOrNull(root, "rev-parse", "--git-dir")
  const common = gitOrNull(root, "rev-parse", "--git-common-dir")
  const abs = (p: string): string => {
    try {
      return realpathSync(resolve(root, p))
    } catch {
      return resolve(root, p)
    }
  }
  return own && common ? { own: abs(own), common: abs(common) } : null
}

/** A session id as given: letters, digits, dots, dashes and underscores, at most 128. */
const SESSION = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/

/** The id of a new session: the day, and eight hex digits. */
export const newSessionId = (now: Date): string => `${now.toISOString().slice(0, 10)}-${randomUUID().slice(0, 8)}`

/**
 * Start a session in this worktree, as `naima hello` does: with `given`, the agent tool's own session id, else a new
 * one. Returns the id, or null when it cannot be kept (outside git, or a folder it may not write).
 */
export function startSession(root: string, now: Date, given?: string): string | null {
  const dir = sessionsDir(root)
  const dirs = gitDirs(root)
  if (!dir || !dirs) return null
  const id = given && SESSION.test(given) ? given : newSessionId(now)
  try {
    writeFileAtomic(join(dir, `current-${keyOf(dirs.own)}.json`), JSON.stringify({ id, started: now.toISOString() }) + "\n")
  } catch {
    return null
  }
  return id
}

function readSession(path: string): string | undefined {
  try {
    const v: unknown = JSON.parse(readFileSync(path, "utf8"))
    return isObject(v) && typeof v["id"] === "string" && SESSION.test(v["id"]) ? v["id"] : undefined
  } catch {
    return undefined
  }
}

/** The session this worktree is in: NAIMA_SESSION, else its own, else the main worktree's; undefined when none was started. */
export function currentSession(root: string): string | undefined {
  const env = process.env["NAIMA_SESSION"]
  if (env && SESSION.test(env)) return env
  const dir = sessionsDir(root)
  const dirs = gitDirs(root)
  if (!dir || !dirs) return undefined
  return readSession(join(dir, `current-${keyOf(dirs.own)}.json`)) ?? readSession(join(dir, `current-${keyOf(dirs.common)}.json`))
}

/** One write of a session's log. */
export interface Logged {
  at: string
  kind: string
  id: string
  ref: string
}

/** A session's log, in order; empty when it has none. */
export function sessionLog(root: string, session: string): Logged[] {
  const dir = sessionsDir(root)
  if (!dir || !SESSION.test(session)) return []
  const path = join(dir, `${session}.jsonl`)
  if (!existsSync(path)) return []
  return readFileSync(path, "utf8").split("\n").flatMap((l) => {
    try {
      const v: unknown = JSON.parse(l)
      return isObject(v) && typeof v["id"] === "string" ? [v as unknown as Logged] : []
    } catch {
      return []
    }
  })
}

// ── who files ────────────────────────────────────────────────────────────────

/** The role of whoever runs this command: NAIMA_ROLE, else inside an agent tool a worker in a linked worktree and the coordinator in the main one, else a person. */
export function filerRole(root: string): Role {
  const given = process.env["NAIMA_ROLE"]
  if (given && (ROLES as readonly string[]).includes(given)) return given as Role
  const env = process.env as Record<string, string | undefined>
  if (!ADAPTERS.some((a) => a.runningIn?.(env))) return "person"
  const dirs = gitDirs(root)
  return dirs && dirs.own !== dirs.common ? "worker" : "coordinator"
}

/** The role `--asked-by` names, with the person's name for `person:<name>`; throws on any other value. */
export function askedByOption(value: string): Pick<OriginRequest, "askedBy" | "person"> {
  const [role, ...rest] = value.split(":")
  const name = rest.join(":").trim()
  if (role === "person") {
    if (!name) throw new Error(`--asked-by person needs the name: --asked-by "person:<name>"`)
    return { askedBy: "person", person: name }
  }
  if (!(ROLES as readonly string[]).includes(role ?? "") || rest.length) {
    throw new Error(`--asked-by "${value}" is not a role: ${ROLES.filter((r) => r !== "person").join(", ")}, or "person:<name>"`)
  }
  return { askedBy: role as string }
}

/** The origin a create records, from what it was told and the place it runs in. */
export function originFor(ctx: Context, req: OriginRequest = {}): Origin {
  const git = isGitRepo(ctx.root)
  const name = req.by?.trim() || (git ? gitOrNull(ctx.root, "config", "user.name") ?? undefined : undefined)
  const session = git ? currentSession(ctx.root) : undefined
  const branch = git ? currentBranch(ctx.root) : "HEAD"
  const askedBy = (ROLES as readonly string[]).includes(req.askedBy ?? "") ? req.askedBy as Role : "agent"
  return {
    askedBy,
    ...(askedBy === "person" && req.person ? { person: req.person } : {}),
    filedBy: { ...(name ? { name } : {}), role: filerRole(ctx.root) },
    ...(session ? { session } : {}),
    on: ctx.now().toISOString(),
    ...(branch !== "HEAD" ? { branch } : {}),
    ...(req.from ? { from: req.from } : {}),
  }
}

/**
 * The origin is written on every create and never changed: a write that changes or drops one is refused; one that
 * gives an item with none its first (naima origin --backfill) goes through. Every write in a session is logged.
 * After the private-infrastructure hook, as the no-leaks signature is: the name it records is git's own.
 */
export const originOnce: WriteHook = {
  name: "origin-once",
  says:
    "every new item records its origin (who asked, in what role, who filed it, the session, the instant, the branch, the item it came from) and no later write changes or drops it; every write in a session is logged, outside the repository, for naima origin",
  beforeWrite(write, ctx) {
    if (write.kind === "create") {
      if (!isObject(write.item.meta[ORIGIN.name])) write.item.meta = { ...write.item.meta, [ORIGIN.name]: originFor(ctx, write.origin) }
      return
    }
    const was = write.before?.[ORIGIN.name]
    if (was === undefined) return
    if (JSON.stringify(was) === JSON.stringify(write.item.meta[ORIGIN.name])) return
    return `${label(write.item)}: its origin is written once, when it is created, and never changed`
  },
  afterWrite(write, ctx) {
    try {
      if (!isGitRepo(ctx.root)) return
      const session = currentSession(ctx.root)
      const dir = sessionsDir(ctx.root)
      if (!session || !dir) return
      mkdirSync(dir, { recursive: true })
      const entry: Logged = { at: ctx.now().toISOString(), kind: write.kind, id: write.item.meta.id, ref: label(write.item) }
      appendFileSync(join(dir, `${session}.jsonl`), JSON.stringify(entry) + "\n")
    } catch {
      // the log is a convenience kept outside the repository: a folder that cannot be written loses it, never the write
    }
  },
}

// ── selecting by origin ──────────────────────────────────────────────────────

const DATE = /^\d{4}(-\d{2}(-\d{2})?)?$/

/**
 * Whether an item's origin matches `--origin`: a role (its askedBy), a date or a range of dates `from..to` (either
 * end may be left open) on the day it was filed, else a session id.
 */
export function originMatches(item: Item, query: string): boolean {
  const o = originOf(item)
  if (!o) return false
  if ((ROLES as readonly string[]).includes(query)) return o.askedBy === query
  const range = query.includes("..") ? query.split("..") : null
  if (range && range.length === 2 && range.every((d) => d === "" || DATE.test(d))) {
    const day = String(o.on).slice(0, 10)
    const [from, to] = range as [string, string]
    return (!from || day >= from) && (!to || day.slice(0, to.length) <= to)
  }
  if (DATE.test(query)) return String(o.on).startsWith(query)
  return o.session === query
}

// ── backfill ─────────────────────────────────────────────────────────────────

/** The subject of a landing marker (the coordination plugin's land.ts): `Land <branch>`. */
const LANDING = /^Land (\S+)$/

/**
 * The origin git gives an item that has none: the commit that added its meta.json (followed across moves), its author
 * and date, and the branch whose landing marker first brought that commit in; askedBy unknown. Null when git has no
 * such commit (an item not committed yet).
 */
export function inferOrigin(ctx: Context, item: Item): Origin | null {
  const path = relative(ctx.trackerGit, join(item.dir, META)).split("\\").join("/")
  const log = gitOrNull(ctx.trackerGit, "log", "--follow", "--diff-filter=A", "--format=%H%x09%an%x09%aI", "--", path)
  const added = log?.split("\n").filter(Boolean).at(-1)
  if (!added) return null
  const [sha, author, date] = added.split("\t") as [string, string, string]
  const merges = runGit(ctx.trackerGit, ["log", "--merges", "--ancestry-path", "--reverse", "--format=%s", `${sha}..HEAD`])
  const branch = merges.ok ? merges.out.split("\n").map((s) => LANDING.exec(s)?.[1]).find((b) => b) : undefined
  return {
    askedBy: "unknown",
    filedBy: { ...(author ? { name: author } : {}), role: "unknown" },
    on: new Date(date).toISOString(),
    ...(branch ? { branch } : {}),
    inferred: true,
    commit: sha.slice(0, 12),
  }
}

/** What a session filed and what else it changed, as `naima origin <session>` prints it. */
export interface SessionReview {
  session: string
  filed: { ref: string; id: string; title: string; askedBy: string }[]
  changed: { ref: string; id: string; title: string | null; writes: number; last: string }[]
}

export function reviewSession(ctx: Context, session: string): SessionReview {
  const filed = ctx.repo.items.filter((i) => originOf(i)?.session === session)
  const ids = new Set(filed.map((i) => i.meta.id))
  const changed = new Map<string, SessionReview["changed"][number]>()
  for (const l of sessionLog(ctx.root, session)) {
    if (ids.has(l.id)) continue
    const item = ctx.repo.byId.get(l.id)
    const was = changed.get(l.id)
    changed.set(l.id, { ref: item ? label(item) : l.ref, id: l.id, title: item?.meta.title ?? null, writes: (was?.writes ?? 0) + 1, last: l.at })
  }
  return {
    session,
    filed: filed.map((i) => ({ ref: label(i), id: i.meta.id, title: i.meta.title, askedBy: originOf(i)!.askedBy })),
    changed: [...changed.values()],
  }
}

export const originCommand: Command = {
  name: "origin",
  says:
    "say the session this worktree is in; with a session id, list what that session filed (each with who asked) and every other item it changed, to review a session that drifted and undo it item by item; with --backfill, give every item with no origin one inferred from git",
  enforces:
    "an origin is never changed: the backfill writes only to items with none, marks each inferred: true with askedBy unknown, for the owner to settle in a review; the session's log is read from outside the repository and never committed",
  usage: "origin [<session>] [--json] | origin --backfill [--dry-run]",
  options: [
    { name: "--json", says: "print the review as JSON: the session, the items it filed, the items it changed" },
    {
      name: "--backfill",
      says:
        "give each item with no origin the one git gives: the commit that added its meta.json, its author and date, the branch of the landing marker that brought it in; inferred: true, askedBy unknown",
    },
    { name: "--dry-run", says: "with --backfill: say what it would write, and write nothing" },
  ],
  examples: ["origin", "origin 2026-10-27-1a2b3c4d", "origin 2026-10-27-1a2b3c4d --json", "origin --backfill --dry-run", "origin --backfill"],
  long: { cannot: "the backfill asks git once per item, with no total known to git", instead: "it prints one line per item it gives an origin" },
  run(args, ctx) {
    const p = parse(args, { json: { type: "boolean" }, backfill: { type: "boolean" }, "dry-run": { type: "boolean" } })
    const [session, ...rest] = p.positionals
    if (rest.length) throw usageError(this)
    if (bool(p, "backfill")) {
      if (session) throw usageError(this)
      const dry = bool(p, "dry-run")
      let n = 0
      for (const item of ctx.repo.items) {
        if (originOf(item)) continue
        const o = inferOrigin(ctx, item)
        if (!o) continue
        n++
        ctx.out(`${label(item)}: filed ${o.on.slice(0, 10)} by ${o.filedBy.name ?? "unknown"}${o.branch ? ` on ${o.branch}` : ""}, commit ${o.commit}`)
        if (!dry) saveMeta(ctx, { ...item, meta: { ...item.meta, [ORIGIN.name]: o } })
      }
      ctx.out(`${n} item${n === 1 ? "" : "s"} ${dry ? "would be given" : "given"} an origin inferred from git, askedBy unknown`)
      return 0
    }
    if (!session) {
      const now = isGitRepo(ctx.root) ? currentSession(ctx.root) : undefined
      ctx.out(now ? `session ${now}` : "no session: naima hello starts one")
      return 0
    }
    const r = reviewSession(ctx, session)
    if (bool(p, "json")) {
      ctx.out(JSON.stringify(r, null, 2))
      return 0
    }
    ctx.out(`session ${session}: filed ${r.filed.length}, changed ${r.changed.length} more`)
    for (const f of r.filed) ctx.out(`  filed    ${f.ref}  asked by ${f.askedBy}  — ${f.title}`)
    for (const c of r.changed) ctx.out(`  changed  ${c.ref}  ${c.writes} write${c.writes === 1 ? "" : "s"}, last ${c.last}${c.title ? `  — ${c.title}` : ""}`)
    return 0
  },
}
