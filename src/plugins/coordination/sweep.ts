// The sweep of stale work: what nothing needs is dropped without asking, by
// the same steps as `naima prune --write`; everything else is only named, with
// its next step. It runs at `naima hello`, after every landing and at
// `naima claims`, and as `naima stale --write`.
//
// It reads git alone, with no network, and keeps nothing: the facts are read
// again at each run. The states of one piece of work (live, idle, stale,
// droppable, dropped) are modelled in develop/models/stale-sweep.

import { mkdirSync, rmSync, statSync, unlinkSync } from "node:fs"
import { join } from "node:path"
import {
  CLI_TRAILER,
  type Context,
  currentBranch,
  gitOrNull,
  gitReason,
  isAncestor,
  isGitRepo,
  mustGit,
  runGit,
  stateDir,
  trunk,
  worktrees as treesOf,
} from "../../core/api.ts"
import type { Claim } from "./index.ts"
import { changes, type StaleEntry, type StaleInputs } from "./stale.ts"
import { gateOfLine, openLines } from "./lines.ts"
import { keepSubmoduleCommits, plural, samePath } from "./worktrees.ts"

/** What a drop or a named piece of work is, said in a few words: the unit of the one line `hello` prints. */
export type SweepKind =
  | "merged worker branch"
  | "landed branch with only a leftover claim file"
  | "merged product branch"
  | "orphan claim"
  | "prunable worktree"
  | "idle branch"
  | "worktree with changes not committed"
  | "detached worktree"
  | "product branch not merged"
  | "claim to release"

export interface SweepItem {
  kind: SweepKind
  subject: string
  /** For a piece of work that is only named: what to do next. For one dropped: what was done. */
  next: string
}

/** One drop the sweep can make, planned: it is made by `run`. */
export interface Drop extends SweepItem {
  run(): void
}

export interface SweepPlan {
  drops: Drop[]
  /** Work only named, outside what `naima stale` already says of the workshop's own branches. */
  needs: SweepItem[]
}

export interface SweepResult {
  dropped: SweepItem[]
  /** Everything that needs a person: the workshop's stale entries that were not dropped, and the plan's own needs. */
  needs: SweepItem[]
  /** Drops that failed, each with the reason: never fatal. */
  failed: SweepItem[]
}

/** What the sweep needs besides the stale facts: the claim files' place and a fresh read of the claims. */
export interface SweepInputs extends StaleInputs {
  /** The claims directory as git names it in the tracker's repository. */
  claimsPath: string
  /** The claims, read from git now. */
  readClaims(): Claim[]
}

/** The claim reasons nothing needs: its branch is gone or merged, or it names the trunk. Any other, such as every item closed, is for a person. */
const ORPHAN = /^(its branch is (gone|merged|only a remote-tracking)|it names )/

const HOUR = 3_600_000

/** Each `Land <branch>` marker's branch tip, from one scan of the merges on every ref. */
function landedTips(root: string): Map<string, string> {
  const out = new Map<string, string>()
  const log = gitOrNull(root, "log", "--all", "--merges", "--grep=^Land ", "--format=%P%x09%s") ?? ""
  for (const l of log.split("\n")) {
    const [parents = "", subject = ""] = l.split("\t")
    const m = subject.match(/^Land (\S+)$/)
    const tip = parents.split(" ")[1]
    if (m?.[1] && tip) out.set(m[1], tip)
  }
  return out
}

const tipOf = (repo: string, branch: string): string | null => gitOrNull(repo, "rev-parse", "--verify", "--quiet", `refs/heads/${branch}^{commit}`)

/** The worktrees git lists with the reason it gives for pruning them, and those it does not: every entry but a bare one. */
function listed(repo: string): { path: string; branch: string | null; head: string | null; prunable: boolean }[] {
  const out: { path: string; branch: string | null; head: string | null; prunable: boolean }[] = []
  for (const block of (gitOrNull(repo, "worktree", "list", "--porcelain") ?? "").split(/\n\n+/)) {
    const path = block.match(/^worktree (.+)$/m)?.[1]
    if (!path || /^bare\b/m.test(block)) continue
    out.push({
      path,
      branch: block.match(/^branch refs\/heads\/(.+)$/m)?.[1] ?? null,
      head: block.match(/^HEAD ([0-9a-f]+)$/m)?.[1] ?? null,
      prunable: /^prunable\b/m.test(block),
    })
  }
  return out
}

/**
 * Remove a worktree and delete its branch: the steps of `prune --branch --write`, the worktree forced only once known
 * clean, and its submodules' commits that exist nowhere else first copied to the main checkout's clones.
 */
function dropBranchAndTree(repo: string, path: string | undefined, branch: string): void {
  if (path) keepSubmoduleCommits(repo, path)
  if (path) mustGit(repo, "worktree", "remove", "--force", path)
  mustGit(repo, "branch", "-D", branch)
}

/** Delete a claim file from a ref by a commit of its own, through a throwaway index: the ref's worktree, if any, is never touched. */
function commitWithoutFile(repo: string, ref: string, path: string, message: string): boolean {
  const old = tipOf(repo, ref)
  if (!old) return false
  const state = stateDir(repo)
  if (!state) throw new Error("this is not a git repository")
  mkdirSync(state, { recursive: true })
  const env = { GIT_INDEX_FILE: join(state, `sweep-${crypto.randomUUID()}.index`) }
  try {
    for (const args of [["read-tree", old], ["update-index", "--force-remove", "--", path]]) {
      const r = runGit(repo, args, { env })
      if (!r.ok) throw new Error(`git ${args[0]}: ${gitReason(r)}`)
    }
    const tree = runGit(repo, ["write-tree"], { env })
    if (!tree.ok) throw new Error(`git write-tree: ${gitReason(tree)}`)
    if (tree.out.trim() === mustGit(repo, "rev-parse", `${old}^{tree}`)) return false
    const made = runGit(repo, ["commit-tree", tree.out.trim(), "-p", old, "-F", "-"], { input: message })
    if (!made.ok) throw new Error(`git commit-tree: ${gitReason(made)}`)
    const moved = runGit(repo, ["update-ref", "-m", "sweep: drop a claim", `refs/heads/${ref}`, made.out.trim(), old])
    if (!moved.ok) throw new Error(`${ref} moved meanwhile: ${gitReason(moved)}`)
    return true
  } finally {
    rmSync(env.GIT_INDEX_FILE, { force: true })
  }
}

const sh = (s: string): string => (/^[\w./@:+=-]+$/.test(s) ? s : `'${s.replace(/'/g, "'\\''")}'`)

/** Count the items by kind. */
function byKind(items: SweepItem[]): Map<SweepKind, number> {
  const out = new Map<SweepKind, number>()
  for (const i of items) out.set(i.kind, (out.get(i.kind) ?? 0) + 1)
  return out
}

/** The plural of a kind, for a count: merged worker branch -> merged worker branches, worktree with changes... -> worktrees with changes... */
export function kindCount(kind: SweepKind, n: number): string {
  if (n === 1) return `1 ${kind}`
  const plurals: Record<SweepKind, string> = {
    "merged worker branch": "merged worker branches",
    "landed branch with only a leftover claim file": "landed branches with only a leftover claim file",
    "merged product branch": "merged product branches",
    "orphan claim": "orphan claims",
    "prunable worktree": "prunable worktrees",
    "idle branch": "idle branches",
    "worktree with changes not committed": "worktrees with changes not committed",
    "detached worktree": "detached worktrees",
    "product branch not merged": "product branches not merged",
    "claim to release": "claims to release",
  }
  return `${n} ${plurals[kind]}`
}

/**
 * The plan: every drop the sweep would make and every piece of work it only names, read now and written nowhere.
 * A piece of work is dropped only when nothing needs it: the trunk, or a line, holds all its commits and its worktree
 * has nothing uncommitted (a leftover claim file after a landing aside); a claim only when its branch is gone or merged.
 */
export function planSweep(ctx: Context, inputs: SweepInputs, entries: StaleEntry[]): SweepPlan {
  const root = ctx.root
  const main = trunk(root)
  const drops: Drop[] = []
  const needs: SweepItem[] = []
  const isClaimFile = (p: string): boolean => p.startsWith(`${ctx.trackerDir ? `${ctx.trackerDir}/` : ""}claims/`)
  const landed = landedTips(root)
  const trees = listed(root)
  const handled = new Set<string>()

  // The workshop's own branches: merged ones, and landed ones that only keep a leftover claim file.
  const workshop = (branch: string, tree: string | undefined, dirty: string[], ahead: number | undefined): void => {
    if (handled.has(branch)) return
    const tip = tipOf(root, branch)
    if (!tip || (main && branch === main) || gateOfLine(branch)) return
    if (tree && samePath(tree, root)) return
    const isLanded = landed.get(branch) === tip
    const merged = ahead === 0 || isLanded
    if (!merged) return
    const leftover = dirty.length > 0 && dirty.every(isClaimFile)
    if (dirty.length && !(isLanded && leftover)) return
    handled.add(branch)
    drops.push({
      kind: leftover ? "landed branch with only a leftover claim file" : "merged worker branch",
      subject: branch,
      next: `removed ${tree ? `the worktree ${tree} and ` : ""}the branch ${branch}`,
      run: () => {
        const paired = ctx.sibling && gitOrNull(ctx.trackerGit, "rev-parse", "--verify", "--quiet", `refs/heads/${branch}`) !== null
        if (paired) mustGit(ctx.trackerGit, "branch", "-D", branch)
        dropBranchAndTree(root, tree, branch)
      },
    })
  }
  for (const e of entries) {
    if (e.gone) continue
    // The stale facts already measured the branch against its base: ahead 0 is merged.
    workshop(e.branch, e.worktree, e.dirty, e.ahead)
  }
  // Landed branches the stale facts do not list yet: just landed, nothing idle about them.
  for (const b of (gitOrNull(root, "for-each-ref", "--format=%(refname:short)", "refs/heads") ?? "").split("\n").filter(Boolean)) {
    if (handled.has(b) || (main && b === main) || gateOfLine(b) || !landed.has(b)) continue
    const tree = trees.find((w) => w.branch === b && !w.prunable)
    const dirty = tree ? changes(tree.path).paths : []
    workshop(b, tree?.path, dirty, undefined)
  }

  // Worktrees git itself reports prunable, in the workshop and in the product clone.
  const repos: { repo: string; name: string }[] = [{ repo: root, name: "the workshop" }]
  const program = ctx.program
  const product = isGitRepo(program) && !samePath(program, root) && samePath(gitOrNull(program, "rev-parse", "--show-toplevel") ?? "", program)
  if (product) repos.push({ repo: program, name: "the product clone" })
  for (const { repo, name } of repos) {
    const gone = listed(repo).filter((w) => w.prunable)
    if (gone.length) {
      drops.push({
        kind: "prunable worktree",
        subject: `${plural(gone.length, "worktree")} of ${name}: ${gone.map((w) => w.path).join(", ")}`,
        next: `ran git worktree prune in ${name}`,
        run: () => {
          mustGit(repo, "worktree", "prune")
        },
      })
    }
  }
  for (const w of trees.slice(1)) {
    if (w.prunable || w.branch || !w.head) continue
    needs.push({
      kind: "detached worktree",
      subject: w.path,
      next: `detached at ${w.head.slice(0, 9)}: remove it with git worktree remove ${sh(w.path)} once nothing there is wanted, or switch it to a branch`,
    })
  }

  if (product) productPlan(ctx, program, inputs, drops, needs)

  // Claims nothing needs: the branch is gone or merged. One on this disk is removed as prune does; one a line carries, by a commit on that line.
  const alive = new Set(
    (gitOrNull(ctx.trackerGit, "for-each-ref", "--format=%(refname:short)", "refs/heads") ?? "").split("\n").filter(Boolean),
  )
  const known = {
    remotes: (gitOrNull(ctx.trackerGit, "for-each-ref", "--format=%(refname)", "refs/remotes") ?? "").split("\n").filter(Boolean),
    lines: openLines(ctx.trackerGit).map((l) => l.branch),
    locals: new Set((gitOrNull(ctx.trackerGit, "for-each-ref", "--format=%(refname:short)", "refs/heads") ?? "").split("\n").filter(Boolean)),
  }
  const inMain = (treesOf(ctx.trackerGit)[0] ?? { self: false }).self
  const checkedOut = new Set(treesOf(ctx.trackerGit).filter((w) => !w.self && w.branch).map((w) => w.branch as string))
  for (const c of inputs.claims) {
    let why = inputs.staleReason(c)
    // A branch only a remote-tracking ref remembers, whose work the line or the trunk already holds, and quiet for staleAfter hours: the same as gone.
    if (!why) {
      const held = remoteOnlyMerged(ctx, c, main, inputs.staleAfter, known)
      if (!held) continue
      why = held
    }
    if (!ORPHAN.test(why)) {
      needs.push({
        kind: "claim to release",
        subject: `${c.branch} (${c.file})`,
        next: `${why}: ${inputs.releaseLine(c)}`,
      })
      continue
    }
    const subject = `${c.branch} (${c.file}${c.ref !== c.branch ? ` on ${c.ref}` : ""})`
    const file = `${inputs.claimsPath}/${c.file}`
    const here = currentBranch(ctx.trackerGit)
    // On the trunk's or a line's own checkout the removal is committed with the claim file alone, so the checkout stays clean for a landing.
    const committed = c.local && inMain && here !== null && (here === main || !!gateOfLine(here)) &&
      gitOrNull(ctx.trackerGit, "ls-files", "--error-unmatch", "--", file) !== null
    if (committed) {
      drops.push({
        kind: "orphan claim",
        subject,
        next: `committed its removal on ${here}`,
        run: () => {
          mustGit(ctx.trackerGit, "rm", "-q", "--", file)
          mustGit(ctx.trackerGit, "commit", "-q", "-m", `Drop the claim of ${c.branch}: ${why}\n\n${CLI_TRAILER}: stale\n`, "--", file)
        },
      })
    } else if (c.local) {
      drops.push({
        kind: "orphan claim",
        subject,
        next: `removed ${c.file} from this checkout: commit the deletion`,
        run: () => unlinkSync(join(ctx.trackerRoot, "claims", c.file)),
      })
    } else if ((gateOfLine(c.ref) || c.ref === main) && alive.has(c.ref) && inMain && !checkedOut.has(c.ref)) {
      drops.push({
        kind: "orphan claim",
        subject,
        next: `committed its removal on ${c.ref}`,
        run: () => {
          commitWithoutFile(
            ctx.trackerGit,
            c.ref,
            `${inputs.claimsPath}/${c.file}`,
            `Drop the claim of ${c.branch}: ${why}\n\nA claim whose branch nothing holds any more.\n\n${CLI_TRAILER}: stale\n`,
          )
        },
      })
    } else {
      needs.push({
        kind: "claim to release",
        subject,
        next: `${why}: ${
          inMain
            ? `${c.ref} is checked out in another worktree, so switch there and run naima prune --write`
            : `run naima stale --write from the main checkout to commit its removal on ${c.ref}`
        }`,
      })
    }
  }
  return { drops, needs }
}

/**
 * Why a claim whose branch exists only as remote-tracking refs counts as orphan, or undefined: every such ref is held by
 * the claim's own ref, the trunk or an open line, and the claim has been quiet for `staleAfter` hours.
 */
function remoteOnlyMerged(
  ctx: Context,
  c: Claim,
  main: string | null,
  staleAfter: number,
  known: { remotes: string[]; lines: string[]; locals: Set<string> },
): string | undefined {
  const repo = ctx.trackerGit
  if (known.locals.has(c.branch)) return undefined
  const remotes = known.remotes.filter((r) => r.replace(/^refs\/remotes\/[^/]+\//, "") === c.branch)
  if (!remotes.length) return undefined
  const holders = [c.ref, ...(main ? [main] : []), ...known.lines].filter((r) => known.locals.has(r))
  if (!remotes.every((r) => holders.some((h) => isAncestor(repo, r, `refs/heads/${h}`)))) return undefined
  const since = Date.parse(c.step?.since ?? c.claimedAt)
  if (Number.isNaN(since) || ctx.now().getTime() - since < staleAfter * HOUR) return undefined
  return "its branch is only a remote-tracking ref, and its work is on a line or the trunk"
}

/** The product clone: its worktrees and worker branches, merged or idle, clean or dirty. */
function productPlan(ctx: Context, repo: string, inputs: StaleInputs, drops: Drop[], needs: SweepItem[]): void {
  const heads = (gitOrNull(repo, "for-each-ref", "--format=%(refname)", "refs/heads", "refs/remotes/origin") ?? "").split("\n").filter(Boolean)
  const integration = heads.filter((r) => /^refs\/(heads|remotes\/origin)\/(main|master|line\/.+)$/.test(r))
  const isIntegration = (b: string): boolean => /^(main|master|line\/.+)$/.test(b)
  // Branches an integration ref holds, one call each.
  const mergedBranches = new Set(
    integration.flatMap((r) => (gitOrNull(repo, "for-each-ref", "--merged", r, "--format=%(refname:short)", "refs/heads") ?? "").split("\n").filter(Boolean)),
  )
  const trees = listed(repo).filter((w) => !w.prunable)
  const first = trees[0]
  const now = ctx.now().getTime()
  const common = gitOrNull(repo, "rev-parse", "--git-common-dir")
  const lastSign = (branch: string, tree: string | undefined, dirtyNewest: number): number => {
    const signs = [Date.parse(gitOrNull(repo, "log", "-1", "--format=%cI", `refs/heads/${branch}`) ?? ""), dirtyNewest]
    if (common) {
      try {
        signs.push(statSyncMtime(join(repo, common, "logs", "refs", "heads", ...branch.split("/"))))
      } catch { /* a branch with no reflog: the commit date stands */ }
    }
    void tree
    return Math.max(...signs.filter((t) => !Number.isNaN(t)), 0)
  }
  const branches = (gitOrNull(repo, "for-each-ref", "--format=%(refname:short)", "refs/heads") ?? "").split("\n").filter(Boolean)
  const seen = new Set<string>()
  for (const w of trees) {
    if (w === first || samePath(w.path, ctx.program)) continue
    if (!w.branch) {
      needs.push({
        kind: "detached worktree",
        subject: w.path,
        next: `in the product clone, detached at ${w.head?.slice(0, 9) ?? "?"}: remove it with git -C ${sh(repo)} worktree remove ${
          sh(w.path)
        } once nothing there is wanted`,
      })
      continue
    }
    seen.add(w.branch)
    decide(w.branch, w.path)
  }
  for (const b of branches) {
    if (seen.has(b) || (first?.branch === b)) continue
    decide(b, undefined)
  }

  function decide(branch: string, tree: string | undefined): void {
    if (isIntegration(branch)) return
    const merged = mergedBranches.has(branch)
    const st = tree ? changes(tree) : { paths: [], newest: NaN }
    const idle = Math.floor((now - lastSign(branch, tree, st.newest)) / HOUR)
    const where = tree ? `${tree} (the product clone)` : `${branch} (the product clone)`
    if (st.paths.length) {
      needs.push({
        kind: "worktree with changes not committed",
        subject: where,
        next: `${plural(st.paths.length, "file")} not committed, idle ${
          plural(idle, "hour")
        }: hand it to a worker, who reads git status there first and never discards what is not committed`,
      })
    } else if (merged && idle >= inputs.staleAfter) {
      drops.push({
        kind: "merged product branch",
        subject: where,
        next: `removed ${tree ? `the worktree ${tree} and ` : ""}the branch ${branch} in the product clone`,
        run: () => dropBranchAndTree(repo, tree, branch),
      })
    } else if (!merged && idle >= inputs.staleAfter) {
      needs.push({
        kind: "product branch not merged",
        subject: where,
        next: `idle ${
          plural(idle, "hour")
        } with commits no line holds: land it, tag it (git tag archive/${branch} ${branch}) and delete it, or hand it to a worker`,
      })
    }
  }
}

const statSyncMtime = (path: string): number => statSync(path).mtimeMs

/** Carry out a plan: each drop on its own, so one that fails never stops the others. */
export function applyPlan(plan: SweepPlan): { dropped: SweepItem[]; failed: SweepItem[] } {
  const dropped: SweepItem[] = []
  const failed: SweepItem[] = []
  for (const d of plan.drops) {
    try {
      d.run()
      dropped.push({ kind: d.kind, subject: d.subject, next: d.next })
    } catch (e) {
      failed.push({ kind: d.kind, subject: d.subject, next: e instanceof Error ? e.message.split("\n")[0] ?? "" : String(e) })
    }
  }
  return { dropped, failed }
}

/** The words for hello and after a landing: one line per kind dropped, and one line for what needs a person, apart. */
export function sweepLines(r: SweepResult): { said: string[]; needs: string[] } {
  const said: string[] = []
  for (const [kind, n] of byKind(r.dropped)) said.push(`dropped ${kindCount(kind, n)}`)
  if (r.failed.length) said.push(`could not drop ${r.failed.length}: ${r.failed.map((f) => `${f.subject} (${f.next})`).join("; ")}`)
  const needs = r.needs.length
    ? [
      `${r.needs.length} stale ${r.needs.length === 1 ? "piece of work needs" : "pieces of work need"} you (naima stale says what to do): ${
        [...byKind(r.needs)].map(([k, n]) => kindCount(k, n)).join(", ")
      }`,
    ]
    : []
  return { said, needs }
}
