// The program: the Naima a project runs, in naima-tracker/naima/, a git clone
// of the product locked to the source and commit naima.json records
// (docs/reference/format.md#the-lock).
//
// Alignment makes the clone's HEAD the locked commit, detached: fetched from a
// repository on this disk that holds it first — the main worktree's program,
// the Naima that runs — then from the clone's origin. It never overwrites
// work: a clone with uncommitted changes, or with commits its source does not
// have, is refused, never reset. It never pulls on its own: only `naima
// update` asks the source where its main is. A program that is a symbolic link
// is never moved: it is someone's own setup, or one clone shared by checkouts
// that lock different commits, which each run would pull to its own lock; every
// run says when it is not at the lock (linkedNote, and worktreeHold for a
// worktree).

import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, readlinkSync, renameSync, rmSync, statSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { posixRelative } from "./config.ts"
import { NaimaError } from "./errors.ts"
import { writeFileAtomic } from "./files.ts"
import { gitReason, mustGit, nativePath, runGit } from "./git.ts"
import { real, RUNTIME_DIR } from "./layout.ts"
import {
  archiveCommit,
  CHECKSUM_MISMATCH,
  clearDownloads,
  fetchRelease,
  listReleases,
  pickRelease,
  releaseRepo,
  RELEASES_UNREACHABLE,
  sameTree,
  unpackArchive,
} from "./releases.ts"

/** Where a project's program is, and what it is locked to. Paths are absolute. */
export interface Target {
  /** The project's git root. */
  root: string
  /** The tracker folder, `naima-tracker/`: what bounds every write (see trackerOf). */
  tracker: string
  program: string
  source: string
  commit: string
  /** Trust a source that differs from the one the program was aligned from: `naima update --accept-source`. */
  acceptSource?: boolean
  /** `verify: "signed"` in naima.json: run a commit only when git verifies its signature. */
  verify?: "signed"
  /** Repositories on this disk that may hold the commit, tried before the source: the running Naima's own clone. */
  seeds?: string[]
  /** The release the commit is, from the lock: fetched from the network, the commit comes with its release's archive, verified. */
  release?: { version: string; sha256: string }
  /** Repair and refuse as usual, clone a missing program, but never check out another commit: a worktree held by worktreeHold. */
  stay?: boolean
}

/** A URL with its credentials removed: a token in a clone's origin must never reach a committed naima.json. */
export function withoutCredentials(source: string): string {
  return source.replace(/^([a-z][a-z0-9+.-]*:\/\/)([^@/]*)@/i, (all, scheme: string, userinfo: string) => {
    if (/^https?:\/\/$/i.test(scheme)) return scheme
    return userinfo.includes(":") ? `${scheme}${userinfo.slice(0, userinfo.indexOf(":"))}@` : all
  })
}

/** The code a refusal to follow a changed source carries, so `update --check` can still read the source. */
export const SOURCE_CHANGED = "source-changed"
/** The code a refusal to check out a commit carries when the commit cannot be had: `naima update` can still move the lock past it. */
export const COMMIT_UNAVAILABLE = "commit-unavailable"
/** The code a refusal to run a commit of the old layout carries: `naima update` moves the lock past it, to the product's head. */
export const OLD_LAYOUT = "old-layout"

/**
 * Refuse to run a commit whose signature git cannot verify, when the lock
 * asks for signed commits. Git runs the verification (gpg, or ssh with
 * gpg.ssh.allowedSignersFile), with the keys the user has configured.
 */
export function verifySigned(repo: string, t: Pick<Target, "source" | "commit" | "verify">): void {
  if (t.verify !== "signed") return
  const r = runGit(repo, ["verify-commit", t.commit])
  if (!r.ok) {
    throw new Error(
      `commit ${short(t.commit)} of ${t.source} carries no signature git can verify (${
        gitReason(r)
      }) — naima.json asks for verify: "signed": make its signer's key known to git, or lock a signed commit`,
    )
  }
}

const has = (repo: string, commit: string): boolean => runGit(repo, ["cat-file", "-e", `${commit}^{commit}`]).ok
/** A clone of its own: a .git directory (a submodule or a worktree has a .git file, and is not a program). */
export const isClone = (dir: string): boolean => {
  try {
    return statSync(join(dir, ".git")).isDirectory()
  } catch {
    return false
  }
}
export const short = (commit: string): string => commit.slice(0, 12)
const where = (t: Target): string => posixRelative(t.root, t.program)

/** Whether `commit` is of the old layout, the runtime in `naima/` rather than at the top. */
export const oldLayout = (repo: string, commit: string): boolean =>
  !runGit(repo, ["cat-file", "-e", `${commit}:src/cli.ts`]).ok && runGit(repo, ["cat-file", "-e", `${commit}:${RUNTIME_DIR}/src/cli.ts`]).ok

// ---- local work ----

/** Why a git checkout holds work that moving it would destroy, or null. */
export function checkoutWork(dir: string): string | null {
  if (runGit(dir, ["status", "--porcelain"]).out) return "uncommitted changes"
  if (runGit(dir, ["rev-list", "-n", "1", "HEAD", "--branches", "--not", "--remotes"]).out) return "commits its source does not have"
  return null
}

/**
 * Record the program's HEAD as the source's when it is, and the clone did not know it: a clone made from a
 * program installed from a release archive, which had no branch, took none of the source's refs, so a
 * commit it was later moved to, held but reached by no ref of origin, read as work of its own and every run
 * was refused. Proved by a repository on this disk that knows the commit as the source's, else by the
 * source's main fetched again; never by the commit alone. Returns the line that says so, or null.
 */
export function recordSourced(t: Target): string | null {
  if (!isClone(t.program) || !readableClone(t.program)) return null
  if (checkoutWork(t.program) !== "commits its source does not have") return null
  // Only a detached HEAD: a branch of commits of its own is work, never examined here.
  if (runGit(t.program, ["rev-list", "-n", "1", "--branches", "--not", "--remotes"]).out) return null
  const head = runGit(t.program, ["rev-parse", "HEAD"]).out
  if (!head) return null
  const proved = seeds(t).find((s) => {
    const r = runGit(t.root, ["-C", s, "rev-list", "-n", "1", head, "--not", "--remotes"])
    return r.ok && !r.out && runGit(t.root, ["-C", s, "cat-file", "-e", `${head}^{commit}`]).ok
  })
  if (proved) runGit(t.program, ["fetch", "--quiet", "--", proved, seedRemotes])
  else runGit(t.program, ["fetch", "--quiet", "origin", "+refs/heads/main:refs/remotes/origin/main"])
  if (checkoutWork(t.program)) return null
  return `${where(t)} is at ${
    short(head)
  }, a commit of its source the clone had not recorded as one (a clone of a program installed from a release archive): recorded`
}

/** Why the program directory holds work that moving it would destroy, or null. */
export const localWork = (t: Target): string | null => (isClone(t.program) ? checkoutWork(t.program) : null)

export function refuseLocalWork(t: Target): void {
  const work = localWork(t)
  if (work) throw new Error(`${where(t)} has ${work} — publish them as a fork and set source in naima.json; Naima never overwrites them`)
}

const sourceChanged = (t: Target, from: string, at: string | null): NaimaError =>
  new NaimaError(
    `the lock's source changed: ${from} → ${t.source}, locked commit moved ${at ? short(at) : "?"} → ${
      short(t.commit)
    } — Naima runs whatever that source holds, so a new one is trusted only on purpose: review the change to naima.json, then naima update --accept-source`,
    SOURCE_CHANGED,
  )

// ---- self-repair ----

/**
 * Whether git reads `dir` as a clone of its own with a HEAD: a clone whose
 * .git lost its HEAD, or worse, is not one — git would read the repository
 * around it instead — and is moved aside, never deleted.
 */
export function readableClone(dir: string): boolean {
  const r = runGit(dir, ["rev-parse", "--show-toplevel", "HEAD"])
  const top = r.ok ? r.out.split("\n")[0] : undefined
  return !!top && real(nativePath(top)) === real(dir)
}

/**
 * Restore the files missing from a clone's checkout, when that is all that
 * differs from its HEAD: a deletion is no one's work, and git holds every
 * file. Returns how many it restored; 0 when the checkout holds any other
 * change, which is work, refused elsewhere and never touched here.
 */
export function restoreDeleted(dir: string): number {
  if (!isClone(dir) || !readableClone(dir)) return 0
  const status = runGit(dir, ["status", "--porcelain", "--untracked-files=all"])
  const lines = status.ok ? status.out.split("\n").filter((l) => l) : []
  if (!lines.length || !lines.every((l) => l.startsWith(" D "))) return 0
  return runGit(dir, ["checkout", "--quiet", "--", "."]).ok ? lines.length : 0
}

/** The line that says files were restored: one line, with their number. */
export const restoredFiles = (n: number, where: string): string => `restored ${n} file${n === 1 ? "" : "s"} missing from ${where}`

/** Move an unreadable clone aside, beside it: its files may be someone's, so it is never deleted. Returns where it went. */
function moveAside(t: Target): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, "0")
  const stamp = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
  const aside = `${t.program}.broken-${stamp}`
  renameSync(t.program, aside)
  return aside
}

// ---- the clone ----

/**
 * Repositories on this disk that may hold the locked commit, so neither a
 * clone nor a fetch needs the network: the program of the main worktree,
 * when this is another worktree of the project, and the Naima that runs.
 */
function seeds(t: Target): string[] {
  const out: string[] = []
  const common = runGit(t.root, ["rev-parse", "--path-format=absolute", "--git-common-dir"])
  if (common.ok) {
    // Asked of git, not of the file system: the main worktree is outside what Naima may read.
    const twin = join(dirname(common.out), posixRelative(t.root, t.program))
    if (resolve(twin) !== resolve(t.program) && runGit(t.root, ["-C", twin, "rev-parse", "--show-toplevel"]).out === twin) out.push(twin)
  }
  out.push(...(t.seeds ?? []).filter((s) => resolve(s) !== resolve(t.program)))
  return out
}

/**
 * A commit fetched by its hash is kept as a remote-tracking ref of origin, so
 * that it counts as the source's, not as local work (localWork): the lock
 * says the source has it, and the fetch has just shown it.
 */
const lockedRefspec = (commit: string): string => `+${commit}:refs/remotes/origin/naima-locked`

/** The source's refs as a seed knows them, copied into a clone of it: a clone names the seed's branches only. */
const seedRemotes = "+refs/remotes/origin/*:refs/remotes/origin/*"

/** Whether `repo` knows `commit` as the source's: held, and reachable from a remote-tracking ref of origin. */
const sourced = (repo: string, commit: string): boolean => has(repo, commit) && !runGit(repo, ["rev-list", "-n", "1", commit, "--not", "--remotes"]).out

/** Fetch `commit` into the program: from a seed on this disk that holds it, else from origin. */
export function fetchCommit(t: Target, commit: string): void {
  // Held is not enough: a commit no ref of origin reaches would read as the clone's own work once checked out.
  if (sourced(t.program, commit)) return
  for (const seed of seeds(t)) {
    if (!runGit(t.root, ["-C", seed, "cat-file", "-e", `${commit}^{commit}`]).ok) continue
    runGit(t.program, ["fetch", "--quiet", "--", seed, lockedRefspec(commit)])
    if (sourced(t.program, commit)) return
  }
  runGit(t.program, ["fetch", "--quiet", "origin"])
  if (!sourced(t.program, commit)) runGit(t.program, ["fetch", "--quiet", "origin", lockedRefspec(commit)])
  if (has(t.program, commit)) return
  const reach = runGit(t.root, ["ls-remote", "--", t.source, "HEAD"])
  if (!reach.ok) {
    throw new NaimaError(
      `cannot fetch from ${t.source}: ${gitReason(reach)} — a commit no repository on this disk holds is fetched from the network`,
      COMMIT_UNAVAILABLE,
    )
  }
  throw new NaimaError(
    `commit ${short(commit)} cannot be fetched from ${t.source} — its history was rewritten or the source is gone; record a commit it has`,
    COMMIT_UNAVAILABLE,
  )
}

/** Clone the program: from a seed on this disk when one holds the commit, its origin then set to the source; else from the source. Says which. */
function cloneProgram(t: Target): string {
  const seed = seeds(t).find((s) => runGit(t.root, ["-C", s, "cat-file", "-e", `${t.commit}^{commit}`]).ok)
  mkdirSync(dirname(t.program), { recursive: true })
  const r = runGit(t.root, ["clone", "--quiet", "--no-checkout", "-c", "core.autocrlf=false", ...(seed ? ["--local"] : []), "--", seed ?? t.source, t.program])
  if (!r.ok) {
    rmSync(t.program, { recursive: true, force: true })
    if (!seed) {
      throw new NaimaError(
        `cannot fetch from ${t.source}: ${gitReason(r)} — a commit no repository on this disk holds is fetched from the network`,
        COMMIT_UNAVAILABLE,
      )
    }
    throw new Error(`cannot clone ${seed} into ${where(t)}: ${gitReason(r)}`)
  }
  if (!seed) return t.source
  // A clone names the seed's branches, not its remote-tracking refs, and the commit may be only there.
  runGit(t.program, ["fetch", "--quiet", "--", seed, seedRemotes, lockedRefspec(t.commit)])
  mustGit(t.program, "remote", "set-url", "origin", t.source)
  return "a copy on this disk"
}

/**
 * Clone the program into a worktree this run has just made. The launcher fixed what the run may
 * read and write when it started, and the new worktree is outside both: every step is a git
 * subprocess, run from `from` (a directory the run may read) and pointed at the new clone with -C.
 */
export function cloneIntoNewWorktree(t: Target, from: string): void {
  const seed = seeds(t).find((s) => runGit(from, ["-C", s, "cat-file", "-e", `${t.commit}^{commit}`]).ok)
  if (!seed) throw new Error(`no clone on this disk holds ${short(t.commit)}: run naima in ${where(t)} to align it`)
  const r = runGit(from, ["clone", "--quiet", "--no-checkout", "-c", "core.autocrlf=false", "--local", "--", seed, t.program])
  if (!r.ok) throw new Error(`cannot clone ${seed} into ${where(t)}: ${gitReason(r)}`)
  const g = (...args: string[]) => runGit(from, ["-C", t.program, ...args])
  // Always, as cloneProgram does: the seed's own main may lag the lock, and the lock's ref is what makes the commit the source's.
  const steps: string[][] = [
    ["fetch", "--quiet", "--", seed, seedRemotes, lockedRefspec(t.commit)],
    ["remote", "set-url", "origin", t.source],
    ["checkout", "--quiet", "--detach", t.commit],
  ]
  if (t.verify === "signed") steps.splice(1, 0, ["verify-commit", t.commit])
  for (const step of steps) {
    const s = g(...step)
    if (!s.ok) throw new Error(`${where(t)}: git ${step[0]} failed: ${gitReason(s)}`)
  }
}

/** What alignment changed: the commit the program was at before, null for a fresh clone; and what it repaired, a line each. */
export interface Moved {
  from: string | null
  repaired: string[]
}

/**
 * Make the program exactly the locked commit of the source, cloning it when
 * it is absent. Returns what moved when the code on disk changed, null when it
 * did not.
 *
 * A lock whose source is not the program's origin — a pulled naima.json
 * pointing somewhere else — is refused until it is accepted on purpose
 * (`acceptSource`): the program runs whatever that source holds. A commit of
 * the old layout is refused: `naima update` moves the lock past it.
 */
export async function align(t: Target): Promise<Moved | null> {
  // A link is someone's own setup, or a clone shared with another checkout that locks another commit: never moved.
  if (linkOf(t)) return null
  // A commit no repository on this disk holds comes from the network: a release's, with its archive, verified.
  const held = (isClone(t.program) && readableClone(t.program) && has(t.program, t.commit)) ||
    seeds(t).some((s) => runGit(t.root, ["-C", s, "cat-file", "-e", `${t.commit}^{commit}`]).ok)
  const release = !held && t.release && !(t.stay && isClone(t.program)) && (!isClone(t.program) || runGit(t.program, ["rev-parse", "HEAD"]).out !== t.commit)
    ? await downloadRelease(t, t.release)
    : null
  try {
    return finishAlign(t, release)
  } finally {
    release?.clear()
  }
}

/**
 * The program, when it is a symbolic link: what it points to, and whether that is the program of another
 * checkout of this same repository (a worktree, or the main one). Such a link shares one clone between
 * checkouts that lock different commits, and every run in either moved it to its own lock: a run in an
 * older worktree put the trunk's program back at the older commit, and nothing said so.
 */
export function linkOf(t: Pick<Target, "root" | "program">): { target: string; shared: boolean } | null {
  let target: string
  try {
    if (!lstatSync(t.program).isSymbolicLink()) return null
    target = resolve(dirname(t.program), readlinkSync(t.program))
  } catch {
    return null
  }
  // Asked of git, a subprocess: the other checkout is outside what Naima may read.
  const common = (dir: string) => runGit(t.root, ["-C", dir, "rev-parse", "--path-format=absolute", "--git-common-dir"])
  const there = common(dirname(target))
  const here = common(t.root)
  const shared = there.ok && here.ok && resolve(nativePath(there.out)) === resolve(nativePath(here.out))
  return { target, shared }
}

/**
 * What to say about a program that is a link Naima does not move, when it is not at the locked commit;
 * null when it is, or when the program is no such link.
 */
export function linkedNote(t: Pick<Target, "root" | "program" | "commit">): string | null {
  const link = linkOf(t)
  if (!link) return null
  const head = runGit(t.root, ["-C", t.program, "rev-parse", "HEAD"]).out
  if (head === t.commit) return null
  return `${posixRelative(t.root, t.program)} is a link to ${posixRelative(t.root, link.target)}, which Naima never moves: it is at ${
    head ? short(head) : "no commit"
  }, and the lock names ${short(t.commit)} — the program running is not the locked one; remove the link and run naima again to get a clone at the lock`
}

function finishAlign(t: Target, release: { check(): void } | null): Moved | null {
  let from: string | null = null
  const repaired: string[] = []
  let restoredFrom: string | null = null
  if (isClone(t.program) && !readableClone(t.program)) {
    repaired.push(`${where(t)} is not a git clone git can read: moved aside to ${posixRelative(t.root, moveAside(t))}`)
  }
  if (!isClone(t.program)) {
    if (existsSync(t.program) && readdirSync(t.program).length) {
      const copy = existsSync(join(t.program, ".naima-copy.json"))
      throw new Error(
        copy
          ? `${where(t)} is a copy of Naima from before the program was a git clone — move it aside and run the installer again, which clones it`
          : `${where(t)} exists and is not a git clone of Naima — move it away`,
      )
    }
    restoredFrom = cloneProgram(t)
  } else {
    const gone = restoreDeleted(t.program)
    if (gone) repaired.push(restoredFiles(gone, where(t)))
    const recorded = recordSourced(t)
    if (recorded) repaired.push(recorded)
    refuseLocalWork(t)
    from = runGit(t.program, ["rev-parse", "HEAD"]).out || null
    const origin = runGit(t.program, ["remote", "get-url", "origin"]).out
    if (withoutCredentials(origin) !== t.source) {
      if (!t.acceptSource) throw sourceChanged(t, withoutCredentials(origin), from)
      mustGit(t.program, "remote", "set-url", "origin", t.source)
    }
    if (from === t.commit) return repaired.length ? { from, repaired } : null
    // Held: what the run repaired is said, and the clone stays where it is.
    if (t.stay) return repaired.length ? { from: null, repaired } : null
  }
  fetchCommit(t, t.commit)
  release?.check()
  if (oldLayout(t.program, t.commit)) {
    throw new NaimaError(
      `commit ${short(t.commit)} is of Naima's old layout, its program in ${RUNTIME_DIR}/: naima update moves the lock to the head of the source's main`,
      OLD_LAYOUT,
    )
  }
  if (!runGit(t.program, ["cat-file", "-e", `${t.commit}:src/cli.ts`]).ok) {
    throw new Error(`commit ${short(t.commit)} of ${t.source} holds no src/cli.ts: lock a commit of Naima's main, or of a fork of it`)
  }
  verifySigned(t.program, t)
  mustGit(t.program, "checkout", "--quiet", "--detach", t.commit)
  if (restoredFrom) repaired.push(`restored ${where(t)} at ${short(t.commit)}, from ${restoredFrom}`)
  return { from, repaired }
}

/** Where a release's archive is downloaded and unpacked, beside the program in the tracker folder: removed after. */
export const releaseDir = (tracker: string): string => join(tracker, ".naima-release")

/**
 * Download the release the lock names, as an install does, and verify it: its checksum the lock's, the commit it
 * was made from the lock's, and once that commit is fetched (`check`), its tree the archive's files exactly. A
 * source that publishes no releases here is fetched by git alone. Network failures carry COMMIT_UNAVAILABLE, as a
 * fetch's do; a checksum that differs is refused.
 */
export async function downloadRelease(t: Target, want: { version: string; sha256: string }): Promise<{ check(): void; clear(): void } | null> {
  const repo = releaseRepo(t.source)
  if (!repo) return null
  const dir = releaseDir(t.tracker)
  clearDownloads(dir)
  try {
    const release = pickRelease(await listReleases(repo), { version: want.version })
    if (!release) throw new NaimaError(`${want.version} is not a release of ${t.source}: naima update moves the lock to one that is`, COMMIT_UNAVAILABLE)
    const got = await fetchRelease(release, repo.repo, dir, { expected: want.sha256 })
    return verifiedArchive(t.program, got.archive, t.commit, dir)
  } catch (e) {
    clearDownloads(dir)
    if (e instanceof NaimaError && e.code === RELEASES_UNREACHABLE) throw new NaimaError(e.message, COMMIT_UNAVAILABLE)
    throw e
  }
}

/** An archive checked to be made from `commit`, unpacked: `check` compares it with the commit's tree once git has it. */
export function verifiedArchive(program: string, archive: string, commit: string, dir: string): { check(): void; clear(): void } {
  const made = archiveCommit(archive, dir)
  if (made !== commit) {
    throw new NaimaError(
      `the release archive was made from ${made ? short(made) : "no recorded commit"}, and the lock names ${short(commit)} — refused, nothing installed`,
      CHECKSUM_MISMATCH,
    )
  }
  const tree = join(dir, "tree")
  unpackArchive(archive, tree)
  return {
    check() {
      const same = sameTree(join(program, ".git"), commit, tree)
      if (!same.same) {
        throw new NaimaError(`the release archive is not the files of ${short(commit)}: ${same.why} — refused, nothing installed`, CHECKSUM_MISMATCH)
      }
    },
    clear: () => clearDownloads(dir),
  }
}

/** What `naima update` follows: the branch it read, and the commit that branch points at. */
export interface Head {
  branch: string
  commit: string
  /** Where the source answered from, when its host redirected it there: the repository moved. */
  movedTo?: string
}

/** The address git says it was redirected to, when the source's host redirects it (a moved repository). */
export function redirectedTo(err: string): string | undefined {
  const m = /redirecting to (\S+)/.exec(err)
  return m ? (m[1] as string).replace(/\/$/, "") : undefined
}

/** What to say when the source has moved: the new address, and how to adopt it. */
export const sourceMoved = (from: string, to: string): string =>
  `the source moved: ${from} now answers from ${to} — set source in naima.json to ${to}, then run naima update --accept-source`

/** The head `naima update --check` compares with: the source's main. Reads the source; changes nothing. */
export function remoteHead(t: Target): Head {
  const r = runGit(t.root, ["ls-remote", "--", t.source, "refs/heads/main"])
  if (!r.ok) throw new Error(`cannot read main from ${t.source}: ${gitReason(r)}`)
  const commit = r.out.split(/\s+/)[0]
  if (!commit) throw new Error(`cannot read main from ${t.source}: it has no main branch`)
  const movedTo = redirectedTo(r.err)
  return { branch: "main", commit, ...(movedTo ? { movedTo } : {}) }
}

/** `git fetch origin main` in the program, with the source's tags, which name versions: the head `naima update` moves the lock to. */
export function fetchHead(t: Target): Head {
  const r = runGit(t.program, ["fetch", "--quiet", "--tags", "origin", "+refs/heads/main:refs/remotes/origin/main"])
  if (!r.ok) throw new Error(`cannot fetch main from ${t.source}: ${gitReason(r)}`)
  const movedTo = redirectedTo(r.err)
  return { branch: "main", commit: mustGit(t.program, "rev-parse", "refs/remotes/origin/main"), ...(movedTo ? { movedTo } : {}) }
}

const IGNORE = ".gitignore"

/**
 * Write the tracker folder's `.gitignore` line for the program, when the
 * program is inside the tracker folder. Returns the file's path, or null when
 * the program lives elsewhere and its ignoring is the project's affair.
 */
export function ignoreProgram(t: Pick<Target, "tracker" | "program">): string | null {
  const rel = posixRelative(t.tracker, t.program)
  if (!rel || rel.startsWith("..")) return null
  const line = `/${rel}/`
  const path = join(t.tracker, IGNORE)
  const lines = existsSync(path) ? readFileSync(path, "utf8").split("\n").filter((l) => l !== "") : []
  if (!lines.includes(line)) writeFileAtomic(path, [...lines, line].join("\n") + "\n")
  return path
}
