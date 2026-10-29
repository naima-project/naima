// The trunk guard: a git reference-transaction hook (git 2.28 or later) that
// refuses a commit, merge or fast-forward of the trunk made by hand. Work goes
// through an item: `naima open` makes its worktree and branch, and `naima land`
// puts it on the trunk as a marker. The hook is cheap for every other ref: it
// is a shell script that exits at once unless the trunk moves, and only then
// starts Naima, `naima guard-check <old> <new>`, which says whether every
// commit the move adds to the trunk's first-parent line is one the trunk takes
// directly: a landing marker, the record land makes after it, a commit that
// only adds to the tracker data (claims, which are coordination state, may also
// be rewritten or removed) or only closes items, naima init's commit, or one
// that only switches the guard. A command that tells the user to commit on the
// branch checked out says so through commitOn, and only for a write this rule
// takes on the trunk. A new tip the upstream already holds
// passes, so a pull of what landed elsewhere works; a rewind passes, and so
// does a ref created or deleted. The owner lets a commit through once with a
// `Trunk-reason:` trailer, which landings-are-markers then notes with its reason.
//
// In sibling mode the tracker's own repository runs the same hook, and its
// trunk is guarded too: it takes the commits Naima makes there itself, each with
// a `Naima-Command:` trailer, which the hook tells by itself without starting
// Naima, landing markers, and a commit with a `Trunk-reason:` trailer; anything
// else starts `naima guard-check --tracker`, which says why not.
//
// The hook is a file of the data directory's hooks, committed, which
// core.hooksPath names in every clone (core/repos.ts points it there where it is
// unset). `naima guard off` removes it and records the choice in naima.json;
// `naima guard on` puts it back.

import { existsSync, readFileSync, rmSync } from "node:fs"
import { isAbsolute, join, relative } from "node:path"
import { isDeepStrictEqual } from "node:util"
import {
  bool,
  CLI_TRAILER,
  type Command,
  type Context,
  DATA_FILE,
  gitOrNull,
  gitPath,
  HOOKS_DIR,
  isAncestor,
  parse,
  posixRelative,
  rendered,
  runGit,
  type Setup,
  type SummarySection,
  TRACKER_DIR,
  TRACKER_TRAILER,
  trunk,
  usageError,
  writeDelegates,
  writeGitHook,
  writeJson,
} from "../../core/api.ts"
import { guardServer, serverHintOf } from "./server.ts"
import { CLOSES, initsTracker, MEETS, onlyAddsTrackerData, onlyClosesItems, recordsMarker, TRACKER_ONLY, TRUNK_REASON } from "./land.ts"

export { TRUNK_REASON }

/** The git hook the guard is: run for every ref update, in the states prepared, committed and aborted. */
export const GUARD_HOOK = "reference-transaction"
/** The coordination option that turns the guard off for the project. */
export const GUARD_OPTION = "trunkGuard"
/** The plugin's key in naima.json's plugins table, where `guard off` records the choice. */
const PLUGIN_KEY = "coordination"
const MARK = "# Written by Naima's trunk guard"
const ZERO = /^0+$/

/** The coordination option `trunkGuard`: false turns the guard off. */
export function readTrunkGuard(options: Record<string, unknown>): boolean {
  const v = options[GUARD_OPTION] ?? true
  if (typeof v !== "boolean") {
    throw new Error(`coordination: option ${GUARD_OPTION} must be true or false, whether the trunk is guarded; got ${JSON.stringify(v)}`)
  }
  return v
}

/** The trunk the hook guards: the plugin's trunk (origin's HEAD, else main, else master), else the branch HEAD names, else main. */
export const guardedTrunk = (root: string): string => trunk(root) ?? gitOrNull(root, "symbolic-ref", "--quiet", "--short", "HEAD") ?? "main"

const quote = (s: string): string => `'${s.replace(/'/g, `'\\''`)}'`

/** A path from the root when it is inside the project, else absolute: what the hook names. */
const fromRoot = (ctx: Context, abs: string): string => {
  const rel = relative(ctx.root, abs)
  return rel && !rel.startsWith("..") && !isAbsolute(rel) ? gitPath(rel) : gitPath(abs)
}

/** The launcher of the program the project runs, from the root: what the hook starts, so the program's permissions apply. */
export function guardLauncher(ctx: Context): string {
  const launcher = [join(ctx.program, "naima.ts"), join(ctx.program, "naima", "naima.ts")].find(existsSync) ?? join(ctx.program, "naima.ts")
  return fromRoot(ctx, launcher)
}

/** The tracker's side of the guard in sibling mode: its trunk's name, and the code root from the data directory. */
export interface TrackerSide {
  trunk: string
  back: string
}

/**
 * The hook: shell that reads the ref updates, runs the clone's own hook of the same name first, and for an update
 * of `refs/heads/<trunkName>` in the prepared state only, starts `command guard-check <old> <new>`. `command` is
 * Deno on the launcher by default; `launcher` names it for the check that it exists. In sibling mode the tracker's
 * repository runs the same hooks: with `tracker` it guards the tracker's trunk too, letting the CLI's own commits
 * through without starting Naima; without it, it does nothing there.
 */
export function guardHook(trunkName: string, command: string, opts: { launcher?: string; sibling?: boolean; tracker?: TrackerSide } = {}): string {
  if (opts.tracker) return trackerGuardHook(trunkName, command, opts.tracker, opts.launcher)
  return [
    "#!/bin/sh",
    `${MARK}: rewritten by it, never by hand.`,
    "# Refuses a commit, merge or fast-forward of the trunk made by hand: work lands through naima open and naima land.",
    "# Any other ref costs this script alone. naima guard off turns it off for the project.",
    "",
    "input=$(cat)",
    "# A hook the clone had before core.hooksPath pointed here still runs, first, with the same lines.",
    `legacy="$(git rev-parse --git-common-dir)/hooks/${GUARD_HOOK}"`,
    `if [ -x "$legacy" ]; then printf '%s\\n' "$input" | "$legacy" "$@" || exit $?; fi`,
    '[ "$1" = prepared ] || exit 0',
    "old=",
    "new=",
    "while read -r o n ref; do",
    `  if [ "$ref" = ${quote(`refs/heads/${trunkName}`)} ]; then old=$o; new=$n; fi`,
    "done <<EOF",
    "$input",
    "EOF",
    '[ -n "$new" ] || exit 0',
    'top="$(git rev-parse --show-toplevel 2>/dev/null)" || exit 0',
    ...(opts.sibling ? [`# The tracker's own repository: its trunk is not guarded.`, `[ -f "$top/${DATA_FILE}" ] && exit 0`] : []),
    'cd "$top" || exit 0',
    ...(opts.launcher
      ? [
        `if [ ! -f ${
          quote(opts.launcher)
        } ]; then echo "naima: the trunk guard cannot run here (no ${opts.launcher}): ${trunkName} moves unchecked" >&2; exit 0; fi`,
        `command -v deno >/dev/null 2>&1 || { echo "naima: the trunk guard cannot run (deno is not on PATH): ${trunkName} moves unchecked" >&2; exit 0; }`,
      ]
      : []),
    "unset GIT_INDEX_FILE",
    `exec ${command} guard-check "$old" "$new"`,
    "",
  ].join("\n")
}

/** The launcher's two checks, that it is there and that Deno is: without either, the trunk moves unchecked, and says so. */
const launcherChecks = (launcher: string | undefined, trunkName: string): string[] =>
  launcher
    ? [
      `if [ ! -f ${quote(launcher)} ]; then echo "naima: the trunk guard cannot run here (no ${launcher}): ${trunkName} moves unchecked" >&2; exit 0; fi`,
      `command -v deno >/dev/null 2>&1 || { echo "naima: the trunk guard cannot run (deno is not on PATH): ${trunkName} moves unchecked" >&2; exit 0; }`,
    ]
    : []

/** The hook of sibling mode, which both repositories run: each guards its own trunk, the tracker's from the code root. */
function trackerGuardHook(trunkName: string, command: string, tracker: TrackerSide, launcher?: string): string {
  return [
    "#!/bin/sh",
    `${MARK}: rewritten by it, never by hand.`,
    "# Refuses a commit, merge or fast-forward of the trunk made by hand: work lands through naima open and naima land.",
    "# The tracker's repository runs it too: its trunk takes the commits Naima makes there itself, which name their command.",
    "# Any other ref costs this script alone. naima guard off turns it off for the project.",
    "",
    "input=$(cat)",
    "# A hook the clone had before core.hooksPath pointed here still runs, first, with the same lines.",
    `legacy="$(git rev-parse --git-common-dir)/hooks/${GUARD_HOOK}"`,
    `if [ -x "$legacy" ]; then printf '%s\\n' "$input" | "$legacy" "$@" || exit $?; fi`,
    '[ "$1" = prepared ] || exit 0',
    'top="$(git rev-parse --show-toplevel 2>/dev/null)" || exit 0',
    `guarded=${quote(`refs/heads/${trunkName}`)}`,
    "side=",
    `if [ -f "$top/${DATA_FILE}" ]; then guarded=${quote(`refs/heads/${tracker.trunk}`)}; side=--tracker; fi`,
    "old=",
    "new=",
    "while read -r o n ref; do",
    '  if [ "$ref" = "$guarded" ]; then old=$o; new=$n; fi',
    "done <<EOF",
    "$input",
    "EOF",
    '[ -n "$new" ] || exit 0',
    'if [ -n "$side" ]; then',
    "  # A branch created, or every commit the move adds naming the command that made it: Naima's own, no need to start it.",
    '  case "$old" in *[!0]*) ;; *) exit 0 ;; esac',
    '  all=$(git rev-list --count --first-parent "$new" "^$old")',
    `  own=$(git log --first-parent --format='%(trailers:key=${CLI_TRAILER},valueonly,separator=%x2C)' "$new" "^$old" | grep -c .)`,
    '  [ "$all" = "$own" ] && exit 0',
    `  top="$top/${tracker.back}"`,
    "  unset GIT_DIR GIT_WORK_TREE GIT_PREFIX GIT_COMMON_DIR",
    "fi",
    'cd "$top" || exit 0',
    ...launcherChecks(launcher, trunkName),
    "unset GIT_INDEX_FILE",
    `exec ${command} guard-check $side "$old" "$new"`,
    "",
  ].join("\n")
}

/** The tracker's side of the guard, in sibling mode while the tracker has a trunk; null otherwise. */
const trackerSide = (ctx: Context): TrackerSide | undefined => {
  if (!ctx.sibling) return undefined
  const main = trunk(ctx.trackerGit) ?? gitOrNull(ctx.trackerGit, "symbolic-ref", "--quiet", "--short", "HEAD")
  return main ? { trunk: main, back: posixRelative(ctx.trackerRoot, ctx.root) || "." } : undefined
}

/** The hook as the project's setup writes it: Deno on the program's launcher. */
export function projectGuardHook(ctx: Context): string {
  const launcher = guardLauncher(ctx)
  const tracker = trackerSide(ctx)
  return guardHook(guardedTrunk(ctx.root), `deno run -A ${quote(launcher)}`, { launcher, sibling: ctx.sibling, ...(tracker ? { tracker } : {}) })
}

const hookFile = (ctx: Context): string => join(ctx.trackerRoot, HOOKS_DIR, GUARD_HOOK)
const hooksPathOf = (ctx: Context): string => `${posixRelative(ctx.root, ctx.trackerRoot) || "."}/${HOOKS_DIR}`
/** Whether the guard itself is in the hooks folder, not absent nor the stub that only runs the clone's own hook. */
const hasGuard = (ctx: Context): boolean => existsSync(hookFile(ctx)) && readFileSync(hookFile(ctx), "utf8").includes(MARK)
const isGit = (root: string): boolean => gitOrNull(root, "rev-parse", "--git-dir") !== null

/** Whether git runs the guard in this clone: the hook is there and core.hooksPath names its directory. */
export const guardRuns = (ctx: Context): boolean => hasGuard(ctx) && gitOrNull(ctx.root, "config", "--get", "core.hooksPath") === hooksPathOf(ctx)

/** What the owner is told once, when the guard starts guarding a clone: and, when the code's origin is on GitHub, that the server can guard it too. */
const announce = (root: string, main: string): string => {
  const server = serverHintOf(root, main)
  return `the trunk is guarded now: a commit, merge or fast-forward of ${main} made by hand is refused, and work lands through naima open and naima land. ` +
    `It stays on. Tell the owner, as information and not as a question: for committing on ${main} by hand, or mixing hand commits with landings, ` +
    `naima guard off turns the guard off for the project, and naima guard on turns it back on.${server ? ` ${server}.` : ""}`
}

/** Write the guard where it is missing or not current; `command` replaces Deno on the launcher (tests). Returns what it did, a line each. */
export function installGuard(ctx: Context, command?: string): string[] {
  if (!isGit(ctx.root)) return []
  const had = guardRuns(ctx)
  const tracker = trackerSide(ctx)
  const text = command ? guardHook(guardedTrunk(ctx.root), command, { sibling: ctx.sibling, ...(tracker ? { tracker } : {}) }) : projectGuardHook(ctx)
  const lines = writeGitHook(ctx.root, ctx.trackerRoot, GUARD_HOOK, text)
  if (!had && guardRuns(ctx)) lines.push(announce(ctx.root, guardedTrunk(ctx.root)))
  return lines
}

/** The setup init and update run: the guard, where it is missing, while the project has it on. */
export const guardSetup = (on: boolean): Setup => ({
  name: "trunk-guard",
  says:
    "the trunk guard, a git reference-transaction hook in the data directory's hooks, which refuses a commit, merge or fast-forward of the trunk made by hand; core.hooksPath pointed there where unset. Nothing while the option trunkGuard is false",
  install: (ctx) => (on ? installGuard(ctx) : []),
})

/** What hello says while the guard is off, so that an agent does not take landings for enforced. */
export const guardOffSection = (on: boolean): SummarySection => ({
  name: "trunk-guard",
  hello: true,
  render: () => rendered({ on }, () => (on ? [] : ["The trunk guard is off in this project (naima guard on): commits on the trunk are not refused."])),
})

// ── what the trunk takes directly ────────────────────────────────────────────

interface Added {
  sha: string
  parents: string[]
  tree: string
  subject: string
  closes: string[]
  tracker: string
  reason: string
  /** The command a commit Naima made itself names, in its `Naima-Command:` trailer; empty otherwise. */
  cli: string
  /** Why a branch that changed only tracker data landed, from a marker's `Tracker-only:` trailer; empty otherwise. */
  trackerOnly: string
  /** The requirements a marker's landing met, from its `Meets:` trailers. */
  meets: string[]
}

const FORMAT =
  `%H%x1f%P%x1f%T%x1f%s%x1f%(trailers:key=${CLOSES},valueonly,separator=%x1d)%x1f%(trailers:key=${TRACKER_TRAILER},valueonly,separator=%x1d)%x1f%(trailers:key=${TRUNK_REASON},valueonly,separator=%x1d)%x1f%(trailers:key=${CLI_TRAILER},valueonly,separator=%x1d)%x1f%(trailers:key=${TRACKER_ONLY},valueonly,separator=%x1d)%x1f%(trailers:key=${MEETS},valueonly,separator=%x1d)%x1e`

function commitsOf(root: string, args: string[]): Added[] {
  const out = gitOrNull(root, "log", `--format=${FORMAT}`, ...args) ?? ""
  return out.split("\x1e").map((r) => r.replace(/^\n/, "")).filter(Boolean).map((r) => {
    const [sha = "", parents = "", tree = "", subject = "", closes = "", tracker = "", reason = "", cli = "", trackerOnly = "", meets = ""] = r.split("\x1f")
    return {
      sha,
      parents: parents.split(" ").filter(Boolean),
      tree,
      subject,
      closes: closes.split("\x1d").map((c) => c.trim()).filter(Boolean),
      tracker: tracker.split("\x1d")[0]?.trim() ?? "",
      reason: reason.split("\x1d").map((c) => c.trim()).filter(Boolean).join("; "),
      cli: cli.split("\x1d")[0]?.trim() ?? "",
      trackerOnly: trackerOnly.split("\x1d").map((c) => c.trim()).filter(Boolean).join("; "),
      meets: meets.split("\x1d").map((c) => c.trim()).filter(Boolean),
    }
  })
}

/** Every file a commit changed against its first parent, with its status. */
function filesOf(root: string, sha: string): { status: string; path: string }[] {
  const out = gitOrNull(root, "diff-tree", "-r", "--root", "--no-commit-id", "--no-renames", "--name-status", "-z", sha) ?? ""
  const tokens = out.split("\0").map((t) => t.replace(/^\n/, "")).filter(Boolean)
  const files: { status: string; path: string }[] = []
  for (let i = 0; i + 1 < tokens.length; i += 2) files.push({ status: tokens[i] ?? "", path: tokens[i + 1] ?? "" })
  return files
}

const treeOf = (root: string, sha: string): string => gitOrNull(root, "rev-parse", `${sha}^{tree}`) ?? ""

/**
 * Whether a commit is a landing marker: a merge whose first parent the second contains, whose tree is the second's,
 * naming what it lands (`Closes:`, `Tracker:`), the requirement it meets (`Meets:`) or why it lands only tracker data (`Tracker-only:`).
 */
export function isMarker(root: string, c: Pick<Added, "parents" | "tree" | "closes" | "tracker"> & { trackerOnly?: string; meets?: string[] }): boolean {
  const [first, second] = c.parents
  if (c.parents.length !== 2 || !first || !second) return false
  return (c.closes.length > 0 || !!c.tracker || !!c.trackerOnly || !!c.meets?.length) && treeOf(root, second) === c.tree && isAncestor(root, first, second)
}

/** Whether a commit only switches the guard: naima.json changed in `trunkGuard` alone, and the hook added or removed. */
export function switchesGuard(ctx: Context, sha: string, files: { status: string; path: string }[]): boolean {
  const data = ctx.trackerPrefix ? `${ctx.trackerPrefix}/` : ""
  const config = `${data}${DATA_FILE}`
  if (!files.some((f) => f.path === config && f.status === "M")) return false
  if (!files.every((f) => f.path === config || f.path === `${data}${HOOKS_DIR}/${GUARD_HOOK}`)) return false
  const read = (rev: string): Record<string, unknown> | null => {
    const r = runGit(ctx.trackerGit, ["show", `${rev}:${config}`])
    try {
      return r.ok ? (JSON.parse(r.out) as Record<string, unknown>) : null
    } catch {
      return null
    }
  }
  const strip = (raw: Record<string, unknown> | null): unknown => {
    if (!raw) return null
    const plugins = { ...(raw["plugins"] as Record<string, unknown> | undefined) }
    const entry = { ...(plugins[PLUGIN_KEY] as Record<string, unknown> | undefined) }
    const options = { ...(entry["options"] as Record<string, unknown> | undefined) }
    delete options[GUARD_OPTION]
    const keptEntry = Object.keys(options).length ? { ...entry, options } : (({ options: _o, ...rest }) => rest)(entry)
    if (Object.keys(keptEntry).length) plugins[PLUGIN_KEY] = keptEntry
    else delete plugins[PLUGIN_KEY]
    return { ...raw, plugins }
  }
  const option = (raw: Record<string, unknown>): unknown =>
    ((((raw["plugins"] as Record<string, unknown> | undefined)?.[PLUGIN_KEY] as Record<string, unknown> | undefined)?.["options"]) as
      | Record<string, unknown>
      | undefined)?.[GUARD_OPTION] ?? true
  const before = read(`${sha}^`), after = read(sha)
  return !!before && !!after && option(before) !== option(after) && isDeepStrictEqual(strip(before), strip(after))
}

/** Why the tracker's trunk, in sibling mode, may not take `c` directly; null when it may. */
function trackerRefusal(repo: string, c: Added, upstream: string | null): string | null {
  if (c.reason || c.cli) return null
  if (c.parents.length >= 2) {
    if (isMarker(repo, c)) return null
    if (upstream && c.parents.slice(1).every((p) => isAncestor(repo, p, upstream))) return null // a pull's merge
    return "a merge that is not a landing marker"
  }
  return `a commit made by hand, without the ${CLI_TRAILER}: trailer of the commits Naima makes there: tracker files are written through naima commands, which commit them`
}

/** Why the trunk may not take `c` directly, after `prev`; null when it may. */
function refusal(ctx: Context, c: Added, prev: Added | undefined, upstream: string | null): string | null {
  const root = ctx.root
  if (c.reason) return null
  if (c.parents.length >= 2) {
    if (isMarker(root, c)) return null
    if (upstream && c.parents.slice(1).every((p) => isAncestor(root, p, upstream))) return null // a pull's merge
    return c.parents.length > 2 ? "a merge of several branches, not a landing marker" : "a merge that is not a landing marker"
  }
  const files = filesOf(root, c.sha)
  if (ctx.sibling) {
    // The code's side of a tracker kept apart: only init's commit of the tracker folder goes straight on it.
    if (files.length && files.every((f) => f.path.startsWith(`${TRACKER_DIR}/`))) return null
    return "a commit made on the trunk by hand"
  }
  if (initsTracker(ctx, files) || onlyAddsTrackerData(ctx, c.sha, files) || onlyClosesItems(ctx, c.sha, files) || switchesGuard(ctx, c.sha, files)) return null
  if (prev && prev.parents.length === 2 && prev.closes.length && recordsMarker(ctx, c.sha, files, { sha: prev.sha, closes: prev.closes })) return null
  return "a commit made on the trunk that does more than add to the tracker data"
}

/**
 * Why the trunk may not move from `old` to `next`, in one line; null when it may. A ref created or deleted, a
 * rewind, and a tip the upstream (origin's branch of the same name) holds pass; otherwise every commit the move adds
 * to the first-parent line must be one the trunk takes directly.
 */
export function trunkRefusal(ctx: Context, old: string, next: string, side: "code" | "tracker" = "code"): string | null {
  const tracker = side === "tracker"
  const root = tracker ? ctx.trackerGit : ctx.root
  const main = tracker ? (trunk(root) ?? guardedTrunk(root)) : guardedTrunk(root)
  if (ZERO.test(old) || ZERO.test(next) || old === next) return null
  if (isAncestor(root, next, old)) return null
  const up = `refs/remotes/origin/${main}`
  const upstream = gitOrNull(root, "rev-parse", "--verify", "--quiet", up) !== null ? up : null
  if (upstream && isAncestor(root, next, upstream)) return null
  const added = commitsOf(root, ["--first-parent", "--reverse", next, `^${old}`])
  let prev: Added | undefined = commitsOf(root, ["-1", old])[0]
  for (const c of added) {
    const why = tracker ? trackerRefusal(root, c, upstream) : refusal(ctx, c, prev, upstream)
    if (why && tracker) {
      return `the tracker's ${main} may not take ${
        c.sha.slice(0, 12)
      } "${c.subject}": ${why}. The trunk stays where it was: make the change with the naima command for it, ` +
        `or on an item's branch, and land it; only the owner lets a commit through by hand, with a ${TRUNK_REASON}: <why> trailer`
    }
    if (why) {
      return `${main} may not take ${c.sha.slice(0, 12)} "${c.subject}": ${why}. Open an item (naima open <item>), commit the change in its worktree, ` +
        `and land it with naima land; only the owner lets a commit through by hand, with a ${TRUNK_REASON}: <why> trailer (naima guard off turns the guard off)`
    }
    prev = c
  }
  return null
}

// ── the commands ─────────────────────────────────────────────────────────────

export const guardCheckCommand: Command = {
  name: "guard-check",
  says: "what the trunk guard's git hook runs when the trunk is about to move: exit 0 when it may, else one line saying why not and what to do",
  enforces:
    "a commit, merge or fast-forward of the trunk made by hand is refused unless every commit it adds to the first-parent line is a landing marker, the record land makes, a commit that only adds to the tracker data (a claim may also be rewritten or removed) or only closes items, naima init's commit, one that only switches the guard, or one with a Trunk-reason: trailer; a tip the upstream holds, a rewind, a ref created or deleted pass",
  usage: "guard-check [--tracker] <old> <new>",
  examples: ["guard-check 0123abc 4567def", "guard-check --tracker 0123abc 4567def"],
  options: [{ name: "--tracker", says: "the move is of the tracker's trunk, in sibling mode: it takes the commits Naima makes there and landing markers" }],
  hook: true,
  run(args, ctx) {
    const p = parse(args, { tracker: { type: "boolean" } })
    const [old, next, ...rest] = p.positionals
    if (!old || !next || rest.length) throw usageError(this)
    const why = trunkRefusal(ctx, old, next, bool(p, "tracker") ? "tracker" : "code")
    if (!why) return 0
    ctx.err(`naima: ${why}`)
    return 1
  },
}

/** Set or clear the option in naima.json, as the next load reads it. */
function recordGuard(ctx: Context, on: boolean): void {
  const file = join(ctx.trackerRoot, DATA_FILE)
  const raw = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>
  const plugins = { ...(raw["plugins"] as Record<string, unknown> | undefined) }
  const entry = { ...(plugins[PLUGIN_KEY] as Record<string, unknown> | undefined) }
  const options = { ...(entry["options"] as Record<string, unknown> | undefined) }
  if (on) delete options[GUARD_OPTION]
  else options[GUARD_OPTION] = false
  if (Object.keys(options).length) entry["options"] = options
  else delete entry["options"]
  if (Object.keys(entry).length) plugins[PLUGIN_KEY] = entry
  else delete plugins[PLUGIN_KEY]
  const next: Record<string, unknown> = { ...raw, plugins }
  if (!Object.keys(plugins).length) delete next["plugins"]
  writeJson(file, next)
}

export const guardCommand = (on: boolean): Command => ({
  name: "guard",
  says:
    "the trunk guard: whether it is on and runs in this clone; off turns it off for the project (recorded in naima.json, the hook removed), on turns it back on; server, on the owner's word, makes a GitHub ruleset that lets only the repository's admins push the trunk (with gh, else it says the request and the web page; --print only says them)",
  enforces:
    "while on, the git hook refuses a commit, merge or fast-forward of the trunk made by hand (naima guard-check says what passes); off is the owner's choice, recorded, and update does not put the hook back",
  usage: "guard [status] | guard on | guard off | guard server [--print]",
  examples: ["guard", "guard off", "guard on", "guard server", "guard server --print"],
  options: [{ name: "--print", says: "with server: say the ruleset, the gh and curl requests and the web page, and send nothing to GitHub" }],
  run(args, ctx) {
    const p = parse(args, { print: { type: "boolean" } })
    const [sub = "status", ...rest] = p.positionals
    if (rest.length) throw usageError(this)
    const config = posixRelative(ctx.root, join(ctx.trackerRoot, DATA_FILE))
    const hook = posixRelative(ctx.root, hookFile(ctx))
    const main = guardedTrunk(ctx.root)
    if (sub === "server") return guardServer(ctx, main, bool(p, "print"))
    if (bool(p, "print")) throw usageError(this)
    if (sub === "status") {
      if (!on) ctx.out(`the trunk guard is off (${config}: ${GUARD_OPTION} false): commits on ${main} are not refused — naima guard on turns it on`)
      else if (guardRuns(ctx)) {
        ctx.out(`the trunk guard is on and runs in this clone: ${main} takes landings and the tracker's own commits only`)
        const server = serverHintOf(ctx.root, main)
        if (server) ctx.out(server)
      } else {
        ctx.out(
          `the trunk guard is on, and does not run in this clone: ${
            hasGuard(ctx) ? `core.hooksPath does not name ${hooksPathOf(ctx)}` : `${hook} is missing`
          } — naima update puts it in place`,
        )
      }
      return 0
    }
    if (sub === "off") {
      recordGuard(ctx, false)
      rmSync(hookFile(ctx), { force: true })
      writeDelegates(ctx.trackerRoot) // the clone's own reference-transaction hook keeps running
      ctx.out(
        `the trunk guard is off: commits on ${main} made by hand are not refused, landings-are-markers asks only from the first landing marker, and the landing rule is not shipped. ` +
          `Commit ${config} and the removed ${hook}; naima guard on turns it back on`,
      )
      return 0
    }
    if (sub === "on") {
      recordGuard(ctx, true)
      for (const line of installGuard(ctx)) ctx.out(line)
      ctx.out(`the trunk guard is on: commit ${config} and ${hook} together, which the guard lets through`)
      return 0
    }
    throw usageError(this)
  },
})

/**
 * The commit from which landings-are-markers asks, by the guard: the newest commit of the trunk's first-parent line
 * whose tree has the hook while its first parent's has not, when the trunk's tip still has it; -1 otherwise.
 */
export function guardedFrom(ctx: Context, repo: string, line: readonly { sha: string; parents: string[] }[]): number {
  if (!line.length) return -1
  const path = [ctx.trackerPrefix, HOOKS_DIR, GUARD_HOOK].filter(Boolean).join("/")
  const r = runGit(repo, ["cat-file", "--batch-check=%(objecttype)"], { input: line.map((c) => `${c.sha}:${path}`).join("\n") + "\n" })
  if (!r.ok) return -1
  const has = r.out.split("\n").map((l) => l.trim() === "blob")
  if (!has[line.length - 1]) return -1
  for (let i = line.length - 1; i >= 0; i--) if (has[i] && !has[i - 1]) return i
  return -1
}
