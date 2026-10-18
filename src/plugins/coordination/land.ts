// Landing: a branch enters the trunk as one marker commit — a merge whose
// first parent is the trunk, whose second is the branch tip that contains it,
// whose tree is the branch tip's, and whose message names the items it
// closes in `Closes:` trailers. `naima land` makes one; the check
// `landings-are-markers` reads the trunk's first-parent line for them. The
// command is a shortcut for `git merge --no-ff` after `git merge-base
// --is-ancestor`: the check, not the command, is the authority.

import {
  type Check,
  code,
  type Command,
  type Context,
  currentBranch,
  type ExtensionPoint,
  filesAt,
  type Finding,
  gitOrNull,
  gitReason,
  isUuid,
  label,
  message,
  mustGit,
  parse,
  runGit,
  str,
  strs,
  table,
  textsAt,
  trunk,
  usageError,
  worktrees,
} from "../../core/api.ts"
import { changeNoteTrailers } from "./changes.ts"
import { plural } from "./worktrees.ts"

/** A landing: the branch, the trunk before it, and every file it changed, from the project root. */
export interface Landing {
  branch: string
  from: string
  /** The marker, once landed; the branch tip while the landing is checked. */
  to: string
  changed: string[]
}

/**
 * What a plugin says about a landing. `blocks` runs before the trunk moves, on the branch tip's files in the main
 * checkout, and names what the landing changed whose proofs are not current: any line refuses the landing unless it
 * is given a reason. `report` runs once the landing is made, and never refuses it.
 */
export interface LandingReport {
  name: string
  says: string
  blocks?(ctx: Context, landing: Landing): string[] | Promise<string[]>
  report?(ctx: Context, landing: Landing): string[] | Promise<string[]>
}

/** The trailer a marker carries when it landed with proofs not current, and why. */
export const STALE_PROOFS = "Stale-proofs"

/** The point this plugin declares: what `naima land` reports after a landing, any plugin contributing. */
export const landingReportsPoint: ExtensionPoint<LandingReport> = {
  id: "landing-reports",
  says:
    "what `naima land` checks before a branch lands and reports once it has: `name`, `says`, and `blocks(ctx, { branch, from, to, changed }) → lines`, what the landing changed whose proofs are not current, any line refusing the landing unless --stale-proofs gives the reason, or `report(ctx, landing) → lines`, printed after it, never blocking; `changed` is every file the landing changed, from the project root",
  noun: "landing report",
  key: (r) => r.name,
  validate: (v) => {
    const r = v as Partial<LandingReport> | null
    if (!r || typeof r !== "object" || typeof r.name !== "string") return "has no name"
    for (const k of ["blocks", "report"] as const) if (r[k] !== undefined && typeof r[k] !== "function") return `has a ${k} that is not a function`
    return r.blocks || r.report ? null : "has neither a blocks nor a report function"
  },
  gaps: (r) => (typeof r.says === "string" && r.says.trim() ? [] : ["does not say what it reports"]),
  document: (
    rs,
  ) => [
    "",
    "**Landing reports**, checked by `naima land` before a landing (blocks) or printed after it (reports)",
    ...table(["Report", "When", "What it says"], rs.map((r) => [code(r.name), r.blocks ? "blocks" : "reports", r.says])),
  ],
}

/** Every file between two commits, from the project root. */
const changedFiles = (root: string, from: string, to: string): string[] =>
  (gitOrNull(root, "diff", "--name-only", "--no-renames", "-z", from, to) ?? "").split("\0").filter(Boolean)

/** What every landing check finds not current, each line prefixed with its name; a check that fails says so and blocks nothing. */
async function blockingLanding(ctx: Context, landing: Landing): Promise<string[]> {
  ctx.reload()
  const out: string[] = []
  for (const c of ctx.registry.contributions("landing-reports")) {
    const check = c.value as LandingReport
    if (!check.blocks) continue
    try {
      for (const line of await check.blocks(ctx, landing)) out.push(`${c.name}: ${line}`)
    } catch (e) {
      ctx.out(`${c.name}: could not check: ${message(e)}`)
    }
  }
  return out
}

/** Each landing report's lines, each prefixed with the report's name; one that fails says so, and the landing stands. */
async function reportLanding(ctx: Context, landing: Landing): Promise<void> {
  ctx.reload()
  for (const c of ctx.registry.contributions("landing-reports")) {
    const report = (c.value as LandingReport).report
    if (!report) continue
    try {
      for (const line of await report(ctx, landing)) ctx.out(`${c.name}: ${line}`)
    } catch (e) {
      ctx.out(`${c.name}: could not report: ${message(e)}`)
    }
  }
}

/** The trailer a marker names each item it closes with. */
export const CLOSES = "Closes"

/** The message of the marker landing `branch`: its subject, a blank line, one trailer per item, then any other trailer. */
export const markerMessage = (branch: string, ids: string[], trailers: string[] = []): string =>
  `Land ${branch}\n\n${[...ids.map((id) => `${CLOSES}: ${id}`), ...trailers].join("\n")}\n`

/** An item as the branch tip has it: where it is, and whether a landing may close it. */
interface Landed {
  id: string
  ref: string
  /** Done (its status's category), or fixed (fixedOn set): what a landing may close. */
  closable: boolean
  status: string
}

/** The claims directory, as git names it. */
const claimsDir = (ctx: Context): string => `${ctx.trackerDir}/claims`

/** The branch a claim file's text records, and its items' ids and refs; null for one that does not parse. */
function claimOf(text: string): { branch?: string; items: { id: string; ref?: string }[] } | null {
  try {
    const c = JSON.parse(text) as { branch?: unknown; items?: unknown }
    const items = Array.isArray(c.items) ? c.items.filter((e): e is { id: string; ref?: string } => typeof e?.id === "string") : []
    return { ...(typeof c.branch === "string" ? { branch: c.branch } : {}), items }
  } catch {
    return null
  }
}

/**
 * The items `branch` claimed in its own commits (those `base` lacks): for each
 * claim file of the branch, its newest version that held items — what it
 * held just before it was released. One `git log` and one batch read.
 */
export function claimedInHistory(ctx: Context, base: string, branch: string): { id: string; ref?: string }[] {
  const log = gitOrNull(ctx.root, "log", "--format=%x1e%H", "--name-status", "--no-renames", `${base}..${branch}`, "--", claimsDir(ctx)) ?? ""
  const names: string[] = []
  const paths: string[] = []
  for (const block of log.split("\x1e").filter((b) => b.trim())) {
    const [sha = "", ...lines] = block.trim().split("\n")
    for (const line of lines) {
      const [status = "", path = ""] = line.split("\t")
      if (!path) continue
      names.push(status.startsWith("D") ? `${sha}^:${path}` : `${sha}:${path}`)
      paths.push(path)
    }
  }
  const texts = textsAt(ctx.root, names)
  const done = new Set<string>()
  const out = new Map<string, { id: string; ref?: string }>()
  texts.forEach((text, i) => {
    const path = paths[i] ?? ""
    if (done.has(path) || text === null) return
    const c = claimOf(text)
    if (!c || c.branch !== branch || !c.items.length) return
    done.add(path) // newest first: the first version with items is the one released
    for (const e of c.items) if (!out.has(e.id)) out.set(e.id, e)
  })
  return [...out.values()]
}

/** The meta.json paths under the tracker, `<data>/<dir>/<slug>/meta.json`, at `rev` that contain `needle`. */
function metaPathsWith(ctx: Context, rev: string, needle: string): string[] {
  const r = runGit(ctx.root, ["grep", "-l", "-F", "-e", needle, rev, "--", ctx.trackerDir])
  if (!r.ok) return []
  const depth = ctx.trackerDir.split("/").length + 3
  return r.out.split("\n").map((l) => l.slice(rev.length + 1)).filter((p) => p.endsWith("/meta.json") && p.split("/").length === depth)
}

/** An item's state as `rev` has it, found by its id. */
function itemAt(ctx: Context, rev: string, id: string): Landed | null {
  const paths = metaPathsWith(ctx, rev, id)
  const texts = textsAt(ctx.root, paths.map((p) => `${rev}:${p}`))
  for (const [i, text] of texts.entries()) {
    if (text === null) continue
    let meta: Record<string, unknown>
    try {
      meta = JSON.parse(text) as Record<string, unknown>
    } catch {
      continue
    }
    if (meta["id"] !== id) continue
    const [dir = "", slug = ""] = (paths[i] ?? "").slice(ctx.trackerDir.length + 1).split("/")
    const type = [...ctx.registry.types.values()].find((t) => t.dir === dir)
    const status = typeof meta["status"] === "string" ? meta["status"] : ""
    const def = type?.statuses && Object.hasOwn(type.statuses, status) ? type.statuses[status] : undefined
    const fixed = typeof meta["fixedOn"] === "string" && meta["fixedOn"] !== ""
    return { id, ref: `${type?.id ?? dir}/${slug}`, closable: def?.category === "done" || fixed, status }
  }
  return null
}

/** The id `ref` names: an id, an item of this checkout, or `<type or dir>/<slug>` at `rev`. */
function idOf(ctx: Context, rev: string, ref: string): string {
  if (isUuid(ref as unknown)) return ref
  try {
    return ctx.repo.resolve(ref).meta.id
  } catch {
    // Not here: an item filed on the branch, read from its tip.
  }
  const [head = "", slug = ""] = ref.split("/")
  const dir = ctx.registry.types.get(head)?.dir ?? head
  const text = slug ? textsAt(ctx.root, [`${rev}:${ctx.trackerDir}/${dir}/${slug}/meta.json`])[0] : null
  try {
    const id = text ? (JSON.parse(text) as { id?: unknown }).id : undefined
    if (typeof id === "string") return id
  } catch {
    // falls through to the refusal
  }
  throw new Error(`no item ${ref}, here or on ${rev}: name it by its id, or as <type>/<slug>`)
}

/**
 * Move `trunk` from `old` to `marker`, and only from `old`: git's
 * compare-and-swap, so a trunk that moved meanwhile is never overwritten.
 */
export function moveTrunk(root: string, trunkName: string, marker: string, old: string, reason: string): void {
  const r = runGit(root, ["update-ref", "-m", reason, `refs/heads/${trunkName}`, marker, old])
  if (!r.ok) {
    throw new Error(`${trunkName} moved while landing (it is no longer ${old.slice(0, 12)}): nothing landed — run naima land again (${gitReason(r)})`)
  }
}

/** Every refusal `land` makes, in order, before anything is written; the trunk, its tip and the items when none applies. */
function preconditions(ctx: Context, branch: string, closes: string[]): { main: string; old: string; tip: string; items: Landed[] } {
  const main = trunk(ctx.root)
  if (!main) throw new Error("no trunk (main, master, or origin's HEAD): nothing to land on")
  if (branch === main) throw new Error(`${branch} is the trunk: land a branch on it, not the trunk itself`)
  const trees = worktrees(ctx.root)
  if (!trees[0]?.self || currentBranch(ctx.root) !== main) {
    throw new Error(`land runs from the main checkout, on ${main}: ${trees[0]?.path ?? "the main worktree"} — only the coordinator lands`)
  }
  const tip = gitOrNull(ctx.root, "rev-parse", "--verify", "--quiet", `refs/heads/${branch}^{commit}`)
  if (!tip) throw new Error(`no branch ${branch}`)
  const old = mustGit(ctx.root, "rev-parse", `refs/heads/${main}`)
  if (runGit(ctx.root, ["merge-base", "--is-ancestor", old, tip]).ok === false) {
    throw new Error(`${main} is not an ancestor of ${branch}: merge ${main} into the branch (git merge ${main}, on the branch) and run its gates again`)
  }
  if (old === tip) throw new Error(`${branch} has nothing ${main} lacks: nothing to land`)
  const dirty = gitOrNull(ctx.root, "status", "--porcelain", "--untracked-files=no") ?? ""
  if (dirty) throw new Error(`the main checkout has uncommitted changes to tracked files: commit or set them aside first\n${dirty}`)
  const held = filesAt(ctx.root, tip, claimsDir(ctx), ".json").filter((f) => claimOf(f.text)?.branch === branch)
  if (held.length) {
    throw new Error(
      `${branch} still holds its claim (${
        held.map((f) => f.name).join(", ")
      }): release it on the branch (naima release, or claim --not-preparing) and commit the deletion`,
    )
  }
  const ids = closes.length ? closes.map((r) => idOf(ctx, tip, r)) : claimedInHistory(ctx, old, branch).map((e) => e.id)
  if (!ids.length) throw new Error(`${branch} claimed no item in its commits: name what it closes with --closes <item>`)
  const items = [...new Set(ids)].map((id) => {
    const it = itemAt(ctx, tip, id)
    if (!it) throw new Error(`${id} is not an item on ${branch}: a landing closes an item that exists`)
    return it
  })
  const open = items.filter((i) => !i.closable)
  if (open.length) {
    throw new Error(
      `${
        open.map((i) => `${i.ref} [${i.status}]`).join(", ")
      } is open and not fixed on ${branch}: a landing closes what it names — set its fixedOn on the branch, or split off what is left (naima new)`,
    )
  }
  return { main, old, tip, items }
}

export const land: Command = {
  name: "land",
  says:
    "land a branch on the trunk as one marker commit: a merge whose tree is the branch tip's and whose message names the items it closes (Closes: trailers); the shortcut for git merge --no-ff once the trunk is the branch's ancestor",
  enforces:
    "runs from the main checkout on the trunk, clean in tracked files; refuses a branch the trunk is not an ancestor of, one still holding a claim, one that names no item or an item open and not fixed, and one that changes a behaviour path of a repository with changes/config.json (the project, or a submodule) with no change note added, unless --no-change-note gives the reason; refuses, touching nothing, a branch that changes what has proofs not current — a property or a test suite reading a file it changed, outside models in development — as the landing checks find them on the branch tip's files, unless --stale-proofs gives the reason; moves the trunk only from the commit it read (compare-and-swap); once landed, prints what every landing report says of the files the landing changed, never undoing it",
  usage: 'land <branch> [--closes <item>]... [--no-change-note "<reason>"] [--stale-proofs "<reason>"]',
  options: [
    { name: "--closes", says: "an item the landing closes, instead of those the branch claimed in its commits; repeat for several" },
    {
      name: "--no-change-note",
      says:
        "why the branch changes behaviour paths with no change note — a refactor, a test, nothing a person or an agent sees; recorded in the marker as a No-change-note: trailer",
    },
    {
      name: "--stale-proofs",
      says:
        "why the branch lands although proofs of what it changed are not current — a suite that runs for days, left to the periodic run; recorded in the marker as a Stale-proofs: trailer",
    },
  ],
  examples: [
    "land agent/export-alpha",
    "land agent/export-alpha --closes export-drops",
    'land agent/tidy-loader --no-change-note "a refactor of the loader: nothing a person or an agent sees changes"',
    'land agent/scheduler --stale-proofs "the liveness property runs for two days: the nightly run checks it"',
  ],
  async run(args, ctx) {
    const p = parse(args, { closes: { type: "string", multiple: true }, "no-change-note": { type: "string" }, "stale-proofs": { type: "string" } })
    const branch = p.positionals[0]
    if (!branch || p.positionals.length > 1) throw usageError(this)
    const stale = str(p, "stale-proofs")
    if (stale !== undefined && (!stale.trim() || stale.includes("\n"))) throw new Error("--stale-proofs takes the reason, on one line")
    const { main, old, tip, items } = preconditions(ctx, branch, strs(p, "closes"))
    const trailers = changeNoteTrailers(ctx, branch, old, tip, str(p, "no-change-note"))
    const tree = mustGit(ctx.root, "rev-parse", `${tip}^{tree}`)
    const changed = changedFiles(ctx.root, old, tip)
    // The checkout takes the branch tip's files first, the trunk still where it was, refusing to overwrite an untracked
    // file: the landing checks read them there, and on a refusal the checkout goes back and nothing has moved.
    const synced = runGit(ctx.root, ["read-tree", "-m", "-u", old, tree])
    if (!synced.ok) throw new Error(`the main checkout could not take ${branch}'s files (${gitReason(synced)}): nothing landed`)
    const back = (): void => {
      const r = runGit(ctx.root, ["read-tree", "-m", "-u", tree, old])
      ctx.reload()
      if (!r.ok) ctx.err(`the main checkout could not go back to ${main}'s files (${gitReason(r)}): git checkout -f ${main}`)
    }
    let marker: string
    try {
      const notCurrent = await blockingLanding(ctx, { branch, from: old, to: tip, changed })
      if (notCurrent.length && stale === undefined) {
        throw new Error(
          `${branch} changes what has proofs not current:\n${notCurrent.map((l) => `  ${l}`).join("\n")}\n` +
            `run them on the branch and commit their runs (naima verify, naima metrics run --record), or land with --stale-proofs "<reason>" when they cannot be made current before landing: nothing landed`,
        )
      }
      if (notCurrent.length) {
        trailers.push(`${STALE_PROOFS}: ${stale!.trim()}`)
        for (const l of notCurrent) ctx.out(`${l} — landed anyway: ${stale!.trim()}`)
      }
      const made = runGit(ctx.root, ["commit-tree", tree, "-p", old, "-p", tip, "-F", "-"], { input: markerMessage(branch, items.map((i) => i.id), trailers) })
      if (!made.ok) throw new Error(`git commit-tree: ${gitReason(made)}`)
      marker = made.out.trim()
      moveTrunk(ctx.root, main, marker, old, `land: ${branch}`)
    } catch (e) {
      back()
      throw e
    }
    ctx.out(`landed ${branch} on ${main}: ${marker.slice(0, 12)}, closing ${items.map((i) => i.ref).join(", ")}`)
    await reportLanding(ctx, { branch, from: old, to: marker, changed })
    const subs = (gitOrNull(ctx.root, "diff-tree", "-r", "--no-commit-id", old, marker) ?? "").split("\n").filter((l) => /^:\d+ 160000 /.test(l))
    if (subs.length) ctx.out(`${plural(subs.length, "submodule")} moved: git submodule update --init`)
    ctx.out(`next: naima close each item once its proof is checked, then naima prune --branch ${branch} --write`)
    return 0
  },
}

interface FirstParent {
  sha: string
  parents: string[]
  tree: string
  subject: string
  closes: string[]
}

/** The trunk's first-parent line, oldest first, in one `git log`. */
function firstParentLine(root: string, main: string): FirstParent[] {
  const format = `%H%x1f%P%x1f%T%x1f%s%x1f%(trailers:key=${CLOSES},valueonly,separator=%x1d)%x1e`
  const out = gitOrNull(root, "log", "--first-parent", "--reverse", `--format=${format}`, `refs/heads/${main}`) ?? ""
  return out.split("\x1e").map((r) => r.replace(/^\n/, "")).filter(Boolean).map((r) => {
    const [sha = "", parents = "", tree = "", subject = "", closes = ""] = r.split("\x1f")
    return {
      sha,
      parents: parents.split(" ").filter(Boolean),
      tree,
      subject,
      closes: closes.split("\x1d").map((c) => c.trim()).filter(Boolean),
    }
  })
}

/** The tree of each commit, through one `git cat-file --batch-check`. */
function treesOf(root: string, commits: string[]): Map<string, string> {
  if (!commits.length) return new Map()
  const r = runGit(root, ["cat-file", "--batch-check=%(objectname)"], { input: commits.map((c) => `${c}^{tree}`).join("\n") + "\n" })
  const lines = r.ok ? r.out.split("\n") : []
  return new Map(commits.map((c, i) => [c, lines[i]?.trim() ?? ""]))
}

/** The item a `Closes:` value names in this checkout: by id, else as a path whose type may have changed since (closing moves it). */
function closedItem(ctx: Context, value: string) {
  const byId = ctx.repo.byId.get(value)
  if (byId) return byId
  for (const ref of [value, value.split("/").pop() ?? value]) {
    try {
      return ctx.repo.resolve(ref)
    } catch {
      // the next form, or unknown
    }
  }
  return undefined
}

/** Why a first-parent commit is not a marker; empty when it is one. */
function notAMarker(ctx: Context, c: FirstParent, trees: Map<string, string>): string[] {
  if (c.parents.length !== 2) return []
  const [first = "", second = ""] = c.parents
  const why: string[] = []
  if (!runGit(ctx.root, ["merge-base", "--is-ancestor", first, second]).ok) why.push("a merge not up to date: the branch did not contain the trunk")
  if (trees.get(second) !== c.tree) why.push("its tree is not the branch tip's")
  if (!c.closes.length) why.push(`it has no ${CLOSES}: trailer naming the item it closes`)
  for (const value of c.closes) {
    const item = closedItem(ctx, value)
    if (!item) why.push(`${CLOSES}: ${value} names no item`)
    else if (ctx.registry.types.get(item.type)?.statuses?.[item.meta.status]?.category !== "done" && !item.meta["fixedOn"]) {
      why.push(`${CLOSES}: ${label(item)} is open and not fixed`)
    }
  }
  return why
}

export const landingsAreMarkers: Check = {
  name: "landings-are-markers",
  says:
    "from the first landing marker on the trunk's first-parent line (a merge whose first parent the second contains, whose tree is the second's, with a Closes: trailer), every first-parent commit is a marker: a fast-forward, a commit made on the trunk, a merge not up to date, or one without a Closes: naming an item done or fixed is a note naming it. Before the first marker nothing is asked",
  run(ctx) {
    const main = trunk(ctx.root)
    if (!main) return []
    const line = firstParentLine(ctx.root, main)
    const merges = line.filter((c) => c.parents.length === 2)
    const trees = treesOf(ctx.root, merges.map((c) => c.parents[1] ?? ""))
    const start = line.findIndex((c) =>
      c.parents.length === 2 && c.closes.length > 0 && trees.get(c.parents[1] ?? "") === c.tree &&
      runGit(ctx.root, ["merge-base", "--is-ancestor", c.parents[0] ?? "", c.parents[1] ?? ""]).ok
    )
    if (start === -1) return []
    const out: Finding[] = []
    let run: FirstParent[] = []
    const flush = () => {
      if (!run.length) return
      const newest = run[run.length - 1]
      const oldest = run[0]
      if (!newest || !oldest) return
      const which = run.length === 1
        ? `${newest.sha.slice(0, 12)} "${newest.subject}"`
        : `${plural(run.length, "commit")} ${oldest.sha.slice(0, 12)}..${newest.sha.slice(0, 12)} ("${newest.subject}")`
      out.push({
        level: "note",
        message:
          `${main} took ${which} without a landing marker — a fast-forward or a commit made on ${main}: land branches with naima land (or git merge --no-ff, the trunk an ancestor of the branch, with a ${CLOSES}: trailer)`,
      })
      run = []
    }
    for (const c of line.slice(start + 1)) {
      if (c.parents.length !== 2) {
        run.push(c)
        continue
      }
      flush()
      const why = notAMarker(ctx, c, trees)
      if (why.length) out.push({ level: "note", message: `${main} took ${c.sha.slice(0, 12)} "${c.subject}", not a landing marker: ${why.join("; ")}` })
    }
    flush()
    return out
  },
}
