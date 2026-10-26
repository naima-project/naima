// State that belongs to no branch, read from all of them.
//
// Some records (who is on what, where a session left off) are written as one
// file per session on that session's own branch, so no two sessions ever
// write the same path. The collection is never stored: it is recombined at
// read time from every ref worth reading. Nothing in this module writes.

import { spawn, spawnSync } from "node:child_process"
import { existsSync, readdirSync, readFileSync, realpathSync } from "node:fs"
import { join, relative, resolve, sep } from "node:path"
import { isRegularFile, walkFiles } from "./files.ts"

let calls = 0
/** How many git processes this module has started: what the cost of a cross-branch read is measured in. */
export const gitCalls = (): number => calls

/** One git run: whether it succeeded, what it printed, and whether git could be started at all. */
export interface GitRun {
  ok: boolean
  /** Standard output, its final newline removed. */
  out: string
  err: string
  /** Git itself could not be started: not installed, or not on PATH. */
  notInstalled: boolean
}

export interface GitOptions {
  /** Written to git's standard input. */
  input?: string
  /** Added to the environment git runs with. */
  env?: Record<string, string>
}

/** The variables a git hook runs with that bind git to one repository. */
const REPO_ENV = ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_COMMON_DIR", "GIT_PREFIX", "GIT_OBJECT_DIRECTORY"]
const ownGitDirs = new Map<string, boolean>()

const realOrSelf = (path: string): string => {
  try {
    return realpathSync(path)
  } catch {
    return path
  }
}

/**
 * The environment git runs with in `cwd`. Run from a hook, Naima inherits
 * GIT_DIR or GIT_INDEX_FILE of the repository being committed; a call into the
 * other repository of a project whose tracker is a repository of its own must
 * not use them, so they are dropped there — kept only where they belong, the
 * repository whose git directory holds them. Undefined (the process's own)
 * outside a hook.
 */
function envFor(cwd: string, extra?: Record<string, string>): NodeJS.ProcessEnv | undefined {
  const env = process.env
  if (!env["GIT_INDEX_FILE"] && !env["GIT_DIR"]) return extra ? { ...env, ...extra } : undefined
  const clean: NodeJS.ProcessEnv = { ...env }
  for (const k of REPO_ENV) delete clean[k]
  let own = ownGitDirs.get(cwd)
  if (own === undefined) {
    const r = spawnSync("git", ["rev-parse", "--absolute-git-dir"], { cwd, env: clean, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] })
    const dir = r.status === 0 ? realOrSelf(String(r.stdout).trim()) : null
    const inside = (v: string | undefined) => !v || (dir !== null && (realOrSelf(resolve(v)) === dir || realOrSelf(resolve(v)).startsWith(dir + sep)))
    own = dir !== null && inside(env["GIT_INDEX_FILE"]) && inside(env["GIT_DIR"])
    ownGitDirs.set(cwd, own)
  }
  const base = own ? env : clean
  return extra ? { ...base, ...extra } : own ? undefined : base
}

function spawnGit(cwd: string, args: string[], opts: GitOptions, encoding: "utf8" | "buffer") {
  calls++
  const env = envFor(cwd, opts.env)
  return spawnSync("git", args, {
    cwd,
    ...(encoding === "utf8" ? { encoding } : {}), // no encoding: bytes (Node refuses an explicit "buffer")
    ...(opts.input !== undefined ? { input: opts.input } : {}),
    ...(env ? { env } : {}),
    stdio: [opts.input !== undefined ? "pipe" : "ignore", "pipe", "pipe"],
    maxBuffer: 1 << 28,
  })
}

/** The one way the program runs git. Never throws: the result says what happened. */
export function runGit(cwd: string, args: string[], opts: GitOptions = {}): GitRun {
  const r = spawnGit(cwd, args, opts, "utf8")
  const notInstalled = (r.error as { code?: string } | undefined)?.code === "ENOENT"
  return { ok: r.status === 0, out: String(r.stdout ?? "").replace(/\r?\n$/, ""), err: String(r.stderr ?? "").trim(), notInstalled }
}

/**
 * A git run that does not block the process, ended after `timeoutMs`: what a network call that must stay short
 * uses (the tick's update check). It never prompts for credentials, and never throws: a timeout is a failed run that says so.
 */
export function runGitAsync(cwd: string, args: string[], timeoutMs: number): Promise<GitRun> {
  calls++
  const env = { ...(envFor(cwd) ?? process.env), GIT_TERMINAL_PROMPT: "0" }
  return new Promise((done) => {
    let out = ""
    let err = ""
    let settled = false
    // Called only from the child's events and the timer, both after the timer exists.
    const finish = (r: GitRun): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      done(r)
    }
    const child = spawn("git", args, { cwd, env, stdio: ["ignore", "pipe", "pipe"] })
    const timer = setTimeout(() => {
      child.kill("SIGKILL")
      finish({ ok: false, out: "", err: `no answer within ${Math.round(timeoutMs / 1000)} s`, notInstalled: false })
    }, timeoutMs)
    child.stdout?.on("data", (b) => (out += String(b)))
    child.stderr?.on("data", (b) => (err += String(b)))
    child.once("error", (e) => finish({ ok: false, out: "", err: String(e), notInstalled: (e as { code?: string }).code === "ENOENT" }))
    child.once("close", (code) => finish({ ok: code === 0, out: out.replace(/\r?\n$/, ""), err: err.trim(), notInstalled: false }))
  })
}

/** Why a run failed, in one line: git's own first line, or that git is not there. */
export function gitReason(r: GitRun): string {
  if (r.notInstalled) return "git is not installed, or not on PATH"
  return r.err.split("\n").find((l) => l.trim())?.replace(/^(fatal|error): /, "") ?? "git failed"
}

/** Git's trimmed output, or null when it fails: for questions whose failure is an answer ("is this a repository?"). */
export function gitOrNull(cwd: string, ...args: string[]): string | null {
  const r = runGit(cwd, args)
  return r.ok ? r.out.trim() : null
}

/** Git's trimmed output; an error naming the subcommand and git's reason when it fails. */
export function mustGit(cwd: string, ...args: string[]): string {
  const r = runGit(cwd, args)
  if (!r.ok) throw new Error(`git ${args[0]}: ${gitReason(r)}`)
  return r.out.trim()
}

/** A path as git reads and writes it: forward slashes, whatever the platform's separator. */
export const gitPath = (path: string, separator: string = sep): string => path.split(separator).join("/")

/**
 * The inverse of `gitPath`: an absolute path git printed (`rev-parse --show-toplevel`, always
 * forward slashes, even on Windows) turned into the given platform's own separator, so it can be
 * compared against one built by `node:path` or `node:fs` (which use the native separator there).
 */
export const nativePath = (path: string, separator: string = sep): string => path.split("/").join(separator)

export function isGitRepo(root: string): boolean {
  return gitOrNull(root, "rev-parse", "--is-inside-work-tree") === "true"
}

/** Whether `commit` names an object git has, and that object is a commit. */
export function commitExists(root: string, commit: string): boolean {
  return runGit(root, ["cat-file", "-e", `${commit}^{commit}`]).ok
}

/** Whether `commit` is `ref` or one of its ancestors. False when either does not exist. */
export function isAncestor(root: string, commit: string, ref: string): boolean {
  return runGit(root, ["merge-base", "--is-ancestor", commit, ref]).ok
}

/** The root of the git working tree holding `dir`, or null outside git. */
export function toplevel(dir: string): string | null {
  return gitOrNull(dir, "rev-parse", "--show-toplevel")
}

/**
 * The project's own files, relative to the root and with forward slashes on
 * every platform: every regular file git tracks
 * or would track (not ignored) — never a submodule's directory, never a
 * symbolic link — or, outside git, every regular file under the root but
 * hidden directories, node_modules, dist and build. Never a file under
 * `program`: the Naima a project runs is not the project's, even when it is
 * committed. What a plugin scans by default, so that nothing has to be listed
 * for it to be covered.
 */
export function projectFiles(root: string, program?: string): string[] {
  const skip = program ? gitPath(relative(root, program)) + "/" : null
  const mine = (f: string): boolean => !skip || !f.startsWith(skip)
  const listed = isGitRepo(root) ? gitOrNull(root, "ls-files", "-z", "--cached", "--others", "--exclude-standard") : null
  if (listed !== null) return [...new Set(listed.split("\0").filter((f) => f && mine(f) && isRegularFile(join(root, f))))].sort()
  return walkFiles(root, { skipHidden: true })
    .map((path) => gitPath(relative(root, path)))
    .filter(mine)
}

export function currentBranch(root: string): string {
  return gitOrNull(root, "rev-parse", "--abbrev-ref", "HEAD") ?? "HEAD"
}

/**
 * Where a tracker step that changes more than it adds (an update of Naima, a waiver, a release record, an epic set
 * done) is committed: on an item's own branch, landed as a marker. Only init's commit, and the close after a
 * landing, go straight on the trunk.
 */
export const LAND_IT = "on the branch of an item of its own, in its worktree, and land it with naima land"

/**
 * The trunk: the local branch origin's HEAD names, else `main`, else
 * `master`; null when there is none of them. One git process.
 */
export function trunk(root: string): string | null {
  const refs = new Map<string, string>()
  for (
    const line of (gitOrNull(root, "for-each-ref", "--format=%(refname) %(symref)", "refs/remotes/origin/HEAD", "refs/heads/main", "refs/heads/master") ?? "")
      .split("\n")
  ) {
    const [name, target = ""] = line.trim().split(" ")
    if (name) refs.set(name, target)
  }
  const origin = refs.get("refs/remotes/origin/HEAD")?.replace(/^refs\/remotes\/origin\//, "")
  if (origin && gitOrNull(root, "rev-parse", "--verify", "--quiet", `refs/heads/${origin}`) !== null) return origin
  return refs.has("refs/heads/main") ? "main" : refs.has("refs/heads/master") ? "master" : null
}

/** Every local and remote branch name, with remote prefixes also stripped. Answers "does this branch still exist". */
export function allRefNames(root: string): Set<string> {
  const out = new Set<string>()
  for (const line of (gitOrNull(root, "for-each-ref", "--format=%(refname:short)", "refs/heads", "refs/remotes") ?? "").split("\n")) {
    const name = line.trim()
    if (!name || name.endsWith("/HEAD")) continue
    out.add(name)
    if (name.includes("/")) out.add(name.replace(/^[^/]+\//, ""))
  }
  return out
}

const realOr = (path: string): string => {
  try {
    return realpathSync(path)
  } catch {
    return path
  }
}

/** A worktree of the repository, as `git worktree list --porcelain` names it. */
export interface Worktree {
  path: string
  /** The branch it stands on; null on a detached HEAD. */
  branch: string | null
  /** The commit it stands on. */
  head: string | null
  /** The worktree `root` is in. */
  self: boolean
}

/** Every worktree with a working copy: never a bare entry, never one git reports prunable (its directory is gone). */
export function worktrees(root: string): Worktree[] {
  const self = realOr(root)
  const out: Worktree[] = []
  for (const block of (gitOrNull(root, "worktree", "list", "--porcelain") ?? "").split(/\n\n+/)) {
    const path = block.match(/^worktree (.+)$/m)?.[1]
    if (!path || /^(bare|prunable)\b/m.test(block)) continue
    out.push({
      path,
      branch: block.match(/^branch refs\/heads\/(.+)$/m)?.[1] ?? null,
      head: block.match(/^HEAD ([0-9a-f]+)$/m)?.[1] ?? null,
      self: realOr(path) === self,
    })
  }
  return out
}

/**
 * The refs worth reading: every local branch not merged into the trunk,
 * whatever each other worktree stands on, and the trunk itself — last, so that
 * a record's own branch is read before the older copy the trunk may carry. A
 * merged branch adds nothing the trunk does not already carry. Without a
 * trunk, every local branch. Never the detached HEAD of this worktree: its
 * disk is read instead. Local branches only: a remote-tracking ref is not read.
 */
export function refsWorthReading(root: string, trees: Worktree[] = worktrees(root)): string[] {
  const main = trunk(root)
  const refs = new Set<string>()
  const branches = main ? ["--no-merged", main, "refs/heads"] : ["refs/heads"]
  for (const line of (gitOrNull(root, "for-each-ref", "--format=%(refname:short)", ...branches) ?? "").split("\n")) {
    if (line.trim()) refs.add(line.trim())
  }
  for (const w of trees) {
    if (w.branch) refs.add(w.branch)
    else if (w.head && !w.self) refs.add(w.head)
  }
  if (main) {
    refs.delete(main)
    refs.add(main)
  }
  return [...refs]
}

export interface BranchFile {
  ref: string
  name: string
  text: string
  /** Read from this worktree's disk (committed or not) rather than from a ref. */
  local: boolean
}

/**
 * Git objects by name (`<ref>:<path>`, or a sha), all through one
 * `git cat-file --batch`: each is its type and bytes, or null when git has no
 * such object. One process for any number of objects.
 */
function objects(root: string, names: string[]): ({ type: string; data: Buffer } | null)[] {
  if (!names.length) return []
  const r = spawnGit(root, ["cat-file", "--batch"], { input: names.join("\n") + "\n" }, "buffer")
  if (r.status !== 0 || !Buffer.isBuffer(r.stdout)) return names.map(() => null)
  const out = r.stdout
  const found: ({ type: string; data: Buffer } | null)[] = []
  let at = 0
  for (let i = 0; i < names.length; i++) {
    const eol = out.indexOf(10, at)
    if (eol === -1) break
    const header = out.subarray(at, eol).toString("utf8").split(" ") // "<sha> <type> <size>", or "<name> missing"
    at = eol + 1
    const size = Number(header[2])
    if (header.length !== 3 || !Number.isInteger(size)) {
      found.push(null)
      continue
    }
    found.push({ type: header[1] ?? "", data: out.subarray(at, at + size) })
    at += size + 1 // the content, then a newline
  }
  return found
}

/** The entries of a tree object: `<mode> <name>\0<20-byte sha>`, repeated. */
function treeEntries(tree: Buffer): { mode: string; name: string; sha: string }[] {
  const out: { mode: string; name: string; sha: string }[] = []
  let at = 0
  while (at < tree.length) {
    const space = tree.indexOf(32, at)
    const nul = tree.indexOf(0, space)
    if (space === -1 || nul === -1) break
    out.push({
      mode: tree.subarray(at, space).toString("utf8"),
      name: tree.subarray(space + 1, nul).toString("utf8"),
      sha: tree.subarray(nul + 1, nul + 21).toString("hex"),
    })
    at = nul + 21
  }
  return out
}

type Entry = { mode: string; name: string; sha: string }

/** The regular files named `*ext` in each tree object: `<ref>:<dir>`, one batch for all of them. */
function treeFiles(root: string, names: string[], ext: string): Entry[][] {
  return objects(root, names).map((t) => (t?.type === "tree" ? treeEntries(t.data).filter((e) => e.mode.startsWith("100") && e.name.endsWith(ext)) : []))
}

/** The contents of the listed files of each ref, one batch for all of them. */
function readEntries(root: string, refs: string[], listed: Entry[][]): BranchFile[][] {
  const blobs = objects(root, listed.flat().map((e) => e.sha))
  let next = 0
  return refs.map((ref, i) =>
    (listed[i] ?? []).flatMap((e) => {
      const blob = blobs[next++]
      return blob?.type === "blob" ? [{ ref, name: e.name, text: blob.data.toString("utf8"), local: false }] : []
    })
  )
}

/** Every `ext` file directly under `dir` on each ref, as committed there. */
function filesOnRefs(root: string, refs: string[], dir: string, ext: string): BranchFile[][] {
  return readEntries(root, refs, treeFiles(root, refs.map((ref) => `${ref}:${dir}`), ext))
}

/** Every `ext` file directly under `dir` of a working copy, as it is on disk now; `local` when it is this worktree's. */
export function filesHere(root: string, dir: string, ext: string, ref: string, local = true): BranchFile[] {
  const abs = join(root, dir)
  if (!existsSync(abs)) return []
  return readdirSync(abs)
    .filter((n) => n.endsWith(ext))
    .sort()
    .map((name) => ({ ref, name, text: readFileSync(join(abs, name), "utf8"), local }))
}

/** Another worktree's files, or null when its disk cannot be read from here (a permission the run was not given). */
function filesThere(path: string, dir: string, ext: string, ref: string): BranchFile[] | null {
  try {
    return filesHere(path, dir, ext, ref, false)
  } catch {
    return null
  }
}

/** Every `ext` file directly under `dir` on one ref (`HEAD` included), as committed there. */
export function filesAt(root: string, ref: string, dir: string, ext: string): BranchFile[] {
  return isGitRepo(root) ? (filesOnRefs(root, [ref], gitPath(dir), ext)[0] ?? []) : []
}

/**
 * The names of the directories directly under `dir` (relative to `root`) on
 * every other local branch worth reading — from the disk of the worktree that
 * stands on it, else from its ref — so that a name taken on a branch not yet
 * merged is known before it is taken again here. Empty outside git: there is
 * no other branch. Null when the branches cannot all be read — git fails, or
 * the clone is shallow — so the caller can fall back to a name nobody else
 * can pick.
 */
export function dirsAcrossBranches(root: string, dir: string): Set<string> | null {
  const probe = runGit(root, ["rev-parse", "--is-inside-work-tree", "--is-shallow-repository"])
  if (!probe.ok) return existsSync(join(root, ".git")) ? null : new Set()
  if (probe.out.split("\n")[1]?.trim() === "true") return null
  const here = currentBranch(root)
  const trees = worktrees(root)
  const refs = refsWorthReading(root, trees).filter((ref) => ref !== here)
  const out = new Set<string>()
  const fromRef: string[] = []
  for (const ref of refs) {
    const w = trees.find((t) => !t.self && (t.branch ?? t.head) === ref)
    let names: string[] | null = null
    if (w) {
      try {
        names = existsSync(join(w.path, dir)) ? readdirSync(join(w.path, dir), { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name) : []
      } catch {
        names = null // a disk this run may not read: its ref instead
      }
    }
    if (names) names.forEach((n) => out.add(n))
    else fromRef.push(ref)
  }
  const inGit = gitPath(dir)
  for (const t of objects(root, fromRef.map((ref) => `${ref}:${inGit}`))) {
    if (t?.type === "tree") { for (const e of treeEntries(t.data)) if (e.mode === "40000") out.add(e.name) }
  }
  return out
}

export interface AcrossOptions {
  /**
   * The branch a record says it belongs to. A copy on this worktree's disk of
   * another branch's record — the trunk carrying a claim merged from it — is
   * older than that branch's own: the branch's version wins.
   */
  owner?: (file: BranchFile) => string | undefined
}

/**
 * Every file under `dir` (relative to `root`) on every local branch worth
 * reading, one entry per file name. A branch checked out in a worktree is
 * read from that worktree's disk, not from its ref: the working copy is the
 * newer truth, so a record written and not yet committed is seen from every
 * other worktree, and one deleted and not yet committed is not — on any ref.
 * A branch no worktree stands on is read from its ref, and so is one whose
 * worktree this run may not read. A record another branch owns is read from
 * that branch, and is gone when that branch's worktree has deleted it.
 */
export function readAcrossBranches(root: string, dir: string, ext: string, opts: AcrossOptions = {}): BranchFile[] {
  const seen = new Map<string, BranchFile>()
  const byRef = new Map<string, Map<string, BranchFile>>()
  const inGit = gitPath(dir) // a ref's tree is read with forward slashes: a Windows path would name nothing
  const here = currentBranch(root)
  const local = filesHere(root, dir, ext, here)
  /** Names each other worktree deleted from its branch and has not committed. */
  const deletedOn = new Map<string, Set<string>>()
  if (isGitRepo(root)) {
    const trees = worktrees(root)
    const refs = refsWorthReading(root, trees).filter((ref) => ref !== here)
    // What each ref's worktree holds on disk, when one stands on it and can be read.
    const disks = new Map<string, BranchFile[]>()
    for (const w of trees) {
      const ref = w.branch ?? w.head
      if (w.self || !ref || !refs.includes(ref)) continue
      const files = filesThere(w.path, dir, ext, ref)
      if (files) disks.set(ref, files)
    }
    // One batch lists this worktree's HEAD and every ref; one more reads the refs no disk answered for.
    const [head = [], ...listed] = treeFiles(root, [`HEAD:${inGit}`, ...refs.map((ref) => `${ref}:${inGit}`)], ext)
    const committed = readEntries(root, refs, listed.map((entries, i) => (disks.has(refs[i] ?? "") ? [] : entries)))
    // A name a working copy deleted and has not committed is gone everywhere: its owner removed it.
    const deleted = new Set<string>()
    const onDisk = (files: BranchFile[]) => new Set(files.map((f) => f.name))
    const drop = (entries: Entry[], disk: Set<string>, ref?: string) =>
      entries.forEach((e) => {
        if (disk.has(e.name)) return
        deleted.add(e.name)
        if (ref !== undefined) deletedOn.set(ref, (deletedOn.get(ref) ?? new Set()).add(e.name))
      })
    drop(head, onDisk(local))
    refs.forEach((ref, i) => {
      const disk = disks.get(ref)
      if (disk) drop(listed[i] ?? [], onDisk(disk), ref)
    })
    refs.forEach((ref, i) => {
      for (const f of disks.get(ref) ?? committed[i] ?? []) {
        if (deleted.has(f.name)) continue
        if (!seen.has(f.name)) seen.set(f.name, f)
        const mine = byRef.get(f.ref) ?? new Map<string, BranchFile>()
        byRef.set(f.ref, mine.set(f.name, f))
      }
    })
  }
  for (const f of local) {
    const owner = opts.owner?.(f)
    if (owner === undefined || owner === here) {
      seen.set(f.name, f)
      continue
    }
    // A copy of another branch's record: the owner's version wins, and so does the owner deleting it.
    if (deletedOn.get(owner)?.has(f.name)) continue
    seen.set(f.name, byRef.get(owner)?.get(f.name) ?? f)
  }
  return [...seen.values()]
}

/** One path the index changes against HEAD: git's status letter (`A`, `M`, `D`, `T`), and the path from the root, with forward slashes. */
export interface StagedChange {
  status: string
  path: string
}

/**
 * What the next commit would change: every path the index adds, modifies or
 * deletes against HEAD — a rename is a deletion and an addition — or against
 * the empty tree before the first commit. Empty outside git, or when git fails.
 */
export function stagedChanges(root: string): StagedChange[] {
  const r = runGit(root, ["diff", "--cached", "--name-status", "--no-renames", "-z"])
  if (!r.ok) return []
  const parts = r.out.split("\0").filter((x) => x !== "")
  const out: StagedChange[] = []
  for (let i = 0; i + 1 < parts.length; i += 2) out.push({ status: parts[i] ?? "", path: parts[i + 1] ?? "" })
  return out
}

/**
 * The text of each file `rev:path` names — `HEAD:<path>` as last committed, `:<path>` as staged — or null where
 * git has no such file. One process for any number of them.
 */
export function textsAt(root: string, names: string[]): (string | null)[] {
  return objects(root, names).map((o) => (o?.type === "blob" ? o.data.toString("utf8") : null))
}
