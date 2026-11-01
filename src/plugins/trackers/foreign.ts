// A commit of another repository, named in an item's commits as <repository>@<hash>: the fix of an item that lives
// in a stance, a plugin, or another repository the project declares. It counts, for naima close and naima check,
// only when git shows it on that repository's default branch: read through a commit-only partial clone kept in the
// project's git directory, fetched at most once per run, and not at all once the commit is known there. Offline,
// it is said not to be checkable and is not accepted.

import { createHash } from "node:crypto"
import { existsSync, mkdirSync } from "node:fs"
import { join, resolve } from "node:path"
import { type Context, gitReason, runGit } from "../../core/api.ts"

/** A commit named in another repository. */
export interface ForeignCommit {
  repo: string
  commit: string
}

const HASH = /^[0-9a-f]{7,40}$/

/** The `<repository>@<hash>` form of `entry`, or null for a plain hash (or anything else). */
export function parseForeign(entry: string): ForeignCommit | null {
  const at = entry.lastIndexOf("@")
  if (at <= 0) return null
  const repo = entry.slice(0, at).trim()
  const commit = entry.slice(at + 1).trim().toLowerCase()
  return repo && HASH.test(commit) && /[/:]/.test(repo) ? { repo, commit } : null
}

/** A repository's address, compared without its trailing slashes or .git. */
export const sameRepo = (url: string): string => url.trim().replace(/\/+$/, "").replace(/\.git$/, "")

/**
 * The repositories the project declares, whose commits an item may name: the Naima it runs (naima.json's source),
 * every plugin pinned from git (a stance among them), and those listed in the trackers option repositories.
 */
export function declaredRepositories(ctx: Context, listed: readonly string[]): Set<string> {
  const out = new Set<string>([ctx.config.source, ...listed].filter((s) => typeof s === "string" && s).map(sameRepo))
  for (const entry of Object.values(ctx.config.plugins ?? {})) {
    for (const s of [entry?.source, entry?.replacedBy]) {
      if (s && typeof s === "object" && "git" in s && typeof s.git === "string") out.add(sameRepo(s.git))
    }
  }
  return out
}

/** Whether the commit is on the default branch of its repository: yes, no with the reason, or cannot tell with the reason. */
export type ForeignVerdict = { ok: true } | { ok: false; why: string; unknown?: boolean }

/** No credentials asked, no object fetched behind a command's back, and a bounded wait for the network. */
const NETWORK = { env: { GIT_TERMINAL_PROMPT: "0", GIT_NO_LAZY_FETCH: "1" }, timeoutMs: 60_000 }
const HEAD_REF = "refs/naima/default-branch"
/** The repositories fetched in this run, by their cache: a check that reads many items asks the network once each. */
const fetched = new Set<string>()

/** The cache of `repo`: a bare, commit-only clone in the project's git directory, shared by every worktree. */
function cacheOf(ctx: Context, repo: string): string | null {
  const common = runGit(ctx.root, ["rev-parse", "--path-format=absolute", "--git-common-dir"])
  if (!common.ok) return null
  const key = createHash("sha256").update(sameRepo(repo)).digest("hex").slice(0, 16)
  return join(resolve(common.out), "naima", "foreign", key)
}

/** Clone the cache, or fetch its default branch again; the reason when the network or the repository refuses. */
function refresh(ctx: Context, repo: string, cache: string): string | null {
  fetched.add(cache)
  if (!existsSync(join(cache, "HEAD"))) {
    mkdirSync(join(cache, ".."), { recursive: true })
    const r = runGit(ctx.root, ["clone", "--quiet", "--bare", "--filter=tree:0", "--", repo, cache], NETWORK)
    if (!r.ok) return gitReason(r)
    const head = runGit(cache, ["update-ref", HEAD_REF, "HEAD"])
    return head.ok ? null : gitReason(head)
  }
  const r = runGit(cache, ["fetch", "--quiet", "--no-tags", "origin", `+HEAD:${HEAD_REF}`], NETWORK)
  return r.ok ? null : gitReason(r)
}

/** Whether the cache holds `commit`, and its default branch reaches it. */
function reached(cache: string, commit: string): boolean {
  const full = runGit(cache, ["rev-parse", "--verify", "--quiet", `${commit}^{commit}`], NETWORK)
  return full.ok && runGit(cache, ["merge-base", "--is-ancestor", full.out, HEAD_REF], NETWORK).ok
}

/** Whether `f` is a commit on the default branch of a repository the project declares. */
export function verifyForeign(ctx: Context, f: ForeignCommit, declared: Set<string>): ForeignVerdict {
  if (!declared.has(sameRepo(f.repo))) {
    return { ok: false, why: `${f.repo} is not a repository the project declares — pin it as a plugin, or list it in the trackers option repositories` }
  }
  const cache = cacheOf(ctx, f.repo)
  if (!cache) return { ok: false, why: "the project is not a git repository", unknown: true }
  if (existsSync(join(cache, "HEAD")) && reached(cache, f.commit)) return { ok: true }
  if (fetched.has(cache)) return { ok: false, why: `${f.commit} is not on the default branch of ${f.repo}` }
  const failed = refresh(ctx, f.repo, cache)
  if (failed) return { ok: false, why: `cannot be checked: ${f.repo} cannot be read (${failed})`, unknown: true }
  return reached(cache, f.commit) ? { ok: true } : { ok: false, why: `${f.commit} is not on the default branch of ${f.repo}` }
}

/** Forget which repositories this run fetched: for a test that changes one between two checks. */
export function forgetFetched(): void {
  fetched.clear()
}
