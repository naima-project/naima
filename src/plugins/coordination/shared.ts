// One trunk shared by several people's coordinators through one remote, the coordination option `sharedRemote`. Each
// person's coordinator is the single writer on its own machine; the remote is where their landings meet. The protocol
// is the model's (the workshop's develop/models/shared-trunk, verified before this code):
//
//   - a landing fetches the remote, brings the trunk here up to the remote's (a fast-forward, which the trunk guard
//     lets through as a pull), merges the trunk into the branch when the branch lacks it, lands, and pushes at once;
//   - the remote refuses a push that is not a fast-forward, so a landing made on an older trunk never overwrites
//     another person's; a refused push undoes the landing here and makes it again on the remote's new trunk, up to
//     LANDING_ATTEMPTS times, then says that the remote kept moving and that the branch is there to land again;
//   - a merge of the trunk into the branch that conflicts stops the landing, with the files to settle;
//   - a claim is committed and pushed on its branch when it is made, and the remote's claims are read again after the
//     push: of two people who claim one item at the same moment, at least one is told of the other.
//
// A tracker kept in a repository of its own (sibling mode) is not shared this way yet: the option is read only for a
// tracker committed with the code.

import { relative } from "node:path"
import { type Context, gitOrNull, gitReason, isAncestor, runGit, TRANSFER_LIMIT_MS, transferEnv, trunk, worktrees } from "../../core/api.ts"
import { gateOfLine, lineBranch, lineOf, openLines } from "./lines.ts"

/** The coordination option naming the remote several people's coordinators share. */
export const SHARED_REMOTE = "sharedRemote"

/** How many times a landing is made before it gives up on a remote that keeps moving. */
export const LANDING_ATTEMPTS = 3

/** The remote this project's trunk is shared through, or null when it is not shared (or the tracker is a sibling). */
export function sharedRemote(ctx: Context): string | null {
  const v = ctx.config.plugins["coordination"]?.options?.[SHARED_REMOTE]
  if (typeof v !== "string" || !v.trim() || ctx.sibling) return null
  return v.trim()
}

const net = { timeoutMs: TRANSFER_LIMIT_MS, env: transferEnv() }

/** Fetch the remote; null when done, else why not. */
export function fetchShared(ctx: Context, remote: string): string | null {
  const r = runGit(ctx.root, ["fetch", "--quiet", "--prune", remote], net)
  return r.ok ? null : gitReason(r)
}

const tipOf = (ctx: Context, ref: string): string | null => gitOrNull(ctx.root, "rev-parse", "--verify", "--quiet", `${ref}^{commit}`)

/** The branch a landing of `branch` moves: its line's, or the trunk. */
export function landingTarget(ctx: Context, branch: string): string | null {
  const lines = openLines(ctx.root)
  const own = gateOfLine(branch)
  if (own && lines.some((l) => l.gate === own)) return trunk(ctx.root)
  const gate = lineOf(ctx.root, branch, lines)
  return gate ? lineBranch(gate) : trunk(ctx.root)
}

/**
 * Bring `name` here up to the remote's: a fast-forward when it is behind. Null when done or when there is nothing to do
 * (the remote lacks it, or it is ahead here: the push takes it), else why not.
 */
export function bringUp(ctx: Context, remote: string, name: string): string | null {
  const theirs = tipOf(ctx, `refs/remotes/${remote}/${name}`)
  const ours = tipOf(ctx, `refs/heads/${name}`)
  if (!theirs || !ours || ours === theirs || isAncestor(ctx.root, theirs, ours)) return null
  if (!isAncestor(ctx.root, ours, theirs)) {
    return `${name} here and ${remote}/${name} have each taken commits the other lacks: push ${name} or merge ${remote}/${name} into it by hand, then land again`
  }
  const here = gitOrNull(ctx.root, "rev-parse", "--abbrev-ref", "HEAD") === name
  const r = here ? runGit(ctx.root, ["merge", "--ff-only", "-q", `${remote}/${name}`]) : runGit(ctx.root, ["update-ref", `refs/heads/${name}`, theirs, ours])
  return r.ok ? null : `${name} could not be brought up to ${remote}/${name} (${gitReason(r)})`
}

/**
 * Merge `target` into `branch` when the branch lacks it: in the worktree that stands on the branch, else without a
 * checkout (git merge-tree). Null when done or when the branch already holds it, else why not, a conflict undone.
 */
export function mergeInto(ctx: Context, branch: string, target: string): string | null {
  const to = tipOf(ctx, `refs/heads/${target}`)
  const tip = tipOf(ctx, `refs/heads/${branch}`)
  if (!to || !tip || isAncestor(ctx.root, to, tip)) return null
  const conflict = (why: string) =>
    `${target} took other work since ${branch} started, and merging it into ${branch} conflicts (${why}): merge ${target} into ${branch} in its worktree, settle the conflicts, commit, and land again — nothing landed`
  const tree = worktrees(ctx.root).find((w) => w.branch === branch)
  if (tree) {
    const r = runGit(tree.path, ["merge", "--no-edit", "-q", target])
    if (r.ok) return null
    runGit(tree.path, ["merge", "--abort"])
    return conflict(gitReason(r))
  }
  const m = runGit(ctx.root, ["merge-tree", "--write-tree", "--name-only", tip, to])
  if (!m.ok) return conflict(m.out.split("\n").slice(1).filter(Boolean).join(", ") || gitReason(m))
  const made = runGit(ctx.root, ["commit-tree", m.out.split("\n")[0]!.trim(), "-p", tip, "-p", to, "-m", `Merge ${target} into ${branch}`])
  if (!made.ok) return conflict(gitReason(made))
  const moved = runGit(ctx.root, ["update-ref", `refs/heads/${branch}`, made.out.trim(), tip])
  return moved.ok ? null : conflict(gitReason(moved))
}

/** Push `sha` as the remote's `name`, never forced: refused when the remote's is not its ancestor. */
export function pushShared(ctx: Context, remote: string, name: string, sha: string): { ok: boolean; refused: boolean; why: string } {
  const r = runGit(ctx.root, ["push", "--porcelain", "--no-verify", remote, `${sha}:refs/heads/${name}`], net)
  if (r.ok) return { ok: true, refused: false, why: "" }
  const said = `${r.out}\n${r.err}`
  return { ok: false, refused: /\[rejected\]|non-fast-forward|fetch first|stale info/.test(said), why: gitReason(r) }
}

/** Put `name` back from `from` to `to`: the checkout follows when it stands on it. */
function rewind(ctx: Context, name: string, from: string, to: string): void {
  const here = gitOrNull(ctx.root, "rev-parse", "--abbrev-ref", "HEAD") === name
  const r = here ? runGit(ctx.root, ["reset", "-q", "--keep", to]) : runGit(ctx.root, ["update-ref", `refs/heads/${name}`, to, from])
  if (!r.ok) throw new Error(`${name} could not be put back to ${to.slice(0, 12)} (${gitReason(r)}): git reset --keep ${to.slice(0, 12)} on ${name}`)
}

/**
 * Land `branch` on a trunk shared through `remote`, as the model says: fetch, bring the target up, merge it into the
 * branch, land (`land`), push at once; a refused push undoes the landing and makes it again, up to LANDING_ATTEMPTS
 * times. Returns land's exit code, or 1 when the landing stayed here unpushed; throws, with nothing landed, otherwise.
 */
export async function landShared(ctx: Context, remote: string, branch: string, land: () => Promise<number>): Promise<number> {
  const target = landingTarget(ctx, branch)
  if (!target) return await land()
  for (let attempt = 1;; attempt++) {
    const unfetched = fetchShared(ctx, remote)
    if (unfetched) throw new Error(`could not fetch ${remote} (${unfetched}): nothing landed — land again once ${remote} answers`)
    const behind = bringUp(ctx, remote, target)
    if (behind) throw new Error(`${behind}: nothing landed`)
    const merged = mergeInto(ctx, branch, target)
    if (merged) throw new Error(merged)
    ctx.reload()
    const before = tipOf(ctx, `refs/heads/${target}`)
    const code = await land()
    const after = tipOf(ctx, `refs/heads/${target}`)
    if (code !== 0 || !before || !after || after === before) return code
    const pushed = pushShared(ctx, remote, target, after)
    if (pushed.ok) {
      ctx.out(`pushed ${target} to ${remote}: ${after.slice(0, 12)}`)
      return 0
    }
    if (!pushed.refused) {
      ctx.out(
        `landed here, but ${target} could not be pushed to ${remote} (${pushed.why}): nothing is lost — push it with git push ${remote} ${target} once ${remote} answers, before the next landing`,
      )
      return 1
    }
    rewind(ctx, target, after, before)
    ctx.reload()
    if (attempt >= LANDING_ATTEMPTS) {
      throw new Error(
        `${remote}'s ${target} kept moving: each of ${attempt} landings of ${branch} was refused by the push and undone here; ${branch} keeps its work — land it again`,
      )
    }
    ctx.out(`${remote}'s ${target} moved while landing: the landing is undone here and made again on it (attempt ${attempt + 1} of ${LANDING_ATTEMPTS})`)
  }
}

/** The branches of the remote whose claims name the item `id`, read from the remote-tracking refs as the last fetch left them. */
export function remoteClaimants(ctx: Context, remote: string, id: string, claimsDir: string): string[] {
  const prefix = `refs/remotes/${remote}/`
  const main = trunk(ctx.root)
  const refs = (gitOrNull(ctx.root, "for-each-ref", "--format=%(refname)", prefix) ?? "").split("\n")
    .filter((r) => r && !r.endsWith("/HEAD") && r !== `${prefix}${main}`)
  if (!refs.length) return []
  const r = runGit(ctx.root, ["grep", "-l", "-F", id, ...refs, "--", claimsDir])
  if (!r.ok) return []
  return [...new Set(r.out.split("\n").filter(Boolean).map((l) => l.slice(prefix.length, l.indexOf(":"))))]
}

/**
 * Share a claim just written: commit its file alone on its branch and push the branch, then read the remote's claims
 * again and say each other branch that claims one of the items. What could not be shared is said, never thrown: the
 * claim holds here all the same.
 */
export function shareClaim(
  ctx: Context,
  remote: string,
  where: string,
  branch: string,
  file: string,
  items: readonly { id: string; ref: string }[],
  claimsDir: string,
): void {
  const path = relative(where, file).split("\\").join("/")
  const changed = gitOrNull(where, "status", "--porcelain", "--", path)
  if (changed) {
    const c = runGit(where, ["commit", "-q", "--no-verify", "-m", `Claim ${items.map((i) => i.ref).join(", ") || "the step"} on ${branch}`, "--", path])
    if (!c.ok) {
      ctx.out(`the claim is not shared: it could not be committed on ${branch} (${gitReason(c)})`)
      return
    }
  }
  const p = runGit(where, ["push", "-q", "--no-verify", "-u", remote, `HEAD:refs/heads/${branch}`], net)
  if (!p.ok) {
    ctx.out(`the claim is not shared: ${branch} could not be pushed to ${remote} (${gitReason(p)}) — other people's agents see it once it is`)
    return
  }
  ctx.out(`shared the claim: ${branch} pushed to ${remote}`)
  // Read again after the push: of two claims made at the same moment, the later reader sees the other.
  if (fetchShared(ctx, remote)) return
  for (const i of items) {
    const others = remoteClaimants(ctx, remote, i.id, claimsDir).filter((b) => b !== branch)
    if (others.length) ctx.out(`note: ${i.ref} is also claimed on ${remote} by ${others.join(", ")} — allowed, and worth knowing`)
  }
}
