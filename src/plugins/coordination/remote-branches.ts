// The pushed copies of worker branches. A branch the trunk holds is finished work, and its copy on the remote only
// piles up there: a landing that has pushed the trunk, and `naima prune`, delete it. Only a copy whose commit the
// trunk holds (the same commit, or an ancestor of it) is ever deleted; one with commits the trunk lacks is kept and
// said. The delete is guarded by the commit read, so a branch pushed to meanwhile is left alone. A failure is
// reported, never fatal. Without a remote nothing happens.

import { type Context, gitOrNull, gitReason, isAncestor, runGit, TRANSFER_LIMIT_MS, transferEnv, trunk } from "../../core/api.ts"
import { LINE_PREFIX, SYNC_PREFIX } from "./lines.ts"
import { sharedRemote } from "./shared.ts"

const net = { timeoutMs: TRANSFER_LIMIT_MS, env: transferEnv() }

/** The remote worker branches are pushed to: the shared remote, else origin; null when the project has neither. */
export function branchRemote(ctx: Context): string | null {
  const shared = sharedRemote(ctx)
  if (shared) return shared
  const remotes = (gitOrNull(ctx.root, "remote") ?? "").split("\n").filter(Boolean)
  return remotes.includes("origin") ? "origin" : null
}

/** The remote's branches and their commits, as it answers now; null when it cannot be asked. */
function remoteHeads(ctx: Context, remote: string): Map<string, string> | null {
  const r = runGit(ctx.root, ["ls-remote", "--heads", remote], net)
  if (!r.ok) return null
  const out = new Map<string, string>()
  for (const l of r.out.split("\n")) {
    const m = /^([0-9a-f]{40,64})\trefs\/heads\/(.+)$/.exec(l.trim())
    if (m) out.set(m[2]!, m[1]!)
  }
  return out
}

/** Whether the trunk (here, or as the remote's last fetch left it) holds `sha`. */
function trunkHolds(ctx: Context, remote: string, sha: string): boolean {
  const main = trunk(ctx.root)
  if (!main) return false
  const known = gitOrNull(ctx.root, "cat-file", "-e", `${sha}^{commit}`) !== null
  if (!known) return false
  return isAncestor(ctx.root, sha, `refs/heads/${main}`) ||
    (gitOrNull(ctx.root, "rev-parse", "--verify", "--quiet", `refs/remotes/${remote}/${main}`) !== null && isAncestor(ctx.root, sha, `refs/remotes/${remote}/${main}`))
}

const isWorkerBranch = (ctx: Context, name: string): boolean =>
  name !== trunk(ctx.root) && name !== "HEAD" && !name.startsWith(LINE_PREFIX) && !name.startsWith(SYNC_PREFIX) && !name.startsWith("archive/")

/** Delete `branch` on `remote` when it is at `sha`; null when done, else why not. */
function deleteAt(ctx: Context, remote: string, branch: string, sha: string): string | null {
  const r = runGit(ctx.root, ["push", "--no-verify", "--quiet", `--force-with-lease=refs/heads/${branch}:${sha}`, remote, `:refs/heads/${branch}`], net)
  return r.ok ? null : gitReason(r)
}

/** One branch's remote copy: removed when the trunk holds it, else kept and said. Returns the line to print, or null when there is no copy. */
function dropOne(ctx: Context, remote: string, branch: string, sha: string, write: boolean): string | null {
  if (!trunkHolds(ctx, remote, sha)) {
    return `kept ${remote}/${branch}: it has commits the trunk lacks (${sha.slice(0, 12)})`
  }
  if (!write) return `would remove ${remote}/${branch} (${sha.slice(0, 12)}, held by the trunk)`
  const why = deleteAt(ctx, remote, branch, sha)
  if (why) return `could not remove ${remote}/${branch} (${why}): git push ${remote} --delete ${branch}`
  runGit(ctx.root, ["update-ref", "-d", `refs/remotes/${remote}/${branch}`])
  return `removed ${remote}/${branch} (${sha.slice(0, 12)}, held by the trunk)`
}

/** After a landing pushed the trunk: the landed branch's copy on `remote` goes when the trunk holds it. Never throws. */
export function dropLandedRemote(ctx: Context, remote: string, branch: string): void {
  try {
    if (!isWorkerBranch(ctx, branch)) return
    const heads = remoteHeads(ctx, remote)
    if (!heads) return void ctx.out(`could not ask ${remote} for ${branch}: its copy there stays`)
    const sha = heads.get(branch)
    if (!sha) return
    const line = dropOne(ctx, remote, branch, sha, true)
    if (line) ctx.out(line)
  } catch (e) {
    ctx.err(`could not remove ${remote}/${branch}: ${e instanceof Error ? e.message : String(e)}`)
  }
}

/** `prune --branch`: the remote copy of the branch just pruned, said as a line each; `write` false only says what would go. */
export function dropBranchRemote(ctx: Context, branch: string, write: boolean): string[] {
  const remote = branchRemote(ctx)
  if (!remote || !isWorkerBranch(ctx, branch)) return []
  const heads = remoteHeads(ctx, remote)
  if (!heads) return [`could not ask ${remote} for ${branch}: its copy there stays`]
  const sha = heads.get(branch)
  if (!sha) return []
  const line = dropOne(ctx, remote, branch, sha, write)
  return line ? [line] : []
}

/** `prune`: every worker branch on the remote that the trunk holds, removed when `write`, else listed. Branches with unmerged commits are not touched. */
export function pruneRemote(ctx: Context, write: boolean): string[] {
  const remote = branchRemote(ctx)
  if (!remote) return []
  const heads = remoteHeads(ctx, remote)
  if (!heads) return [`could not ask ${remote} for its branches: none removed there`]
  const out: string[] = []
  for (const [branch, sha] of heads) {
    if (!isWorkerBranch(ctx, branch) || !trunkHolds(ctx, remote, sha)) continue
    try {
      const line = dropOne(ctx, remote, branch, sha, write)
      if (line) out.push(line)
    } catch (e) {
      out.push(`could not remove ${remote}/${branch}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }
  return out
}
