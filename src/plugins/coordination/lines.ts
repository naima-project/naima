// Parallel development lines: a long-lived branch `line/<gate>` per goal of
// the trunk. Nothing is stored: a line's base, how far it lags and its latest
// update come from git, and the line a chat works on is kept in the session
// record outside the repository (naima line use).
//
// A line starts from the trunk with a commit of its own, so that every branch
// opened from it carries a commit the trunk lacks: that is how a branch shows
// its line. An item's branch lands on its line as a marker that fixes and
// closes nothing (`Fixes:` trailers); the trunk reaches a line only through a
// sync, a short branch from the line that merges the trunk and lands with a
// `Sync:` trailer; the line lands on the trunk as one marker that closes
// every item fixed on it. Abandoning a line keeps its commits under the tag
// archive/line/<gate> and deletes the branch: its items are open again on the
// trunk, where nothing of the line was ever written.
//
// The behaviour is the model's: develop/models/lines/lines.mcrl2.

import {
  bool,
  type Command,
  type Context,
  type ExtensionPoint,
  gitOrNull,
  isAncestor,
  mustGit,
  parse,
  rendered,
  runGit,
  sessionLine,
  setSessionLine,
  type SummarySection,
  table,
  trunk,
  usageError,
  type View,
  worktrees,
} from "../../core/api.ts"
import { ahead, exists, home, plural, type Policy, SEGMENT, SEGMENT_SAYS, worktreesDir } from "./worktrees.ts"
import { archiveTag } from "./index.ts"
import { landOnLine } from "./land.ts"

/** The namespace of the lines' branches. */
export const LINE_PREFIX = "line/"
/** The namespace of the short branches that sync a line with the trunk. */
export const SYNC_PREFIX = "sync/"
/** The trailer a landing on a line names each item it fixes with: fixed there, closed when the line lands. */
export const FIXES = "Fixes"
/** The trailer of a landing on a line that brings the trunk into it: the trunk commit it merged. */
export const SYNC = "Sync"

/** The branch of a gate's line. */
export const lineBranch = (gate: string): string => `${LINE_PREFIX}${gate}`
/** The gate a line's branch is tied to; null for any other branch. */
export const gateOfLine = (
  branch: string,
): string | null => (branch.startsWith(LINE_PREFIX) && branch.length > LINE_PREFIX.length ? branch.slice(LINE_PREFIX.length) : null)

/** The order of the goals: whether goal `a` comes before goal `b`. Contributed by the gates plugin, read here by name. */
export interface GoalOrder {
  name: string
  says: string
  before(ctx: Context, a: string, b: string): boolean
}

/** The point this plugin declares: what orders the goals lines are tied to. */
export const goalOrderPoint: ExtensionPoint<GoalOrder> = {
  id: "goal-order",
  says:
    "the order of the goals development lines are tied to: `name`, `says`, `before(ctx, a, b) → boolean`, whether goal a comes before goal b; naima open refuses an item on the line of a goal that comes after the item's own",
  noun: "goal order",
  key: (o) => o.name,
  validate: (v) => {
    const o = v as Partial<GoalOrder> | null
    if (!o || typeof o !== "object" || typeof o.name !== "string") return "has no name"
    return typeof o.before === "function" ? null : "has no before function"
  },
  gaps: (o) => (typeof o.says === "string" && o.says.trim() ? [] : ["does not say what it orders"]),
}

/** Whether goal `a` comes before goal `b`, by any contributed order. */
export const goalBefore = (ctx: Context, a: string, b: string): boolean =>
  ctx.registry.contributions("goal-order").some((c) => (c.value as GoalOrder).before(ctx, a, b))

/** An open line: its gate and branch, its tip, the commits it has that the trunk lacks and those it lacks, its latest update. */
export interface Line {
  gate: string
  branch: string
  tip: string
  ahead: number
  behind: number
  /** The date of its newest commit, YYYY-MM-DD. */
  updated: string
}

/** Every open line: a branch line/<gate> with commits the trunk lacks. A landed line is merged, so no longer open. */
export function openLines(root: string): Line[] {
  const main = trunk(root)
  if (!main) return []
  const out = gitOrNull(root, "for-each-ref", "--format=%(refname:short)%09%(objectname)%09%(committerdate:short)", "--no-merged", main, "refs/heads/line/") ??
    ""
  return out.split("\n").filter(Boolean).flatMap((l) => {
    const [branch = "", tip = "", updated = ""] = l.split("\t")
    const gate = gateOfLine(branch)
    return gate ? [{ gate, branch, tip, updated, ahead: ahead(root, main, branch), behind: ahead(root, branch, main) }] : []
  })
}

/** Whether `ref` carries a commit of `other` that the trunk `main` lacks. */
const carries = (root: string, main: string, ref: string, other: string): boolean => {
  const mb = gitOrNull(root, "merge-base", ref, other)
  return !!mb && !isAncestor(root, mb, main)
}

/**
 * The gate of the line `ref` belongs to: the line itself, or the open line whose commits the trunk lacks it carries;
 * null for a branch of the trunk. A branch carrying commits of two lines is refused: lines never mix.
 */
export function lineOf(root: string, ref: string, lines: Line[] = openLines(root)): string | null {
  const own = gateOfLine(ref)
  if (own && lines.some((l) => l.gate === own)) return own
  const main = trunk(root)
  if (!main) return null
  const hits = lines.filter((l) => carries(root, main, ref, l.branch))
  if (hits.length > 1) {
    throw new Error(
      `${ref} carries commits of ${hits.length} lines (${
        hits.map((l) => l.branch).join(", ")
      }): a branch belongs to one line, and no line's commits enter another — take the work back to one line`,
    )
  }
  return hits[0]?.gate ?? null
}

/** The gate of an abandoned line whose commits, kept under its archive tag, `ref` carries and the trunk lacks; null when none. */
export function abandonedLineOf(root: string, ref: string): string | null {
  const main = trunk(root)
  if (!main) return null
  const tags = (gitOrNull(root, "for-each-ref", "--format=%(refname:short)", `refs/tags/${archiveTag(LINE_PREFIX)}`) ?? "").split("\n").filter(Boolean)
  for (const tag of tags) {
    if (carries(root, main, ref, `refs/tags/${tag}`)) return tag.slice(archiveTag(LINE_PREFIX).length)
  }
  return null
}

/** The commit that opened the line of `gate` on `ref` (its branch, or its archive tag): the first-parent commit "Open line/<gate>". */
export function openingOf(root: string, ref: string, gate: string): string | null {
  const subject = `Open ${lineBranch(gate)}`
  const out = gitOrNull(root, "log", "--first-parent", "--fixed-strings", `--grep=${subject}`, "--format=%H%x09%s", ref) ?? ""
  for (const l of out.split("\n")) {
    const [sha = "", s = ""] = l.split("\t")
    if (s === subject) return sha
  }
  return null
}

/**
 * The lines whose work `next` holds and `old` (when given) lacks, though they have not landed there: an open line whose
 * opening commit `next` carries without its tip, or an abandoned one whose opening commit it carries. A line's work
 * reaches the trunk only when the line lands (P1 of the model), and an abandoned line's never.
 */
export function lineWorkIn(root: string, next: string, old?: string): { branch: string; abandoned: boolean }[] {
  const out: { branch: string; abandoned: boolean }[] = []
  const brings = (o: string | null): boolean => !!o && isAncestor(root, o, next) && !(old && isAncestor(root, o, old))
  for (const l of openLines(root)) {
    if (brings(openingOf(root, l.branch, l.gate)) && !isAncestor(root, l.tip, next)) out.push({ branch: l.branch, abandoned: false })
  }
  const prefix = archiveTag(LINE_PREFIX)
  for (const tag of (gitOrNull(root, "for-each-ref", "--format=%(refname:short)", `refs/tags/${prefix}`) ?? "").split("\n").filter(Boolean)) {
    const gate = tag.slice(prefix.length)
    if (brings(openingOf(root, `refs/tags/${tag}`, gate))) out.push({ branch: lineBranch(gate), abandoned: true })
  }
  return out
}

/** What a line's work on the trunk is, in words: "line/<gate>, which has not landed" or "…, which was abandoned". */
export const unlanded = (w: { branch: string; abandoned: boolean }): string => `${w.branch}, which ${w.abandoned ? "was abandoned" : "has not landed"}`

/** Where a branch measures itself, and lands: its line's branch, else the trunk. */
export function baseOf(root: string, ref: string): string | null {
  try {
    const gate = lineOf(root, ref)
    if (gate && gate !== gateOfLine(ref)) return lineBranch(gate)
  } catch {
    // A branch of two lines measures against the trunk: land refuses it, and says why.
  }
  return trunk(root)
}

/** The items fixed on a line: the Fixes: trailers of the markers on its first-parent line that the trunk lacks. */
export function fixedOnLine(root: string, branch: string): string[] {
  const main = trunk(root)
  if (!main) return []
  const out = gitOrNull(root, "log", "--first-parent", `--format=%(trailers:key=${FIXES},valueonly,separator=%x1d)%x1e`, `${main}..${branch}`) ?? ""
  return [...new Set(out.replaceAll("\x1d", "\n").replaceAll("\x1e", "\n").split("\n").map((s) => s.trim()).filter(Boolean))]
}

/** The gate the command works on: --line, --trunk, else the line this chat works on; null for the trunk. Refuses a line that is not open. */
export function chosenLine(ctx: Context, given: { line?: string | undefined; trunk?: boolean }, lines: Line[] = openLines(ctx.root)): string | null {
  if (given.line !== undefined && given.trunk) throw new Error("--line and --trunk name two places: give one")
  if (given.trunk) return null
  const gate = given.line ?? sessionLine(ctx.root) ?? null
  if (gate === null) return null
  if (!lines.some((l) => l.gate === gate)) {
    throw new Error(
      given.line !== undefined
        ? `no open line for ${gate}: naima line new ${gate} starts one, naima line list lists them`
        : `this chat works on line ${gate}, which is no longer open (landed or abandoned): naima line use --trunk, or naima line use <gate>`,
    )
  }
  return gate
}

/** The line a command follows, said first: "on line <branch>" or "on the trunk". */
export const onLine = (gate: string | null, main: string | null): string => (gate ? `on line ${lineBranch(gate)}` : `on the trunk${main ? `, ${main}` : ""}`)

/** The gates the project declares, by name: what a line may be tied to. */
const gateNames = (ctx: Context): string[] => ctx.registry.contributions("gates").map((c) => c.name)

const refusesSibling = (ctx: Context): void => {
  if (ctx.sibling) throw new Error("development lines need the tracker committed with its code: this project keeps the tracker in a repository of its own")
}

/** Whether a worktree stands on `branch`. */
const standing = (root: string, branch: string) => worktrees(root).find((w) => w.branch === branch)

/** `line new`: the branch line/<gate> from the trunk, with a commit of its own. */
function newLine(ctx: Context, gate: string): number {
  refusesSibling(ctx)
  if (!SEGMENT.test(gate)) throw new Error(`${gate}: a line's gate is a ${SEGMENT_SAYS}, the last part of the branch line/<gate>`)
  const names = gateNames(ctx)
  if (!names.includes(gate)) {
    throw new Error(
      `no gate ${gate}: a line is tied to a goal of the trunk — ${names.length ? `declared gates: ${names.join(", ")}` : "declare one with naima gate new"}`,
    )
  }
  const main = trunk(ctx.root)
  if (!main) throw new Error("no trunk (main, master, or origin's HEAD): a line starts from it")
  const branch = lineBranch(gate)
  if (gitOrNull(ctx.root, "rev-parse", "--verify", "--quiet", `refs/heads/${branch}`) !== null) {
    throw new Error(
      isAncestor(ctx.root, branch, main)
        ? `${branch} exists and has landed: delete it first (naima prune --branch ${branch} --write)`
        : `${branch} is open already: naima line use ${gate} works on it`,
    )
  }
  const tip = mustGit(ctx.root, "rev-parse", `refs/heads/${main}`)
  const made = runGit(ctx.root, ["commit-tree", `${tip}^{tree}`, "-p", tip, "-F", "-"], { input: `Open ${branch}\n\nThe line of ${gate}, from ${main}.\n` })
  if (!made.ok) throw new Error(`git commit-tree: ${made.err.trim()}`)
  mustGit(ctx.root, "branch", branch, made.out.trim())
  ctx.out(`opened ${branch} from ${main} at ${tip.slice(0, 12)}: naima line use ${gate} makes this chat work on it`)
  return 0
}

/** An item as `<type>/<slug>`, by its id; the id when this checkout has no such item. */
const itemRef = (ctx: Context, id: string): string => {
  const i = ctx.repo.byId.get(id)
  return i ? `${i.type}/${i.slug}` : id
}

/** The line's facts, for list, the view and hello. */
function linesData(ctx: Context) {
  const lines = openLines(ctx.root)
  const current = sessionLine(ctx.root)
  return {
    trunk: trunk(ctx.root),
    current: current === undefined ? null : current,
    lines: lines.map((l) => ({ ...l, fixed: fixedOnLine(ctx.root, l.branch).map((id) => itemRef(ctx, id)) })),
  }
}

const lineRow = (l: ReturnType<typeof linesData>["lines"][number]): string =>
  `${l.branch}  (gate ${l.gate}, updated ${l.updated}, ${l.behind ? `${plural(l.behind, "trunk commit")} to sync` : "up to date with the trunk"}${
    l.fixed.length ? `, fixed on it: ${l.fixed.join(", ")}` : ""
  })`

/** `line sync`: a short branch from the line that merges the trunk; landed on the line at once when the merge is clean. */
function syncLine(ctx: Context, policy: Policy, gate: string): number {
  refusesSibling(ctx)
  const main = trunk(ctx.root)
  const branch = lineBranch(gate)
  if (!main || !openLines(ctx.root).some((l) => l.gate === gate)) throw new Error(`no open line for ${gate}: naima line list lists them`)
  if (isAncestor(ctx.root, main, branch)) {
    ctx.out(`${branch} is up to date with ${main}: nothing to sync`)
    return 0
  }
  const sync = `${SYNC_PREFIX}${gate}`
  if (gitOrNull(ctx.root, "rev-parse", "--verify", "--quiet", `refs/heads/${sync}`) !== null) {
    throw new Error(`${sync} exists: finish it (resolve, commit, naima land ${sync}) or delete it (naima prune --branch ${sync} --write)`)
  }
  const path = `${worktreesDir(policy, home(ctx.root))}/${gate}`
  if (exists(path)) throw new Error(`${path} already exists: the sync of ${branch} is made there — remove it first`)
  mustGit(ctx.root, "worktree", "add", "-q", "-b", sync, path, branch)
  const merged = runGit(path, ["merge", "--no-ff", "--no-edit", "-m", `Sync ${branch} with ${main}`, main])
  if (!merged.ok) {
    ctx.out(`the trunk does not merge cleanly into ${branch}: resolve the conflicts in ${path}, commit the merge on ${sync}, then naima land ${sync}`)
    return 1
  }
  // Landed, the sync's worktree and branch are removed: landOnLine does it for every sync, this one or one finished by hand.
  return landOnLine(ctx, sync, gate, [])
}

/** `line abandon`: the line's commits under archive/line/<gate>, the branch deleted; its items open again on the trunk. */
function abandonLine(ctx: Context, gate: string): number {
  refusesSibling(ctx)
  const branch = lineBranch(gate)
  const lines = openLines(ctx.root)
  if (!lines.some((l) => l.gate === gate)) throw new Error(`no open line for ${gate}: naima line list lists them`)
  const tree = standing(ctx.root, branch)
  if (tree) throw new Error(`${tree.path} stands on ${branch}: switch it to another branch first`)
  const tag = archiveTag(branch)
  if (gitOrNull(ctx.root, "rev-parse", "--verify", "--quiet", `refs/tags/${tag}`) !== null) {
    throw new Error(`the tag ${tag} exists, from an earlier abandon: move it aside (git tag -m) before abandoning ${branch} again`)
  }
  const fixed = fixedOnLine(ctx.root, branch)
  const pending = (gitOrNull(ctx.root, "for-each-ref", "--format=%(refname:short)", "refs/heads") ?? "").split("\n").filter((b) => {
    if (!b || b === branch || isAncestor(ctx.root, b, branch)) return false
    try {
      return lineOf(ctx.root, b, lines) === gate
    } catch {
      return true
    }
  })
  mustGit(ctx.root, "tag", tag, branch)
  mustGit(ctx.root, "branch", "-D", branch)
  if (sessionLine(ctx.root) === gate) setSessionLine(ctx.root, null)
  ctx.out(`abandoned ${branch}: its commits stay on the tag ${tag}, the branch is deleted, and nothing was written on the trunk`)
  if (fixed.length) {
    ctx.out(`open again on the trunk, as it never saw their fix: ${fixed.map((id) => itemRef(ctx, id)).join(", ")}`)
  }
  for (const b of pending) {
    ctx.out(`dropped: ${b} was opened from ${branch} and cannot land — naima prune --branch ${b} --archive --write; its items are open again`)
  }
  return 0
}

/** `naima line`: new, list, use, sync, abandon. */
export function lineCommand(policy: Policy): Command {
  return {
    name: "line",
    says:
      "parallel development lines, one long-lived branch line/<gate> per goal of the trunk: new starts one from the trunk; list shows the open ones, each with its gate, latest update, how far it lags and the items fixed on it; use sets the line this chat works on (kept outside the repository), which open, claims, queue --ready and land follow; sync merges the trunk into a line through a short branch; abandon keeps its commits under archive/line/<gate> and deletes it",
    enforces:
      "a line starts only from the trunk, tied to a gate the project declares, never from another line; the trunk reaches a line only by a sync, never the reverse, and a line reaches the trunk only by landing; abandon keeps every commit under its archive tag and writes nothing on the trunk, so the items fixed on the line are open there again; nothing is supported with the tracker in a repository of its own",
    usage: "line new <gate> | line list [--json] | line use [<gate> | --trunk] | line sync <gate> | line abandon <gate>",
    options: [
      { name: "--trunk", says: "with use: this chat works on the trunk" },
      { name: "--json", says: "with list: the lines as JSON, each one's gate, branch, tip, ahead, behind, updated and the items fixed on it" },
    ],
    examples: ["line new release-1.2", "line use release-1.2", "line list", "line sync release-1.2", "line use --trunk", "line abandon release-1.2"],
    run(args, ctx) {
      const p = parse(args, { trunk: { type: "boolean" }, json: { type: "boolean" } })
      const [sub, gate, ...rest] = p.positionals
      if (rest.length || (bool(p, "json") && sub !== "list") || (bool(p, "trunk") && sub !== "use")) throw usageError(this)
      if (sub === "new" && gate) return newLine(ctx, gate)
      if (sub === "sync" && gate) return syncLine(ctx, policy, gate)
      if (sub === "abandon" && gate) return abandonLine(ctx, gate)
      if (sub === "list" && !gate) {
        const d = linesData(ctx)
        if (bool(p, "json")) {
          ctx.out(JSON.stringify(d, null, 2))
          return 0
        }
        ctx.out(`this chat works ${onLine(d.current, d.trunk)}`)
        if (!d.lines.length) ctx.out("no open line: naima line new <gate> starts one")
        for (const l of d.lines) ctx.out(`  ${lineRow(l)}`)
        return 0
      }
      if (sub === "use") {
        if (bool(p, "trunk")) {
          if (gate) throw usageError(this)
          setSessionLine(ctx.root, null)
          ctx.out(`this chat works on the trunk: open, claims, queue --ready and land follow it`)
          return 0
        }
        if (!gate) {
          const now = sessionLine(ctx.root)
          ctx.out(
            now === undefined
              ? `this chat has chosen no line: it works on the trunk (naima line use <gate>)`
              : `this chat works ${onLine(now, trunk(ctx.root))}`,
          )
          return 0
        }
        refusesSibling(ctx)
        chosenLine(ctx, { line: gate })
        setSessionLine(ctx.root, gate)
        ctx.out(`this chat works on ${lineBranch(gate)}: open, claims, queue --ready and land follow it; --trunk or --line override`)
        return 0
      }
      throw usageError(this)
    },
  }
}

/** What naima show says of an item fixed on an open line: the trunk's copy of it does not say so. */
export const lineFacts = {
  name: "lines",
  says: "an item fixed on an open development line, and not yet on the trunk: fixed on line line/<gate>",
  facts(ctx: Context, item: { meta: { id: string } }): string[] {
    if (ctx.sibling) return []
    return openLines(ctx.root).filter((l) => fixedOnLine(ctx.root, l.branch).includes(item.meta.id)).map((l) =>
      `fixed on line ${l.branch}, not yet on the trunk: it closes when the line lands`
    )
  },
}

/** `naima view lines`: the open lines and the items fixed on each, read from the lines' tips. */
export const linesView: View = {
  name: "lines",
  says: "the open development lines: each one's gate, latest update, how far it lags the trunk, and the items fixed on it and not yet closed on the trunk",
  render: (_args, ctx) =>
    rendered(
      linesData(ctx),
      (d) =>
        d.lines.length
          ? table(
            ["Line", "Gate", "Updated", "Behind the trunk", "Fixed on it"],
            d.lines.map((l) => [l.branch, l.gate, l.updated, String(l.behind), l.fixed.join(", ")]),
          )
          : ["no open line"],
    ),
}

const escHtml = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")

/** The open lines as a view of `naima ui`, the shape the `ui-views` point takes: its data is `naima line list --json`. */
export const linesUiView = {
  name: "lines",
  title: "Lines",
  says: "the open development lines: each one's gate, branch, tip, how far it is ahead of and behind the trunk, its latest update and the items fixed on it; its data is `naima line list --json`",
  order: 30,
  render(_params: Record<string, string[]>, ctx: Context) {
    const d = linesData(ctx)
    return {
      data: d,
      html: d.lines.length
        ? `<ul>${d.lines.map((l) => `<li><code>${escHtml(l.branch)}</code> ${escHtml(lineRow(l).slice(l.branch.length).trim())}</li>`).join("")}</ul>`
        : "<p>No open line: <code>naima line new &lt;gate&gt;</code> starts one.</p>",
    }
  },
}

/** What hello says of the lines: each open one with its gate and latest update, and the line this chat works on. */
export const linesSection: SummarySection = {
  name: "lines",
  hello: true,
  render(ctx) {
    const d = linesData(ctx)
    return rendered(d, (x) =>
      x.lines.length || x.current
        ? [
          ...(x.lines.length ? [`Open lines: ${x.lines.map((l) => `${l.branch} (gate ${l.gate}, updated ${l.updated})`).join("; ")}.`] : []),
          `This chat works ${onLine(x.current, x.trunk)}.`,
        ]
        : [])
  },
}
