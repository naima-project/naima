// Records that belong with a change, held in the commit that makes it, and
// the pre-commit hook that holds them there.
//
// A companion rule says: a change under a path, to an item of a type, or of a
// field, must come with another record in the same commit — a change to an
// item of a type, a field set on the item, a note on it, a link from it. One
// rule is built in: setting `fixedOn` requires a linked verifying test. The
// rules are evaluated over the staged change by `naima check --staged` (and
// by `naima check`, over whatever is staged when it runs).
//
// `naima hooks install` writes a pre-commit hook into the data directory —
// tracked, so every clone and worktree has the same one — and points git's
// core.hooksPath at it, once per clone: worktrees share the setting. The hook
// starts Naima only when a staged path is under the tracker or a rule's
// paths; any other commit costs one `git diff`. `git commit --no-verify`
// skips it.

import { chmodSync, existsSync, readFileSync } from "node:fs"
import { dirname, isAbsolute, join, relative } from "node:path"
import {
  bool,
  type Check,
  type Command,
  type Context,
  CONTRACT,
  DATA_FILE,
  DELEGATE_MARK,
  type Finding,
  gitPath,
  gitReason,
  HOOKS_OFF_KEY,
  installTrailerHooks,
  isGitRepo,
  type Item,
  label,
  linked,
  type Meta,
  parse,
  type Plugin,
  type PluginOptions,
  posixRelative,
  runGit,
  stagedChanges,
  textsAt,
  usageError,
  writeFileAtomic,
} from "../../core/api.ts"

/** The directory under the data directory the hooks are written to: what core.hooksPath names. */
export const HOOKS_DIR = "hooks"
/** The one hook it writes. */
export const PRE_COMMIT = "pre-commit"
/** The first comment of every hook it writes: whose the file is. */
const MARK = "# Written by `naima hooks install`"

/** What a rule is triggered by: a staged path under one of `paths`, a change to an item of `type`, a change of `field` to a set value. */
export interface When {
  paths?: string[]
  type?: string
  field?: string
}

/** What a rule requires in the same commit: a change to an item of `type`, `field` set on the item, a `note` on it, a `link` of that relation from it. */
export interface Requires {
  type?: string
  field?: string
  note?: boolean
  link?: string
}

/** A companion rule: when the staged change does `when`, it must also do `requires`. */
export interface Companion {
  name: string
  says: string
  when: When
  requires: Requires
}

/** The rule built in: a fix comes with the test that will prove it. */
export const FIXED_HAS_TEST: Companion = {
  name: "fixed-has-test",
  says: "setting fixedOn comes with a linked verifying test",
  when: { field: "fixedOn" },
  requires: { link: "verified-by" },
}

/** Every option, read and validated: a malformed rule fails loading, naming it. */
export interface HooksOptions {
  companions: Companion[]
  /** The command the hook runs when a relevant path is staged; unset, Deno on the project's launcher. */
  command?: string
}

const strings = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === "string" && x.trim() !== "")

function readRule(raw: unknown, at: string): Companion {
  const fail = (why: string): never => {
    throw new Error(`commit-hooks: options.companions${at} ${why}`)
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) fail("is not an object")
  const r = raw as Record<string, unknown>
  if (typeof r["name"] !== "string" || !/^[a-z0-9][a-z0-9-]*$/.test(r["name"])) fail("has no name of lowercase letters, digits and dashes")
  const when = (r["when"] ?? {}) as Record<string, unknown>
  const req = (r["requires"] ?? {}) as Record<string, unknown>
  if (when["paths"] !== undefined && !strings(when["paths"])) fail(`(${r["name"]}): when.paths is not a list of paths`)
  for (const k of ["type", "field"]) if (when[k] !== undefined && typeof when[k] !== "string") fail(`(${r["name"]}): when.${k} is not a name`)
  for (const k of ["type", "field", "link"]) if (req[k] !== undefined && typeof req[k] !== "string") fail(`(${r["name"]}): requires.${k} is not a name`)
  if (req["note"] !== undefined && req["note"] !== true) fail(`(${r["name"]}): requires.note is not true`)
  const w: When = {
    ...(when["paths"] ? { paths: (when["paths"] as string[]).map(normalPath) } : {}),
    ...(typeof when["type"] === "string" ? { type: when["type"] } : {}),
    ...(typeof when["field"] === "string" ? { field: when["field"] } : {}),
  }
  const q: Requires = {
    ...(typeof req["type"] === "string" ? { type: req["type"] } : {}),
    ...(typeof req["field"] === "string" ? { field: req["field"] } : {}),
    ...(req["note"] === true ? { note: true } : {}),
    ...(typeof req["link"] === "string" ? { link: req["link"] } : {}),
  }
  if (!w.paths && !w.type && !w.field) fail(`(${r["name"]}): when names no paths, type or field`)
  if (w.paths && (w.type || w.field)) fail(`(${r["name"]}): when names paths and an item too — a rule is triggered by one or the other`)
  if (Object.keys(q).length !== 1) fail(`(${r["name"]}): requires names not exactly one of type, field, note, link`)
  if (w.paths && !q.type) fail(`(${r["name"]}): a rule on paths has no item of its own, so it can require only a change to an item of a type`)
  return { name: r["name"] as string, says: typeof r["says"] === "string" ? r["says"] : describe({ when: w, requires: q }), when: w, requires: q }
}

/** A path from the root, as a rule names it: forward slashes, no leading ./ and no trailing slash. */
const normalPath = (p: string): string => gitPath(p.trim(), "\\").replace(/^(\.\/)+/, "").replace(/\/+$/, "")

/** A rule, in words, when it says nothing of itself. */
function describe(r: Pick<Companion, "when" | "requires">): string {
  const w = r.when.paths
    ? `a change under ${r.when.paths.join(", ")}`
    : `${r.when.field ? `setting ${r.when.field} on` : "a change to"} ${r.when.type ? `an item of ${r.when.type}` : "an item"}`
  const q = r.requires
  const what = q.type ? `a change to an item of ${q.type}` : q.field ? `${q.field} set` : q.note ? "a note on it" : `a ${q.link} link`
  return `${w} comes with ${what}`
}

export function readOptions(o: PluginOptions): HooksOptions {
  const raw = o["companions"] ?? []
  if (!Array.isArray(raw)) throw new Error("commit-hooks: options.companions is not a list of rules")
  const own = raw.map((r, i) => readRule(r, `[${i}]`))
  const builtin = o["builtin"] ?? true
  if (typeof builtin !== "boolean") throw new Error("commit-hooks: options.builtin is not true or false")
  const companions = [...(builtin ? [FIXED_HAS_TEST] : []), ...own]
  const names = new Set<string>()
  for (const c of companions) {
    if (names.has(c.name)) throw new Error(`commit-hooks: two companion rules are named ${c.name}`)
    names.add(c.name)
  }
  const command = o["command"]
  if (command !== undefined && (typeof command !== "string" || !command.trim())) throw new Error("commit-hooks: options.command is not a command")
  return { companions, ...(typeof command === "string" ? { command } : {}) }
}

// ── the staged change, read as items ─────────────────────────────────────────

/** One item the staged change touches: its id, its fields before and after, and every staged path in its directory. */
interface Touched {
  id: string
  type: string
  /** Its directory from the root, after the change (before it, for one the change deletes). */
  dir: string
  before: Meta | null
  after: Meta | null
  paths: string[]
}

/** The staged change: every path, and every item it touches, by id — a move is one item, not a deletion and a creation. */
export interface Staged {
  paths: string[]
  items: Touched[]
}

const parseMeta = (text: string | null): Meta | null => {
  if (text === null) return null
  try {
    const m = JSON.parse(text) as unknown
    return m && typeof m === "object" && typeof (m as Meta).id === "string" ? (m as Meta) : null
  } catch {
    return null
  }
}

/** The staged change of the project, read from git: empty outside git or with nothing staged. */
export function readStaged(ctx: Context): Staged {
  // The items are staged in the tracker's repository: the project's own, or one of its own in sibling mode.
  if (!isGitRepo(ctx.trackerGit)) return { paths: [], items: [] }
  const changes = stagedChanges(ctx.trackerGit)
  const dirs = new Map([...ctx.registry.types.values()].map((t) => [t.dir, t.id]))
  const prefix = ctx.trackerPrefix ? ctx.trackerPrefix + "/" : ""
  // Each path under an item's directory, grouped by that directory.
  const byDir = new Map<string, { type: string; changes: typeof changes }>()
  for (const c of changes) {
    if (!c.path.startsWith(prefix)) continue
    const [dir, slug] = c.path.slice(prefix.length).split("/")
    const type = dir === undefined ? undefined : dirs.get(dir)
    if (!type || !slug) continue
    const key = `${prefix}${dir}/${slug}`
    const entry = byDir.get(key) ?? { type, changes: [] }
    entry.changes.push(c)
    byDir.set(key, entry)
  }
  const keys = [...byDir.keys()]
  const metas = textsAt(ctx.trackerGit, keys.flatMap((k) => [`HEAD:${k}/meta.json`, `:${k}/meta.json`]))
  const byId = new Map<string, Touched>()
  keys.forEach((key, i) => {
    const before = parseMeta(metas[2 * i] ?? null)
    const after = parseMeta(metas[2 * i + 1] ?? null)
    const id = (after ?? before)?.id
    const entry = byDir.get(key)
    if (!id || !entry) return
    const seen = byId.get(id)
    const paths = entry.changes.map((c) => c.path)
    if (!seen) {
      byId.set(id, { id, type: entry.type, dir: key, before, after, paths })
      return
    }
    // A move: the deleted directory holds the fields before, the new one those after.
    byId.set(id, {
      id,
      type: after ? entry.type : seen.type,
      dir: after ? key : seen.dir,
      before: seen.before ?? before,
      after: seen.after ?? after,
      paths: [...seen.paths, ...paths],
    })
  })
  // Paths are from the project root: in sibling mode the code's staged paths, and the tracker's under the data directory.
  const paths = ctx.sibling
    ? [...(isGitRepo(ctx.root) ? stagedChanges(ctx.root) : []).map((c) => c.path), ...changes.map((c) => `${ctx.trackerDir}/${c.path}`)]
    : changes.map((c) => c.path)
  return { paths, items: [...byId.values()] }
}

// ── evaluating the rules ─────────────────────────────────────────────────────

const under = (path: string, prefix: string): boolean => path === prefix || path.startsWith(prefix + "/")
const isSet = (v: unknown): boolean => v !== undefined && v !== null && v !== "" && !(Array.isArray(v) && v.length === 0)

/** The item a rule's trigger names, by short name: undefined when no loaded type answers to it. */
const typeId = (ctx: Context, name: string | undefined): string | undefined => (name ? ctx.registry.find<{ id: string }>("types", name)?.value.id : undefined)

/** Whether one touched item triggers `rule`. */
function triggers(ctx: Context, rule: Companion, t: Touched): boolean {
  if (!t.after) return false
  if (rule.when.type && t.type !== typeId(ctx, rule.when.type)) return false
  if (rule.when.field) {
    const now = t.after[rule.when.field]
    return isSet(now) && JSON.stringify(now) !== JSON.stringify(t.before?.[rule.when.field])
  }
  return true
}

/** What `rule` misses for one item the change touches, in words; null when the change carries it. */
function missing(ctx: Context, staged: Staged, rule: Companion, t: Touched | null): string | null {
  const q = rule.requires
  if (q.type) {
    const id = typeId(ctx, q.type)
    const dir = id ? ctx.registry.types.get(id)?.dir : undefined
    if (!dir) return `no loaded type is named ${q.type}`
    const others = staged.items.filter((o) => o.type === id && o.id !== t?.id)
    return others.length ? null : `no item of ${q.type} is changed in this commit`
  }
  if (!t?.after) return null
  if (q.field) return isSet(t.after[q.field]) ? null : `${q.field} is not set`
  if (q.note) return t.paths.some((p) => p.endsWith("/README.md")) ? null : "its page has no note in this commit"
  if (q.link) {
    const item = ctx.repo.byId.get(t.id)
    return item && linked(ctx, item, q.link).length ? null : `no item is linked to it by ${q.link}`
  }
  return null
}

/** Every finding the companion rules make over the staged change. */
export function companionFindings(ctx: Context, rules: Companion[], staged: Staged = readStaged(ctx)): Finding[] {
  if (!staged.paths.length) return []
  const out: Finding[] = []
  for (const rule of rules) {
    if (rule.when.paths) {
      const hit = staged.paths.filter((p) => rule.when.paths?.some((prefix) => under(p, prefix)))
      if (!hit.length) continue
      const why = missing(ctx, staged, rule, null)
      if (why) {
        out.push({
          level: "problem",
          message: `${hit[0]}${hit.length > 1 ? ` and ${hit.length - 1} more` : ""}: ${why} — companion rule ${rule.name}: ${rule.says}`,
        })
      }
      continue
    }
    for (const t of staged.items) {
      if (!triggers(ctx, rule, t)) continue
      const why = missing(ctx, staged, rule, t)
      if (!why) continue
      const item: Item | undefined = ctx.repo.byId.get(t.id)
      const where = item ? label(item) : t.dir.slice(ctx.trackerPrefix ? ctx.trackerPrefix.length + 1 : 0)
      out.push({ level: "problem", message: `${where}: ${why} — companion rule ${rule.name}: ${rule.says}`, ...(item ? { item } : {}) })
    }
  }
  return out
}

// ── the hook ─────────────────────────────────────────────────────────────────

const quote = (s: string): string => `'${s.replace(/'/g, `'\\''`)}'`
const escapeRegex = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

/** A path from the root when it is inside the project, else absolute: what the hook and core.hooksPath name. */
const fromRoot = (ctx: Context, abs: string): string => {
  const rel = relative(ctx.root, abs)
  return rel && !rel.startsWith("..") && !isAbsolute(rel) ? gitPath(rel) : gitPath(abs)
}

/** The command the hook runs: the project's `command`, else Deno on the launcher of the program the project runs. */
function hookCommand(ctx: Context, opts: HooksOptions): string {
  if (opts.command) return opts.command
  // The committed launcher beside the program's folder installs Deno and restores the program first when either is missing.
  const committed = join(dirname(ctx.program), "naima.sh")
  if (existsSync(committed)) return `sh ${quote(fromRoot(ctx, committed))} check --staged`
  const launcher = [join(ctx.program, "naima.ts"), join(ctx.program, "naima", "naima.ts")].find(existsSync) ?? join(ctx.program, "naima.ts")
  return `deno run -A ${quote(fromRoot(ctx, launcher))} check --staged`
}

/** Every path prefix the hook watches: the data directory, and every rule's paths. */
export function watched(ctx: Context, opts: HooksOptions): string[] {
  return [...new Set([fromRoot(ctx, ctx.trackerRoot), ...opts.companions.flatMap((c) => c.when.paths ?? [])])]
}

/** The pre-commit hook, as `naima hooks install` writes it. */
export function preCommit(ctx: Context, opts: HooksOptions): string {
  const pattern = `^(${watched(ctx, opts).map(escapeRegex).join("|")})(/|$)`
  return [
    "#!/bin/sh",
    `${MARK}: rewritten by it, never by hand.`,
    "# Runs Naima's staged-change checks only when a staged path is under one of the watched paths;",
    "# any other commit costs one git diff. `git commit --no-verify` skips it.",
    "",
    "# A hook the clone had before core.hooksPath pointed here still runs, first.",
    'legacy="$(git rev-parse --git-common-dir)/hooks/pre-commit"',
    'if [ -x "$legacy" ]; then "$legacy" "$@" || exit $?; fi',
    "",
    ...(ctx.sibling
      ? [
        "# The tracker is a repository of its own: every commit of it is checked, from the code's root.",
        `if [ -f "$(git rev-parse --show-toplevel)/${DATA_FILE}" ]; then cd "$(git rev-parse --show-toplevel)/${
          posixRelative(ctx.trackerRoot, ctx.root) || "."
        }" && exec ${hookCommand(ctx, opts)}; fi`,
      ]
      : []),
    `git -c core.quotePath=false diff --cached --name-only --no-renames | grep -qE ${quote(pattern)} || exit 0`,
    `exec ${hookCommand(ctx, opts)}`,
    "",
  ].join("\n")
}

const hookFile = (ctx: Context): string => join(ctx.trackerRoot, HOOKS_DIR, PRE_COMMIT)
/** Whether a hook file is there and not the stub that only runs the clone's own hook: what install wrote, or a hand edit of it. */
const ours = (file: string): boolean => existsSync(file) && !readFileSync(file, "utf8").includes(DELEGATE_MARK)
const hooksPath = (ctx: Context): string => fromRoot(ctx, join(ctx.trackerRoot, HOOKS_DIR))
const currentHooksPath = (ctx: Context): string | null => {
  const r = runGit(ctx.root, ["config", "--get", "core.hooksPath"])
  return r.ok && r.out.trim() ? r.out.trim() : null
}

function install(ctx: Context, opts: HooksOptions, force: boolean): number {
  if (!isGitRepo(ctx.root)) throw new Error("hooks install needs a git repository: there is no commit to hook")
  const mine = hooksPath(ctx)
  const set = currentHooksPath(ctx)
  if (set && set !== mine && !force) {
    throw new Error(`core.hooksPath is already ${set}, which is not Naima's: its hooks would stop running — --force points it at ${mine} anyway`)
  }
  const file = hookFile(ctx)
  writeFileAtomic(file, preCommit(ctx, opts))
  chmodSync(file, 0o755)
  if (set !== mine) {
    const r = runGit(ctx.root, ["config", "core.hooksPath", mine])
    if (!r.ok) throw new Error(`git config core.hooksPath: ${gitReason(r)}`)
  }
  runGit(ctx.root, ["config", "--unset", HOOKS_OFF_KEY])
  ctx.out(`wrote ${fromRoot(ctx, file)} — commit it; core.hooksPath is ${mine}, for this clone and every worktree of it`)
  // Sibling mode: the tracker's repository runs the same hooks, and both run the trailer hook that pairs their commits.
  if (ctx.sibling) { for (const line of installTrailerHooks(ctx.root, ctx.trackerRoot)) ctx.out(line) }
  return 0
}

function uninstall(ctx: Context): number {
  const mine = hooksPath(ctx)
  const set = currentHooksPath(ctx)
  if (set !== mine) {
    ctx.out(set ? `core.hooksPath is ${set}, not Naima's: left as it is` : "core.hooksPath is not set: nothing to undo")
    return 0
  }
  const r = runGit(ctx.root, ["config", "--unset", "core.hooksPath"])
  if (!r.ok) throw new Error(`git config --unset core.hooksPath: ${gitReason(r)}`)
  // Remembered for this clone, so that a launched run does not point it back.
  runGit(ctx.root, ["config", HOOKS_OFF_KEY, "off"])
  ctx.out(`core.hooksPath unset: git runs the clone's own hooks again; ${fromRoot(ctx, hookFile(ctx))} is left for the other clones`)
  return 0
}

function list(ctx: Context, opts: HooksOptions): number {
  const set = currentHooksPath(ctx)
  const mine = hooksPath(ctx)
  ctx.out(
    set === mine && ours(hookFile(ctx))
      ? `pre-commit hook: installed (core.hooksPath is ${mine})`
      : set
      ? `pre-commit hook: not installed — core.hooksPath is ${set}`
      : "pre-commit hook: not installed — naima hooks install",
  )
  ctx.out(`watched paths: ${watched(ctx, opts).join(", ")}`)
  ctx.out()
  ctx.out("Companion rules, held in the commit that makes the change (naima check --staged):")
  for (const c of opts.companions) ctx.out(`  ${c.name}: ${c.says}`)
  return 0
}

export default function hooks(options: PluginOptions = {}): Plugin {
  const opts = readOptions(options)

  const companions: Check = {
    name: "companions",
    staged: true,
    says:
      "the change staged for the next commit carries the records each companion rule requires with it: a change to an item of a type, a field set, a note, a link",
    run: (ctx) => companionFindings(ctx, opts.companions),
  }

  const current: Check = {
    name: "hook-current",
    says: "the pre-commit hook in the data directory, once written, is the one naima hooks install writes for the companion rules as they are now",
    run(ctx) {
      const file = hookFile(ctx)
      // Absent, or the stub that only runs the clone's own pre-commit: never written by install.
      if (!ours(file)) return []
      return readFileSync(file, "utf8") === preCommit(ctx, opts)
        ? []
        : [{ level: "problem", message: `${fromRoot(ctx, file)} is not the hook the companion rules make now — naima hooks install rewrites it` }]
    },
  }

  const command: Command = {
    name: "hooks",
    says:
      "the pre-commit hook and the companion rules it holds: list them, install the hook — tracked in the data directory, named by core.hooksPath once per clone — or uninstall it",
    enforces:
      "the installed pre-commit hook runs the staged checks and the companion rules before every commit; install refuses to take over a core.hooksPath that is not Naima's unless --force",
    usage: "hooks [list] | hooks install [--force] | hooks uninstall",
    options: [{ name: "--force", says: "install even when core.hooksPath already names another directory, whose hooks then stop running" }],
    examples: ["hooks", "hooks install", "hooks uninstall"],
    run(args, ctx) {
      const p = parse(args, { force: { type: "boolean" } })
      const [sub = "list", ...rest] = p.positionals
      if (rest.length) throw usageError(this)
      if (sub === "install") return install(ctx, opts, bool(p, "force"))
      if (bool(p, "force")) throw usageError(this)
      if (sub === "uninstall") return uninstall(ctx)
      if (sub === "list") return list(ctx, opts)
      throw usageError(this)
    },
  }

  const builtin = opts.companions.includes(FIXED_HAS_TEST)
  return {
    name: "commit-hooks",
    contract: CONTRACT,
    says: "companion records required in the commit that makes a change, and the path-scoped pre-commit hook that holds them",
    about: "A record written later is never written: a fix with no test to prove it, a feature with no note. " +
      "A companion rule says that a change — under a path, to an item of a type, or setting a field — must come with another record in the same commit: " +
      "a change to an item of a type, a field set on the item, a note on its page, or a link from it. " +
      "`naima check --staged` evaluates the rules over the staged change, and `naima check` over whatever is staged when it runs. " +
      "One rule is built in, `fixed-has-test`: setting `fixedOn` comes with a linked verifying test. " +
      "`naima hooks install` writes a pre-commit hook into the data directory, tracked, and points core.hooksPath at it — once per clone, which every worktree shares. " +
      "The hook starts Naima only when a staged path is under the data directory or a rule's paths; `git commit --no-verify` skips it.",
    options: [
      {
        name: "companions",
        says:
          'the project\'s companion rules: each { "name", "says"?, "when": { "paths" } or { "type"?, "field"? }, "requires": exactly one of { "type" }, { "field" }, { "note": true }, { "link" } }',
        default: "[] — the built-in rule alone",
      },
      { name: "builtin", says: "false switches off the built-in rule fixed-has-test", default: "true" },
      { name: "command", says: "the command the hook runs when a watched path is staged", default: "deno run -A <the program's naima.ts> check --staged" },
    ],
    dirs: [HOOKS_DIR],
    checks: [companions, current],
    commands: [command],
    ...(builtin ? { uses: { fields: ["fixedOn"], relations: ["verified-by"] } } : {}),
  }
}
