// Releases: how Naima, a stance or naima-codegen is installed and updated from
// a published release rather than from a branch (docs/guide/update-naima.md).
//
// A release is a tag v<version> of a repository with two assets: the source
// tree at the tag, `<name>-<version>.tar.gz`, as `git archive` makes it, and its
// SHA-256, `<name>-<version>.tar.gz.sha256`. The release step builds both
// (bin/release-assets.sh). Installing or updating downloads the archive
// from the release, so the host's download count per asset counts installs and
// updates per version, with no telemetry; the archive is checked against its
// checksum, and against the lock's when the lock records one, before anything
// is unpacked.
//
// The releases are read from GitHub's public API, without credentials, or from
// a server that answers like it, named by NAIMA_RELEASES_API (a mirror, a
// test's fake server). Nothing here retries or waits long: a host that does not
// answer is said, and the caller keeps what it has.

import { createHash } from "node:crypto"
import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { gunzipSync } from "node:zlib"
import { NaimaError } from "./errors.ts"
import { gitReason, runGit } from "./git.ts"
import { githubRepo } from "./visibility.ts"

/** The variable that names another server answering like GitHub's releases API. */
export const RELEASES_API_ENV = "NAIMA_RELEASES_API"
/** GitHub's API: where the releases of a repository on GitHub are read. */
export const GITHUB_API = "https://api.github.com"
/** The hosts a release download reaches: the API, and the hosts GitHub redirects an asset's download to. */
export const RELEASE_HOSTS = ["api.github.com", "github.com", "objects.githubusercontent.com", "release-assets.githubusercontent.com"] as const

/** The code of a refusal because an archive does not match its checksum: never installed. */
export const CHECKSUM_MISMATCH = "checksum-mismatch"
/** The code of a failure to reach the releases or download an asset: the caller keeps what it has. */
export const RELEASES_UNREACHABLE = "releases-unreachable"

/** One published release: its version (the tag without its v), whether it is a pre-release, and its assets by name. */
export interface Release {
  version: string
  tag: string
  prerelease: boolean
  assets: Record<string, string>
}

/** A repository whose releases are read: its owner and name, and the API that answers for it. */
export interface ReleaseRepo {
  api: string
  owner: string
  repo: string
}

/** The releases API to ask: NAIMA_RELEASES_API when set, else GitHub's. */
export function releasesApi(env: Record<string, string | undefined> = process.env): string {
  const named = env[RELEASES_API_ENV]?.trim()
  return named ? named.replace(/\/+$/, "") : GITHUB_API
}

/** The host (and port) of an API address: what the launcher lets the program reach. */
export function apiHost(api: string): string | null {
  try {
    return new URL(api).host || null
  } catch {
    return null
  }
}

/**
 * The repository whose releases a source publishes: a GitHub URL's owner and name; with another API named, the
 * last two segments of any source's path, as a mirror or a test's server serves them. Null when nothing answers
 * for the source: a path on this disk, or a host other than GitHub, publishes no releases.
 */
export function releaseRepo(source: string, api = releasesApi()): ReleaseRepo | null {
  const gh = githubRepo(source)
  if (gh) {
    const [owner, repo] = gh.split("/") as [string, string]
    return { api, owner, repo }
  }
  if (api === GITHUB_API) return null
  const parts = source.replace(/^file:\/\//, "").replace(/\\/g, "/").replace(/\.git\/?$/, "").split(/[/:]/).filter(Boolean)
  const repo = parts.at(-1)
  const owner = parts.at(-2)
  return owner && repo ? { api, owner, repo } : null
}

const VERSION = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/

/** Whether `text` names a version, 1.2.3 or v1.2.3, a pre-release suffix allowed: what `--to` tells from a commit. */
export const isVersion = (text: string): boolean => VERSION.test(text)

/** A version without its leading v. */
export const bareVersion = (text: string): string => text.replace(/^v/, "")

/** Whether a version is a pre-release: it carries a suffix, 1.2.0-rc.1. */
export const isPrerelease = (version: string): boolean => (VERSION.exec(version)?.[4] ?? "") !== ""

/** Semantic-version order: negative when `a` comes before `b`; a pre-release before its release. */
export function compareVersions(a: string, b: string): number {
  const x = VERSION.exec(a)
  const y = VERSION.exec(b)
  if (!x || !y) return a.localeCompare(b)
  for (const i of [1, 2, 3]) {
    const d = Number(x[i]) - Number(y[i])
    if (d) return d
  }
  const p = x[4] ?? ""
  const q = y[4] ?? ""
  if (p === q) return 0
  if (!p) return 1
  if (!q) return -1
  const ps = p.split(".")
  const qs = q.split(".")
  for (let i = 0; i < Math.max(ps.length, qs.length); i++) {
    const m = ps[i]
    const n = qs[i]
    if (m === undefined) return -1
    if (n === undefined) return 1
    const numeric = /^\d+$/.test(m) && /^\d+$/.test(n)
    const d = numeric ? Number(m) - Number(n) : m.localeCompare(n)
    if (d) return d
  }
  return 0
}

const unreachable = (what: string, why: string): NaimaError => new NaimaError(`cannot ${what}: ${why}`, RELEASES_UNREACHABLE)
const why = (e: unknown): string => (e instanceof Error ? e.message : String(e))

/**
 * The published releases of `r`, newest first, drafts left out: one request, ten seconds at most. A repository the
 * API does not know (404: missing, or private to an anonymous reader) publishes none. Throws, with the code
 * RELEASES_UNREACHABLE, when the API cannot be read.
 */
export async function listReleases(r: ReleaseRepo, timeoutMs = 10_000): Promise<Release[]> {
  const url = `${r.api}/repos/${r.owner}/${r.repo}/releases?per_page=100`
  let res: Response
  try {
    res = await fetch(url, { headers: { "user-agent": "naima-releases", accept: "application/vnd.github+json" }, signal: AbortSignal.timeout(timeoutMs) })
  } catch (e) {
    throw unreachable(`read the releases of ${r.owner}/${r.repo} from ${r.api}`, why(e))
  }
  if (res.status === 404) {
    await res.body?.cancel()
    return []
  }
  if (res.status !== 200) {
    await res.body?.cancel()
    throw unreachable(`read the releases of ${r.owner}/${r.repo} from ${r.api}`, `it answered ${res.status}`)
  }
  const body = (await res.json()) as unknown
  if (!Array.isArray(body)) throw unreachable(`read the releases of ${r.owner}/${r.repo}`, "the answer is not a list of releases")
  const out: Release[] = []
  for (const x of body as Record<string, unknown>[]) {
    const tag = x["tag_name"]
    if (x["draft"] === true || typeof tag !== "string" || !isVersion(tag)) continue
    const assets: Record<string, string> = {}
    for (const a of Array.isArray(x["assets"]) ? (x["assets"] as Record<string, unknown>[]) : []) {
      if (typeof a["name"] === "string" && typeof a["browser_download_url"] === "string") assets[a["name"]] = a["browser_download_url"]
    }
    out.push({ version: bareVersion(tag), tag, prerelease: x["prerelease"] === true || isPrerelease(bareVersion(tag)), assets })
  }
  return out.sort((a, b) => compareVersions(b.version, a.version))
}

/**
 * The release to install: the one `version` names, or the newest — the newest release proper, or the newest of all
 * when `pre` asks for pre-releases. Null when none matches.
 */
export function pickRelease(releases: readonly Release[], ask: { version?: string | undefined; pre?: boolean | undefined } = {}): Release | null {
  if (ask.version !== undefined) return releases.find((r) => r.version === bareVersion(ask.version as string)) ?? null
  const eligible = releases.filter((r) => ask.pre || !r.prerelease)
  return [...eligible].sort((a, b) => compareVersions(b.version, a.version))[0] ?? null
}

/**
 * The first release of Naima built to be installed from its archive: an older release's tree predates the layout
 * an install unpacks, so neither `naima update` nor the installers (FIRST_ARCHIVE_RELEASE in site/install.sh and
 * site/install.ps1) ever take one as the newest. A version named explicitly is installed as named.
 */
export const FIRST_ARCHIVE_RELEASE = "1.1.0-beta.4"

/** What `naima update` does, given the lock and the source's releases: the decision alone, the downloads apart. */
export type UpdatePlan =
  | { kind: "main" }
  | { kind: "none" }
  | { kind: "missing"; version: string }
  | { kind: "current"; release: Release }
  | { kind: "move"; release: Release; migrating: boolean }

/**
 * Plan an update. No release: the source's main is followed (a fork, a mirror, a repository on this disk). A
 * named version moves there, forward or back. Otherwise the newest release from FIRST_ARCHIVE_RELEASE on: the
 * newest stable one, pre-releases included when asked, when the project already runs one, or while no stable
 * release qualifies; none when no release qualifies. A lock with no version, a commit of main, migrates to
 * releases.
 */
export function planUpdate(
  lock: { version?: string | undefined },
  releases: readonly Release[],
  ask: { version?: string | undefined; pre?: boolean | undefined } = {},
): UpdatePlan {
  if (!releases.length) return { kind: "main" }
  if (ask.version !== undefined) {
    const named = pickRelease(releases, { version: ask.version })
    if (!named) return { kind: "missing", version: bareVersion(ask.version) }
    return lock.version === named.version ? { kind: "current", release: named } : { kind: "move", release: named, migrating: lock.version === undefined }
  }
  const qualifying = releases.filter((r) => compareVersions(r.version, FIRST_ARCHIVE_RELEASE) >= 0)
  const pre = ask.pre === true || (lock.version !== undefined && isPrerelease(lock.version)) || !qualifying.some((r) => !r.prerelease)
  const release = pickRelease(qualifying, { pre })
  if (!release) return { kind: "none" }
  if (lock.version !== undefined && release.version === lock.version) return { kind: "current", release }
  return { kind: "move", release, migrating: lock.version === undefined }
}

/** The archive of `name` at `version`: what the release step builds and installs download. */
export const archiveName = (name: string, version: string): string => `${name}-${version}.tar.gz`
/** Its checksum's asset. */
export const checksumName = (name: string, version: string): string => `${archiveName(name, version)}.sha256`

/** The SHA-256 of a file, in hex. */
export const sha256Of = (path: string): string => createHash("sha256").update(readFileSync(path)).digest("hex")

async function download(url: string, to: string, timeoutMs: number): Promise<void> {
  let res: Response
  try {
    res = await fetch(url, { headers: { "user-agent": "naima-releases", accept: "application/octet-stream" }, signal: AbortSignal.timeout(timeoutMs) })
  } catch (e) {
    throw unreachable(`download ${url}`, why(e))
  }
  if (res.status !== 200) {
    await res.body?.cancel()
    throw unreachable(`download ${url}`, `it answered ${res.status}`)
  }
  writeFileSync(to, new Uint8Array(await res.arrayBuffer()))
}

/** A downloaded, verified archive: where it is, its checksum, and the commit it was made from. */
export interface Fetched {
  archive: string
  sha256: string
  version: string
  prerelease: boolean
  /** The commit `git archive` recorded in the archive; null when it carries none. */
  commit: string | null
}

/**
 * Download `name`'s archive of `release` and its checksum into `dir`, and verify it: the archive's SHA-256 must be
 * the one its .sha256 asset gives, and `expected` (the lock's) when given. A mismatch is refused with the code
 * CHECKSUM_MISMATCH and the archive removed; nothing is unpacked.
 */
export async function fetchRelease(
  release: Release,
  name: string,
  dir: string,
  opts: { expected?: string | undefined; timeoutMs?: number } = {},
): Promise<Fetched> {
  const file = archiveName(name, release.version)
  const sums = checksumName(name, release.version)
  const archiveUrl = release.assets[file]
  const sumUrl = release.assets[sums]
  if (!archiveUrl || !sumUrl) {
    throw new NaimaError(
      `release ${release.tag} has no ${!archiveUrl ? file : sums} among its assets — it cannot be installed from its release`,
      "missing-asset",
    )
  }
  mkdirSync(dir, { recursive: true })
  const archive = join(dir, file)
  const sumFile = join(dir, sums)
  await download(archiveUrl, archive, opts.timeoutMs ?? 120_000)
  await download(sumUrl, sumFile, opts.timeoutMs ?? 30_000)
  const said = readFileSync(sumFile, "utf8").trim().split(/\s+/)[0]?.toLowerCase() ?? ""
  rmSync(sumFile, { force: true })
  const sha256 = sha256Of(archive)
  const refuse = (against: string, theirs: string) => {
    rmSync(archive, { force: true })
    return new NaimaError(
      `${file} of release ${release.tag} has SHA-256 ${sha256}, but ${against} says ${theirs} — refused, nothing installed: the download was altered or the release was replaced`,
      CHECKSUM_MISMATCH,
    )
  }
  if (!/^[0-9a-f]{64}$/.test(said)) throw refuse(sums, JSON.stringify(said))
  if (said !== sha256) throw refuse(sums, said)
  if (opts.expected !== undefined && opts.expected !== sha256) throw refuse("the lock", opts.expected)
  return { archive, sha256, version: release.version, prerelease: release.prerelease, commit: archiveCommit(archive, dir) }
}

/** The commit `git archive` recorded in a .tar.gz, read by git itself; null when it carries none. */
export function archiveCommit(archive: string, cwd: string): string | null {
  let tar: Uint8Array
  try {
    tar = gunzipSync(readFileSync(archive))
  } catch {
    return null
  }
  // It reads the first two blocks alone, the pax header git archive writes: more would be written to a closed pipe.
  const r = runGit(cwd, ["get-tar-commit-id"], { input: tar.subarray(0, 1024) })
  return r.ok && /^[0-9a-f]{40}$/.test(r.out) ? r.out : null
}

/** Unpack a release archive into `dir`, its top folder (`<name>-<version>/`) stripped, with the system's tar. */
export function unpackArchive(archive: string, dir: string): void {
  mkdirSync(dir, { recursive: true })
  const r = spawnSync("tar", ["-xzf", archive, "-C", dir, "--strip-components=1"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })
  if (r.status !== 0) throw new Error(`cannot unpack ${archive}: ${String(r.stderr || r.error?.message || "tar failed").trim()}`)
}

/**
 * Whether the files in `dir` are exactly `commit`'s tree in the git repository `gitDir`: the unpacked archive
 * added to a scratch index started from the commit, and the tree it writes compared with the commit's.
 */
export function sameTree(gitDir: string, commit: string, dir: string): { same: boolean; why?: string } {
  const index = join(gitDir, "naima-release.index")
  rmSync(index, { force: true })
  const env = { GIT_INDEX_FILE: index }
  const g = (...args: string[]) => runGit(dir, ["--git-dir", gitDir, "--work-tree", dir, "-c", "core.autocrlf=false", ...args], { env })
  try {
    for (const step of [["read-tree", commit], ["add", "--all", "--force", "."]]) {
      const r = g(...step)
      if (!r.ok) return { same: false, why: `git ${step[0]}: ${gitReason(r)}` }
    }
    const tree = g("write-tree")
    const theirs = runGit(dir, ["--git-dir", gitDir, "rev-parse", `${commit}^{tree}`])
    if (!tree.ok || !theirs.ok) return { same: false, why: gitReason(tree.ok ? theirs : tree) }
    if (tree.out === theirs.out) return { same: true }
    const diff = g("diff", "--cached", "--name-only", commit)
    return { same: false, why: `they differ in ${diff.out.split("\n").filter((l) => l).slice(0, 5).join(", ") || "their modes"}` }
  } finally {
    rmSync(index, { force: true })
  }
}

/**
 * The shared routine: given a source (its git URL) and a name, fetch and verify a release archive. The version
 * named, else the newest release (pre-releases only when asked). Returns null when the source publishes no
 * releases, so the caller falls back to what it pins without them (a commit). Used by naima update, by stance
 * adopt, and usable by naima-codegen.
 */
export async function fetchReleaseOf(
  source: string,
  name: string,
  dir: string,
  ask: { version?: string; pre?: boolean; expected?: string; api?: string } = {},
): Promise<(Fetched & { release: Release }) | null> {
  const repo = releaseRepo(source, ask.api ?? releasesApi())
  if (!repo) return null
  const releases = await listReleases(repo)
  if (!releases.length) return null
  const release = pickRelease(releases, { version: ask.version, pre: ask.pre })
  if (!release) {
    if (ask.version !== undefined) throw new NaimaError(`${ask.version} is not a release of ${repo.owner}/${repo.repo}`, "no-such-release")
    return null
  }
  return { ...(await fetchRelease(release, name, dir, { expected: ask.expected })), release }
}

/** Remove a folder of downloads, if there. */
export const clearDownloads = (dir: string): void => {
  if (existsSync(dir)) rmSync(dir, { recursive: true, force: true })
}
