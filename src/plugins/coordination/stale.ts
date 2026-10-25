// Work a worker left behind: the branches, worktrees and claims with no
// progress for a while, or whose branch is gone or merged, each with what it
// holds and the next step for it. Everything is read from git and the
// tracker as they are; nothing is stored.

import { statSync } from "node:fs"
import { join } from "node:path"
import { allRefNames, bool, type Command, type Context, gitOrNull, isAncestor, parse, rendered, type SummarySection, trunk, worktrees } from "../../core/api.ts"
import type { Claim, Pass } from "./index.ts"
import { ahead, plural } from "./worktrees.ts"

/** What to do with a piece of stale work. */
export type NextStep = "land" | "resume" | "archive" | "drop"

export interface StaleEntry {
  branch: string
  /** The worktree standing on the branch, if any. */
  worktree?: string
  /** No branch of this name exists any more: only its claim is left. */
  gone?: true
  /** The instant of the branch's last commit, ISO 8601. */
  lastCommit?: string
  /** Whole hours since the last sign of life: a commit, a step, a session note, a file changed and not committed, the claim. */
  idleHours?: number
  /** Paths changed and not committed in its worktree (and in the tracker's worktree of the same branch). */
  dirty: string[]
  /** Commits the trunk does not have. */
  ahead?: number
  /** The trunk is an ancestor of the branch: it can enter the trunk as it is. */
  upToDate?: true
  /** The claim on the branch, with each item's status. */
  claim?: { file: string; ref: string; claimedAt: string; items: { ref: string; title: string; status: string; closed: boolean }[] }
  /** Why the work counts as stale. */
  why: string[]
  next: NextStep
  /** What to run, or do, for the next step. */
  how: string
}

export interface StaleData {
  trunk: string | null
  /** Hours without a sign of life after which a branch counts as stale: the coordination option `staleAfter`. */
  staleAfter: number
  stale: StaleEntry[]
}

/** What the plugin knows that this module does not compute itself. */
export interface StaleInputs {
  claims: Claim[]
  notes: Pass[]
  /** Why a claim no longer stands for work in progress, or undefined. */
  staleReason: (c: Claim) => string | undefined
  /** Whether an item is closed. */
  closed: (id: string) => boolean
  /** Where a stale claim is released. */
  releaseLine: (c: Claim) => string
  staleAfter: number
}

const STALE_AFTER = 24

/** The coordination option `staleAfter`: hours without a sign of life before a branch counts as stale. */
export function readStaleAfter(options: Record<string, unknown>): number {
  const v = options["staleAfter"] ?? STALE_AFTER
  if (typeof v !== "number" || !Number.isInteger(v) || v < 1) {
    throw new Error(
      `coordination: option staleAfter must be a positive whole number, the hours without a sign of life before a branch counts as stale; got ${
        JSON.stringify(v)
      }`,
    )
  }
  return v
}

const localBranches = (repo: string): string[] => (gitOrNull(repo, "for-each-ref", "--format=%(refname:short)", "refs/heads") ?? "").split("\n").filter(Boolean)

/** The paths `git status` reports in a worktree, with the newest instant one of them changed. */
function changes(path: string): { paths: string[]; newest: number } {
  const out = gitOrNull(path, "status", "--porcelain", "--untracked-files=all", "--ignore-submodules=none") ?? ""
  const paths = out.split("\n").filter(Boolean).map((l) => l.slice(3).replace(/^.* -> /, ""))
  let newest = NaN
  for (const p of paths) {
    try {
      newest = Math.max(Number.isNaN(newest) ? 0 : newest, statSync(join(path, p)).mtimeMs)
    } catch { /* deleted: no instant of its own */ }
  }
  return { paths, newest }
}

/** The next step for a stale branch, and what to run for it. */
function nextStep(e: Omit<StaleEntry, "next" | "how">, claim: Claim | undefined, inputs: StaleInputs, main: string | null): { next: NextStep; how: string } {
  const release = claim ? inputs.releaseLine(claim) : undefined
  if (e.dirty.length) {
    return {
      next: "resume",
      how: `hand ${e.worktree ?? e.branch} to a new worker, who reads git status there first and never discards what is not committed`,
    }
  }
  if (e.gone) return { next: "drop", how: `drop the claim: ${release}` }
  const open = claim?.items.some((i) => !inputs.closed(i.id)) ?? false
  if (!e.ahead) {
    return { next: "drop", how: `nothing the trunk lacks: naima prune --branch ${e.branch} --write${release ? `, then ${release}` : ""}` }
  }
  if (!open) {
    return {
      next: "archive",
      how: `${plural(e.ahead, "commit")} the trunk lacks and no open item claimed: naima prune --branch ${e.branch} --archive --write${
        release ? `, then ${release}` : ""
      }`,
    }
  }
  if (e.upToDate) {
    return {
      next: "land",
      how: `run its gates in ${e.worktree ?? `a worktree on ${e.branch}`}, then naima land ${e.branch} from the main checkout; resume it if they fail`,
    }
  }
  return { next: "resume", how: `hand ${e.branch} to a new worker: bring it up to date with ${main ?? "the trunk"}, then finish its items` }
}

/** Every stale branch, worktree and claim, with its facts and its next step. */
export function staleData(ctx: Context, inputs: StaleInputs): StaleData {
  const repo = ctx.root
  const main = trunk(repo)
  const alive = allRefNames(ctx.trackerGit)
  const trees = worktrees(repo)
  const trackerTrees = ctx.sibling ? worktrees(ctx.trackerGit) : []
  const branches = new Set([...localBranches(repo), ...inputs.claims.map((c) => c.branch)])
  if (main) branches.delete(main)
  const now = ctx.now().getTime()
  const out: StaleEntry[] = []
  for (const branch of branches) {
    const claim = inputs.claims.find((c) => c.branch === branch && c.local) ?? inputs.claims.find((c) => c.branch === branch)
    const local = gitOrNull(repo, "rev-parse", "--verify", "--quiet", `refs/heads/${branch}`) !== null
    const tree = trees.find((w) => w.branch === branch)
    const trackerTree = trackerTrees.find((w) => w.branch === branch)
    const here = tree ? changes(tree.path) : { paths: [], newest: NaN }
    const there = trackerTree ? changes(trackerTree.path) : { paths: [], newest: NaN }
    const lastCommit = local ? gitOrNull(repo, "log", "-1", "--format=%cI", `refs/heads/${branch}`) ?? undefined : undefined
    const signs = [
      lastCommit ? Date.parse(lastCommit) : NaN,
      claim?.step ? Date.parse(claim.step.since) : NaN,
      claim?.claimedAt ? Date.parse(claim.claimedAt) : NaN,
      here.newest,
      there.newest,
      ...inputs.notes.filter((n) => n.branch === branch).map((n) => Date.parse(n.at || n.date)),
    ].filter((t) => !Number.isNaN(t))
    const idleHours = signs.length ? Math.max(0, Math.floor((now - Math.max(...signs)) / 3_600_000)) : undefined
    const why: string[] = []
    const gone = !local && !alive.has(branch)
    if (gone) why.push("its branch is gone")
    const claimWhy = claim ? inputs.staleReason(claim) : undefined
    if (claimWhy && !gone) why.push(claimWhy)
    if (idleHours !== undefined && idleHours >= inputs.staleAfter) why.push(`no sign of life for ${plural(idleHours, "hour")}`)
    if (!why.length) continue
    const n = local && main ? ahead(repo, main, branch) : undefined
    const facts: Omit<StaleEntry, "next" | "how"> = {
      branch,
      ...(tree ? { worktree: tree.path } : {}),
      ...(gone ? { gone: true as const } : {}),
      ...(lastCommit ? { lastCommit } : {}),
      ...(idleHours !== undefined ? { idleHours } : {}),
      dirty: [...here.paths, ...there.paths.map((p) => `${ctx.trackerDir}/${p}`)],
      ...(n !== undefined ? { ahead: n } : {}),
      ...(local && main && isAncestor(repo, main, `refs/heads/${branch}`) ? { upToDate: true as const } : {}),
      ...(claim
        ? {
          claim: {
            file: claim.file,
            ref: claim.ref,
            claimedAt: claim.claimedAt,
            items: claim.items.map((i) => ({
              ref: i.ref,
              title: i.title,
              status: String(ctx.repo.byId.get(i.id)?.meta.status ?? "not here"),
              closed: inputs.closed(i.id),
            })),
          },
        }
        : {}),
      why,
    }
    out.push({ ...facts, ...nextStep(facts, claim, inputs, main) })
  }
  return { trunk: main, staleAfter: inputs.staleAfter, stale: out.sort((a, b) => (a.branch < b.branch ? -1 : 1)) }
}

/** One stale entry, said in lines: what `naima stale` prints. */
function entryLines(e: StaleEntry): string[] {
  const facts = [
    e.gone ? "branch gone" : e.ahead === undefined ? "" : e.ahead ? `${plural(e.ahead, "commit")} ahead${e.upToDate ? "" : ", behind the trunk"}` : "merged",
    e.lastCommit ? `last commit ${e.lastCommit.slice(0, 16).replace("T", " ")}` : "",
    e.idleHours !== undefined ? `idle ${plural(e.idleHours, "hour")}` : "",
    e.dirty.length ? `${plural(e.dirty.length, "file")} not committed` : "clean",
  ].filter(Boolean)
  return [
    `${e.branch}  — ${e.next}`,
    ...(e.worktree ? [`  worktree: ${e.worktree}`] : []),
    `  ${facts.join(" · ")}`,
    ...(e.dirty.length ? [`  not committed: ${e.dirty.slice(0, 5).join(", ")}${e.dirty.length > 5 ? `, +${e.dirty.length - 5}` : ""}`] : []),
    ...(e.claim
      ? [
        `  claim ${e.claim.file}${e.claim.ref !== e.branch ? ` (on ${e.claim.ref})` : ""}, since ${e.claim.claimedAt}:`,
        ...e.claim.items.map((i) => `    ${i.ref}  [${i.status}]${i.closed ? "  closed, still claimed" : ""}`),
      ]
      : []),
    `  why: ${e.why.join("; ")}`,
    `  next: ${e.how}`,
  ]
}

export const staleCommand = (read: (ctx: Context) => StaleData, staleAfter: number): Command => ({
  name: "stale",
  says:
    "the work left behind: every branch, worktree and claim with no sign of life for staleAfter hours, or whose branch is gone or merged, with what it holds and the next step",
  enforces:
    `nothing: it only reads; a branch counts as stale when its claim is stale (branch gone or merged into the trunk, or every item closed) or nothing happened on it for staleAfter hours (${staleAfter} here) — no commit, step, session note or file changed; the next step is resume when anything is not committed, land when it is ahead of the trunk, up to date with it and holds open items, resume when it is behind, archive when no open item is claimed, drop when the trunk has all of it or the branch is gone`,
  usage: "stale [--json]",
  options: [
    { name: "--json", says: "print the stale work as JSON: each entry's facts, why it is stale, the next step and what to run" },
  ],
  examples: ["stale", "stale --json"],
  run(args, ctx) {
    const p = parse(args, { json: { type: "boolean" } })
    const d = read(ctx)
    if (bool(p, "json")) {
      ctx.out(JSON.stringify(d, null, 2))
      return 0
    }
    if (!d.stale.length) {
      ctx.out(`no stale work: every branch and claim moved in the last ${plural(d.staleAfter, "hour")}, on a live branch with open work`)
      return 0
    }
    ctx.out(d.stale.flatMap((e, i) => [...(i ? [""] : []), ...entryLines(e)]).join("\n"))
    return 0
  },
})

export const staleSection = (read: (ctx: Context) => StaleData): SummarySection => ({
  name: "stale work",
  render(ctx) {
    const data = read(ctx).stale.map((e) => ({ branch: e.branch, next: e.next, why: e.why }))
    return rendered(
      data,
      (d) => d.length ? [...d.map((e) => `  ${e.branch}: ${e.next} — ${e.why.join("; ")}`), "  (naima stale: the facts and the commands)"] : [],
    )
  },
})
