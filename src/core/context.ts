// The object every command, check and view receives.

import { randomUUID } from "node:crypto"
import { existsSync, mkdirSync, rmSync } from "node:fs"
import { join } from "node:path"
import { parseConfig, posixRelative, readRaw } from "./config.ts"
import { gitReason, runGit, textsAt } from "./git.ts"
import { stateDir } from "./tick.ts"
import { deepFreeze } from "./collections.ts"
import { writes } from "./item.ts"
import { loadRepo } from "./repo.ts"
import { trackerGitOf } from "./repos.ts"
import type { Config, Context, Registry, Repo } from "./types.ts"

export interface IO {
  out(line?: string): void
  err(line: string): void
  now(): Date
}

// A reader that closes early (`naima list | head -1`) breaks the pipe: Deno, Node and Bun each
// surface that differently — a thrown error here, an async "error" event there, EPIPE on a real
// pipe or ENOTCONN when the runtime's stdout is backed by a socket (Bun, under load) — so all of
// them are caught and treated the same way a closed pipe should end a CLI: quietly, exit code 0.
const BROKEN_PIPE_CODES = new Set(["EPIPE", "ENOTCONN", "ECONNRESET"])
function isEpipe(err: unknown): boolean {
  return typeof err === "object" && err !== null && "code" in err && BROKEN_PIPE_CODES.has(String((err as { code?: unknown }).code))
}
for (const stream of [process.stdout, process.stderr]) {
  stream.on("error", (err) => {
    if (isEpipe(err)) process.exit(0)
    throw err
  })
}
function writeLine(stream: NodeJS.WriteStream, line: string): void {
  try {
    stream.write(line + "\n")
  } catch (err) {
    if (isEpipe(err)) process.exit(0)
    throw err
  }
}

export const consoleIO: IO = {
  out: (line = "") => writeLine(process.stdout, line),
  err: (line) => writeLine(process.stderr, line),
  now: () => new Date(),
}

/** Where a project is: its root, its data directory, and the program that runs it. All absolute. */
export interface Place {
  root: string
  data: string
  program: string
}

export function createContext(place: Place, config: Config, registry: Registry, io: IO = consoleIO, preread?: ReadonlyMap<string, string>): Context {
  const trackerRoot = place.data
  const trackerGit = trackerGitOf(place.root, trackerRoot)
  let repo: Repo | null = null
  let readAt = -1
  return {
    root: place.root,
    trackerRoot,
    trackerDir: posixRelative(place.root, trackerRoot),
    trackerGit,
    trackerPrefix: trackerGit === place.root ? posixRelative(place.root, trackerRoot) : "",
    sibling: trackerGit !== place.root,
    program: place.program,
    config: deepFreeze(config),
    registry,
    get repo() {
      // Every write through the core's helpers moves `writes()`: the next read sees it.
      if (repo === null || readAt !== writes()) {
        readAt = writes()
        repo = loadRepo(trackerRoot, registry, preread)
      }
      return repo
    },
    reload() {
      repo = null
    },
    out: io.out,
    err: io.err,
    now: io.now,
  }
}

/**
 * The text of every item's `meta.json` in the tracker the index `env` names, in one `git cat-file --batch`, by the path it
 * has under `data`. A file just checked out is scanned by the machine at its first read (on Windows some 3 ms each, a
 * minute for a large tracker); read from git's objects instead, the items are in hand at once.
 */
function metaFilesOf(ctx: Context, env: Record<string, string>, data: string): Map<string, string> | undefined {
  const listed = runGit(ctx.trackerGit, ["ls-files", "-s", "-z"], { env })
  if (!listed.ok) return undefined
  const files: { sha: string; path: string }[] = []
  for (const row of listed.out.split("\0")) {
    const m = /^100\d+ ([0-9a-f]+) 0\t([^/]+\/[^/]+\/meta\.json)$/.exec(row)
    if (m) files.push({ sha: m[1]!, path: m[2]! })
  }
  const texts = textsAt(ctx.trackerGit, files.map((f) => f.sha))
  const found = new Map<string, string>()
  files.forEach((f, i) => {
    const text = texts[i]
    if (text !== null && text !== undefined) found.set(join(data, ...f.path.split("/")), text)
  })
  return found
}

/**
 * The tracker as `ref` has it, read only: its data directory checked out of git, through an index of its own, into a
 * folder of Naima's state in the git directory, the one place outside the tracker every command may write. The tree
 * of a branch no worktree stands on is judged so, such as a development line's tip. `dispose` removes the folder.
 */
export function contextAt(ctx: Context, ref: string): { ctx: Context; dispose(): void } {
  const state = stateDir(ctx.root)
  if (!state) throw new Error("the tracker of a ref is read into Naima's state folder in the git directory: this is not a git repository")
  const dir = join(state, "at", randomUUID())
  const data = join(dir, "data")
  mkdirSync(data, { recursive: true })
  const dispose = (): void => rmSync(dir, { recursive: true, force: true })
  let preread: Map<string, string> | undefined
  try {
    const env = { GIT_INDEX_FILE: join(dir, "index") }
    const tree = ctx.trackerPrefix ? `${ref}:${ctx.trackerPrefix}` : `${ref}^{tree}`
    const read = runGit(ctx.trackerGit, ["read-tree", tree], { env })
    if (!read.ok) throw new Error(`no tracker on ${ref}: ${gitReason(read)}`)
    const out = runGit(ctx.trackerGit, ["-c", "checkout.workers=0", "checkout-index", "-a", "-f", `--prefix=${data.split("\\").join("/")}/`], { env })
    if (!out.ok) throw new Error(`the tracker on ${ref} could not be read: ${gitReason(out)}`)
    preread = metaFilesOf(ctx, env, data)
  } catch (e) {
    dispose()
    throw e
  }
  const at = createContext({ root: ctx.root, data, program: ctx.program }, ctx.config as Config, ctx.registry, { out: ctx.out, err: ctx.err, now: ctx.now }, preread)
  return { ctx: at, dispose }
}

/**
 * The project as the commit `rev` has it, files and tracker alike: a detached worktree of it in a folder of Naima's state in
 * the git directory, and a context there with this one's configuration and plugins, writing through `io` (this context's
 * own by default). What a landing check reads of a branch no checkout stands on is read there. Each submodule the commit
 * pins is there too, as a detached worktree of the submodule's own repository in this checkout, at the pinned commit
 * (nothing is fetched or cloned: one this checkout does not hold at that commit stays empty), so that a check reading
 * files across the submodule's path, the stance's agent-endpoint check reading the product's MCP server, finds them.
 * `dispose` removes every worktree.
 */
export function checkoutAt(ctx: Context, rev: string, io: IO = { out: ctx.out, err: ctx.err, now: ctx.now }): { ctx: Context; dispose(): void } {
  const state = stateDir(ctx.root)
  if (!state) throw new Error("a checkout of a commit is made in Naima's state folder in the git directory: this is not a git repository")
  const dir = join(state, "checkouts", randomUUID())
  mkdirSync(join(state, "checkouts"), { recursive: true })
  const made = runGit(ctx.root, ["worktree", "add", "--detach", "--quiet", dir, rev])
  if (!made.ok) throw new Error(`no checkout of ${rev}: ${gitReason(made)}`)
  const subs: string[] = []
  const pinned = runGit(ctx.root, ["ls-tree", "-r", rev])
  for (const line of pinned.ok ? pinned.out.split("\n") : []) {
    const m = /^160000 commit ([0-9a-f]+)\t(.+)$/.exec(line)
    if (!m) continue
    const [, commit, path] = m
    const own = join(ctx.root, path!)
    if (!existsSync(join(own, ".git"))) continue
    mkdirSync(join(dir, path!), { recursive: true })
    if (runGit(own, ["worktree", "add", "--detach", "--quiet", "--force", join(dir, path!), commit!]).ok) subs.push(own)
  }
  const dispose = (): void => {
    if (!runGit(ctx.root, ["worktree", "remove", "--force", dir]).ok) rmSync(dir, { recursive: true, force: true })
    runGit(ctx.root, ["worktree", "prune"])
    for (const own of subs) runGit(own, ["worktree", "prune"])
  }
  return { ctx: contextIn(ctx, dir, io), dispose }
}

/**
 * A context at `root`, another checkout of this project (a worktree), with this one's configuration and plugins,
 * writing through `io` (this context's own by default): with `root` this context's own, it is this context with its
 * output elsewhere, which is what a command runs another command with when it reads that one's output.
 */
export function contextIn(ctx: Context, root: string, io: IO = { out: ctx.out, err: ctx.err, now: ctx.now }): Context {
  const data = ctx.sibling || root === ctx.root ? ctx.trackerRoot : join(root, ctx.trackerDir)
  return createContext({ root, data, program: ctx.program }, ctx.config as Config, ctx.registry, io)
}

/**
 * Another project on this machine, read only: its checkout `root` and its tracker's `data`, with this context's plugins,
 * and the project's own configuration when this Naima reads it as it is (this context's otherwise), writing through
 * `io`. The home across projects reads every project Naima knows through one of these.
 */
export function contextOfProject(ctx: Context, root: string, data: string, io: IO = { out: ctx.out, err: ctx.err, now: ctx.now }): Context {
  let config = ctx.config as Config
  try {
    config = parseConfig(readRaw(data))
  } catch { /* data at another format: read with this project's configuration */ }
  return createContext({ root, data, program: ctx.program }, config, ctx.registry, io)
}
