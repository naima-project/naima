// Who is working on what, and where each session left off — without any
// session ever writing a file another session writes.
//
//   <data>/claims/<uuid>.json        one per branch that claims work: its items, shared
//   <data>/passes/<date>-<uuid>.md   one per session note
//
// Both are written on the writer's own branch, never staged, never committed
// by the tool. The collections are recombined at read time from every branch.

import { randomUUID } from "node:crypto"
import { mkdirSync, readFileSync, unlinkSync } from "node:fs"
import { dirname, join } from "node:path"
import {
  allRefNames,
  appliesTo,
  bool,
  type BranchFile,
  type Check,
  cloneIntoNewWorktree,
  type Command,
  type Context,
  CONTRACT,
  currentBranch,
  fieldValue,
  filesAt,
  type Finding,
  findPrivate,
  gitOrNull,
  guardPrivate,
  isClone,
  label,
  mustGit,
  parse,
  type Plugin,
  positiveInt,
  posixRelative,
  privateContext,
  readAcrossBranches,
  rendered,
  short,
  str,
  type SummarySection,
  today,
  trunk,
  usageError,
  worktrees,
  writeFileAtomic,
  type WriteHook,
  writeJson,
} from "../../core/api.ts"
import {
  ahead,
  exists,
  home,
  plural,
  type Policy,
  policyFindings,
  preparingFindings,
  readPolicy,
  SEGMENT,
  SEGMENT_SAYS,
  worktreesDir,
  writeThroughGit,
} from "./worktrees.ts"
import { claimsUiView, notesUiView } from "./ui.ts"
import { changeNotesCheck, changesCommand } from "./changes.ts"
import { land, landingReportsPoint, landingsAreMarkers } from "./land.ts"
import { DIARY_RULE, diaryCheck, diaryCommand, eventCommand, EVENTS, readDiaryPerDay, timelineUiView, timelineView } from "./timeline.ts"

export { type Timeline, type TimelineEvent, timelineOf } from "./timeline.ts"
export { claimedInHistory, CLOSES, type Landing, type LandingReport, landingReportsPoint, markerMessage, moveTrunk } from "./land.ts"

export const CLAIMS = "claims"
export const PASSES = "passes"

export interface ClaimEntry {
  id: string
  ref: string
  title: string
}

export interface Claim {
  branch: string
  claimedAt: string
  note?: string
  /** The branch is being prepared to enter the trunk: it is told when the trunk moves under it. */
  preparing?: true
  items: ClaimEntry[]
  file: string
  /** The ref it was read from; this worktree's branch when `local`. */
  ref: string
  local: boolean
}

export interface Pass {
  file: string
  date: string
  at: string
  branch: string
  /** The acknowledgement line it was written with (`pass --ack`), recorded as it was valid then — a rule change later never invalidates it. */
  ack?: string
  body: string
  local: boolean
}

/**
 * The day acknowledgement lines shipped: a note dated this day or earlier is
 * grandfathered, the way a closed item on the day `commits` shipped is
 * (`trackers`' `commitsRequiredFrom`) — `sessionNoteAck` holds only a note
 * dated strictly after it.
 */
export const ACK_REQUIRED_FROM = "2026-10-02"

/** A coordination directory, from the project root, with forward slashes: it is also a path in git. */
const rel = (ctx: Context, dir: string): string => `${ctx.trackerDir}/${dir}`

function parseClaim(f: BranchFile): Claim | null {
  try {
    const c = JSON.parse(f.text) as Partial<Claim>
    if (!Array.isArray(c.items)) return null
    const items = c.items.filter((e): e is ClaimEntry => typeof e?.id === "string")
    return {
      branch: c.branch ?? f.ref,
      claimedAt: c.claimedAt ?? "",
      ...(c.note ? { note: c.note } : {}),
      ...(c.preparing === true ? { preparing: true as const } : {}),
      items,
      file: f.name,
      ref: f.ref,
      local: f.local,
    }
  } catch {
    return null // an unreadable claim is one row missing, never a broken listing
  }
}

/** The branch a claim file records, read without trusting the rest of it. */
function claimBranch(f: BranchFile): string | undefined {
  try {
    const branch = (JSON.parse(f.text) as { branch?: unknown }).branch
    return typeof branch === "string" ? branch : undefined
  } catch {
    return undefined
  }
}

export function readClaims(ctx: Context): Claim[] {
  return readAcrossBranches(ctx.root, rel(ctx, CLAIMS), ".json", { owner: claimBranch })
    .map(parseClaim)
    .filter((c): c is Claim => c !== null)
}

const FRONT = /^---\n([\s\S]*?)\n---\n/

function parsePass(f: BranchFile): Pass | null {
  const m = f.text.match(FRONT)
  if (!m?.[1]) return null
  const field = (k: string) => m[1]?.match(new RegExp(`^${k}:\\s*(.+)$`, "m"))?.[1]?.trim() ?? ""
  const date = field("date")
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null
  const ack = field("ack")
  return {
    file: f.name,
    date,
    at: field("at"),
    branch: field("branch") || f.ref,
    ...(ack ? { ack } : {}),
    body: f.text.slice(m[0].length).trim(),
    local: f.local,
  }
}

/** Every session note on every branch, newest first by instant. */
export function readPasses(ctx: Context): Pass[] {
  const key = (p: Pass) => p.at || p.date
  return readAcrossBranches(ctx.root, rel(ctx, PASSES), ".md")
    .map(parsePass)
    .filter((p): p is Pass => p !== null)
    .sort((a, b) => (key(a) < key(b) ? 1 : key(a) > key(b) ? -1 : a.file < b.file ? 1 : -1))
}

/**
 * The acknowledgement phrases `pass --ack` must see, agents-audience rules
 * first, must before should — read generically through the registry, by
 * field name, since plugins never import each other: whichever plugin (the
 * rules plugin, in this project) declares `ack`, `audience` and `strength`
 * on a type, and sets an item of it to `status: active`.
 */
function expectedAcks(ctx: Context): string[] {
  const ack = ctx.registry.fields.get("ack")
  if (!ack) return []
  const audience = ctx.registry.fields.get("audience")
  const strength = ctx.registry.fields.get("strength")
  const rank = (i: (typeof ctx.repo.items)[number]) => {
    const s = strength ? fieldValue(i, strength) : undefined
    return s === "must" ? 0 : s === "should" ? 1 : 2
  }
  return ctx.repo.items
    .filter((i) => i.meta.status === "active" && appliesTo(ack, i.type))
    .filter((i) => {
      if (!audience) return true
      const a = fieldValue(i, audience)
      return a === "agents" || a === "everyone" || a === undefined
    })
    .sort((a, b) => rank(a) - rank(b))
    .map((i) => fieldValue(i, ack))
    .filter((v): v is string => typeof v === "string" && v.length > 0)
}

function writeClaim(ctx: Context, claim: Claim): string {
  const dir = join(ctx.root, rel(ctx, CLAIMS))
  mkdirSync(dir, { recursive: true })
  const { file, ref: _ref, local: _local, ...body } = claim
  writeJson(join(dir, file), body)
  return join(rel(ctx, CLAIMS), file)
}

/** This branch's claim: the one on this worktree's disk, else one another ref carries for it. */
function myClaim(ctx: Context, branch: string, all: Claim[] = readClaims(ctx)): Claim | undefined {
  return all.find((c) => c.local && c.branch === branch) ?? all.find((c) => c.branch === branch)
}

/**
 * A new claim for this branch. When the branch committed a claim file and has
 * since deleted it (every item released, the deletion not yet committed), the
 * same file is written again rather than a second one beside it.
 */
function freshClaim(ctx: Context, branch: string): Claim {
  const committed = filesAt(ctx.root, "HEAD", rel(ctx, CLAIMS), ".json").map(parseClaim).find((c) => c?.branch === branch)
  return { branch, claimedAt: today(ctx), items: [], file: committed?.file ?? `${randomUUID()}.json`, ref: branch, local: true }
}

/** A claim that holds nothing: no item. */
const empty = (c: Claim): boolean => !c.items.length

const claimCommand: Command = {
  name: "claim",
  says: "record that this branch is working on items (writes one file on this branch)",
  enforces:
    "a claim belongs to a branch, never to a detached HEAD, and is one file on that branch; it never locks anything: several branches may claim one item",
  usage: 'claim <item>... [--note "why"] [--preparing | --not-preparing]',
  options: [
    { name: "--note", says: "why this branch holds the items; replaces the previous note" },
    {
      name: "--preparing",
      says:
        "mark the branch as being prepared to enter the trunk: from then on naima check notes every commit the trunk takes that the branch lacks, and every one committed on the trunk directly; items are optional",
    },
    { name: "--not-preparing", says: "drop the mark" },
  ],
  examples: [
    'claim export-drops export-keeps --note "alpha channel in the exporter"',
    "claim --preparing",
  ],
  run(args, ctx) {
    const p = parse(args, {
      note: { type: "string" },
      preparing: { type: "boolean" },
      "not-preparing": { type: "boolean" },
    })
    const preparing = bool(p, "preparing") ? true : bool(p, "not-preparing") ? false : undefined
    if (bool(p, "preparing") && bool(p, "not-preparing")) throw usageError(this)
    if (!p.positionals.length && preparing === undefined) throw usageError(this)
    const items = p.positionals.map((r) => ctx.repo.resolve(r))
    const branch = currentBranch(ctx.root)
    if (branch === "HEAD") throw new Error("HEAD is detached: a claim belongs to a branch — git switch -c <branch>, then claim")
    const all = readClaims(ctx)
    const held = myClaim(ctx, branch, all)
    if (!held && !items.length) throw new Error(`${branch} holds no claim: claim its items first (naima claim <item>...)`)
    const mine = held ?? freshClaim(ctx, branch)
    const note = str(p, "note")
    if (note) mine.note = note
    if (preparing === true) mine.preparing = true
    if (preparing === false) delete mine.preparing
    if (preparing !== undefined) ctx.out(`${branch} is ${preparing ? "" : "no longer "}being prepared to enter the trunk`)
    if (preparing === false && !items.length && empty(mine) && mine.local) {
      unlinkSync(join(ctx.root, rel(ctx, CLAIMS), mine.file))
      ctx.out(`removed ${join(rel(ctx, CLAIMS), mine.file)}, which held only the mark — commit the deletion on ${branch}`)
      return 0
    }
    for (const item of items) {
      if (mine.items.some((e) => e.id === item.meta.id)) {
        ctx.out(`already claimed on ${branch}: ${label(item)}`)
        continue
      }
      const others = all.filter((c) => c.branch !== branch && c.items.some((e) => e.id === item.meta.id)).map((c) => c.branch)
      if (others.length) ctx.out(`note: also claimed by ${others.join(", ")} — allowed, and worth knowing`)
      mine.items.push({ id: item.meta.id, ref: label(item), title: item.meta.title })
      ctx.out(`claimed ${label(item)}`)
    }
    ctx.out(`wrote ${writeClaim(ctx, mine)} — commit it on ${branch} with your work`)
    return 0
  },
}

const release: Command = {
  name: "release",
  says: "drop this branch's claim on items; the last one removes the file, unless the branch is being prepared (claim --preparing)",
  enforces: "only this branch's own claim is dropped, and only on items it holds; while the branch is being prepared, the emptied file is kept",
  usage: "release <item>...",
  examples: ["release export-drops"],
  run(args, ctx) {
    const p = parse(args, {})
    const refs = p.positionals
    if (!refs.length) throw usageError(this)
    const branch = currentBranch(ctx.root)
    const mine = myClaim(ctx, branch)
    if (!mine) throw new Error(`nothing to release: ${branch} holds no claim here`)
    const ids = new Set(refs.map((r) => ctx.repo.resolve(r).meta.id))
    const kept = mine.items.filter((e) => !ids.has(e.id))
    if (kept.length === mine.items.length) throw new Error(`none of ${refs.join(", ")} is claimed on ${branch}; nothing changed`)
    ctx.out(`released ${mine.items.length - kept.length} on ${branch}`)
    if (kept.length === 0 && mine.local && !mine.preparing) {
      unlinkSync(join(ctx.root, rel(ctx, CLAIMS), mine.file))
      ctx.out(`removed ${join(rel(ctx, CLAIMS), mine.file)} — commit the deletion on ${branch}`)
    } else {
      // A claim read from another ref cannot be deleted from here: an emptied copy on this branch overrides it.
      mine.items = kept
      ctx.out(`wrote ${writeClaim(ctx, mine)}`)
      if (!kept.length && mine.preparing) ctx.out(`kept, empty, while ${branch} is being prepared: naima claim --not-preparing removes it`)
    }
    return 0
  },
}

/** Who holds what, as `naima claims --json` prints it and the window's claims panel shows it. */
export interface ClaimsData {
  claims: {
    branch: string
    here: boolean
    local: boolean
    claimedAt: string
    note?: string
    preparing?: true
    items: ClaimEntry[]
  }[]
  /** The items more than one branch claims — allowed, and worth knowing. */
  contested: { id: string; ref: string; branches: string[] }[]
}

/** Every claim, recombined from every branch now — only `only`'s when given — and the items more than one holds. */
export function claimsData(ctx: Context, only?: string): ClaimsData {
  const here = currentBranch(ctx.root)
  const list = readClaims(ctx).filter((c) => !only || c.branch === only)
  const holders = new Map<string, Set<string>>()
  for (const c of list) for (const e of c.items) holders.set(e.id, (holders.get(e.id) ?? new Set()).add(c.branch))
  return {
    claims: list.map((c) => ({
      branch: c.branch,
      here: c.branch === here,
      local: c.local,
      claimedAt: c.claimedAt,
      ...(c.note ? { note: c.note } : {}),
      ...(c.preparing ? { preparing: true as const } : {}),
      items: c.items,
    })),
    contested: [...holders].filter(([, b]) => b.size > 1).map(([id, b]) => {
      const item = ctx.repo.byId.get(id)
      return { id, ref: item ? label(item) : id, branches: [...b] }
    }),
  }
}

const claimsCommand: Command = {
  name: "claims",
  says: "who holds what, recombined from every branch",
  enforces: "nothing: it only reads",
  usage: "claims [--branch <b>] [--json]",
  options: [
    { name: "--branch", says: "only the claim of this branch" },
    { name: "--json", says: "print the claims as JSON: each branch's items, note and marks, and the items more than one branch holds" },
  ],
  examples: ["claims", "claims --branch fix/export-alpha", "claims --json"],
  run(args, ctx) {
    const p = parse(args, { branch: { type: "string" }, json: { type: "boolean" } })
    const d = claimsData(ctx, str(p, "branch"))
    if (bool(p, "json")) {
      ctx.out(JSON.stringify(d, null, 2))
      return 0
    }
    if (!d.claims.some((c) => c.items.length)) ctx.out("no claims")
    for (const c of d.claims) {
      ctx.out(`${c.branch}${c.here ? "  ← here" : ""}${c.local ? "  (working tree)" : ""}${c.note ? `  — ${c.note}` : ""}`)
      for (const e of c.items) ctx.out(`  ${e.ref}  ${e.title}`)
    }
    if (d.contested.length) {
      ctx.out("\nclaimed by more than one branch (allowed):")
      for (const c of d.contested) ctx.out(`  ${c.ref} → ${c.branches.join(", ")}`)
    }
    return 0
  },
}

/** The tag that keeps a branch's commits once the branch is deleted. */
export const archiveTag = (branch: string): string => `archive/${branch}`

/**
 * Delete a branch and the worktree standing on it. A branch with commits the
 * trunk has not is deleted only when its archive tag holds them: `--archive`
 * makes the tag first.
 */
function pruneBranch(ctx: Context, branch: string, write: boolean, archive: boolean): number {
  const main = trunk(ctx.root)
  if (!main) throw new Error("no trunk (main, master, or origin's HEAD): nothing to measure the branch against")
  if (branch === main) throw new Error(`${branch} is the trunk: it is never pruned`)
  if (gitOrNull(ctx.root, "rev-parse", "--verify", "--quiet", `refs/heads/${branch}`) === null) throw new Error(`no branch ${branch}`)
  const tree = worktrees(ctx.root).find((w) => w.branch === branch)
  if (tree?.self) throw new Error(`${branch} is the worktree you stand in: prune it from another one`)
  const tag = archiveTag(branch)
  const n = ahead(ctx.root, main, branch)
  const kept = gitOrNull(ctx.root, "rev-parse", "--verify", "--quiet", `refs/tags/${tag}`) !== null &&
    gitOrNull(ctx.root, "merge-base", "--is-ancestor", branch, `refs/tags/${tag}`) !== null
  const unkept = n > 0 && !kept
  if (unkept) {
    const why = `${branch} has ${plural(n, "commit")} not on ${main} and no ${tag} tag holding them`
    if (!archive) {
      if (write) throw new Error(`${why}: deleting it would lose them — pass --archive to tag them as ${tag} first`)
      ctx.out(`${why}: --archive tags them first`)
    }
  }
  const plan = [
    ...(unkept && archive ? [`tag ${tag} at ${branch}`] : []),
    ...(tree ? [`remove the worktree ${tree.path}`] : []),
    `delete the branch ${branch}`,
  ]
  if (!write) {
    ctx.out(`would ${plan.join(", ")} — run again with --write`)
    return 0
  }
  if (unkept && archive) mustGit(ctx.root, "tag", tag, branch)
  if (tree) mustGit(ctx.root, "worktree", "remove", tree.path)
  mustGit(ctx.root, "branch", "-D", branch)
  ctx.out(`did ${plan.join(", ")}${kept || (unkept && archive) ? ` — its commits stay on ${tag}` : ""}`)
  return 0
}

const prune: Command = {
  name: "prune",
  says:
    "list (or with --write remove) claim files naming a branch git no longer has; one only another ref carries is listed with that ref, to be dropped there. With --branch, delete a branch and its worktree, refusing one with unmerged commits that no archive/<branch> tag holds",
  enforces: "the trunk is never pruned, and a branch with unmerged commits that no archive/<branch> tag holds is refused; nothing is removed without --write",
  usage: "prune [--write] | prune --branch <b> [--archive] [--write]",
  options: [
    { name: "--write", says: "remove the stale claim files, or the branch and its worktree, instead of listing what would go" },
    { name: "--branch", says: "the branch to delete, with the worktree standing on it" },
    { name: "--archive", says: "tag the branch's commits as archive/<branch> before deleting it, so none is lost" },
  ],
  examples: ["prune", "prune --write", "prune --branch claude/old-idea --archive --write"],
  run(args, ctx) {
    const p = parse(args, { write: { type: "boolean" }, branch: { type: "string" }, archive: { type: "boolean" } })
    const write = bool(p, "write")
    const branch = str(p, "branch")
    if (branch) return pruneBranch(ctx, branch, write, bool(p, "archive"))
    if (bool(p, "archive")) throw usageError(this)
    const alive = allRefNames(ctx.root)
    const stale = readClaims(ctx).filter((c) => !alive.has(c.branch))
    if (!stale.length) {
      ctx.out("every claim names a branch that exists")
      return 0
    }
    // Only a file on this disk can be removed from here; one another ref carries is dropped on that ref.
    const here = stale.filter((c) => c.local)
    const elsewhere = stale.filter((c) => !c.local)
    const holds = (c: Claim) => `${c.items.length} items`
    for (const c of here) ctx.out(`  ${c.branch}  ${holds(c)}  ${c.file}`)
    for (const c of elsewhere) {
      ctx.out(`  ${c.branch}  ${holds(c)}  ${c.file}  on ${c.ref}: drop it there (git switch ${c.ref}, naima prune --write)`)
    }
    if (!write) {
      ctx.out("nothing removed — run again with --write")
      return 0
    }
    for (const c of here) unlinkSync(join(ctx.root, rel(ctx, CLAIMS), c.file))
    ctx.out(
      `removed ${here.length} here${elsewhere.length ? `; ${elsewhere.length} must be dropped on its ref` : ""} — commit the deletions on ${
        currentBranch(ctx.root)
      }`,
    )
    return 0
  },
}

const pass: Command = {
  name: "pass",
  says: "write this session's note (one new file), or list the newest",
  enforces:
    "a session note is one new file: earlier ones are never rewritten; --ack is refused unless it carries every phrase the project's active rules ask an agent to acknowledge",
  usage: 'pass "<what changed, what is proven, what is left>" [--ack "<line>"] | pass --file <f> [--ack "<line>"] | pass --list [n] [--json]',
  options: [
    { name: "--file", says: "read the note from a file instead of the arguments" },
    {
      name: "--ack",
      says:
        "the acknowledgement line the project's rules ask for (naima rules --audience agents, last line) — written first, and refused if a phrase is missing from it",
    },
    { name: "--list", says: "print the newest n notes across every branch instead of writing one", default: "5" },
    { name: "--json", says: "with --list, print the notes as JSON: each one's date, instant, branch, ack, file and text" },
  ],
  examples: [
    'pass "Exporter keeps alpha; proof owed: tests/export-keeps-alpha" --ack "Acknowledge: Quiet mode on"',
    "pass --file note.md",
    "pass --list 3",
    "pass --list 3 --json",
  ],
  run(args, ctx) {
    const p = parse(args, { file: { type: "string" }, ack: { type: "string" }, list: { type: "boolean" }, json: { type: "boolean" } })
    if (bool(p, "json") && !bool(p, "list")) throw usageError(this)
    if (bool(p, "list")) {
      const n = positiveInt(p.positionals[0], 5, "pass --list")
      const passes = readPasses(ctx).slice(0, n)
      if (bool(p, "json")) {
        ctx.out(JSON.stringify(passes, null, 2))
        return 0
      }
      if (!passes.length) ctx.out("no session notes")
      for (const s of passes) ctx.out(`── ${s.date}  ${s.branch}${s.local ? "  (working tree)" : ""}\n${s.body}\n`)
      return 0
    }
    const file = str(p, "file")
    const text = (file ? readFileSync(file, "utf8") : p.positionals.join(" ")).trim()
    if (!text) throw usageError(this)
    const ack = str(p, "ack")
    if (ack !== undefined) {
      const missing = expectedAcks(ctx).filter((phrase) => !ack.includes(phrase))
      if (missing.length) {
        throw new Error(
          `pass --ack is missing: ${missing.join(" · ")} — naima rules --audience agents prints the line to give back`,
        )
      }
    }
    const now = ctx.now()
    const date = now.toISOString().slice(0, 10)
    const branch = currentBranch(ctx.root)
    const dir = join(ctx.root, rel(ctx, PASSES))
    mkdirSync(dir, { recursive: true })
    const name = `${date}-${randomUUID()}.md`
    const allowance = guardPrivate("the session note", findPrivate(text, privateContext()), ctx.allowPrivate)
    const body = [ack, text, allowance].filter(Boolean).join("\n\n")
    writeFileAtomic(
      join(dir, name),
      `---\ndate: ${date}\nat: ${now.toISOString()}\nbranch: ${branch}${ack ? `\nack: ${ack}` : ""}\n---\n\n${body}\n`,
    )
    ctx.out(`wrote ${join(rel(ctx, PASSES), name)} — commit it on ${branch} with the work it describes`)
    return 0
  },
}

/** `open`: the worktree, the policy-named branch and the claim, in one step. */
function openCommand(policy: Policy): Command {
  return {
    name: "open",
    says: "start a piece of work: a worktree <worktrees>/<what> on a new branch <who>/<what> from the trunk, and its claim on the items, in one step",
    enforces: "work happens on its own branch and worktree from the trunk, and its claim on the items is recorded in the same step",
    usage: 'open <item>... [--as <who>] [--name <what>] [--note "why"]',
    options: [
      { name: "--as", says: "who works: the branch's first segment", ...(policy.who ? { default: policy.who } : {}) },
      { name: "--name", says: "what the work is: the branch's last segment and the worktree's folder", default: "the first item's slug" },
      { name: "--note", says: "why the branch holds the items, written in the claim" },
    ],
    examples: ['open export-drops --as claude --note "alpha channel in the exporter"', "open export-drops export-keeps --as claude --name export-alpha"],
    run(args, ctx) {
      const p = parse(args, { as: { type: "string" }, name: { type: "string" }, note: { type: "string" } })
      if (!p.positionals.length) throw usageError(this)
      const who = str(p, "as") ?? policy.who
      if (!who) throw new Error("open needs --as <who>, the branch's first segment, or the coordination plugin's who option")
      const items = p.positionals.map((r) => ctx.repo.resolve(r))
      const what = str(p, "name") ?? items[0]?.slug ?? ""
      for (const [flag, value] of [["--as", who], ["--name", what]] as const) {
        if (!SEGMENT.test(value)) throw new Error(`${flag} ${value}: each part of a branch name is a ${SEGMENT_SAYS}`)
      }
      const branch = `${who}/${what}`
      const trees = worktrees(ctx.root)
      const path = join(worktreesDir(policy, home(ctx.root, trees)), what)
      if (gitOrNull(ctx.root, "rev-parse", "--verify", "--quiet", `refs/heads/${branch}`) !== null) {
        throw new Error(`branch ${branch} already exists: pick another --name, or work in it where it stands`)
      }
      if (exists(path)) throw new Error(`${path} already exists: pick another --name`)
      const base = trunk(ctx.root) ?? "HEAD"
      mustGit(ctx.root, "worktree", "add", "-q", "-b", branch, path, base)
      const newProgram = join(path, posixRelative(ctx.root, ctx.program))
      if (!isClone(ctx.program)) {
        ctx.out(`${posixRelative(ctx.root, ctx.program)} is not a program clone yet: ${path} will align its own on its first run (naima check)`)
      } else {
        const newData = join(path, ctx.trackerDir)
        cloneIntoNewWorktree({
          root: path,
          tracker: dirname(newData),
          program: newProgram,
          source: ctx.config.source,
          commit: ctx.config.commit,
          ...(ctx.config.verify ? { verify: ctx.config.verify } : {}),
          seeds: [ctx.program],
        }, ctx.root)
        ctx.out(`cloned ${posixRelative(path, newProgram)} from ${posixRelative(ctx.root, ctx.program)}, at ${short(ctx.config.commit)} — no network`)
      }
      const others = readClaims(ctx)
      const claim: Claim = { branch, claimedAt: today(ctx), items: [], file: `${randomUUID()}.json`, ref: branch, local: true }
      const note = str(p, "note")
      if (note) claim.note = note
      for (const item of items) {
        if (claim.items.some((e) => e.id === item.meta.id)) continue
        const holders = others.filter((c) => c.items.some((e) => e.id === item.meta.id)).map((c) => c.branch)
        if (holders.length) ctx.out(`note: ${label(item)} is also claimed by ${holders.join(", ")} — allowed, and worth knowing`)
        claim.items.push({ id: item.meta.id, ref: label(item), title: item.meta.title })
      }
      // The new worktree is outside what this run may write: git writes the claim there.
      const { file: name, ref: _ref, local: _local, ...body } = claim
      const file = `${rel(ctx, CLAIMS)}/${name}`
      writeThroughGit(path, file, JSON.stringify(body, null, 2) + "\n")
      ctx.out(`opened ${path} on ${branch}, from ${base}`)
      ctx.out(`claimed ${claim.items.map((e) => e.ref).join(", ")} in ${file} — commit it on ${branch} with the work`)
      ctx.out(`next: cd ${path}, and install the dependencies a fresh checkout lacks`)
      return 0
    },
  }
}

/** Who holds each branch, for the policy: a claim with items, or a session note written on it. */
const holders = (ctx: Context) => ({
  claimed: new Set(readClaims(ctx).filter((c) => !empty(c)).map((c) => c.branch)),
  noted: new Set(readPasses(ctx).map((p) => p.branch)),
  claims: rel(ctx, CLAIMS),
})

function worktreePolicy(policy: Policy): Check {
  return {
    name: "worktree-policy",
    says:
      "every worktree but the main one is <worktrees>/<what> on the branch <who>/<what>, every local branch but the trunk is <who>/<what>, and every worktree carries a claim — one with commits the trunk lacks and no claim, now or released in those commits, nor a session note, is a problem for the worktree being checked, and (unless naima check --all-worktrees) a note naming any other worktree in the same state",
    run: (ctx, options) => policyFindings(ctx.root, policy, holders(ctx), options),
  }
}

const trunkMoved: Check = {
  name: "trunk-moved-while-preparing",
  says:
    "a branch whose claim is marked preparing is told every commit the trunk took that it lacks, and which of them the trunk's reflog records as committed on the trunk directly",
  run: (ctx) => readClaims(ctx).filter((c) => c.preparing).flatMap((c) => preparingFindings(ctx.root, c.branch)),
}

const claimsResolve: Check = {
  name: "claims-resolve",
  says: "a claim written in this worktree names items that exist",
  run: (ctx) =>
    readClaims(ctx)
      .filter((c) => c.local)
      .flatMap((c) =>
        c.items.filter((e) => !ctx.repo.byId.has(e.id)).map((e): Finding => ({
          level: "note",
          message: `claim ${c.file} names ${e.ref} (${e.id}), which is not here`,
        }))
      ),
}

/**
 * AGENTS.md: a branch does not close its own items on the strength of its own
 * tests. Its own items are the ones it claims; closing one there is marking
 * its own homework, so it waits for the trunk — or for `--force`, from the
 * one who owns the evidence.
 */
const noClosingOwnWork: WriteHook = {
  name: "no-closing-own-claims",
  says:
    "archiving an item (a move to a type that is not creatable, as naima close does) that the branch you stand on claims is refused unless --force: a branch does not close its own items on the strength of its own tests",
  beforeWrite(write, ctx) {
    if (write.kind !== "move" || write.to?.creatable !== false || write.force) return
    const branch = currentBranch(ctx.root)
    if (branch === "HEAD") return // detached: no branch, so no claim of its own
    const id = write.item.meta.id
    if (!readClaims(ctx).some((c) => c.branch === branch && c.items.some((e) => e.id === id))) return
    return `${
      label(write.item)
    } is claimed by ${branch}, the branch you are on: a branch does not close its own items on the strength of its own tests — merge the work and close it from the trunk once someone else has checked the proof, or pass --force if you own the evidence`
  },
}

/**
 * The check counterpart of no-closing-own-claims: a hand edit (a directory
 * moved into the archive, meta.json rewritten) never meets the hook, so the
 * state it protects is asserted here — nothing the branch you stand on claims
 * is archived.
 */
const closedNotClaimed: Check = {
  name: "closed-not-claimed",
  says:
    "no archived item (one in a type that is not creatable, where naima close moves it) is claimed by the branch you stand on: what no-closing-own-claims refuses on a write, asserted on the tracker as it is, hand edits included",
  run(ctx) {
    const branch = currentBranch(ctx.root)
    if (branch === "HEAD") return []
    const mine = new Set(readClaims(ctx).filter((c) => c.branch === branch).flatMap((c) => c.items.map((e) => e.id)))
    return ctx.repo.items
      .filter((i) => mine.has(i.meta.id) && ctx.registry.types.get(i.type)?.creatable === false)
      .map((i): Finding => ({
        level: "problem",
        item: i,
        message: `${
          label(i)
        } is closed, yet ${branch}, the branch you are on, claims it: a branch does not close its own items — move it back, or, if the evidence owner closed it, release the claim (naima release ${i.slug})`,
      }))
  },
}

const sessionNoteAck: Check = {
  name: "session-note-ack",
  says:
    `a session note dated after ${ACK_REQUIRED_FROM} carries the acknowledgement line it was written with (naima pass --ack), and its body still begins with it — a rule change afterwards never invalidates a note already written, since what was asked of it then is what it recorded`,
  run(ctx) {
    return readPasses(ctx)
      .filter((p) => p.date > ACK_REQUIRED_FROM)
      .flatMap((p): Finding[] => {
        if (!p.ack) {
          return [{
            level: "problem",
            subject: `${PASSES}/${p.file}`,
            message:
              `${PASSES}/${p.file}: a session note dated ${p.date} carries no acknowledgement line — naima pass --ack "<line>", or, for a note already written, naima waive session-note-ack ${PASSES}/${p.file} --reason "<why>"`,
          }]
        }
        if (!p.body.startsWith(p.ack)) {
          return [{
            level: "problem",
            subject: `${PASSES}/${p.file}`,
            message: `${PASSES}/${p.file}: its body no longer begins with the acknowledgement line it was written with`,
          }]
        }
        return []
      })
  },
}

const whereWeWere: SummarySection = {
  name: "where we were",
  render(ctx) {
    const [newest, ...rest] = readPasses(ctx)
    const data = newest
      ? { date: newest.date, branch: newest.branch, lines: newest.body.split("\n").slice(0, 8), sameDay: rest.filter((p) => p.date === newest.date).length }
      : null
    return rendered(
      data,
      (d) =>
        d ? [`  ${d.date}  ${d.branch}`, ...d.lines.map((l) => `  ${l}`), ...(d.sameDay ? [`  (+${d.sameDay} more that day — naima pass --list)`] : [])] : [],
    )
  },
}

const inHand: SummarySection = {
  name: "in hand",
  render(ctx) {
    const data = readClaims(ctx).filter((c) => !empty(c)).map((c) => ({ branch: c.branch, items: c.items.map((e) => e.ref) }))
    return rendered(data, (claims) => claims.map((c) => `  ${c.branch}: ${c.items.join(", ")}`))
  },
}

export default function coordination(options: Record<string, unknown> = {}): Plugin {
  const policy = readPolicy(options)
  const diaryPerDay = readDiaryPerDay(options)
  return {
    name: "coordination",
    contract: CONTRACT,
    says: "claims and session notes, one file per session, recombined from every branch; the timeline, derived from the items and git",
    about:
      "No session writes a file another session writes. A claim is one file per branch, `claims/<uuid>.json`; a session note is one file per session, `passes/<date>-<uuid>.md`. " +
      "Both are written on the writer's own branch and never staged or committed by the tool: commit them with the work. " +
      "`claims`, `pass --list` and `summary` recombine them at read time from every local branch — the trunk, every branch not merged into it, whatever each worktree stands on — each read from the disk of the worktree that stands on it, uncommitted files included, or from its ref when none does; remote-tracking refs are not read. " +
      "The trunk is the branch origin's HEAD names, else `main`, else `master`; without one, every local branch is read. A claim belongs to a branch, so on a detached HEAD `claim` is refused. " +
      "Several branches may claim one item: `claim` says who else holds it rather than refusing. " +
      "There are no locks: a claim says who works on what and never excludes anyone. What one session at a time must touch — the trunk, the published site, the releases — is touched by one writer, the coordinator; workers only prepare on their own branches, and the owner decides what lands and when, when it matters. " +
      "Work happens by one scheme, checked: the worktree `<worktrees>/<what>` stands on the branch `<who>/<what>` and carries a claim; `open` makes all three in one step. " +
      "A claim marked `--preparing` is told when the trunk moves under it, and which commits were made on the trunk directly; `prune --branch` deletes a branch only when the trunk or an `archive/<branch>` tag holds its commits. " +
      "Landings are semi-linear: a branch the trunk is an ancestor of enters it as one marker commit, a merge whose tree is the branch tip's and whose message names the items it closes in `Closes:` trailers; `land` makes it from the main checkout, the shortcut for `git merge --no-ff`, and moves the trunk only from the commit it read. " +
      "From the first marker on the trunk's first-parent line every first-parent commit is a marker, or `landings-are-markers` notes it; before it nothing is asked, so a history of fast-forwards keeps working. " +
      "A repository of the project with `changes/config.json` — the project itself, or a product it holds as a submodule — names there the paths whose change is a change of behaviour; a branch that changes one adds a change note, `changes/<date>-<slug>.md`, in the same repository. `land` refuses a branch that does not, unless `--no-change-note` gives the reason, which the marker records as a `No-change-note:` trailer; `change-notes` notes it on the branch beforehand, and is a problem for a file of `changes/` that is not a change note. `changes` prints the release notes the change notes of a range make. " +
      "`naima view timeline` derives every event, with nothing stored: a gate opened is its first item reported (`created`), a gate passed its last item resolved (`closedOn`, else `fixedOn`) once none is open; an epic the same, from the items it groups; a release is a version tag, dated by its commit; a session is its note. " +
      "What has no date is counted at the foot, never placed at a guess. Only what nothing derives — a decision taken elsewhere, a build handed out, a policy, an outside fact — is a record, one file per event, `events/<date>-<uuid>.md`, written by `naima event`. " +
      '`naima diary` tells the records of kind `diary`, every decision with its reason and every session note, day by day. The plugin ships the rule that agents keep the diary on their own, one entry per decision taken with the owner or notable turn and never a log of routine work, acknowledged as "Diary mode on"; the check `diary-entries` notes, never failing, a day with more diary entries than the option `diaryPerDay` allows, and an entry that only restates a session note of its day or a decision taken that day. ' +
      `\`pass --ack "<line>"\` writes the acknowledgement line whichever plugin declares a rule's \`ack\` field asks an agent to give back — refused if a phrase is missing from it — and records it in the note's front matter; a note dated after ${ACK_REQUIRED_FROM} missing it, or whose body no longer starts with it, is a problem (\`session-note-ack\`), tolerating one written before — on the day it shipped, or earlier, grandfathered like a closed item on the day \`commits\` shipped — since what it recorded is what the rules asked then. A note is never edited after the fact: one written without the line is accepted with a recorded waiver, \`naima waive session-note-ack passes/<file> --reason "<why>"\`.`,
    options: [
      { name: "who", says: "who works, when `naima open` is given no `--as`: the branch's first segment" },
      {
        name: "worktrees",
        says: "the directory every worktree is a folder of, relative to the main worktree",
        default: "../<main worktree's folder>-worktrees",
      },
      { name: "exempt", says: "branches the naming scheme does not apply to: names, or patterns with *", default: "[]" },
      { name: "diaryPerDay", says: "how many diary entries a day may hold before the check diary-entries notes it: a positive whole number", default: "5" },
    ],
    dirs: [CLAIMS, PASSES, EVENTS],
    checks: [
      claimsResolve,
      worktreePolicy(policy),
      trunkMoved,
      closedNotClaimed,
      sessionNoteAck,
      landingsAreMarkers,
      diaryCheck(readPasses, diaryPerDay),
      changeNotesCheck,
    ],
    commands: [openCommand(policy), claimCommand, release, claimsCommand, land, changesCommand, prune, pass, eventCommand, diaryCommand(readPasses)],
    views: [timelineView(readPasses)],
    contributes: { "ui-views": [claimsUiView(claimsData), timelineUiView(readPasses), notesUiView(readPasses)], rules: [DIARY_RULE] },
    // The claims are a panel of naima ui, the timeline and the session notes tabs, when the ui plugin is loaded; without it, still commands and a view.
    // The diary rule is listed by naima rules when the rules plugin is loaded; without it, the check still notes.
    optional: ["ui-views", "rules"],
    points: [landingReportsPoint],
    summary: [whereWeWere, inHand],
    hooks: [noClosingOwnWork],
  }
}
