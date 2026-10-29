// Stances: plugins of the kind "stance", each a set of authored choices and
// rules a project adopts as a whole (docs/guide/stances.md). Where they are
// found is one small registry: for now the Naima project's GitHub organisation,
// where a stance named <name> is the repository naima-stance-<name>. A real
// registry replaces `stanceRegistry` alone.

import { runGit } from "./git.ts"
import { VISIBILITY_HOST } from "./visibility.ts"

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
