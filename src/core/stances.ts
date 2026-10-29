// Stances: plugins of the kind "stance", each a set of authored choices and
// rules a project adopts as a whole (docs/guide/stances.md). Where they are
// found is one small registry: for now the Naima project's GitHub organisation,
// where a stance named <name> is the repository naima-stance-<name>. A real
// registry replaces `stanceRegistry` alone.

import { NaimaError } from "./errors.ts"
import { runGit } from "./git.ts"
import { CHECKSUM_MISMATCH, clearDownloads, fetchReleaseOf, releaseRepo } from "./releases.ts"
import { VISIBILITY_HOST } from "./visibility.ts"

/** The word of a stance's own adoption: its command named like its plugin entry, given `adopt`. Not the adopt plugin's name. */
export const STANCE_ADOPT = "adopt"

/** The kind a stance's manifest declares. */
export const STANCE_KIND = "stance"

/** The organisation stances are published in, for now. */
export const STANCE_ORG = "naima-project"

/** The prefix of a stance's repository name: naima-stance-<name>. */
export const STANCE_REPO_PREFIX = "naima-stance-"

/** The plugin entry a stance is adopted under in naima.json: stance-<name>. */
export const stancePlugin = (name: string): string => `stance-${name}`

/** The module a stance's repository holds its plugin in. */
export const STANCE_MODULE = "plugin/index.mjs"

/** A stance's name: lowercase letters, digits and dashes, starting with a letter or a digit. */
export const STANCE_NAME = /^[a-z0-9][a-z0-9-]*$/

/** One stance a registry offers: its name and what it says of itself. */
export interface StanceListing {
  name: string
  says: string
}

/** Where stances are found: every one available, and the git repository of each by its name. */
export interface StanceRegistry {
  /** Every stance available; throws, saying why, when the registry cannot be reached. */
  list(): Promise<StanceListing[]>
  /** The git URL of the stance `name`. */
  url(name: string): string
}

/** The stances of the organisation, from GitHub's public API without credentials: one request, ten seconds at most. */
async function listOrganisation(): Promise<StanceListing[]> {
  let r: Response
  try {
    r = await fetch(`https://${VISIBILITY_HOST}/orgs/${STANCE_ORG}/repos?per_page=100&type=public`, {
      headers: { "user-agent": "naima-stances", accept: "application/vnd.github+json" },
      signal: AbortSignal.timeout(10_000),
    })
  } catch (e) {
    throw new Error(`cannot reach GitHub to list the stances of ${STANCE_ORG}: ${e instanceof Error ? e.message : String(e)}`)
  }
  if (r.status !== 200) {
    await r.body?.cancel()
    throw new Error(`cannot list the stances of ${STANCE_ORG}: GitHub answered ${r.status}`)
  }
  const repos = (await r.json()) as { name?: unknown; description?: unknown }[]
  return repos
    .filter((x): x is { name: string; description?: unknown } => typeof x.name === "string" && x.name.startsWith(STANCE_REPO_PREFIX))
    .map((x) => ({ name: x.name.slice(STANCE_REPO_PREFIX.length), says: typeof x.description === "string" ? x.description : "" }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

/** The registry stances are found in: the organisation on GitHub, for now. */
export function stanceRegistry(): StanceRegistry {
  return {
    list: listOrganisation,
    url: (name) => `https://github.com/${STANCE_ORG}/${STANCE_REPO_PREFIX}${name}.git`,
  }
}

/** The commit at the head of `git`'s default branch, or the reason it cannot be had. */
export function stanceHead(cwd: string, git: string): { commit: string } | { reason: string } {
  const r = runGit(cwd, ["ls-remote", "--", git, "HEAD"])
  const commit = r.ok ? r.out.split(/\s/)[0] ?? "" : ""
  if (/^[0-9a-f]{40}$/.test(commit)) return { commit }
  return { reason: r.ok ? `${git} has no HEAD` : `cannot reach ${git}: ${r.err.split("\n")[0] || "git ls-remote failed"}` }
}

/** A stance's release, as adopt pins it: the commit its verified archive was made from, its version and checksum. */
export interface StanceRelease {
  commit: string
  version: string
  sha256: string
}

/**
 * The newest release of the stance at `git`, its archive downloaded into `dir` and verified — its checksum, and the
 * commit it was made from being the one its tag names — then removed: the download is what counts the adoption.
 * Null when the stance publishes no releases, and adopt pins its head commit instead. Throws when the releases
 * cannot be read, or the archive does not match.
 */
export async function stanceRelease(cwd: string, git: string, dir: string): Promise<StanceRelease | null> {
  const repo = releaseRepo(git)
  if (!repo) return null
  try {
    const got = await fetchReleaseOf(git, repo.repo, dir)
    if (!got) return null
    const tag = runGit(cwd, ["ls-remote", "--tags", "--", git, got.release.tag, `${got.release.tag}^{}`])
    const lines = tag.ok ? tag.out.split("\n").map((l) => l.split(/\s+/)) : []
    const tagged = (lines.find((l) => l[1]?.endsWith("^{}")) ?? lines[0])?.[0]
    if (!got.commit || (tagged && tagged !== got.commit)) {
      throw new NaimaError(
        `the archive of ${got.release.tag} of ${git} was made from ${got.commit ?? "no recorded commit"}, and the tag names ${tagged} — refused`,
        CHECKSUM_MISMATCH,
      )
    }
    return { commit: got.commit, version: got.version, sha256: got.sha256 }
  } finally {
    clearDownloads(dir)
  }
}
