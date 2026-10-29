// Stances: plugins of the kind "stance", each a set of authored choices and
// rules a project adopts as a whole (docs/guide/stances.md). Where they are
// found is one small registry: for now the Naima project's GitHub organisation,
// where a stance named <name> is the repository naima-stance-<name>. A real
// registry replaces `stanceRegistry` alone.

import { existsSync } from "node:fs"
import { join, posix } from "node:path"
import { NaimaError } from "./errors.ts"
import { projectFiles, runGit } from "./git.ts"
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
  /** Why the repository is not a stance, when it was read and its manifest does not declare the kind stance. */
  notStance?: string
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
  const listed = repos
    .filter((x): x is { name: string; description?: unknown } => typeof x.name === "string" && x.name.startsWith(STANCE_REPO_PREFIX))
    .map((x) => ({ name: x.name.slice(STANCE_REPO_PREFIX.length), says: typeof x.description === "string" ? x.description : "" }))
    .sort((a, b) => a.name.localeCompare(b.name))
  return await Promise.all(listed.map(async (l) => {
    const notStance = await notAStance(`${STANCE_REPO_PREFIX}${l.name}`)
    return notStance ? { ...l, notStance } : l
  }))
}

/** A GET of GitHub's public API without credentials, ten seconds at most: null when it cannot be reached. */
async function github(path: string, accept: string): Promise<Response | null> {
  try {
    return await fetch(`https://${VISIBILITY_HOST}${path}`, { headers: { "user-agent": "naima-stances", accept }, signal: AbortSignal.timeout(10_000) })
  } catch {
    return null
  }
}

/** Does the text of a plugin's module declare the kind stance in its manifest: a `kind` key whose value is the string "stance"? */
export function declaresStance(module: string): boolean {
  // A flat token pattern, not a parse: a key and a string literal. Adoption loads the module and checks its manifest itself.
  return /\bkind\s*:\s*(["'`])stance\1/.test(module)
}

/**
 * Why the repository `repo` of the organisation is not a stance, read from its module at its newest release, or at the
 * head of its default branch when it publishes none: it has no module where a stance keeps it, or its manifest does
 * not declare the kind stance. Undefined when it is one, and when it cannot be read: then adopting it says.
 * Two requests, the module alone: nothing is cloned.
 */
async function notAStance(repo: string): Promise<string | undefined> {
  const latest = await github(`/repos/${STANCE_ORG}/${repo}/releases/latest`, "application/vnd.github+json")
  let ref = ""
  let at = "the head of its default branch"
  if (latest?.status === 200) {
    const tag = ((await latest.json()) as { tag_name?: unknown }).tag_name
    if (typeof tag === "string" && tag) [ref, at] = [`?ref=${encodeURIComponent(tag)}`, `its newest release, ${tag}`]
  } else await latest?.body?.cancel()
  const r = await github(`/repos/${STANCE_ORG}/${repo}/contents/${STANCE_MODULE}${ref}`, "application/vnd.github.raw")
  if (!r) return undefined
  if (r.status === 404) {
    await r.body?.cancel()
    return `it has no ${STANCE_MODULE} at ${at}`
  }
  if (r.status !== 200) {
    await r.body?.cancel()
    return undefined
  }
  return declaresStance(await r.text()) ? undefined : `its manifest at ${at} does not declare kind "${STANCE_KIND}"`
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

/** The option a stance declares for the folder of the app its adoption writes into, from the project's root. */
export const STANCE_APP_OPTION = "app"

/**
 * The arguments of `naima stance adopt <name>` after the name, split: the stance's own options (those its manifest
 * declares, given as `--<name> <value>` or `--<name>=<value>`), which go into its plugin entry's options, and the rest,
 * which its adoption is given.
 */
export function stanceOptions(args: readonly string[], declared: ReadonlySet<string>): { options: Record<string, string>; rest: string[] } {
  const options: Record<string, string> = {}
  const rest: string[] = []
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!
    const m = /^--([^=]+)(?:=(.*))?$/.exec(a)
    if (!m || !declared.has(m[1]!)) {
      rest.push(a)
      continue
    }
    const value = m[2] ?? args[++i]
    if (value === undefined || (m[2] === undefined && value.startsWith("--"))) throw new Error(`--${m[1]} needs a value`)
    options[m[1]!] = value
  }
  return { options, rest }
}

/** The files that make a folder an app: its package.json, or a Svelte configuration. */
const APP_FILES: readonly string[] = ["package.json", "svelte.config.js", "svelte.config.mjs", "svelte.config.cjs", "svelte.config.ts"]

/** Is the folder `dir` an app: does it hold a package.json or a Svelte configuration? */
export const isApp = (dir: string): boolean => APP_FILES.some((f) => existsSync(join(dir, f)))

/**
 * The project's apps below its root: each folder, from the root with forward slashes, that holds a package.json or a
 * Svelte configuration, among the files git tracks or would track. Never under node_modules, nor under `skip`, the
 * tracker folder from the root.
 */
export function appsBelow(root: string, skip: string): string[] {
  const apps = new Set<string>()
  for (const f of projectFiles(root)) {
    if (f.startsWith(`${skip}/`) || f.split("/").includes("node_modules")) continue
    const dir = posix.dirname(f)
    if (dir !== "." && APP_FILES.includes(posix.basename(f))) apps.add(dir)
  }
  return [...apps].sort()
}
