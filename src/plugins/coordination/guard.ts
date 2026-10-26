// The trunk guard: a git reference-transaction hook (git 2.28 or later) that
// refuses a commit, merge or fast-forward of the trunk made by hand. Work goes
// through an item: `naima open` makes its worktree and branch, and `naima land`
// puts it on the trunk as a marker. The hook is cheap for every other ref: it
// is a shell script that exits at once unless the trunk moves, and only then
// starts Naima, `naima guard-check <old> <new>`, which says whether every
// commit the move adds to the trunk's first-parent line is one the trunk takes
// directly: a landing marker, the record land makes after it, a commit that
// only adds to the tracker data or only closes items, naima init's commit, or
// one that only switches the guard. A new tip the upstream already holds
// passes, so a pull of what landed elsewhere works; a rewind passes, and so
// does a ref created or deleted. The owner lets a commit through once with a
// `Trunk-reason:` trailer, which landings-are-markers then notes with its reason.
//
// The hook is a file of the data directory's hooks, committed, which
// core.hooksPath names in every clone (core/repos.ts points it there where it is
// unset). `naima guard off` removes it and records the choice in naima.json;
// `naima guard on` puts it back.

import { existsSync, readFileSync, rmSync } from "node:fs"
import { isAbsolute, join, relative } from "node:path"
import { isDeepStrictEqual } from "node:util"
import {
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
import { CLOSES, initsTracker, onlyAddsTrackerData, onlyClosesItems, recordsMarker, TRUNK_REASON } from "./land.ts"

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

/** The rule this plugin ships while the guard is on: work goes through an item, and lands. */
export const LANDING_RULE = {
  name: "changes-land-through-items",
  title: "Every change goes through an item, its worktree and naima land; the trunk is never committed by hand",
  audience: "agents" as const,
  strength: "must" as const,
  text:
    "Every change goes through an item: `naima open <item>` makes its worktree and branch, the change and its test are committed there, and `naima land` puts it on the trunk. Never commit, merge or fast-forward the trunk by hand. Straight on the trunk only: `naima init`'s commit, the tracker additions the CLI writes (an item filed, a note, a diary entry), and the close after a landing. The trunk guard, a git hook, refuses anything else; the owner alone lets a commit through, with a `Trunk-reason:` trailer that says why.",
  why:
    "an agent that was never told this made about ninety plain commits, half of them straight on the trunk, and merged a worktree it made by hand with a fast-forward: no item said what any of it was for, no landing closed one, and nothing stopped it.",
  ack: "Landing mode on",
  enforcedBy: "landings-are-markers",
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

/**
 * The hook: shell that reads the ref updates, runs the clone's own hook of the same name first, and for an update
 * of `refs/heads/<trunkName>` in the prepared state only, starts `command guard-check <old> <new>`. `command` is
 * Deno on the launcher by default; `launcher` names it for the check that it exists. In sibling mode the tracker's
 * repository runs the same hooks: there it does nothing.
 */
export function guardHook(trunkName: string, command: string, opts: { launcher?: string; sibling?: boolean } = {}): string {
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

/** The hook as the project's setup writes it: Deno on the program's launcher. */
export function projectGuardHook(ctx: Context): string {
  const launcher = guardLauncher(ctx)
  return guardHook(guardedTrunk(ctx.root), `deno run -A ${quote(launcher)}`, { launcher, sibling: ctx.sibling })
}

const hookFile = (ctx: Context): string => join(ctx.trackerRoot, HOOKS_DIR, GUARD_HOOK)
const hooksPathOf = (ctx: Context): string => `${posixRelative(ctx.root, ctx.trackerRoot) || "."}/${HOOKS_DIR}`
/** Whether the guard itself is in the hooks folder, not absent nor the stub that only runs the clone's own hook. */
const hasGuard = (ctx: Context): boolean => existsSync(hookFile(ctx)) && readFileSync(hookFile(ctx), "utf8").includes(MARK)
const isGit = (root: string): boolean => gitOrNull(root, "rev-parse", "--git-dir") !== null

/** Whether git runs the guard in this clone: the hook is there and core.hooksPath names its directory. */
export const guardRuns = (ctx: Context): boolean => hasGuard(ctx) && gitOrNull(ctx.root, "config", "--get", "core.hooksPath") === hooksPathOf(ctx)

/** What the owner is told once, when the guard starts guarding a clone. */
const announce = (main: string): string =>
  `the trunk is guarded now: a commit, merge or fast-forward of ${main} made by hand is refused, and work lands through naima open and naima land. ` +
  `To commit on ${main} by hand instead, naima guard off turns the guard off for the project (or ask your agent); naima guard on turns it back on.`

/** Write the guard where it is missing or not current; `command` replaces Deno on the launcher (tests). Returns what it did, a line each. */
export function installGuard(ctx: Context, command?: string): string[] {
  if (!isGit(ctx.root)) return []
  const had = guardRuns(ctx)
  const text = command ? guardHook(guardedTrunk(ctx.root), command, { sibling: ctx.sibling }) : projectGuardHook(ctx)
  const lines = writeGitHook(ctx.root, ctx.trackerRoot, GUARD_HOOK, text)
  if (!had && guardRuns(ctx)) lines.push(announce(guardedTrunk(ctx.root)))
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
}

const FORMAT =
  `%H%x1f%P%x1f%T%x1f%s%x1f%(trailers:key=${CLOSES},valueonly,separator=%x1d)%x1f%(trailers:key=${TRACKER_TRAILER},valueonly,separator=%x1d)%x1f%(trailers:key=${TRUNK_REASON},valueonly,separator=%x1d)%x1e`

function commitsOf(root: string, args: string[]): Added[] {
  const out = gitOrNull(root, "log", `--format=${FORMAT}`, ...args) ?? ""
  return out.split("\x1e").map((r) => r.replace(/^\n/, "")).filter(Boolean).map((r) => {
    const [sha = "", parents = "", tree = "", subject = "", closes = "", tracker = "", reason = ""] = r.split("\x1f")
    return {
      sha,
      parents: parents.split(" ").filter(Boolean),
      tree,
      subject,
      closes: closes.split("\x1d").map((c) => c.trim()).filter(Boolean),
      tracker: tracker.split("\x1d")[0]?.trim() ?? "",
      reason: reason.split("\x1d").map((c) => c.trim()).filter(Boolean).join("; "),
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

/** Whether a commit is a landing marker: a merge whose first parent the second contains, whose tree is the second's, naming what it lands. */
export function isMarker(root: string, c: Pick<Added, "parents" | "tree" | "closes" | "tracker">): boolean {
  const [first, second] = c.parents
  if (c.parents.length !== 2 || !first || !second) return false
  return (c.closes.length > 0 || !!c.tracker) && treeOf(root, second) === c.tree && isAncestor(root, first, second)
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
export function trunkRefusal(ctx: Context, old: string, next: string): string | null {
  const root = ctx.root
  const main = guardedTrunk(root)
  if (ZERO.test(old) || ZERO.test(next) || old === next) return null
  if (isAncestor(root, next, old)) return null
  const up = `refs/remotes/origin/${main}`
  const upstream = gitOrNull(root, "rev-parse", "--verify", "--quiet", up) !== null ? up : null
  if (upstream && isAncestor(root, next, upstream)) return null
  const added = commitsOf(root, ["--first-parent", "--reverse", next, `^${old}`])
  let prev: Added | undefined = commitsOf(root, ["-1", old])[0]
  for (const c of added) {
    const why = refusal(ctx, c, prev, upstream)
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
    "a commit, merge or fast-forward of the trunk made by hand is refused unless every commit it adds to the first-parent line is a landing marker, the record land makes, a commit that only adds to the tracker data or only closes items, naima init's commit, one that only switches the guard, or one with a Trunk-reason: trailer; a tip the upstream holds, a rewind, a ref created or deleted pass",
  usage: "guard-check <old> <new>",
  examples: ["guard-check 0123abc 4567def"],
  hook: true,
  run(args, ctx) {
    const [old, next, ...rest] = parse(args).positionals
    if (!old || !next || rest.length) throw usageError(this)
    const why = trunkRefusal(ctx, old, next)
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
    "the trunk guard: whether it is on and runs in this clone; off turns it off for the project (recorded in naima.json, the hook removed), on turns it back on",
  enforces:
    "while on, the git hook refuses a commit, merge or fast-forward of the trunk made by hand (naima guard-check says what passes); off is the owner's choice, recorded, and update does not put the hook back",
  usage: "guard [status] | guard on | guard off",
  examples: ["guard", "guard off", "guard on"],
  run(args, ctx) {
    const [sub = "status", ...rest] = parse(args).positionals
    if (rest.length) throw usageError(this)
    const config = posixRelative(ctx.root, join(ctx.trackerRoot, DATA_FILE))
    const hook = posixRelative(ctx.root, hookFile(ctx))
    const main = guardedTrunk(ctx.root)
    if (sub === "status") {
      if (!on) ctx.out(`the trunk guard is off (${config}: ${GUARD_OPTION} false): commits on ${main} are not refused — naima guard on turns it on`)
      else if (guardRuns(ctx)) ctx.out(`the trunk guard is on and runs in this clone: ${main} takes landings and the tracker's own commits only`)
      else {
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
