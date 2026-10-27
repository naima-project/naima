// The one entry point: find the data, align the program when the launcher
// runs it, load every plugin, dispatch. The commands that set up and move the
// program itself — init, update, rollback, hello, plugin, guide, help — are answered here,
// before any plugin is loaded.

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join, relative, resolve } from "node:path"
import {
  carryRefusal,
  type Lock,
  parseConfig,
  parseLock,
  parseUpdates,
  posixRelative,
  programDir,
  readRaw,
  sourceRefusal,
  UPDATE_POLICIES,
  writeRaw,
  writeValidatedRaw,
} from "./config.ts"
import { consoleIO, type IO, type Place } from "./context.ts"
import { cliCommands } from "./entry.ts"
import { FORMAT, formatRefusal, isFormat, migrate, MIGRATIONS, type Step } from "./format.ts"
import { formatsFor, type OpenOptions, openProject, owed } from "./project.ts"
import { bool, pairs, parse, str } from "./args.ts"
import { gitOrNull, gitReason, LAND_IT, nativePath, runGit, runGitAsync, toplevel, trunk } from "./git.ts"
import { remoteVisibility, type Visibility } from "./visibility.ts"
import {
  clearExposed,
  exposureOf,
  fileSweepTodo,
  ownerPrivate,
  PRIVATE_REMOTES,
  refreshVisibility,
  setVisibilityProbe,
  trackerExposure,
  wasExposed,
  type Where,
  writeGuard,
} from "./exposure.ts"
import { moveTrackerOut } from "./move-tracker.ts"
import { setWriteGuard } from "./item.ts"
import {
  installTrailerHooks,
  missingTracker,
  naimaHooks,
  pairTracker,
  pointHooksPath,
  projectRootOf,
  readSiblingMarker,
  SIBLING_FILE,
  TRACKER_URL_KEY,
  trackerGitOf,
  writeSiblingMarker,
} from "./repos.ts"
import { exclusions } from "./excludes.ts"
import { ALLOW_PRIVATE, allowPrivateOption, findPrivate, guardPrivate, privateContext, REVISED, revisedOption } from "./private.ts"
import { DATA_DIR, DATA_FILE, DEFAULT_DATA, findData, globalOptions, PROGRAM_DIR, real, RELAUNCH, runtimeOf, trackerOf, trackerReadme } from "./layout.ts"
import {
  align,
  checkoutWork,
  COMMIT_UNAVAILABLE,
  fetchCommit,
  fetchHead,
  ignoreProgram,
  isClone,
  OLD_LAYOUT,
  remoteHead,
  short,
  SOURCE_CHANGED,
  sourceMoved,
  type Target,
  verifySigned,
  withoutCredentials,
} from "./program.ts"
import {
  backwardFormats,
  banner,
  BASICS_INSTRUCTION,
  BASICS_OFFER,
  changeOf,
  checkFrom,
  counted,
  describe,
  type Findings,
  FOLLOW_UP,
  INTRODUCTION,
  INTRODUCTION_BOLD,
  newly,
  NOTHING_WAITS,
  OFFERS,
  OPTIONAL_KEYS,
  pageRules,
  rehearse,
  RULES_FIRST,
  versionOf,
  withCommit,
  withoutOptional,
} from "./updates.ts"
import { changedRules, notesBetween } from "./changes.ts"
import { createItem, saveProse } from "./item.ts"
import { isOpen } from "./lifecycle.ts"
import { EXIT, isInternal, message, NaimaError } from "./errors.ts"
import type { Command, Context, GuideSection, Plugin, Setup } from "./types.ts"
import { asRendered, linesAs } from "./rendered.ts"
import { shortOrId } from "./names.ts"
import { apiFor } from "./plugins.ts"
import { atSessionStart, goalsAtSessionStart, offersAtSessionStart } from "./base.ts"
import { committedLock as lockOfLastCommit, type SessionConfig, sessionStartGaps, startSessions, unfinishedUpdate } from "./session-start.ts"
import { adapter, ADAPTERS } from "./adapters/index.ts"
import { itemStore } from "./messages.ts"
import {
  HOUR,
  type JobOutcome,
  messageId,
  messageLine,
  type Notice,
  record,
  type Schedule,
  startTick,
  tickDir,
  type TickResult,
  type TickTask,
} from "./tick.ts"
import type { TickJob } from "./types.ts"

export interface CliOptions extends OpenOptions {
  cwd: string
  /** The Naima that is running: the directory holding its naima.ts and src/. */
  programRoot: string
  /** The data directory named by `NAIMA_DATA`, if any; `--data` wins over it. */
  data?: string
  /** Run by the launcher: align the program first, and ask to be run again when the code on disk is not the code running. */
  launched?: boolean
  io?: IO
  /** Print the stack of an internal error (NAIMA_DEBUG=1). */
  debug?: boolean
  /** How init asks whether a remote URL is public: GitHub's public API, unless a test gives its own. */
  visibility?: (url: string) => Promise<Visibility>
  /**
   * The tick, for a run the launcher did not start: a test's clock and update check. Launched, every command
   * ticks with the real ones; run directly, as the development build, nothing ticks unless this is given.
   */
  tick?: { clock?: () => Date; check?: (signal: AbortSignal) => Promise<JobOutcome> }
}

const usage = (name: string): string => `usage: naima ${cliCommands.find((c) => c.name === name)?.usage ?? name}`

/** What the running Naima is: the source and commit it is, and why nobody else could run that commit, if so. */
interface Running {
  commit: string
  source: string | null
  work: string | null
  /** The git repository holding it: a repository on this disk that has the commit. */
  repo: string
}

/**
 * The running Naima, when it is a git clone of the product: its runtime at
 * the top of the clone, at HEAD. Null when it is not — the development build,
 * a runtime folder inside a larger repository.
 */
function running(at: string): Running | null {
  // Resolved first: Deno grants the real path, and a file that does not exist cannot be resolved through a symbolic link.
  const programRoot = real(at)
  if (!isClone(programRoot)) return null
  // git always prints --show-toplevel with forward slashes, even on Windows, where real(programRoot)
  // (node:fs) uses backslashes: without nativePath() the two never compared equal there, so a fresh
  // Windows clone was never recognized as its own clone (naima: this Naima is not a clone with an origin).
  const gitTop = toplevel(programRoot)
  // Both resolved: on Windows a temporary folder may be named by its short 8.3 form on one side only.
  if (gitTop === null || real(nativePath(gitTop)) !== programRoot) return null
  const commit = gitOrNull(programRoot, "rev-parse", "HEAD")
  if (!commit) return null
  return { commit, source: gitOrNull(programRoot, "remote", "get-url", "origin"), work: checkoutWork(programRoot), repo: programRoot }
}

type Located = Place & { lock: Lock; raw: Record<string, unknown> }

/** The project whose data is `found`, or null when it holds no naima.json. */
function locate(found: string): Located | null {
  if (!existsSync(join(found, DATA_FILE))) return null
  const data = real(found) // as git names the root: relative paths between the two must not cross a symlink
  const raw = readRaw(data)
  if (!isFormat(raw["format"])) throw new Error(`${DATA_FILE} ${formatRefusal(raw["format"])}`)
  const lock = parseLock(raw)
  return { root: projectRootOf(data) ?? dirname(dirname(data)), data, program: programDir(data, lock), lock, raw }
}

function targetOf(place: Place, lock: Lock, opts: CliOptions): Target {
  // The running Naima's clone holds the commit it runs: a clone made from it needs no network. Asked only when it is not the program.
  const elsewhere = real(opts.programRoot) !== real(runtimeOf(place.program) ?? place.program)
  const repo = elsewhere ? running(opts.programRoot)?.repo : null
  return {
    root: place.root,
    tracker: trackerOf(place.data),
    program: place.program,
    source: lock.source,
    commit: lock.commit,
    ...(lock.verify ? { verify: lock.verify } : {}),
    ...(repo ? { seeds: [repo] } : {}),
  }
}

export { withoutCredentials }

/**
 * What the loaded plugins put in place in this clone where it is missing (their `setup`), each line said; a step
 * that fails says why and stops nothing. Run by init and update after their own work.
 */
async function setUp(place: Place, opts: CliOptions, io: IO): Promise<void> {
  let ctx: Context
  try {
    ctx = await openProject(place, opts, { ...io, err: () => {} })
  } catch {
    return // the project does not open: its next command says why
  }
  for (const c of ctx.registry.contributions("setup")) {
    try {
      for (const line of await (c.value as Setup).install(ctx)) io.out(line)
    } catch (e) {
      io.out(`${c.name}: not put in place: ${message(e)}`)
    }
  }
}

/** The command init names as the next step: a type the loaded plugins really let one create. */
async function nextStep(place: Place, opts: CliOptions, io: IO): Promise<string> {
  try {
    const ctx = await openProject(place, opts, io)
    const creatable = [...ctx.registry.types.values()].filter((t) => t.creatable !== false)
    // The first thing to do is filed where the project files follow-ups (todos, where it has them), not as a defect.
    const type = creatable.find((t) => t.traits?.includes(FOLLOW_UP)) ?? creatable[0]
    return type ? `next: naima new ${type.id} "<the first thing to do>"` : "next: naima help"
  } catch {
    return "next: naima check" // it says what is wrong with the project
  }
}

/** Print, and with --write-excludes write, the lines that keep the program out of the host's own tools. */
function excludeHost(root: string, program: string, write: boolean, io: IO): void {
  for (const x of exclusions(root, posixRelative(root, program))) {
    if (x.present) continue
    if (!write) io.out(`exclude from ${x.file}: ${x.line}   (naima init --write-excludes adds it)`)
    else if (x.write()) {
      io.out(
        `Added Naima's program to the excludes in ${x.file}, so ${
          EXCLUDED_BY[x.file] ?? "the tool it configures"
        } does not check it as part of your project: ${x.line}`,
      )
    } else io.out(`not written, it is not plain JSON — add by hand to ${x.file}: ${x.line}`)
  }
}

/**
 * Write what makes an agent run naima hello at every session start — the pointer line, and with `hooks` each tool's
 * hook — and say each in a plain sentence. Returns the files written, and what this run was not allowed to write.
 */
function startAgents(root: string, tracker: string, config: SessionConfig, hooks: boolean, io: IO): { wrote: string[]; left: string[] } {
  const done = startSessions(root, tracker, config, { hooks })
  for (const line of done.said) io.out(line)
  return done
}

/** What init could not write, the permissions it runs with lacking it: each said, with the command that writes it. */
function sayLeft(left: readonly string[], io: IO): void {
  for (const part of left) io.out(`not written, this run may not write it: ${part} — naima update writes it`)
}

/** The tool each host file `init --write-excludes` writes configures. */
const EXCLUDED_BY: Record<string, string> = { "deno.json": "Deno", "deno.jsonc": "Deno", "tsconfig.json": "tsc", ".prettierignore": "prettier" }

/** The installer's refusal outside a git repository, said by init and by a first run alike. */
const OUTSIDE = (where: string): string =>
  `${where} is not in a git repository. Is its folder the root of your project? If so, ask your agent to create a repository there and install Naima from https://naima-project.github.io/naima/`

/** The nearest directory of `path`, or above it, that exists: what git can be asked about. */
function existing(path: string): string {
  let dir = resolve(path)
  while (!existsSync(dir) && dirname(dir) !== dir) dir = dirname(dir)
  return dir
}

/**
 * Make `data` a Naima project's data, locked to the running Naima: its
 * `naima.json`, and the tracker folder's README.md and .gitignore. What
 * `naima init` and a first run with no data beside the program both do.
 * Returns the line that says what it wrote.
 */
function createData(data: string, opts: CliOptions): { root: string; tracker: string; program: string; said: string } {
  const tracker = dirname(data)
  const top = toplevel(existing(tracker))
  if (!top) throw new Error(OUTSIDE(tracker))
  const root = nativePath(top)
  // A tracker kept in a repository of its own is cloned, never made afresh beside the code: that would be a second tracker.
  if (readSiblingMarker(tracker) && !existsSync(join(data, ".git"))) throw new Error(missingTracker(root, tracker))
  const me = running(opts.programRoot)
  if (!me?.source) {
    throw new Error(
      `this Naima is not a git clone with an origin: the lock records the source and commit of the Naima that runs — git clone <source> ${
        posixRelative(root, join(tracker, PROGRAM_DIR))
      }, and run its naima.ts`,
    )
  }
  const source = withoutCredentials(me.source)
  const refusal = sourceRefusal(source)
  if (refusal) throw new Error(`the origin of ${opts.programRoot} cannot be a lock's source: it ${refusal}`)
  // Everyone else must be able to fetch what is locked: nothing uncommitted, and a commit of the origin's main.
  if (me.work === "uncommitted changes") {
    throw new Error(
      `the Naima that runs has uncommitted changes, so nobody else could run the commit it would lock — commit and push them, or clone a pushed one`,
    )
  }
  if (!runGit(me.repo, ["rev-parse", "--verify", "--quiet", "refs/remotes/origin/main"]).ok) {
    runGit(me.repo, ["fetch", "--quiet", "origin", "+refs/heads/main:refs/remotes/origin/main"])
  }
  if (!runGit(me.repo, ["merge-base", "--is-ancestor", me.commit, "refs/remotes/origin/main"]).ok) {
    throw new Error(
      `the Naima that runs is at ${
        short(me.commit)
      }, which is not on its origin's main, so nobody else could run the commit it would lock — check out a commit of main, or push it there`,
    )
  }
  mkdirSync(data, { recursive: true })
  const parent = posixRelative(root, tracker) || "."
  const readme = join(tracker, "README.md")
  if (!existsSync(readme)) writeFileSync(readme, trackerReadme(parent, source))
  const formats = formatsFor(opts.firstParty.map((p) => p.factory({}, apiFor(p.name, { rename: {} }))))
  writeRaw(data, { format: FORMAT, ...(Object.keys(formats).length ? { formats } : {}), source, commit: me.commit })
  const program = join(tracker, PROGRAM_DIR)
  ignoreProgram({ tracker, program })
  // A source on this machine's disk goes into the repository with the lock: say so, since it names a private path.
  const local = !/^[a-z][a-z0-9+.-]*:\/\//i.test(source) && !/^[^/\\]+@[^/\\]+:/.test(source)
  const warn = local
    ? `\n${source} is a folder on this machine: it is committed in ${DATA_DIR}/${DATA_FILE} as the lock's source, and nobody else can fetch from it — clone Naima from its public address instead, unless this is a test`
    : ""
  return {
    root,
    tracker,
    program,
    said: `wrote ${parent}/: README.md, .gitignore, ${DATA_DIR}/${DATA_FILE} — locked to ${source} at ${short(me.commit)}${warn}`,
  }
}

/**
 * `init --tracker <url>`: the data directory becomes a git clone of the tracker repository at `url`, ignored by the
 * code's git, and the tracker folder's committed `tracker.json` says so — naming `url` unless `privateUrl`, which keeps
 * it in this clone's git config instead. A data directory committed with the code is refused: moving it out is a
 * migration, by hand (docs/guide/private-tracker.md).
 */
function siblingTracker(data: string, url: string | null, privateUrl: boolean, io: IO): boolean {
  const tracker = dirname(data)
  const top = toplevel(existing(tracker))
  if (!top) throw new Error(OUTSIDE(tracker))
  const root = nativePath(top)
  const shown = posixRelative(root, data)
  if (!existsSync(join(data, ".git"))) {
    if (existsSync(join(data, DATA_FILE))) {
      if (url !== null) {
        throw new Error(
          `${shown}/${DATA_FILE} is committed with the code: move it into a repository of its own first, with its history, by naima init --private-tracker — docs/guide/private-tracker.md`,
        )
      }
      moveTrackerOut(root, data, io.out)
      return true
    }
    if (existsSync(data) && readdirSync(data).length) throw new Error(`${shown} exists and is not a git clone: move it away, then run naima init again`)
    if (url === null) {
      // A local repository: no remote, works offline, stays on this machine until pushed to a private one.
      mkdirSync(data, { recursive: true })
      const r = runGit(data, ["init", "--quiet", "-b", trunk(root) ?? "main"])
      if (!r.ok) throw new Error(`cannot create the tracker repository in ${shown}: ${r.err.split("\n").find((l) => l.trim()) ?? "git failed"}`)
      io.out(`created a git repository of its own for the tracker in ${shown}, on this machine only: no remote, nothing public`)
    } else {
      const r = runGit(root, ["clone", "--quiet", "--", url, data])
      if (!r.ok) throw new Error(`cannot clone the tracker repository into ${shown}: ${r.err.split("\n").find((l) => l.trim()) ?? "git failed"}`)
      io.out(`cloned the tracker repository into ${shown}`)
    }
  } else if (trackerGitOf(root, data) === root) {
    throw new Error(`${shown} is part of the code's repository, not a clone of its own`)
  }
  mkdirSync(tracker, { recursive: true })
  writeSiblingMarker(tracker, privateUrl || url === null ? {} : { repository: withoutCredentials(url) })
  if (privateUrl && url !== null) runGit(root, ["config", TRACKER_URL_KEY, url])
  ignoreProgram({ tracker, program: data })
  io.out(
    `wrote ${posixRelative(root, join(tracker, SIBLING_FILE))}${
      privateUrl ? `, and the tracker's address in this clone's git config (${TRACKER_URL_KEY})` : ""
    }; ${posixRelative(root, tracker)}/.gitignore ignores ${DATA_DIR}/ — commit both in the code's repository`,
  )
  return false
}

const PRIVATE_TRACKER = `naima init --private-tracker (a git repository of its own in ${DEFAULT_DATA}, ignored by the project, on this machine only)`

/** What init says, through the agent, of a project that is public or may be: where its tracker lives. */
function looksPublic(visibility: Visibility, url: string | null): string {
  const remote = url ? ` ${withoutCredentials(url)}` : ""
  if (visibility === "public") {
    return `this project is public (its remote${remote} is public): its tracker must be private, so it is kept beside it — tell the owner, then run ${PRIVATE_TRACKER} — docs/guide/private-tracker.md`
  }
  return `this project may be public (the visibility of its remote${remote} cannot be told): is that remote private? Ask the owner once — ` +
    `yes: naima init --tracker-inside (committed with the code, and the answer recorded); no, or not sure: ${PRIVATE_TRACKER} — docs/guide/private-tracker.md`
}

/** Where a project's tracker privacy is read from, outside a command: its places and a clock. */
function whereOf(root: string, data: string, io: IO): Where {
  const trackerGit = trackerGitOf(root, data)
  return { root, trackerRoot: data, trackerGit, sibling: trackerGit !== root, now: io.now }
}

/**
 * Record the owner's answer that the tracker's remotes whose visibility cannot be told are private: their keys
 * in naima.json's privateRemotes. A remote GitHub says is public is refused: the answer cannot make it private.
 */
async function recordPrivate(root: string, data: string, io: IO): Promise<void> {
  const w = whereOf(root, data, io)
  const seen = await refreshVisibility(w)
  const exposure = exposureOf(w, seen)
  if (exposure.state === "exposed") throw new Error(exposure.message)
  const known = ownerPrivate(data)
  const add = seen.filter((r) => r.visibility === "unknown" && !known.includes(r.key))
  if (!add.length) {
    io.out(`nothing to record: no remote of the tracker has a visibility that cannot be told`)
    return
  }
  const raw = readRaw(data)
  writeValidatedRaw(data, { ...raw, [PRIVATE_REMOTES]: [...known, ...add.map((r) => r.key)] })
  io.out(
    `recorded in ${posixRelative(root, join(data, DATA_FILE))}, by a hash of its address: the owner says ${
      add.map((r) => r.url).join(", ")
    } is private — commit it ${LAND_IT}`,
  )
}

/** After a tracker moved out of a public repository: the sweep todo, filed once. */
async function sweepAfter(place: Place, opts: CliOptions, io: IO): Promise<void> {
  const ctx = await openProject(place, opts, io)
  io.out(fileSweepTodo(ctx))
  clearExposed(ctx.trackerGit)
  clearExposed(ctx.root)
}

async function init(args: string[], opts: CliOptions, data: string, io: IO): Promise<number> {
  // --write-agent-pointer is accepted and changes nothing: the pointer is always written.
  const p = parse(args, {
    "write-excludes": { type: "boolean" },
    "write-agent-pointer": { type: "boolean" },
    "no-session-hook": { type: "boolean" },
    tracker: { type: "string" },
    "private-url": { type: "boolean" },
    "private-tracker": { type: "boolean" },
    "tracker-inside": { type: "boolean" },
    "remote-private": { type: "boolean" },
  })
  const write = bool(p, "write-excludes")
  const hooks = !bool(p, "no-session-hook")
  const given = str(p, "tracker")
  const local = bool(p, "private-tracker")
  const inside = bool(p, "tracker-inside")
  const remotePrivate = bool(p, "remote-private")
  if ((bool(p, "private-url") && given === undefined) || [given !== undefined, local, inside, remotePrivate].filter(Boolean).length > 1) {
    throw new Error(usage("init"))
  }
  if (remotePrivate) {
    const found = locate(data)
    if (!found) {
      throw new Error(
        `no ${DATA_FILE} in ${data}: --remote-private answers for a project that has its tracker — naima init --tracker-inside answers it at the start`,
      )
    }
    await recordPrivate(found.root, found.data, io)
    return 0
  }
  const sibling = given !== undefined || local
  const url = given ?? null
  // Where the tracker lives, asked once of a project that looks public and has none yet.
  let answeredInside = false
  if (!sibling && !locate(data) && !existsSync(join(data, ".git")) && !readSiblingMarker(dirname(resolve(data)))) {
    const top = toplevel(existing(dirname(resolve(data))))
    if (top) {
      const seen = await remoteVisibility(nativePath(top), opts.visibility)
      if (seen.visibility === "public" || (seen.visibility === "unknown" && !inside)) throw new Error(looksPublic(seen.visibility, seen.url))
      answeredInside = inside && seen.visibility === "unknown"
    }
  }
  const moved = sibling ? siblingTracker(resolve(data), url, bool(p, "private-url"), io) : false
  const found = locate(data)
  if (found) {
    io.out(`${posixRelative(found.root, join(found.data, DATA_FILE))} already exists — left as it is`)
    if (moved) await sweepAfter(found, opts, io)
    else if (sibling) { for (const line of installTrailerHooks(found.root, found.data)) io.out(line) }
    else if (trackerGitOf(found.root, found.data) === found.root) {
      const w = whereOf(found.root, found.data, io)
      const exposure = exposureOf(w, await refreshVisibility(w))
      if (exposure.state !== "private") io.out(exposure.message)
    }
    const config = parseConfig(found.raw, { lenient: true })
    excludeHost(found.root, found.program, write, io)
    sayLeft(startAgents(found.root, trackerOf(found.data), config, hooks, io).left, io)
    await setUp(found, opts, io)
    io.out(await nextStep(found, opts, io))
    return 0
  }
  const made = createData(resolve(data), opts)
  const place: Place = { root: made.root, data: real(data), program: made.program }
  if (answeredInside) await recordPrivate(made.root, place.data, io)
  // Launched from a Naima elsewhere, init clones the program beside the data; run directly, as a test, the first launched run does.
  const cloned = opts.launched && real(opts.programRoot) !== real(made.program)
    ? (align({ ...targetOf(place, parseLock(readRaw(place.data)), opts) }), `, and cloned ${PROGRAM_DIR}/`)
    : ""
  io.out(made.said + cloned)
  if (sibling) {
    for (const line of installTrailerHooks(made.root, place.data)) io.out(line)
    io.out(`commit ${posixRelative(made.root, place.data)}/ in the tracker repository first, then ${posixRelative(made.root, made.tracker)}/ in the code's`)
  }
  excludeHost(made.root, made.program, write, io)
  sayLeft(startAgents(made.root, made.tracker, parseConfig(readRaw(place.data)), hooks, io).left, io)
  await setUp(place, opts, io)
  io.out(await nextStep(place, opts, io))
  return 0
}

/** What `naima update` says it migrated: the core's format, then each plugin's own. */
function migrated(steps: readonly Step[], from: unknown, plugins: readonly { plugin: string | null; migrations: readonly unknown[] }[]): string[] {
  if (!steps.length) return [`the data is format ${FORMAT}: nothing to migrate`]
  const out = steps.some((s) => s.plugin === null) ? [`migrated the data from format ${String(from)} to ${FORMAT}`] : []
  for (const p of plugins) {
    const mine = steps.filter((s) => s.plugin === p.plugin)
    if (mine.length) out.push(`migrated ${p.plugin}'s data from its format ${mine[0]?.from} to ${1 + p.migrations.length}`)
  }
  return out
}

/**
 * What updating to `to` changes, said — the commits, their change notes, what is computed — and the rehearsal:
 * `to`'s own naima check run on the project, writing nothing. Nothing when the program's origin is not the lock's
 * source, whose commits it may not hold.
 */
async function said(opts: CliOptions, place: Place, t: Target, raw: Record<string, unknown>, to: string): Promise<string[]> {
  if (withoutCredentials(runGit(t.program, ["remote", "get-url", "origin"]).out) !== t.source) return []
  verifySigned(t.program, { ...t, commit: to })
  return [...describe(await changeOf(t.program, raw, t.commit, to)), ...await rehearse(t.program, to, opts.programRoot, place)]
}

/** The lock naima.json holds in the project's last commit; null when it holds none. */
const committedLock = (place: Place): string | null => lockOfLastCommit(place.root, place.data)

/** A finding as an item's title: its first words, short enough to read. */
const titleOf = (finding: string): string => {
  const words = `After the Naima update: ${finding}`.split(/\s+/)
  let title = ""
  for (const w of words) {
    if ((title + " " + w).length > 100) return `${title}…`
    title = title ? `${title} ${w}` : w
  }
  return title
}

/** File an item for each finding the update left, in the type that carries the trait follow-up; one already open with its title is not filed again. */
async function fileLeft(opts: CliOptions, place: Place, io: IO, commit: string, all: readonly string[], pending: readonly string[]): Promise<void> {
  const findings = all.filter((f) => !pending.includes(f))
  if (!findings.length) return
  const ctx = await openProject(place, opts, io)
  const type = [...ctx.registry.types.values()].find((t) => t.creatable !== false && t.traits?.includes(FOLLOW_UP))
  if (!type) {
    io.out(`not filed, no type of this project carries the trait ${FOLLOW_UP}: ${findings.join("; ")}`)
    return
  }
  for (const finding of findings) {
    const title = titleOf(finding)
    if (ctx.repo.items.some((i) => i.type === type.id && i.meta.title === title && isOpen(ctx, i))) continue
    try {
      const item = createItem(ctx, type, title)
      saveProse(
        ctx,
        item,
        `# ${title}\n\nAfter naima update moved the lock to ${
          short(commit)
        }, naima check found this, and the update could not fix it by itself:\n\n> ${finding}\n\nFix it, or accept it with its reason (naima waive).\n`,
      )
      io.out(`filed ${type.id}/${item.slug} for what the update left: ${finding}`)
    } catch (e) {
      io.out(`not filed: ${finding} — ${message(e)}`)
    }
  }
}

/**
 * How `naima update` ends, run by the Naima it moved to: the rules the move changed, for agents to acknowledge
 * again; naima check; and an item filed for each problem or note the check newly finds — newly against the
 * locked commit of the project's last commit, whose own check runs from a temporary copy. A finding in `pending` is
 * what the next run of the update writes, and is not filed.
 */
async function finish(opts: CliOptions, place: Place, lock: Lock, io: IO, pending: readonly string[] = []): Promise<void> {
  const program = place.program
  const was = committedLock(place)
  const moved = was !== null && was !== lock.commit && runGit(program, ["merge-base", "--is-ancestor", was, lock.commit]).ok
  let baseline: Findings | null = null
  if (moved) {
    const rules = [...new Set([...pageRules(program, was, lock.commit), ...changedRules(notesBetween(program, was, lock.commit).notes)])]
    if (rules.length) {
      io.out(
        `Rules changed: ${rules.join("; ")} — agents read them again (naima rules --audience agents) and give their acknowledgement in the next session note`,
      )
    }
    try {
      baseline = await withCommit(program, was, (dir) => checkFrom(dir, place))
    } catch {
      baseline = null // the older Naima cannot read the data any more: every problem is the update's to look at
    }
  }
  const now = await checkFrom(opts.programRoot, place)
  if (moved) {
    const left = baseline ? newly(baseline, now) : { problems: now.problems, notes: [] }
    await fileLeft(opts, place, io, lock.commit, [...left.problems, ...left.notes], pending)
  }
  io.out(`naima check: ${counted(now.problems.length, "problem")}, ${counted(now.notes.length, "note")}${now.problems.length ? ":" : ""}`)
  for (const p of now.problems) io.out(`  ✗ ${p}`)
}

/** The commit `naima.json` named before the current lock, in its git history (the uncommitted file first), and the commit that recorded the current one. */
function previousLock(place: Place, current: string): string {
  const repo = trackerGitOf(place.root, place.data)
  const rel = posixRelative(repo, join(place.data, DATA_FILE))
  const log = runGit(repo, ["log", "--format=%H", "--", rel])
  for (const c of log.ok ? log.out.split("\n").filter((l) => l) : []) {
    const text = runGit(repo, ["show", `${c}:${rel}`])
    let commit: unknown
    try {
      commit = (JSON.parse(text.out) as { commit?: unknown }).commit
    } catch {
      continue
    }
    if (typeof commit === "string" && commit !== current) return commit
  }
  throw new Error(`no earlier lock in the history of ${rel} — name the commit: naima update --to <commit>`)
}

/** The commit of the project that recorded the data's current formats: the one to revert to have the data as it was before. */
function migratedBy(place: Place, raw: Record<string, unknown>): string | null {
  const repo = trackerGitOf(place.root, place.data)
  const rel = posixRelative(repo, join(place.data, DATA_FILE))
  const formats = (o: Record<string, unknown>) => JSON.stringify([o["format"], o["formats"] ?? {}])
  const now = formats(raw)
  const log = runGit(repo, ["log", "--format=%H", "--", rel])
  let last: string | null = null
  for (const c of log.ok ? log.out.split("\n").filter((l) => l) : []) {
    let then: Record<string, unknown>
    try {
      then = JSON.parse(runGit(repo, ["show", `${c}:${rel}`]).out) as Record<string, unknown>
    } catch {
      break
    }
    if (formats(then) !== now) break
    last = c
  }
  return last
}

/** The full hash of `commit` in the program, fetched when it is a full hash the program lacks; an error naming it otherwise. */
function resolveCommit(t: Target, commit: string): string {
  if (!/^[0-9a-f]{4,40}$/.test(commit)) throw new Error(`${commit} is not a commit: name it by its hash`)
  if (commit.length === 40) fetchCommit(t, commit)
  const r = runGit(t.program, ["rev-parse", "--verify", "--quiet", `${commit}^{commit}`])
  if (!r.ok) throw new Error(`no commit ${commit} in ${t.source}: name one of its main by its full hash`)
  return r.out
}

/**
 * Move the lock to `to`, a commit of the source's main, forward or back: say what changes, refuse a commit
 * older than the data's formats, drop `updates` when `to` does not know it, align the program, record the
 * lock. Forward across a format, the new Naima finishes (RELAUNCH); otherwise one change to commit.
 */
async function moveLock(opts: CliOptions, place: Place, lock: Lock, raw: Record<string, unknown>, io: IO, to: string): Promise<number> {
  const t = targetOf(place, lock, opts)
  const onMain = runGit(t.program, ["merge-base", "--is-ancestor", to, "refs/remotes/origin/main"]).ok ||
    runGit(t.program, ["merge-base", "--is-ancestor", to, lock.commit]).ok
  if (!onMain) throw new Error(`${short(to)} is not a commit of the source's main: the lock names only those`)
  verifySigned(t.program, { ...t, commit: to })
  const change = await changeOf(t.program, raw, lock.commit, to)
  const tracker = posixRelative(place.root, trackerOf(place.data))
  const back = backwardFormats(change)
  if (back.length) {
    const f = back[0] as (typeof back)[number]
    const name = f.plugin === null ? "data format" : `${f.plugin} format`
    const by = migratedBy(place, raw)
    throw new Error(
      `${short(to)} reads ${name} ${f.to}, and the data is format ${f.from}: migrations run forward only, so going back needs the data as it was — ${
        by ? `git revert ${short(by)}, the commit that migrated it, then naima check` : `the migration is not committed: git checkout -- ${tracker}`
      }`,
    )
  }
  if (change.unknown && change.back) throw new Error(`cannot tell which data format ${short(to)} reads: ${change.unknown}`)
  let next: Record<string, unknown> = { ...change.rewritten, commit: to }
  const notes: string[] = []
  if (change.config) {
    const dropped = OPTIONAL_KEYS.filter((k) => k in next)
    if (dropped.length && change.configWithoutUpdates === null) {
      next = withoutOptional(next)
      for (const key of dropped) {
        notes.push(`${short(to)} does not know the option ${key}: removed from ${DATA_FILE}; it is set again after an update to a Naima that knows it`)
      }
    } else throw new Error(`${short(to)} does not read this ${DATA_FILE}: ${change.config}`)
  }
  for (const line of describe(change)) io.out(line)
  // Move the program first, and only then the lock: a refusal leaves both where they were.
  align({ ...t, commit: to })
  writeRaw(place.data, next)
  io.out(`locked ${short(lock.commit)} → ${short(to)}`)
  for (const r of change.rewrites) io.out(r)
  for (const n of notes) io.out(n)
  // Forward, the new Naima finishes: it knows the new format, and its own check is the one that ends the update.
  if (!change.back || change.formats.some((f) => f.to > f.from)) return RELAUNCH
  const verb = change.back ? "Roll Naima back to" : "Update Naima to"
  io.out(`${short(to)} is the lock — commit it as one change ${LAND_IT}: git add ${tracker} && git commit -m "${verb} ${short(to)}"`)
  return 0
}

async function update(args: string[], opts: CliOptions, place: Place, lock: Lock, raw: Record<string, unknown>, io: IO): Promise<number> {
  const p = parse(args, { check: { type: "boolean" }, "accept-source": { type: "boolean" }, to: { type: "string" }, mode: { type: "string" } })
  const check = bool(p, "check")
  const to = str(p, "to")
  const mode = str(p, "mode")
  if ([check, bool(p, "accept-source"), to !== undefined, mode !== undefined].filter((x) => x).length > 1 || p.positionals.length) {
    throw new Error(usage("update"))
  }
  if (bool(p, "accept-source")) {
    // The entry point has aligned the program to the new source already: accepting it is all this asks,
    // with the tracker's README, which names the source to clone, rewritten for it when Naima wrote it.
    const tracker = trackerOf(place.data)
    const readme = join(tracker, "README.md")
    const fresh = trackerReadme(posixRelative(place.root, tracker) || ".", lock.source)
    const ours = existsSync(readme) && readFileSync(readme, "utf8").startsWith("[Naima](")
    if (ours && readFileSync(readme, "utf8") !== fresh) {
      writeFileSync(readme, fresh)
      const shown = posixRelative(place.root, readme)
      io.out(
        `trusted ${lock.source} at the locked commit ${
          short(lock.commit)
        }; rewrote ${shown} for it — commit it ${LAND_IT}: git add ${shown} && git commit -m "Naima's source: ${lock.source}"`,
      )
    } else io.out(`trusted ${lock.source} at the locked commit ${short(lock.commit)}; nothing else moved`)
    return 0
  }
  const tracker = posixRelative(place.root, trackerOf(place.data))
  if (mode !== undefined) {
    const policy = parseUpdates(mode)
    writeValidatedRaw(place.data, { ...raw, updates: policy })
    io.out(`updates: ${policy} — ${POLICY_SAYS[policy]}; commit it ${LAND_IT}: git add ${tracker} && git commit -m "Naima updates: ${policy}"`)
    return 0
  }
  const t = targetOf(place, lock, opts)
  if (check) {
    const head = remoteHead(t)
    if (head.movedTo) io.out(sourceMoved(lock.source, head.movedTo))
    if (head.commit === lock.commit) io.out(`current: the source's ${head.branch} is the locked commit ${short(head.commit)}`)
    else {
      io.out(`the source's ${head.branch} moved: ${short(lock.commit)} → ${short(head.commit)} — naima update`)
      try {
        fetchHead(t)
        for (const line of await said(opts, place, t, raw, head.commit)) io.out(line)
      } catch (e) {
        io.out(`what it changes is not known: ${message(e)}`)
      }
    }
    return head.commit === lock.commit ? 0 : 1
  }
  const carried = carryRefusal(raw, posixRelative(place.root, place.program))
  if (carried) throw new Error(carried)
  const head = to !== undefined ? undefined : fetchHead(t)
  if (head?.movedTo) io.out(sourceMoved(lock.source, head.movedTo))
  const target = head ? head.commit : resolveCommit(t, to as string)
  if (target !== lock.commit) return await moveLock(opts, place, lock, raw, io, target)
  const from = raw["format"]
  const { all } = await owed(raw, place, opts)
  const steps = migrate(place.data, MIGRATIONS, all.slice(1))
  for (const line of migrated(steps, from, all.slice(1))) io.out(line)
  // A mechanical fix, said: what makes agents run naima hello at every session start, where it is missing.
  const config = parseConfig(readRaw(place.data), { lenient: true })
  const { wrote, left } = startAgents(place.root, trackerOf(place.data), config, true, io)
  // And what the plugins put in place in the clone, such as the trunk guard, where it is missing.
  await setUp(place, opts, io)
  // Launched by an older launcher, whose fence predates these files, this run may not write them: the next run, under
  // this Naima's own launcher, does. What its check notes about them is that run's to fix, not an item to file.
  const unfinished = left.length ? unfinishedUpdate(place.root, place.data, target, config) : null
  const pending = left.length ? [...(unfinished ? [unfinished] : []), ...sessionStartGaps(place.root, trackerOf(place.data), config)] : []
  await finish(opts, place, lock, io, pending)
  if (left.length) {
    io.out(`Naima ${unfinished ? "moved to" : "is at"} ${short(target)}; run naima update once more to finish: ${left.join(" and ")}`)
    return 0
  }
  io.out(
    `${short(target)} is the lock — commit it as one change ${LAND_IT}: git add ${[tracker, ...wrote].join(" ")} && git commit -m "Update Naima to ${
      short(target)
    }"`,
  )
  return 0
}

/** What each update policy makes a session start do. */
const POLICY_SAYS: Record<(typeof UPDATE_POLICIES)[number], string> = {
  off: "a session start does not ask the source; naima update --check does, on request",
  check: "a session start says when a newer Naima exists",
  update: "a session start says what a newer Naima changes, and offers it; it is applied only after the owner's yes",
}

/** `naima rollback`: the lock back to the one before it, found in naima.json's git history. */
async function rollback(args: string[], opts: CliOptions, place: Place, lock: Lock, raw: Record<string, unknown>, io: IO): Promise<number> {
  if (parse(args).positionals.length) throw new Error(usage("rollback"))
  const carried = carryRefusal(raw, posixRelative(place.root, place.program))
  if (carried) throw new Error(carried)
  const t = targetOf(place, lock, opts)
  return await moveLock(opts, place, lock, raw, io, resolveCommit(t, previousLock(place, lock.commit)))
}

/** The update check's schedule: once a day, a short network call, retried an hour after a failure, urgent after a week of them. */
export const UPDATE_CHECK: Schedule = { name: "update-check", every: "day", timeoutMs: 8_000, retryAfterMs: HOUR, escalateAfterDays: 7 }

/** What a check of the source found, as the tick records it: a newer Naima is a message for the owner, said once per commit. */
function checked(lock: Lock, head: string): JobOutcome {
  if (head === lock.commit) return { ok: true, notices: [] }
  const notice: Notice = {
    id: messageId("update-available", short(head)),
    level: "info",
    text: `A newer Naima is available: ${short(lock.commit)} → ${
      short(head)
    }. Ask the owner whether to update: naima update --check says what it changes, and nothing is applied without the owner's yes.`,
  }
  return { ok: true, notices: [notice] }
}

/** The update check as a job of the tick; null when naima.json's updates is off. */
function updateCheck(opts: CliOptions, place: Place, lock: Lock, raw: Record<string, unknown>): TickTask | null {
  if (parseUpdates(raw["updates"]) === "off") return null
  return {
    ...UPDATE_CHECK,
    escalation: (since) => ({
      title: `Naima has not been able to check for a newer version since ${since}`,
      text: `The daily check of Naima's source for a newer version has failed every day since ${since}, so a fix or a security update may be waiting unseen. ` +
        "Run naima update --check to see why it fails (no network, a source that moved or was removed, missing credentials). Nothing is updated without the owner's yes.",
    }),
    async run(signal) {
      if (opts.tick?.check) return await opts.tick.check(signal)
      const r = await runGitAsync(place.root, ["ls-remote", "--", lock.source, "refs/heads/main"], UPDATE_CHECK.timeoutMs ?? 8_000)
      const head = r.ok ? r.out.split(/\s+/)[0] : undefined
      if (!head) return { ok: false, error: r.ok ? "the source has no main branch" : gitReason(r) }
      return checked(lock, head)
    },
  }
}

/** A plugin's job as the tick runs it, in the project's context. */
const asTask = (ctx: Context, job: TickJob): TickTask => ({ ...job, run: (signal) => job.run(ctx, signal) })

/** Whether this run ticks: launched, always; run directly, only when a test asks. */
const ticks = (opts: CliOptions): boolean => opts.launched === true || opts.tick !== undefined

/** Start the tick of a command: every job due claimed and started, nothing waited for. Null when this run does not tick. */
function beginTick(opts: CliOptions, place: Located, ctx: Context): { finish(): Promise<TickResult> } | null {
  if (!ticks(opts)) return null
  try {
    const dir = tickDir(place.root)
    if (!dir) return null
    const check = updateCheck(opts, place, place.lock, place.raw)
    const jobs = ctx.registry.contributions("jobs").map((c) => asTask(ctx, c.value as TickJob))
    return startTick({ dir, clock: opts.tick?.clock ?? (() => ctx.now()), tasks: [...(check ? [check] : []), ...jobs], store: itemStore(ctx) })
  } catch {
    return null // the tick never stops a command
  }
}

/** Wait for the tick's jobs, each bounded by its timeout, and return what it has for the owner, each message claimed. */
async function endTick(tick: { finish(): Promise<TickResult> } | null): Promise<TickResult> {
  if (!tick) return { ran: [], shown: [] }
  try {
    return await tick.finish()
  } catch {
    return { ran: [], shown: [] }
  }
}

/** A message as a person reads it in a list: urgent ones marked, with how the owner acknowledges them. */
const spoken = (n: Notice): string => `${n.level === "urgent" ? "URGENT: " : ""}${n.text}${n.ack ? ` (only the owner acknowledges it: ${n.ack})` : ""}`

/** What an agent is told to do, at the end of its turn, with what the tick has for the owner. */
export const stopReason = (shown: readonly Notice[]): string =>
  [
    "Naima has something for the owner. Before you end this turn, tell the owner in plain words, in your reply:",
    ...shown.map((n) => `- ${spoken(n)}`),
    "Ask before acting on any of it: nothing is applied without the owner's yes, and never acknowledge a message on the owner's behalf.",
  ].join("\n")

/** The adapter `--hook` names, or an error that names the tools that have one. */
function hookTool(args: string[], command: string): { tool: ReturnType<typeof adapter> | null; rest: string[] } {
  const at = args.indexOf("--hook")
  if (at === -1) return { tool: null, rest: args }
  const id = args[at + 1]
  const tool = id ? adapter(id) : undefined
  if (!tool) {
    throw new Error(
      `usage: naima ${command} --hook <tool>, one whose adapter has hooks: ${ADAPTERS.filter((a) => a.sessionStart || a.turnEnd).map((a) => a.id).join(", ")}`,
    )
  }
  return { tool, rest: args.filter((_, i) => i !== at && i !== at + 1) }
}

/**
 * `naima tick`: run the tick now, waiting for every job due, and say what is due to the owner. With --hook, as the
 * tool's turn-end hook: what its adapter prints when there is something, nothing otherwise, and never a failure.
 */
async function tickCommand(args: string[], opts: CliOptions, place: Located, io: IO): Promise<number> {
  const { tool, rest } = hookTool(args, "tick")
  const p = parse(rest, { json: { type: "boolean" } })
  if (p.positionals.length) throw new Error(usage("tick"))
  let result: TickResult = { ran: [], shown: [] }
  try {
    const ctx = await openProject(place, opts, { ...io, err: () => {} })
    const tick = beginTick({ ...opts, tick: opts.tick ?? {} }, place, ctx)
    result = await endTick(tick)
  } catch (e) {
    if (tool) return 0
    throw e
  }
  if (tool) {
    if (result.shown.length) io.out(tool.stopFor ? tool.stopFor(stopReason(result.shown)) : stopReason(result.shown))
    return 0
  }
  if (bool(p, "json")) {
    io.out(JSON.stringify({ ran: result.ran, messages: result.shown.map((n) => ({ id: n.id, level: n.level, text: n.text, ack: n.ack ?? null })) }, null, 2))
    return 0
  }
  if (!result.shown.length) io.out(result.ran.length ? `ran ${result.ran.join(", ")}; nothing for the owner` : "nothing due")
  for (const n of result.shown) io.out(spoken(n))
  return 0
}

/** What an agent is told at a session start, beside the greeting the owner has just seen. */
export const greetingContext = (shown: string): string =>
  [
    "Naima's session-start greeting (naima hello) has just been shown to the owner directly:",
    "",
    shown,
    "",
    `In your first reply, open with the banner's first words as "${INTRODUCTION_BOLD}", keeping the bold and the expansion, and say in the same line which version is active; pass on the next goal and release, if the greeting names them, and, in plain words, anything above that waits on the owner's decision — a newer Naima, a long run that is due, an urgent message — asking before acting on it. Do not run naima hello again in this session.`,
    "",
    BASICS_INSTRUCTION,
  ].join("\n")

/**
 * `naima hello`: the banner, what the update policy finds, what waits on the owner (the summary sections marked
 * `hello`, such as the long runs that are due, and the urgent messages the tick holds), and the offers, the summary
 * sections' first, such as generating code from a model — what an
 * agent says first in a session. Reads the source only as `updates` says, and records that check as the day's update
 * check; never moves the lock, never starts a run. With --hook, prints it as the tool's session-start hook wants it.
 */
async function hello(args: string[], opts: CliOptions, place: Located, io: IO): Promise<number> {
  const { tool, rest } = hookTool(args, "hello")
  if (rest.length) throw new Error(usage("hello"))
  const { lock, raw } = place
  const me = running(opts.programRoot)
  const policy = parseUpdates(raw["updates"])
  const lines: string[] = []
  /** Whether something the lines say waits on the owner's decision: a newer Naima, an unfinished update, a due run, an urgent message. */
  let waits = false
  const now = opts.tick?.clock ?? (() => new Date())
  const dir = ticks(opts) ? tickDir(place.root) : null
  /** The day's update check, done here: recorded, so the tick does not ask the source again today. */
  const recorded = (outcome: JobOutcome): void => {
    try {
      if (dir) record(UPDATE_CHECK, dir, now(), outcome)
    } catch {
      // the tick's state cannot be written here: the next command's tick checks again
    }
  }
  // An update an older launcher started, and could not finish: what the next naima update writes.
  try {
    const unfinished = unfinishedUpdate(place.root, place.data, lock.commit, parseConfig(raw, { lenient: true }))
    if (unfinished) {
      waits = true
      lines.push(`${unfinished.charAt(0).toUpperCase()}${unfinished.slice(1)}.`)
    }
  } catch {
    // a naima.json this Naima cannot read: the next command says why
  }
  if (policy === "off") lines.push(`Updates are not checked (${DATA_FILE}: "updates": "off"); naima update --check checks on request.`)
  else {
    const t = targetOf(place, lock, opts)
    try {
      // Launched, the program may fetch into its own clone, tags too; the development build only reads the source.
      const head = opts.launched ? fetchHead(t) : remoteHead(t)
      recorded(checked(lock, head.commit))
      if (head.movedTo) lines.push(`${sourceMoved(lock.source, head.movedTo)}.`)
      if (head.commit === lock.commit) lines.push(`Naima is current: the source's ${head.branch} is the locked commit.`)
      else {
        const count = runGit(t.program, ["rev-list", "--count", `${lock.commit}..${head.commit}`])
        waits = true
        const n = count.ok ? Number(count.out) : null
        const commits = n === null ? "" : `, ${counted(n, "commit")}`
        lines.push(`A newer Naima is available: ${short(lock.commit)} → ${short(head.commit)}${commits}.`)
        if (policy === "check" || !opts.launched) lines.push("naima update --check says what it changes; updating waits for the owner's yes.")
        else {
          lines.push(...await said(opts, place, t, raw, head.commit))
          lines.push("Ask the owner before naima update: it moves the lock and migrates the data, as one change to commit.")
        }
      }
    } catch (e) {
      recorded({ ok: false, error: message(e) })
      lines.push(`Could not check for a newer Naima: ${message(e)}.`)
    }
  }
  // What waits on the owner's decision, such as a long run that is due: said, never started. A project that does not
  // open says why on its next command; the greeting goes on without these lines. Then the tick: what it shows here is
  // said by the lines above, except the urgent messages, said after them.
  // Where the project is going comes first: the goals the plugins say (the next milestone and release, with what
  // stops them). Then what waits on the owner, or that nothing does.
  const decisions: string[] = []
  const offers: string[] = []
  try {
    const ctx = await openProject(place, opts, { ...io, err: () => {} })
    try {
      lines.push(...await goalsAtSessionStart(ctx))
    } catch {
      // a goal that cannot be evaluated here: naima gates says why
    }
    decisions.push(...await atSessionStart(ctx))
    try {
      offers.push(...await offersAtSessionStart(ctx))
    } catch {
      // an offer that cannot be rendered here is left out
    }
    const { shown } = await endTick(beginTick(opts, place, ctx))
    for (const n of shown) if (n.level === "urgent") decisions.push(`URGENT: ${n.text}${n.ack ? ` Only the owner acknowledges it: ${n.ack}.` : ""}`)
  } catch {
    // nothing to add
  }
  lines.push(...decisions)
  if (!waits && !decisions.length) lines.push(NOTHING_WAITS)
  // The banner first, read after the check: a fetch brings the tags that name the version.
  const all = [
    me
      ? banner(versionOf(me.repo, me.commit), me.commit)
      : `${INTRODUCTION}, active in this repository: a development build, its lock commit ${short(lock.commit)}.`,
    ...lines,
    RULES_FIRST,
    ...offers,
    OFFERS,
    BASICS_OFFER,
  ]
  if (tool?.greeting) io.out(tool.greeting(all.join("\n"), greetingContext(all.join("\n"))))
  else for (const line of all) io.out(line)
  return 0
}

type PluginTable = Record<string, Record<string, unknown>>

/** Every plugin this project could be asked about: "core", every first-party (loaded or opt-in), and every third-party name the table already adds with its own `source`. */
function knownPlugins(opts: CliOptions, raw: Record<string, unknown>): { firstPartyNames: string[]; thirdPartyNames: string[] } {
  const firstPartyNames = opts.firstParty.map((p) => p.name)
  const table = (raw["plugins"] as PluginTable | undefined) ?? {}
  return { firstPartyNames, thirdPartyNames: Object.keys(table).filter((n) => n !== "core" && !firstPartyNames.includes(n)) }
}

/** Why `name` cannot be configured here, or null: it must be "core", a first-party plugin, or a third-party one the table already names — adding a third-party plugin's `source` is not this command's. */
function pluginRefusal(name: string, opts: CliOptions, raw: Record<string, unknown>): string | null {
  if (name === "core") return null
  const { firstPartyNames, thirdPartyNames } = knownPlugins(opts, raw)
  if (firstPartyNames.includes(name) || thirdPartyNames.includes(name)) return null
  return `no plugin named "${name}" — first-party: ${firstPartyNames.join(", ")}${
    thirdPartyNames.length ? `; this project's own: ${thirdPartyNames.join(", ")}` : ""
  } — a third-party plugin is added by naming its code in plugins.${name}.source, not by naima plugin`
}

/** A first-party plugin's manifest, made with no options: only to read its static declarations (`says`, `options`), never run with the project's own, which might not (yet) be valid. Null for a third-party plugin, not instantiated here. */
function firstPartyManifest(name: string, opts: CliOptions): Plugin | null {
  const fp = opts.firstParty.find((p) => p.name === name)
  return fp ? fp.factory({}, apiFor(name, { rename: {} })) : null
}

/** The option names `name` declares, or null when they cannot be known here (a third-party plugin). */
function declaredOptions(name: string, opts: CliOptions): string[] | null {
  const manifest = firstPartyManifest(name, opts)
  return manifest ? (manifest.options ?? []).map((o) => o.name) : null
}

const pluginEntry = (raw: Record<string, unknown>, name: string): Record<string, unknown> => ({
  ...(((raw["plugins"] as PluginTable | undefined) ?? {})[name] ?? {}),
})

/**
 * `raw` with `name`'s entry replaced by `entry` — or removed when `entry` is
 * now empty and its mere presence is not what loads the plugin (`keepPresence`,
 * true for an opt-in first-party plugin: `optIn && !entry` is how it stays off).
 */
function withPluginEntry(raw: Record<string, unknown>, name: string, entry: Record<string, unknown>, keepPresence: boolean): Record<string, unknown> {
  const table = { ...((raw["plugins"] as PluginTable | undefined) ?? {}) }
  if (Object.keys(entry).length === 0 && !keepPresence) delete table[name]
  else table[name] = entry
  const { plugins: _was, ...rest } = raw
  return Object.keys(table).length ? { ...rest, plugins: table } : rest
}

const isOptIn = (name: string, opts: CliOptions): boolean => opts.firstParty.find((p) => p.name === name)?.optIn === true

const CORE_ENABLED_REFUSAL = "core is always loaded, and cannot be switched off or replaced — only its checks can be weighed: plugins.core.checks"
const CORE_OPTIONS_REFUSAL = "core takes no options — only its checks can be weighed: plugins.core.checks"

function statusOf(name: string, opts: CliOptions, raw: Record<string, unknown>): string {
  if (name === "core") return "always loaded"
  const entry = ((raw["plugins"] as PluginTable | undefined) ?? {})[name]
  if (isOptIn(name, opts) && !entry) return "off (opt-in)"
  return entry?.["enabled"] === false ? "off" : "on"
}

function showAllPlugins(opts: CliOptions, raw: Record<string, unknown>, io: IO): number {
  const { thirdPartyNames } = knownPlugins(opts, raw)
  io.out(`${"core".padEnd(16)} ${statusOf("core", opts, raw)}`)
  for (const { name } of opts.firstParty) io.out(`${name.padEnd(16)} ${statusOf(name, opts, raw)}`)
  for (const name of thirdPartyNames) io.out(`${name.padEnd(16)} ${statusOf(name, opts, raw)} (third-party)`)
  return 0
}

function showOnePlugin(name: string, opts: CliOptions, raw: Record<string, unknown>, io: IO): number {
  const refusal = pluginRefusal(name, opts, raw)
  if (refusal) throw new Error(refusal)
  const entry = ((raw["plugins"] as PluginTable | undefined) ?? {})[name]
  io.out(`${name}: ${statusOf(name, opts, raw)}`)
  if (name === "core") return 0
  if (entry?.["source"] !== undefined) io.out(`  source: ${JSON.stringify(entry["source"])}`)
  if (entry?.["replacedBy"] !== undefined) io.out(`  replacedBy: ${JSON.stringify(entry["replacedBy"])}`)
  const manifest = firstPartyManifest(name, opts)
  const options = (entry?.["options"] as Record<string, unknown> | undefined) ?? {}
  if (manifest?.options?.length) {
    io.out("  options:")
    for (const o of manifest.options) {
      const held = options[o.name]
      const said = held !== undefined ? `= ${JSON.stringify(held)}` : o.default !== undefined ? `(default ${o.default})` : "(unset)"
      io.out(`    ${o.name} ${said} — ${o.says}`)
    }
  } else if (Object.keys(options).length) {
    io.out(`  options: ${JSON.stringify(options)}`)
  }
  if (entry?.["checks"] && Object.keys(entry["checks"] as object).length) io.out(`  checks: ${JSON.stringify(entry["checks"])}`)
  return 0
}

function pluginCommand(args: string[], opts: CliOptions, place: Place, raw: Record<string, unknown>, io: IO): number {
  // Taken as every write takes them: a value is text that goes into the repository, checked for private names.
  const { reason, rest: unsigned } = allowPrivateOption(args)
  const [sub, name, ...rest] = parse(revisedOption(unsigned).rest).positionals
  if (sub === "show") {
    if (rest.length) throw new Error(usage("plugin"))
    return name ? showOnePlugin(name, opts, raw, io) : showAllPlugins(opts, raw, io)
  }
  if (sub !== "enable" && sub !== "disable" && sub !== "set") throw new Error(usage("plugin"))
  if (!name?.trim()) throw new Error(usage("plugin"))
  if (sub === "enable" || sub === "disable") {
    if (rest.length) throw new Error(usage("plugin"))
    if (name === "core") throw new Error(CORE_ENABLED_REFUSAL)
    const refusal = pluginRefusal(name, opts, raw)
    if (refusal) throw new Error(refusal)
    const entry = pluginEntry(raw, name)
    if (sub === "enable") delete entry["enabled"]
    else entry["enabled"] = false
    writeValidatedRaw(place.data, withPluginEntry(raw, name, entry, isOptIn(name, opts)))
    io.out(`${name}: ${sub === "enable" ? "enabled" : "disabled"}`)
    return 0
  }
  // sub === "set"
  if (!rest.length) throw new Error(usage("plugin"))
  if (name === "core") throw new Error(CORE_OPTIONS_REFUSAL)
  const refusal = pluginRefusal(name, opts, raw)
  if (refusal) throw new Error(refusal)
  const assigns = pairs(rest)
  guardPrivate(`the options of ${name}`, findPrivate(assigns.map(([, v]) => v).join("\n"), privateContext()), reason)
  const known = declaredOptions(name, opts)
  for (const [key, value] of assigns) {
    // Removing one is allowed: an option no plugin reads is what naima check notes, to be removed.
    if (known && !known.includes(key) && value !== "") {
      throw new Error(`plugins.${name} declares no option "${key}" — its options: ${known.join(", ") || "none"}`)
    }
  }
  const entry = pluginEntry(raw, name)
  const options = { ...((entry["options"] as Record<string, unknown> | undefined) ?? {}) }
  for (const [key, value] of assigns) {
    if (value === "") delete options[key]
    else {
      let parsed: unknown = value
      try {
        parsed = JSON.parse(value)
      } catch {
        // not JSON: kept as the plain string it was typed as
      }
      options[key] = parsed
    }
  }
  if (Object.keys(options).length) entry["options"] = options
  else delete entry["options"]
  writeValidatedRaw(place.data, withPluginEntry(raw, name, entry, isOptIn(name, opts)))
  io.out(`${name}: ${rest.join(" ")}`)
  return 0
}

/** What `naima guide` points at, from the program root: all of it is in the product, so in every clone. */
export const GUIDE_PAGES: readonly (readonly [string, string])[] = [
  ["skill", "skills/naima/SKILL.md"],
  ["index", "docs/README.md"],
  ["guide", "docs/guide/README.md"],
  ["rulebook", "docs/guide/rules.md"],
  ["agents", "docs/agents/README.md"],
  ["format", "docs/reference/format.md"],
  ["install", "docs/guide/install.md"],
  ["basics", "docs/guide/the-basics.md"],
]

/** The guide sections the project's plugins contribute, as lines; none outside a project, and none when it does not open (`naima check` says why). */
async function guideSections(opts: CliOptions, data: string, io: IO): Promise<string[]> {
  let ctx: Context
  try {
    const place = locate(data)
    if (!place) return []
    ctx = await openProject(place, opts, io)
  } catch (e) {
    io.err(`naima: the project's guide sections are not shown: ${message(e)} — naima check`)
    return []
  }
  const out: string[] = []
  for (const c of ctx.registry.contributions("guide")) {
    const lines = linesAs(asRendered(await (c.value as GuideSection).render(ctx), `guide section "${c.name}"`), "text")
    if (lines.length) out.push(...lines, "")
  }
  return out
}

async function guide(opts: CliOptions, data: string, io: IO): Promise<number> {
  for (const line of await guideSections(opts, data, io)) io.out(line)
  const at = (path: string): string => relative(opts.cwd, join(opts.programRoot, path)) || "."
  const commit = running(opts.programRoot)?.commit
  io.out(`Naima ${commit ? commit.slice(0, 12) : "(development build)"}, data format ${FORMAT}, at ${at("")}`)
  io.out("Read these as files; they are the documentation of the Naima that runs:")
  for (const [name, path] of GUIDE_PAGES) io.out(`  ${name.padEnd(8)} ${at(path)}`)
  return 0
}

function help(ctx: Context | null, data: string, io: IO): number {
  io.out(`usage: naima [--data <dir>] <command> [args] [${ALLOW_PRIVATE} "<reason>"] [${REVISED} <checklist>]\n`)
  const entry = cliCommands.filter((c) => c.name !== "help")
  for (const c of entry) io.out(`  ${c.name.padEnd(10)} ${c.says}\n  ${"".padEnd(10)} naima ${c.usage}`)
  if (!ctx) {
    io.out(`\nno ${DATA_FILE} in ${data} — run naima init, or name the data with --data <dir>`)
    return 0
  }
  for (const c of ctx.registry.contributions("commands")) {
    const cmd = c.value as Command
    if (cmd.hidden) continue
    const name = shortOrId(ctx, "commands", c)
    io.out(`  ${name.padEnd(10)} ${cmd.says}\n  ${"".padEnd(10)} naima ${name === c.name ? cmd.usage : cmd.usage.replace(c.name, name)}`)
  }
  return 0
}

const isHelp = (command: string | undefined): boolean => !command || command === "help" || command === "--help" || command === "-h"

/** `naima <command> --help`: the command's usage, what it does, its options and examples -- what the reference says of it. */
function commandHelp(cmd: Command, io: IO): number {
  io.out(`usage: naima ${cmd.usage}`)
  io.out(cmd.says)
  if (cmd.options?.length) {
    io.out("options:")
    const width = Math.max(...cmd.options.map((o) => o.name.length))
    for (const o of cmd.options) io.out(`  ${o.name.padEnd(width)}  ${o.says}${o.default !== undefined ? ` (default: ${o.default})` : ""}`)
  }
  if (cmd.examples?.length) {
    io.out("examples:")
    for (const e of cmd.examples) io.out(`  naima ${e}`)
  }
  return 0
}

export async function runCli(argv: string[], opts: CliOptions): Promise<number> {
  const io = opts.io ?? consoleIO
  setWriteGuard(null)
  setVisibilityProbe(opts.visibility ?? null)
  try {
    const { data: flag, rest } = globalOptions(argv)
    const [command, ...args] = rest
    // Launched, NAIMA_DATA is the data the launcher found from the same flag, resolved as Deno grants it.
    const given = opts.launched && opts.data ? opts.data : flag ?? opts.data
    const data = findData(opts.cwd, real(opts.programRoot), given)
    if (command === "init") {
      const known = [
        "--write-excludes",
        "--write-agent-pointer",
        "--no-session-hook",
        "--private-url",
        "--private-tracker",
        "--tracker-inside",
        "--remote-private",
      ]
      const at = args.indexOf("--tracker")
      const rest = at === -1 ? args : args.filter((_, i) => i !== at && i !== at + 1)
      if ((at !== -1 && !args[at + 1]) || rest.some((a) => !known.includes(a))) throw new Error(usage("init"))
      return await init(args, opts, data, io)
    }
    if (command === "guide") return await guide(opts, data, io)
    let place = locate(data)
    // The first run of a clone with no data beside it makes it, as init does: a plain git clone is an install.
    if (!place && !given && running(opts.programRoot)) {
      io.err(`naima: ${createData(data, opts).said}`)
      place = locate(data)
    }
    if (!place) {
      if (isHelp(command)) return help(null, data, io)
      const folder = trackerOf(data)
      const top = readSiblingMarker(folder) ? toplevel(existing(folder)) : null
      if (top) throw new Error(missingTracker(nativePath(top), folder))
      throw new Error(`no ${DATA_FILE} in ${data} — run naima init, or name the data with --data <dir>`)
    }
    if (opts.launched) {
      const carried = carryRefusal(place.raw, posixRelative(place.root, place.program))
      if (carried) throw new Error(carried)
      const acceptSource = command === "update" && args.includes("--accept-source")
      let moved = null
      try {
        moved = align({ ...targetOf(place, place.lock, opts), acceptSource })
      } catch (e) {
        // update --check only reads the source: it answers whatever program runs it.
        const readOnly = command === "update" && args.includes("--check")
        // A locked commit that cannot be had, or of the old layout, is what update moves past: whatever program runs it moves the lock to main.
        const moving = command === "update" && !acceptSource
        const code = e instanceof NaimaError ? e.code : null
        if (!((readOnly && code === SOURCE_CHANGED) || (moving && (code === COMMIT_UNAVAILABLE || code === OLD_LAYOUT)))) throw e
      }
      for (const line of moved?.repaired ?? []) io.err(`naima: ${line}`)
      if (moved?.from && moved.from !== place.lock.commit) io.err(`naima: locked commit moved ${short(moved.from)} → ${short(place.lock.commit)}`)
      const target = runtimeOf(place.program)
      if (moved || (target && real(opts.programRoot) !== real(target))) return RELAUNCH
      // A fresh clone has the project's git hooks, committed, and not core.hooksPath, which git keeps per clone.
      if (naimaHooks(place.data).length) { for (const line of pointHooksPath(place.root, place.data, { quietWhenSet: true })) io.err(`naima: ${line}`) }
    }
    // The commands the entry point runs itself answer --help as every other command does.
    const own = cliCommands.find((c) => c.name === command)
    if (own && (args.includes("--help") || args.includes("-h"))) return commandHelp(own as Command, io)
    if (command === "update") {
      if (!opts.launched) throw new Error(`naima update moves the program, so it runs through the launcher: deno run -A <the program>/naima.ts update`)
      return await update(args, opts, place, place.lock, place.raw, io)
    }
    if (command === "rollback") {
      if (!opts.launched) throw new Error(`naima rollback moves the program, so it runs through the launcher: deno run -A <the program>/naima.ts rollback`)
      return await rollback(args, opts, place, place.lock, place.raw, io)
    }
    if (command === "hello") return await hello(args, opts, place, io)
    if (command === "tick") return await tickCommand(args, opts, place, io)
    if (command === "plugin") return pluginCommand(args, opts, place, place.raw, io)
    const ctx = await openProject(place, opts, io)
    if (isHelp(command)) return help(ctx, data, io)
    if (ctx.sibling) {
      // Work on code branch X writes to tracker branch X: paired before any command reads or writes the tracker.
      try {
        const moved = pairTracker(ctx.root, ctx.trackerGit, gitOrNull(ctx.root, "rev-parse", "--abbrev-ref", "HEAD") ?? "HEAD")
        if (moved) {
          io.err(`naima: ${moved}`)
          ctx.reload()
        }
      } catch (e) {
        io.err(`naima: ${message(e)}`)
      }
    }
    const { reason, rest: unsigned } = allowPrivateOption(args)
    if (reason !== undefined) ctx.allowPrivate = reason
    const { path: revised, rest: commandArgs } = revisedOption(unsigned)
    if (revised !== undefined) ctx.revised = resolve(opts.cwd, revised)
    const cmd = ctx.registry.find<Command>("commands", command as string)?.value
    if (!cmd) throw new Error(`unknown command "${command}" — naima help`)
    if (args.includes("--help") || args.includes("-h")) return commandHelp(cmd, io)
    if (cmd.hook) {
      // Run by a git hook, inside a commit or a ref update: it only reads, and waits for nothing beside it.
      setWriteGuard(() => {
        throw new Error(`naima ${command} runs from a git hook and writes nothing`)
      })
      return await cmd.run(commandArgs, ctx)
    }
    // The tracker's privacy, an invariant: every write through the core's helpers is refused while it is exposed.
    const exposure = await trackerExposure(ctx)
    if (exposure.state === "private" && wasExposed(ctx.trackerGit)) {
      io.err(`naima: the tracker was exposed and is private now: ${fileSweepTodo(ctx)}`)
      clearExposed(ctx.trackerGit)
    }
    setWriteGuard(writeGuard(ctx.trackerRoot, exposure, io.err))
    // The tick: what is due starts now, beside the command, and what it has for the owner is said after it, on standard error.
    const tick = beginTick(opts, place, ctx)
    let code: number
    try {
      code = await cmd.run(commandArgs, ctx)
    } finally {
      for (const n of (await endTick(tick)).shown) io.err(messageLine(n))
    }
    if (code !== RELAUNCH) return code
    // Only the entry point asks for a relaunch; a command's 75 would make the launcher run it again.
    io.err(`naima: ${command} exited ${RELAUNCH}, the code reserved for asking the launcher to relaunch — reported as ${EXIT.FAILED}`)
    return EXIT.FAILED
  } catch (e) {
    if (!isInternal(e)) {
      io.err(`naima: ${message(e)}`)
      return EXIT.USAGE
    }
    const name = e instanceof Error ? `${e.name}: ` : ""
    io.err(`naima: internal error: ${name}${message(e)} — a bug in Naima or a plugin; NAIMA_DEBUG=1 prints where`)
    if (opts.debug && e instanceof Error && e.stack) io.err(e.stack)
    return EXIT.INTERNAL
  } finally {
    setWriteGuard(null)
    setVisibilityProbe(null)
  }
}
