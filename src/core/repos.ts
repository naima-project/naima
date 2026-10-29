// One repository, or two: where the code is committed and where the tracker is.
//
// A project's tracker data, `naima-tracker/naima-data/`, is committed in the
// project's own repository (one repository), or it is a git clone of a
// separate repository, gitignored there: sibling mode, the way to keep the
// tracker private beside a public code repository. The project root is
// always the code repository; the tracker repository is the data directory
// itself in sibling mode, and the project root otherwise. Every git call
// that reads or writes tracker files goes to `ctx.trackerGit`, with paths
// built by `trackerPath`; every call about the code goes to `ctx.root`.
//
// In sibling mode the two are linked commit by commit, without submodules:
// a code commit names the tracker commit it was made with in a `Tracker:`
// trailer, a tracker commit names the code commit in a `Code:` trailer, and
// branches pair by name. The committed file `naima-tracker/tracker.json`
// says so where a public clone, which has no tracker, can read it.

import { chmodSync, existsSync, readdirSync, readFileSync, realpathSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { posixRelative } from "./config.ts"
import { gitOrNull, mustGit, nativePath, runGit, toplevel, trunk } from "./git.ts"
import { DATA_DIR, DATA_FILE, TRACKER_DIR } from "./layout.ts"
import { writeFileAtomic } from "./files.ts"

/** The file, in the tracker folder and committed with the code, that says the tracker is a repository of its own. */
export const SIBLING_FILE = "tracker.json"
/** The git config key holding the tracker repository's address when the committed file leaves it out. */
export const TRACKER_URL_KEY = "naima.tracker"
/** The trailer a code commit names its tracker commit with. */
export const TRACKER_TRAILER = "Tracker"
/** The trailer a tracker commit names its code commit with. */
export const CODE_TRAILER = "Code"

/** What `naima-tracker/tracker.json` says: the tracker repository's address, when that address may be public. */
export interface SiblingMarker {
  repository?: string
}

const realOf = (path: string): string => {
  try {
    return realpathSync(path)
  } catch {
    return resolve(path)
  }
}

/** The tracker folder's marker, or null when the project keeps its tracker in its own repository. */
export function readSiblingMarker(trackerFolder: string): SiblingMarker | null {
  const file = join(trackerFolder, SIBLING_FILE)
  if (!existsSync(file)) return null
  try {
    const raw = JSON.parse(readFileSync(file, "utf8")) as { repository?: unknown }
    return typeof raw.repository === "string" && raw.repository ? { repository: raw.repository } : {}
  } catch {
    return {}
  }
}

export function writeSiblingMarker(trackerFolder: string, marker: SiblingMarker): string {
  const file = join(trackerFolder, SIBLING_FILE)
  writeFileAtomic(file, JSON.stringify({ ...(marker.repository ? { repository: marker.repository } : {}) }, null, 2) + "\n")
  return file
}

const cache = new Map<string, string>()

/**
 * The git repository that holds the tracker data: the data directory itself
 * when it is the top of a repository of its own inside the project (sibling
 * mode), else the project root. One git process, remembered.
 */
export function trackerGitOf(root: string, data: string): string {
  // No .git in the data directory: it is no repository's top, whatever git says later. Only the answer git gave is remembered.
  if (!existsSync(join(data, ".git")) || realOf(root) === realOf(data)) return root
  const key = `${root}\0${data}`
  const known = cache.get(key)
  if (known !== undefined) return known
  const top = toplevel(data)
  const out = top !== null && realOf(nativePath(top)) === realOf(data) ? data : root
  cache.set(key, out)
  return out
}

/**
 * The project root of a data directory: the code repository. The top of the
 * repository that holds the data, unless the data is a repository of its own
 * inside another (sibling mode): then that other one. Null outside git.
 */
export function projectRootOf(data: string): string | null {
  const top = toplevel(data)
  if (top === null) return null
  if (realOf(nativePath(top)) !== realOf(data)) return nativePath(top)
  const outer = toplevel(dirname(data))
  return outer !== null ? nativePath(outer) : nativePath(top)
}

/** A path in the tracker repository, as git names it from its top: `sub` under the data directory. */
export function trackerPath(prefix: string, sub = ""): string {
  return [prefix, sub].filter((p) => p !== "" && p !== ".").join("/")
}

/** The tracker repository's address: the committed marker's, else the clone's own git config, else null. */
export function trackerUrl(root: string, trackerFolder: string): string | null {
  return readSiblingMarker(trackerFolder)?.repository ?? gitOrNull(root, "config", "--get", TRACKER_URL_KEY)
}

/** Why a project's tracker is missing when the committed marker says it is a repository of its own: the steps that bring it. */
export function missingTracker(root: string, trackerFolder: string): string {
  const url = trackerUrl(root, trackerFolder)
  const where = `${TRACKER_DIR}/${DATA_DIR}`
  return `this project keeps its tracker in a repository of its own (${TRACKER_DIR}/${SIBLING_FILE}), and ${where}/${DATA_FILE} is not here: ` +
    (url ? `clone it: git clone ${url} ${where}` : `clone the tracker repository into ${where} (ask the project for its address)`) +
    ` — without access to it the code still builds and tests, but Naima cannot run`
}

/** The trailer value `key` of a commit message, or null. */
export function trailerOf(text: string, key: string): string | null {
  const m = text.match(new RegExp(`^${key}: *(\\S+) *$`, "m"))
  return m?.[1] ?? null
}

/** The commit-msg hook sibling mode installs in both repositories: it adds the other repository's HEAD as a trailer. */
export const TRAILER_HOOK = "commit-msg"
const HOOK_MARK = "# Written by Naima for a tracker kept in a repository of its own"

/**
 * The commit-msg hook: in the tracker repository (its top holds naima.json)
 * it adds `Code: <the code HEAD>`, in the code repository `Tracker: <the
 * tracker HEAD>`, replacing a trailer of that key already there. `back` is the
 * code root from the data directory, `data` the data directory from the root.
 */
export function trailerHook(back: string, data: string): string {
  return [
    "#!/bin/sh",
    `${HOOK_MARK}: rewritten by Naima, never by hand.`,
    "# Every commit names the commit of the other repository it was made with, in a trailer.",
    'legacy="$(git rev-parse --git-common-dir)/hooks/commit-msg"',
    'if [ -x "$legacy" ]; then "$legacy" "$@" || exit $?; fi',
    'top="$(git rev-parse --show-toplevel)" || exit 0',
    `if [ -f "$top/${DATA_FILE}" ]; then other="$top/${back}"; key=${CODE_TRAILER}; else other="$top/${data}"; key=${TRACKER_TRAILER}; fi`,
    'head="$( (unset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE GIT_PREFIX GIT_COMMON_DIR; git -C "$other" rev-parse --verify -q HEAD) )" || exit 0',
    '[ -n "$head" ] || exit 0',
    'git interpret-trailers --in-place --if-exists replace --trailer "$key: $head" "$1"',
    "",
  ].join("\n")
}

/** The hooks directory in the data directory, which core.hooksPath of both repositories names. */
export const HOOKS_DIR = "hooks"

/**
 * Write the trailer hook into the data directory and point core.hooksPath of
 * both repositories at it — the code's as a path from its root, the
 * tracker's as `hooks`, so every worktree of each finds it. A core.hooksPath
 * already set elsewhere is left alone, and said. Returns what it did, a line each.
 */
export function installTrailerHooks(root: string, data: string): string[] {
  const out: string[] = []
  const back = relativePosix(data, root)
  const fromRoot = relativePosix(root, data)
  const file = join(data, HOOKS_DIR, TRAILER_HOOK)
  writeFileAtomic(file, trailerHook(back, fromRoot))
  runGit(data, ["update-index", "--chmod=+x", "--", `${HOOKS_DIR}/${TRAILER_HOOK}`])
  try {
    chmodSync(file, 0o755)
  } catch {
    // a file system without modes: git's index records it executable anyway
  }
  for (const [repo, path] of [[root, `${fromRoot}/${HOOKS_DIR}`], [data, HOOKS_DIR]] as const) {
    const set = gitOrNull(repo, "config", "--get", "core.hooksPath")
    if (set && set !== path) {
      out.push(`core.hooksPath of ${repo === root ? "the code" : "the tracker"} repository is ${set}, not ${path}: the trailer hook is not run there`)
      continue
    }
    if (!set) mustGit(repo, "config", "core.hooksPath", path)
  }
  out.push(`wrote ${fromRoot}/${HOOKS_DIR}/${TRAILER_HOOK}, which adds ${TRACKER_TRAILER}: and ${CODE_TRAILER}: trailers to every commit of either repository`)
  return out
}

/** The per-clone git config key `naima hooks uninstall` sets to `off`: a launched run then leaves core.hooksPath unset. */
export const HOOKS_OFF_KEY = "naima.hooks"

/** The first comment of every hook Naima writes: what tells its hooks from anyone else's. */
const WRITTEN_BY = /^# Written by (`naima hooks install`|Naima)/m

/** The hooks in the data directory that Naima wrote, by name: what core.hooksPath pointed there runs. */
export function naimaHooks(data: string): string[] {
  const dir = join(data, HOOKS_DIR)
  if (!existsSync(dir)) return []
  const out: string[] = []
  for (const name of readdirSync(dir).sort()) {
    try {
      if (WRITTEN_BY.test(readFileSync(join(dir, name), "utf8").slice(0, 300))) out.push(name)
    } catch {
      // a directory or an unreadable file is no hook of Naima's
    }
  }
  return out
}

/**
 * Point core.hooksPath of the code repository at the data directory's hooks where it is unset: a fresh clone has
 * the hook files, committed, and not the setting, which git keeps per clone. A core.hooksPath set elsewhere is left
 * alone, and said; one a clone turned off with `naima hooks uninstall` is left unset. Returns what it did, a line each.
 */
export function pointHooksPath(root: string, data: string, opts: { quietWhenSet?: boolean } = {}): string[] {
  const path = `${relativePosix(root, data)}/${HOOKS_DIR}`
  const set = gitOrNull(root, "config", "--get", "core.hooksPath")
  if (set === path) return []
  if (set) return opts.quietWhenSet ? [] : [`core.hooksPath of the code repository is ${set}, not ${path}: Naima's git hooks are not run there`]
  if (gitOrNull(root, "config", "--get", HOOKS_OFF_KEY) === "off") return []
  // Every hook of the clone's own directory keeps running: a stub of each name Naima does not write calls it.
  writeDelegates(data)
  const r = runGit(root, ["config", "core.hooksPath", path])
  if (!r.ok) return [`core.hooksPath could not be set to ${path}: ${r.err.split("\n")[0] ?? "git failed"}`]
  const own = naimaHooks(data).filter((n) => !isDelegate(data, n))
  return [
    `core.hooksPath is ${path} now, for this clone and every worktree of it: git runs the project's hooks (${
      own.join(", ") || "none yet"
    }), and every hook of the clone's own still runs — naima hooks uninstall undoes it`,
  ]
}

/** Every hook name git runs: a stub of each that Naima does not write itself keeps the clone's own hook running. */
export const GIT_HOOKS: readonly string[] = [
  "applypatch-msg",
  "pre-applypatch",
  "post-applypatch",
  "pre-commit",
  "pre-merge-commit",
  "prepare-commit-msg",
  "commit-msg",
  "post-commit",
  "pre-rebase",
  "post-checkout",
  "post-merge",
  "pre-push",
  "pre-receive",
  "update",
  "proc-receive",
  "post-receive",
  "post-update",
  "reference-transaction",
  "push-to-checkout",
  "pre-auto-gc",
  "post-rewrite",
  "sendemail-validate",
  "fsmonitor-watchman",
  "p4-changelist",
  "p4-prepare-changelist",
  "p4-post-changelist",
  "p4-pre-submit",
  "post-index-change",
]

export const DELEGATE_MARK = "# Written by Naima to delegate"

/** The stub for hook `name`: the clone's own hook of that name, when it exists and is executable, with the same arguments, input and exit code. */
export const delegateHook = (name: string): string =>
  [
    "#!/bin/sh",
    `${DELEGATE_MARK}: core.hooksPath names this folder, so the clone's own ${name} runs from here.`,
    `own="$(git rev-parse --git-common-dir)/hooks/${name}"`,
    '[ -x "$own" ] || exit 0',
    'exec "$own" "$@"',
    "",
  ].join("\n")

const isDelegate = (data: string, name: string): boolean => {
  try {
    return readFileSync(join(data, HOOKS_DIR, name), "utf8").includes(DELEGATE_MARK)
  } catch {
    return false
  }
}

/**
 * Whether git runs a trunk guard in this clone: core.hooksPath names the data directory's hooks, and the
 * reference-transaction hook there is one Naima wrote, not the stub that only delegates to the clone's own.
 */
export function trunkGuardRuns(root: string, data: string): boolean {
  if (gitOrNull(root, "config", "--get", "core.hooksPath") !== `${relativePosix(root, data)}/${HOOKS_DIR}`) return false
  return naimaHooks(data).includes("reference-transaction") && !isDelegate(data, "reference-transaction")
}

/** Write the stub of every hook name that has no file in the data directory's hooks yet. Returns the names written. */
export function writeDelegates(data: string): string[] {
  const out: string[] = []
  for (const name of GIT_HOOKS) {
    const file = join(data, HOOKS_DIR, name)
    if (existsSync(file)) continue
    writeFileAtomic(file, delegateHook(name))
    try {
      chmodSync(file, 0o755)
    } catch {
      // a file system without modes: git's index records it executable once added
    }
    out.push(name)
  }
  return out
}

/**
 * Write the git hook `name` into the data directory's hooks, executable, and point core.hooksPath at them where it
 * is unset. Returns what it did, a line each: nothing when the file was already this text and the path set.
 */
export function writeGitHook(root: string, data: string, name: string, text: string): string[] {
  const file = join(data, HOOKS_DIR, name)
  const same = existsSync(file) && readFileSync(file, "utf8") === text
  writeDelegates(data)
  if (!same) {
    writeFileAtomic(file, text)
    try {
      chmodSync(file, 0o755)
    } catch {
      // a file system without modes: git's index records it executable once added
    }
  }
  const pointed = pointHooksPath(root, data)
  return same ? pointed : [`wrote ${relativePosix(root, data)}/${HOOKS_DIR}/${name}`, ...pointed]
}

/** Whether the trailer hook file in the data directory is the one Naima writes now. */
export function trailerHookCurrent(root: string, data: string): boolean {
  const file = join(data, HOOKS_DIR, TRAILER_HOOK)
  return existsSync(file) && readFileSync(file, "utf8") === trailerHook(relativePosix(data, root), relativePosix(root, data))
}

function relativePosix(from: string, to: string): string {
  return posixRelative(realOf(from), realOf(to)) || "."
}

/** The tracker branch that pairs with a code branch: the same name, the tracker's trunk for the code's trunk. */
export function pairedBranch(root: string, trackerGit: string, codeBranch: string): string {
  const codeTrunk = trunk(root)
  return codeTrunk !== null && codeBranch === codeTrunk ? (trunk(trackerGit) ?? codeBranch) : codeBranch
}

/**
 * Put the tracker's worktree on the branch that pairs with the code's
 * branch, created from the tracker's trunk when it does not exist yet: what
 * makes work on code branch X write to tracker branch X. Nothing on a
 * detached code HEAD. A tracker worktree with uncommitted changes, or a
 * branch checked out elsewhere, is refused with the step that pairs them.
 * Returns the line that says what moved, or null when they were paired.
 */
export function pairTracker(root: string, trackerGit: string, codeBranch: string): string | null {
  if (codeBranch === "HEAD") return null
  const want = pairedBranch(root, trackerGit, codeBranch)
  const have = gitOrNull(trackerGit, "rev-parse", "--abbrev-ref", "HEAD") ?? "HEAD"
  if (have === want) return null
  const dirty = gitOrNull(trackerGit, "status", "--porcelain") ?? ""
  if (dirty) {
    throw new Error(
      `the tracker is on ${have} while the code is on ${codeBranch}, and it has uncommitted changes: commit them on ${have} (git -C ${TRACKER_DIR}/${DATA_DIR} commit), then run again to pair it with ${want}`,
    )
  }
  const exists = gitOrNull(trackerGit, "rev-parse", "--verify", "--quiet", `refs/heads/${want}`) !== null
  const base = trunk(trackerGit) ?? "HEAD"
  const r = exists ? runGit(trackerGit, ["switch", "-q", want]) : runGit(trackerGit, ["switch", "-q", "-c", want, base])
  if (!r.ok) {
    throw new Error(`the tracker could not move to ${want}, the branch that pairs with the code's ${codeBranch}: ${r.err.split("\n")[0] ?? "git failed"}`)
  }
  return exists ? `the tracker moved to ${want}, the code's branch` : `the tracker took a new branch ${want}, from its ${base}, to pair with the code's`
}

// ── the tracker's own commits ────────────────────────────────────────────────

/** The trailer of every tracker commit Naima makes itself in sibling mode, naming the command: what tells them from commits made by hand. */
export const CLI_TRAILER = "Naima-Command"

/** The files a tracker's working tree has changed, each with its status as git status says it: path → the two status letters. */
export function trackerChanges(trackerGit: string): Map<string, string> {
  const out = new Map<string, string>()
  const r = runGit(trackerGit, ["status", "--porcelain=v1", "-z", "--untracked-files=all", "--no-renames"])
  if (!r.ok) return out
  for (const entry of r.out.split("\0")) if (entry.length > 3) out.set(entry.slice(3), entry.slice(0, 2))
  return out
}

/** The message of a tracker commit made by `naima <command>`: the items (or files) it wrote in the subject, the command in the trailer. */
export function cliCommitMessage(command: string, paths: readonly string[]): string {
  const names = [
    ...new Set(paths.map((p) => {
      const parts = p.split("/")
      return parts.length >= 3 ? `${parts[0]}/${parts[1]}` : p
    })),
  ].sort()
  const shown = names.length > 3 ? `${names.slice(0, 3).join(", ")} and ${names.length - 3} more` : names.join(", ")
  return `naima ${command}: ${shown}\n\n${CLI_TRAILER}: ${command}\n`
}

/** Commit `paths` of a tracker kept as a repository of its own, as `naima <command>` wrote them. Null when done, else why not. */
export function commitTrackerPaths(trackerGit: string, command: string, paths: readonly string[]): string | null {
  if (!paths.length) return null
  const input = paths.join("\0") + "\0"
  const spec = ["--pathspec-from-file=-", "--pathspec-file-nul"]
  const added = runGit(trackerGit, ["--literal-pathspecs", "add", "-A", ...spec], { input })
  if (!added.ok) return `git add: ${added.err.split("\n")[0] ?? "git failed"}`
  const made = runGit(trackerGit, ["--literal-pathspecs", "commit", "-q", "-m", cliCommitMessage(command, paths), ...spec], { input })
  return made.ok ? null : `git commit: ${made.err.split("\n").find((l) => l.trim()) ?? "git failed"}`
}

/**
 * Commit what `naima <command>` wrote to a tracker kept as a repository of its own: every file whose state differs
 * from `before`, the tracker's changes when the command started, in one commit. A file changed before the command
 * and not by it is left as it is, and said. Returns the lines to say.
 */
export function commitTrackerWrites(trackerGit: string, command: string, before: ReadonlyMap<string, string>): string[] {
  const after = trackerChanges(trackerGit)
  const mine = [...after].filter(([p, s]) => before.get(p) !== s).map(([p]) => p)
  const out: string[] = []
  const failed = commitTrackerPaths(trackerGit, command, mine)
  if (failed) out.push(`what naima ${command} wrote to the tracker is not committed (${failed}): git -C ${TRACKER_DIR}/${DATA_DIR} commit it`)
  const left = [...before.keys()].filter((p) => after.has(p) && !mine.includes(p))
  if (left.length) {
    const shown = left.length > 3 ? `${left.slice(0, 3).join(", ")} and ${left.length - 3} more` : left.join(", ")
    out.push(
      `the tracker has changes no naima command made (${shown}), left uncommitted: tracker files are written through naima commands, which commit them, never by hand`,
    )
  }
  return out
}
