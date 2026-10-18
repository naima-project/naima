// The one entry point: find the data, align the program when the launcher
// runs it, load every plugin, dispatch. The commands that set up and move the
// program itself — init, update, rollback, hello, plugin, guide, help — are answered here,
// before any plugin is loaded.

import { existsSync, mkdirSync, writeFileSync } from "node:fs"
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
import { gitOrNull, nativePath, runGit, toplevel } from "./git.ts"
import { exclusions } from "./excludes.ts"
import { ALLOW_PRIVATE, allowPrivateOption } from "./private.ts"
import { DATA_DIR, DATA_FILE, findData, globalOptions, PROGRAM_DIR, real, RELAUNCH, runtimeOf, trackerOf, trackerReadme } from "./layout.ts"
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
  type Target,
  verifySigned,
  withoutCredentials,
} from "./program.ts"
import {
  backwardFormats,
  banner,
  changeOf,
  checkFrom,
  counted,
  describe,
  type Findings,
  FOLLOW_UP,
  newly,
  OFFERS,
  pageRules,
  rehearse,
  versionOf,
  withCommit,
} from "./updates.ts"
import { changedRules, notesBetween } from "./changes.ts"
import { createItem, saveProse } from "./item.ts"
import { isOpen } from "./lifecycle.ts"
import { EXIT, isInternal, message, NaimaError } from "./errors.ts"
import type { Command, Context, GuideSection, Plugin } from "./types.ts"
import { asRendered, linesAs } from "./rendered.ts"
import { shortOrId } from "./names.ts"
import { apiFor } from "./plugins.ts"
import { type SessionConfig, startSessions } from "./session-start.ts"

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
  return { root: toplevel(data) ?? dirname(dirname(data)), data, program: programDir(data, lock), lock, raw }
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

/** The command init names as the next step: a type the loaded plugins really let one create. */
async function nextStep(place: Place, opts: CliOptions, io: IO): Promise<string> {
  try {
    const ctx = await openProject(place, opts, io)
    const type = [...ctx.registry.types.values()].find((t) => t.creatable !== false)
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
    else if (x.write()) io.out(`wrote ${x.file}: ${x.line}`)
    else io.out(`not written, it is not plain JSON — add by hand to ${x.file}: ${x.line}`)
  }
}

/** Write what makes an agent run naima hello at every session start — the pointer line, and with `hooks` each tool's hook — and say it. */
function startAgents(root: string, tracker: string, config: SessionConfig, hooks: boolean, io: IO): string[] {
  const done = startSessions(root, tracker, config, { hooks })
  for (const line of done.said) io.out(line)
  return done.wrote
}

/** The installer's refusal outside a git repository, said by init and by a first run alike. */
const OUTSIDE = (where: string): string =>
  `${where} is not in a git repository. Is its folder the root of your project? If so, ask your agent to create a repository there and install Naima from https://vincenzoml.github.io/naima/`

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
  return { root, tracker, program, said: `wrote ${parent}/: README.md, .gitignore, ${DATA_DIR}/${DATA_FILE} — locked to ${source} at ${short(me.commit)}` }
}

async function init(args: string[], opts: CliOptions, data: string, io: IO): Promise<number> {
  // --write-agent-pointer is accepted and changes nothing: the pointer is always written.
  const p = parse(args, { "write-excludes": { type: "boolean" }, "write-agent-pointer": { type: "boolean" }, "no-session-hook": { type: "boolean" } })
  const write = bool(p, "write-excludes")
  const hooks = !bool(p, "no-session-hook")
  const found = locate(data)
  if (found) {
    io.out(`${posixRelative(found.root, join(found.data, DATA_FILE))} already exists — left as it is`)
    const config = parseConfig(found.raw, { lenient: true })
    excludeHost(found.root, found.program, write, io)
    startAgents(found.root, trackerOf(found.data), config, hooks, io)
    io.out(await nextStep(found, opts, io))
    return 0
  }
  const made = createData(resolve(data), opts)
  const place: Place = { root: made.root, data: real(data), program: made.program }
  // Launched from a Naima elsewhere, init clones the program beside the data; run directly, as a test, the first launched run does.
  const cloned = opts.launched && real(opts.programRoot) !== real(made.program)
    ? (align({ ...targetOf(place, parseLock(readRaw(place.data)), opts) }), `, and cloned ${PROGRAM_DIR}/`)
    : ""
  io.out(made.said + cloned)
  excludeHost(made.root, made.program, write, io)
  startAgents(made.root, made.tracker, parseConfig(readRaw(place.data)), hooks, io)
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
function committedLock(place: Place): string | null {
  const r = runGit(place.root, ["show", `HEAD:${posixRelative(place.root, join(place.data, DATA_FILE))}`])
  if (!r.ok) return null
  try {
    const commit = (JSON.parse(r.out) as { commit?: unknown }).commit
    return typeof commit === "string" ? commit : null
  } catch {
    return null
  }
}

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
async function fileLeft(opts: CliOptions, place: Place, io: IO, commit: string, findings: readonly string[]): Promise<void> {
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
 * locked commit of the project's last commit, whose own check runs from a temporary copy.
 */
async function finish(opts: CliOptions, place: Place, lock: Lock, io: IO): Promise<void> {
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
    await fileLeft(opts, place, io, lock.commit, [...left.problems, ...left.notes])
  }
  io.out(`naima check: ${counted(now.problems.length, "problem")}, ${counted(now.notes.length, "note")}${now.problems.length ? ":" : ""}`)
  for (const p of now.problems) io.out(`  ✗ ${p}`)
}

/** The commit `naima.json` named before the current lock, in its git history (the uncommitted file first), and the commit that recorded the current one. */
function previousLock(place: Place, current: string): string {
  const rel = posixRelative(place.root, join(place.data, DATA_FILE))
  const log = runGit(place.root, ["log", "--format=%H", "--", rel])
  for (const c of log.ok ? log.out.split("\n").filter((l) => l) : []) {
    const text = runGit(place.root, ["show", `${c}:${rel}`])
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
  const rel = posixRelative(place.root, join(place.data, DATA_FILE))
  const formats = (o: Record<string, unknown>) => JSON.stringify([o["format"], o["formats"] ?? {}])
  const now = formats(raw)
  const log = runGit(place.root, ["log", "--format=%H", "--", rel])
  let last: string | null = null
  for (const c of log.ok ? log.out.split("\n").filter((l) => l) : []) {
    let then: Record<string, unknown>
    try {
      then = JSON.parse(runGit(place.root, ["show", `${c}:${rel}`]).out) as Record<string, unknown>
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
    if ("updates" in next && change.configWithoutUpdates === null) {
      const { updates: _dropped, ...without } = next
      next = without
      notes.push(`${short(to)} does not know the option updates: removed from ${DATA_FILE}; it is set again after an update to a Naima that knows it`)
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
  io.out(`${short(to)} is the lock — commit it as one change: git add ${tracker} && git commit -m "${verb} ${short(to)}"`)
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
    // The entry point has aligned the program to the new source already: accepting it is all this asks.
    io.out(`trusted ${lock.source} at the locked commit ${short(lock.commit)}; nothing else moved`)
    return 0
  }
  const tracker = posixRelative(place.root, trackerOf(place.data))
  if (mode !== undefined) {
    const policy = parseUpdates(mode)
    writeValidatedRaw(place.data, { ...raw, updates: policy })
    io.out(`updates: ${policy} — ${POLICY_SAYS[policy]}; commit it: git add ${tracker} && git commit -m "Naima updates: ${policy}"`)
    return 0
  }
  const t = targetOf(place, lock, opts)
  if (check) {
    const head = remoteHead(t)
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
  const target = to !== undefined ? resolveCommit(t, to) : fetchHead(t).commit
  if (target !== lock.commit) return await moveLock(opts, place, lock, raw, io, target)
  const from = raw["format"]
  const { all } = await owed(raw, place, opts)
  const steps = migrate(place.data, MIGRATIONS, all.slice(1))
  for (const line of migrated(steps, from, all.slice(1))) io.out(line)
  // A mechanical fix, said: what makes agents run naima hello at every session start, where it is missing.
  const wrote = startAgents(place.root, trackerOf(place.data), parseConfig(readRaw(place.data), { lenient: true }), true, io)
  await finish(opts, place, lock, io)
  io.out(`${short(target)} is the lock — commit it as one change: git add ${[tracker, ...wrote].join(" ")} && git commit -m "Update Naima to ${short(target)}"`)
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

/**
 * `naima hello`: the banner, what the update policy finds, and the offers — what an agent says first in a
 * session. Reads the source only as `updates` says; never moves the lock, never writes the project.
 */
async function hello(opts: CliOptions, place: Place, lock: Lock, raw: Record<string, unknown>, io: IO): Promise<number> {
  const me = running(opts.programRoot)
  const policy = parseUpdates(raw["updates"])
  const lines: string[] = []
  if (policy === "off") lines.push(`Updates are not checked (${DATA_FILE}: "updates": "off"); naima update --check checks on request.`)
  else {
    const t = targetOf(place, lock, opts)
    try {
      // Launched, the program may fetch into its own clone, tags too; the development build only reads the source.
      const head = opts.launched ? fetchHead(t) : remoteHead(t)
      if (head.commit === lock.commit) lines.push(`Naima is current: the source's ${head.branch} is the locked commit.`)
      else {
        const count = runGit(t.program, ["rev-list", "--count", `${lock.commit}..${head.commit}`])
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
      lines.push(`Could not check for a newer Naima: ${message(e)}.`)
    }
  }
  // The banner first, read after the check: a fetch brings the tags that name the version.
  io.out(
    me ? banner(versionOf(me.repo, me.commit), me.commit) : `Naima is active in this repository: a development build, its lock commit ${short(lock.commit)}.`,
  )
  for (const line of lines) io.out(line)
  io.out(OFFERS)
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
  const [sub, name, ...rest] = parse(args).positionals
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
  io.out(`usage: naima [--data <dir>] <command> [args] [${ALLOW_PRIVATE} "<reason>"]\n`)
  const entry = cliCommands.filter((c) => c.name !== "help")
  for (const c of entry) io.out(`  ${c.name.padEnd(10)} ${c.says}\n  ${"".padEnd(10)} naima ${c.usage}`)
  if (!ctx) {
    io.out(`\nno ${DATA_FILE} in ${data} — run naima init, or name the data with --data <dir>`)
    return 0
  }
  for (const c of ctx.registry.contributions("commands")) {
    const cmd = c.value as Command
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
  try {
    const { data: flag, rest } = globalOptions(argv)
    const [command, ...args] = rest
    // Launched, NAIMA_DATA is the data the launcher found from the same flag, resolved as Deno grants it.
    const given = opts.launched && opts.data ? opts.data : flag ?? opts.data
    const data = findData(opts.cwd, real(opts.programRoot), given)
    if (command === "init") {
      if (args.some((a) => !["--write-excludes", "--write-agent-pointer", "--no-session-hook"].includes(a))) throw new Error(usage("init"))
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
    }
    if (command === "update") {
      if (!opts.launched) throw new Error(`naima update moves the program, so it runs through the launcher: deno run -A <the program>/naima.ts update`)
      return await update(args, opts, place, place.lock, place.raw, io)
    }
    if (command === "rollback") {
      if (!opts.launched) throw new Error(`naima rollback moves the program, so it runs through the launcher: deno run -A <the program>/naima.ts rollback`)
      return await rollback(args, opts, place, place.lock, place.raw, io)
    }
    if (command === "hello") return await hello(opts, place, place.lock, place.raw, io)
    if (command === "plugin") return pluginCommand(args, opts, place, place.raw, io)
    const ctx = await openProject(place, opts, io)
    if (isHelp(command)) return help(ctx, data, io)
    const { reason, rest: commandArgs } = allowPrivateOption(args)
    if (reason !== undefined) ctx.allowPrivate = reason
    const cmd = ctx.registry.find<Command>("commands", command as string)?.value
    if (!cmd) throw new Error(`unknown command "${command}" — naima help`)
    if (args.includes("--help") || args.includes("-h")) return commandHelp(cmd, io)
    const code = await cmd.run(commandArgs, ctx)
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
  }
}
