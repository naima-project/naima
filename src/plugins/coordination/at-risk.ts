// Work at risk: what this machine alone holds, which a lost disk would take with it. Naima pushes nothing by itself
// (naima land merges without pushing; a worker's branch may live only here), so naima hello says, one line each:
//
//   the trunk and every open line with commits their remote-tracking branch lacks
//   every other local branch with commits on no remote, with the age of the oldest
//   every worktree with changes not committed, with how long the oldest has sat
//
// each with the command that makes it safe, and nothing when all is safe. A clone with no remote keeps everything on
// this disk by choice: nothing is listed for it. Git alone, from the remote-tracking refs as
// the last fetch left them: no network. The git runs go out together, so the listing costs about one of them.

import { type Context, rendered, runGitAsync, type SummarySection, trunk, worktrees } from "../../core/api.ts"
import { statSync } from "node:fs"
import { join, relative, sep } from "node:path"
import { LINE_PREFIX } from "./lines.ts"

/** How long one git run of the listing may take before it is left out. */
const GIT_MS = 5_000
/** The changed files of a worktree whose times are read, at most: enough for the oldest, cheap for a large change. */
const STAT_AT_MOST = 200

export interface AtRisk {
  /**
   * trunk or line: commits its remote-tracking branch lacks; branch: commits on no remote; worktree: changes not
   * committed.
   */
  kind: "trunk" | "line" | "branch" | "worktree"
  /** The branch, or the worktree's folder relative to the project's root ("." for the root). */
  name: string
  /** Commits, or changed files. */
  count: number
  /** The remote-tracking branch the commits are missing from, for the trunk and a line. */
  remote?: string
  /** Milliseconds since the oldest commit was made, or the oldest changed file was written; absent when unknown. */
  ageMs?: number
  /** The command that makes it safe. */
  fix: string
}

const lines = (s: string): string[] => s.split("\n").map((l) => l.trim()).filter(Boolean)

/** Everything at risk in the clone at `root`, read at `now`. */
export async function atRisk(root: string, now: number = Date.now()): Promise<AtRisk[]> {
  const git = (cwd: string, args: string[]) => runGitAsync(cwd, args, GIT_MS)
  const main = trunk(root)
  const [refs, remotes, names] = await Promise.all([
    git(root, ["for-each-ref", "--format=%(refname:short)%09%(upstream:short)%09%(upstream:remotename)", "refs/heads/"]),
    git(root, ["for-each-ref", "--format=%(refname:short)", "refs/remotes/"]),
    git(root, ["remote"]),
  ])
  // A clone with no remote keeps everything on this disk by choice.
  if (!refs.ok || !names.ok || !lines(names.out).length) return []
  const tracking = new Set(lines(remotes.out))
  const branches = lines(refs.out).map((l) => {
    const [branch = "", upstream = "", remote = ""] = l.split("\t")
    // The trunk and a line are compared with their own remote branch: their upstream, else origin's of that name.
    const own = upstream || (tracking.has(`origin/${branch}`) ? `origin/${branch}` : "")
    const kind: AtRisk["kind"] = branch === main ? "trunk" : branch.startsWith(LINE_PREFIX) ? "line" : "branch"
    return { branch, kind, own, remote: remote || (own ? own.split("/")[0]! : "origin") }
  })
  const commitRuns = branches.map(async (b): Promise<AtRisk | null> => {
    const not = b.kind !== "branch" && b.own ? [`refs/remotes/${b.own}`] : ["--remotes"]
    const r = await git(root, ["log", "--format=%ct", `refs/heads/${b.branch}`, "--not", ...not])
    const times = r.ok ? lines(r.out).map(Number) : []
    if (!times.length) return null
    const oldest = Math.min(...times) * 1000
    const push = b.kind === "branch" || !b.own ? `git push -u ${b.remote} ${b.branch}` : `git push ${b.remote} ${b.branch}`
    return {
      kind: b.kind,
      name: b.branch,
      count: times.length,
      ...(b.kind !== "branch" && b.own ? { remote: b.own } : {}),
      ageMs: Math.max(0, now - oldest),
      fix: push,
    }
  })
  const treeRuns = worktrees(root).map(async (w): Promise<AtRisk | null> => {
    const r = await git(w.path, ["status", "--porcelain", "-z", "--untracked-files=normal"])
    if (!r.ok) return null
    // -z: each entry "XY path", a rename followed by its source as an entry of its own, which is skipped.
    const entries = r.out.split("\0").filter(Boolean)
    const paths: string[] = []
    for (let i = 0; i < entries.length; i++) {
      const e = entries[i]!
      paths.push(e.slice(3))
      if (/^[RC]/.test(e)) i++
    }
    if (!paths.length) return null
    let oldest = Infinity
    for (const p of paths.slice(0, STAT_AT_MOST)) {
      try {
        oldest = Math.min(oldest, statSync(join(w.path, p)).mtimeMs)
      } catch {
        // a deleted file has no time
      }
    }
    // From the root when it is beside it or within; a worktree further away by its full path.
    const rel = relative(root, w.path) || "."
    const name = rel.startsWith(`..${sep}..`) ? w.path : rel
    const at = name === "." ? "" : `-C ${name} `
    return {
      kind: "worktree",
      name,
      count: paths.length,
      ...(Number.isFinite(oldest) ? { ageMs: Math.max(0, now - oldest) } : {}),
      fix: `git ${at}add -A && git ${at}commit`,
    }
  })
  return [...(await Promise.all([...commitRuns, ...treeRuns])).filter((x): x is AtRisk => x !== null)]
}

/** A duration in the largest whole unit: minutes, hours or days. */
export function age(ms: number): string {
  const m = Math.floor(ms / 60_000)
  if (m < 60) return m === 1 ? "1 minute" : `${m} minutes`
  const h = Math.floor(m / 60)
  if (h < 48) return h === 1 ? "1 hour" : `${h} hours`
  return `${Math.floor(h / 24)} days`
}

const n = (k: number, one: string, many: string): string => `${k} ${k === 1 ? one : many}`

/** One line for one entry: what is at risk, how much and since when, and the command that makes it safe. */
export function riskLine(r: AtRisk): string {
  const since = r.ageMs === undefined ? "" : `, the oldest ${age(r.ageMs)} old`
  if (r.kind === "worktree") {
    const where = r.name === "." ? "This checkout" : `The worktree ${r.name}`
    const sat = r.ageMs === undefined ? "" : `, for ${age(r.ageMs)}`
    return `Not committed: ${where} has ${n(r.count, "changed file", "changed files")}${sat} — ${r.fix}.`
  }
  const commits = n(r.count, "commit", "commits")
  if (r.remote) return `Not pushed: ${r.kind === "trunk" ? "the trunk" : "the line"} ${r.name} has ${commits} not on ${r.remote}${since} — ${r.fix}.`
  return `On no remote: ${r.kind === "branch" ? "the branch" : r.kind === "trunk" ? "the trunk" : "the line"} ${r.name} has ${commits}${since} — ${r.fix}.`
}

/** What hello says of the work at risk: a line each, nothing when all is safe. Its data is the entries. */
export const atRiskSection: SummarySection = {
  name: "at-risk",
  hello: true,
  async render(ctx: Context) {
    const d = await atRisk(ctx.root)
    return rendered(d, (x) => x.map(riskLine))
  },
}
