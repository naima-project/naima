// Landing: a branch enters the trunk as one marker commit — a merge whose
// first parent is the trunk, whose second is the branch tip that contains it,
// whose tree is the branch tip's, and whose message names the items it
// closes in `Closes:` trailers. `naima land` makes one; the check
// `landings-are-markers` reads the trunk's first-parent line for them. The
// command is a shortcut for `git merge --no-ff` after `git merge-base
// --is-ancestor`: the check, not the command, is the authority.

import { join, relative } from "node:path"
import { isDeepStrictEqual } from "node:util"
import {
  appliesTo,
  bool,
  type Check,
  code,
  CODE_TRAILER,
  type Command,
  type Context,
  currentBranch,
  DATA_FILE,
  type ExtensionPoint,
  filesAt,
  type Finding,
  gitOrNull,
  gitReason,
  isAncestor,
  isOpen,
  isUuid,
  type Item,
  label,
  message,
  META,
  mustGit,
  parse,
  runGit,
  saveMeta,
  str,
  strs,
  table,
  textsAt,
  TRACKER_TRAILER,
  trackerPath,
  trunk,
  usageError,
  WAIVERS,
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

/** The trailer that lets one commit onto the trunk by hand past the trunk guard, and says why. */
export const TRUNK_REASON = "Trunk-reason"

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

/** The claims directory, as git names it in the tracker's repository. */
const claimsDir = (ctx: Context): string => trackerPath(ctx.trackerPrefix, "claims")

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
  const log = gitOrNull(ctx.trackerGit, "log", "--format=%x1e%H", "--name-status", "--no-renames", `${base}..${branch}`, "--", claimsDir(ctx)) ?? ""
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
  const texts = textsAt(ctx.trackerGit, names)
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
  const r = runGit(ctx.trackerGit, ["grep", "-l", "-F", "-e", needle, rev, "--", ctx.trackerPrefix || "."])
  if (!r.ok) return []
  const depth = (ctx.trackerPrefix ? ctx.trackerPrefix.split("/").length : 0) + 3
  return r.out.split("\n").map((l) => l.slice(rev.length + 1)).filter((p) => p.endsWith("/meta.json") && p.split("/").length === depth)
}

/** An item's state as `rev` has it, found by its id. */
function itemAt(ctx: Context, rev: string, id: string): Landed | null {
  const paths = metaPathsWith(ctx, rev, id)
  const texts = textsAt(ctx.trackerGit, paths.map((p) => `${rev}:${p}`))
  for (const [i, text] of texts.entries()) {
    if (text === null) continue
    let meta: Record<string, unknown>
    try {
      meta = JSON.parse(text) as Record<string, unknown>
    } catch {
      continue
    }
    if (meta["id"] !== id) continue
    const [dir = "", slug = ""] = (paths[i] ?? "").slice(ctx.trackerPrefix ? ctx.trackerPrefix.length + 1 : 0).split("/")
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
  const text = slug ? textsAt(ctx.trackerGit, [`${rev}:${trackerPath(ctx.trackerPrefix, `${dir}/${slug}/meta.json`)}`])[0] : null
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

/** One repository's side of a landing: its trunk, the commit the trunk is at, and the branch tip (the trunk's commit when the branch is absent). */
interface Side {
  repo: string
  main: string
  old: string
  tip: string
}

/**
 * A repository's side of landing `branch`, refused unless run from its main checkout on its trunk, clean in tracked
 * files, with the trunk an ancestor of the branch. `name` says which repository when there are two; an `optional`
 * side may lack the branch: it then lands nothing.
 */
function sideOf(repo: string, branch: string, name: string, optional: boolean): Side {
  const main = trunk(repo)
  if (!main) throw new Error(`no trunk (main, master, or origin's HEAD)${name}: nothing to land on`)
  if (branch === main) throw new Error(`${branch} is the trunk: land a branch on it, not the trunk itself`)
  const trees = worktrees(repo)
  if (!trees[0]?.self || currentBranch(repo) !== main) {
    throw new Error(`land runs from the main checkout, on ${main}${name}: ${trees[0]?.path ?? "the main worktree"} — only the coordinator lands`)
  }
  const old = mustGit(repo, "rev-parse", `refs/heads/${main}`)
  const tip = gitOrNull(repo, "rev-parse", "--verify", "--quiet", `refs/heads/${branch}^{commit}`) ?? (optional ? old : null)
  if (!tip) throw new Error(`no branch ${branch}`)
  if (runGit(repo, ["merge-base", "--is-ancestor", old, tip]).ok === false) {
    throw new Error(
      `${main}${name} is not an ancestor of ${branch}: merge ${main} into the branch (git merge ${main}, on the branch${name}) and run its gates again`,
    )
  }
  const dirty = gitOrNull(repo, "status", "--porcelain", "--untracked-files=no") ?? ""
  if (dirty) throw new Error(`the main checkout${name} has uncommitted changes to tracked files: commit or set them aside first\n${dirty}`)
  return { repo, main, old, tip }
}

/** Every refusal `land` makes, in order, before anything is written; the trunk, its tip and the items when none applies. */
function preconditions(ctx: Context, branch: string, closes: string[]): { main: string; old: string; tip: string; items: Landed[] } {
  const { main, old, tip } = sideOf(ctx.root, branch, "", false)
  if (old === tip) throw new Error(`${branch} has nothing ${main} lacks: nothing to land`)
  return { main, old, tip, items: landedItems(ctx, branch, closes, old, tip) }
}

/**
 * The items a landing closes, read in the tracker's repository between its trunk `old` and the branch tip `tip`:
 * refused while the branch still holds its claim, when it names no item, or one open and not fixed.
 */
function landedItems(ctx: Context, branch: string, closes: string[], old: string, tip: string): Landed[] {
  const held = filesAt(ctx.trackerGit, tip, claimsDir(ctx), ".json").filter((f) => claimOf(f.text)?.branch === branch)
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
  return items
}

/** The field an item names the commits that fixed it in, when a plugin declares it: a list of hashes. */
const COMMITS = "commits"

/** The subject of the commit that records a marker in the items it closes. */
const recordSubject = (marker: string): string => `Record ${marker.slice(0, 12)} in the items it closes`

/**
 * Add the marker to the commits of each item it closes whose type has that field, in one commit on the trunk right
 * after the marker: the marker cannot name itself, and close asks for a commit reachable from the trunk. A failure
 * leaves the landing standing and says the hand step.
 */
function recordMarker(ctx: Context, marker: string, ids: string[]): void {
  const def = ctx.registry.fields.get(COMMITS)
  if (!def || def.kind !== "strings") return
  ctx.reload()
  const files: string[] = []
  const refs: string[] = []
  try {
    for (const id of ids) {
      const item = ctx.repo.byId.get(id)
      if (!item || !appliesTo(def, item.type)) continue
      const had = Array.isArray(item.meta[COMMITS]) ? (item.meta[COMMITS] as unknown[]).filter((h): h is string => typeof h === "string") : []
      if (had.includes(marker)) continue
      saveMeta(ctx, { ...item, meta: { ...item.meta, [COMMITS]: [...had, marker] } })
      files.push(relative(ctx.trackerGit, join(item.dir, META)))
      refs.push(label(item))
    }
    if (!files.length) return
    // In sibling mode the record is a tracker commit: it names the code marker it records, as every tracker commit does.
    const text = ctx.sibling ? `${recordSubject(marker)}\n\n${CODE_TRAILER}: ${marker}\n` : recordSubject(marker)
    const r = runGit(ctx.trackerGit, ["commit", "-q", "-m", text, "--", ...files])
    if (!r.ok) throw new Error(`git commit: ${gitReason(r)}`)
    ctx.out(`recorded ${marker.slice(0, 12)} in the commits of ${refs.join(", ")}`)
  } catch (e) {
    ctx.err(`could not record ${marker.slice(0, 12)} in the items it closes (${message(e)}): naima set <item> commits=${marker}, and commit it`)
  } finally {
    ctx.reload()
  }
}

/**
 * Whether a commit made on the trunk right after `marker` is the record land makes: it changes only the meta.json of
 * items the marker closes, and in each only adds the marker to commits.
 */
export function recordsMarker(ctx: Context, sha: string, files: { status: string; path: string }[], marker: { sha: string; closes: string[] }): boolean {
  if (!files.length) return false
  const data = ctx.trackerPrefix ? `${ctx.trackerPrefix}/` : ""
  for (const { status, path } of files) {
    if (status !== "M" || !path.startsWith(data) || !path.endsWith(`/${META}`)) return false
    const [before, after] = textsAt(ctx.trackerGit, [`${sha}^:${path}`, `${sha}:${path}`])
    let a: Record<string, unknown>, b: Record<string, unknown>
    try {
      a = JSON.parse(before ?? "") as Record<string, unknown>
      b = JSON.parse(after ?? "") as Record<string, unknown>
    } catch {
      return false
    }
    if (typeof b["id"] !== "string" || !marker.closes.includes(b["id"])) return false
    const had = Array.isArray(a[COMMITS]) ? a[COMMITS] as unknown[] : []
    if (!isDeepStrictEqual(b[COMMITS], [...had, marker.sha])) return false
    const { [COMMITS]: _a, ...restA } = a
    const { [COMMITS]: _b, ...restB } = b
    if (!isDeepStrictEqual(restA, restB)) return false
  }
  return true
}

/** The message of the code marker landing `branch` in sibling mode: no item, only the tracker commit it pairs with, and the code's own trailers. */
export const codeMarkerMessage = (branch: string, tracker: string, trailers: string[] = []): string =>
  `Land ${branch}\n\n${[`${TRACKER_TRAILER}: ${tracker}`, ...trailers].join("\n")}\n`

/** A first-parent commit of a trunk carrying the trailer asked for: its subject, its parents and the trailer's value. */
interface Paired {
  sha: string
  parents: string[]
  subject: string
  value: string
  closes: string[]
}

/** The newest `limit` first-parent commits of `main` in `repo` that carry the trailer `key`, newest first. */
function pairedOn(repo: string, main: string, key: string, limit = 500): Paired[] {
  const format = `%H%x1f%P%x1f%s%x1f%(trailers:key=${key},valueonly,separator=%x1d)%x1f%(trailers:key=${CLOSES},valueonly,separator=%x1d)%x1e`
  const out = gitOrNull(repo, "log", "--first-parent", `-n${limit}`, `--format=${format}`, `refs/heads/${main}`) ?? ""
  return out.split("\x1e").map((r) => r.replace(/^\n/, "")).filter(Boolean).flatMap((r) => {
    const [sha = "", parents = "", subject = "", value = "", closes = ""] = r.split("\x1f")
    const v = value.split("\x1d")[0]?.trim() ?? ""
    return v ? [{ sha, parents: parents.split(" ").filter(Boolean), subject, value: v, closes: closes.split("\x1d").map((c) => c.trim()).filter(Boolean) }] : []
  })
}

/** The branch a marker lands, from its subject `Land <branch>`. */
const landedBranch = (subject: string): string | null => subject.match(/^Land (\S+)$/)?.[1] ?? null

/** Read a branch tip's tree into a main checkout standing at `from`, refusing to overwrite an untracked file. */
const takeTree = (repo: string, from: string, tree: string) => runGit(repo, ["read-tree", "-m", "-u", from, tree])

/**
 * Land `branch` in sibling mode, both sides. The tracker's trunk takes a marker first — the items it closes in
 * `Closes:`, the code tip in `Code:` — then the code's trunk takes one naming that tracker marker in `Tracker:` and
 * nothing of the tracker else; last, the tracker records the code marker in the items it closes, in a commit whose
 * `Code:` names it. Two repositories cannot move at once: a failure after the tracker moved says the command that
 * finishes the landing, `land --repair`, and `landings-paired` notes it until then.
 */
async function landBoth(ctx: Context, branch: string, closes: string[], noChangeNote: string | undefined, stale: string | undefined): Promise<number> {
  const code = sideOf(ctx.root, branch, "", false)
  const trk = sideOf(ctx.trackerGit, branch, " in the tracker", true)
  if (code.old === code.tip && trk.old === trk.tip) throw new Error(`${branch} has nothing ${code.main} lacks, in the code or in the tracker: nothing to land`)
  const items = landedItems(ctx, branch, closes, trk.old, trk.tip)
  const ids = items.map((i) => i.id)
  const codeMoves = code.old !== code.tip
  const trailers = codeMoves ? changeNoteTrailers(ctx, branch, code.old, code.tip, noChangeNote) : []
  const codeTree = mustGit(ctx.root, "rev-parse", `${code.tip}^{tree}`)
  const trkTree = mustGit(ctx.trackerGit, "rev-parse", `${trk.tip}^{tree}`)
  const changed = [
    ...changedFiles(ctx.root, code.old, code.tip),
    ...changedFiles(ctx.trackerGit, trk.old, trk.tip).map((f) => `${ctx.trackerDir}/${f}`),
  ]
  // Both checkouts take the branch tips' files, the trunks still where they were: the landing checks read them there.
  const synced = takeTree(ctx.root, code.old, codeTree)
  if (!synced.ok) throw new Error(`the main checkout could not take ${branch}'s files (${gitReason(synced)}): nothing landed`)
  const backCode = (): void => {
    const r = takeTree(ctx.root, codeTree, code.old)
    if (!r.ok) ctx.err(`the main checkout could not go back to ${code.main}'s files (${gitReason(r)}): git checkout -f ${code.main}`)
  }
  const backTracker = (): void => {
    const r = takeTree(ctx.trackerGit, trkTree, trk.old)
    if (!r.ok) ctx.err(`the tracker could not go back to its ${trk.main}'s files (${gitReason(r)}): git -C ${ctx.trackerDir} checkout -f ${trk.main}`)
  }
  const trkSynced = takeTree(ctx.trackerGit, trk.old, trkTree)
  if (!trkSynced.ok) {
    backCode()
    throw new Error(`the tracker could not take ${branch}'s files (${gitReason(trkSynced)}): nothing landed`)
  }
  let tm: string
  try {
    const notCurrent = await blockingLanding(ctx, { branch, from: code.old, to: code.tip, changed })
    const own: string[] = []
    if (notCurrent.length && stale === undefined) {
      throw new Error(
        `${branch} changes what has proofs not current:\n${notCurrent.map((l) => `  ${l}`).join("\n")}\n` +
          `run them on the branch and commit their runs (naima verify, naima metrics run --record), or land with --stale-proofs "<reason>" when they cannot be made current before landing: nothing landed`,
      )
    }
    if (notCurrent.length) {
      // The reason may name tracker content: it is recorded in the tracker's marker only.
      own.push(`${STALE_PROOFS}: ${stale!.trim()}`)
      for (const l of notCurrent) ctx.out(`${l} — landed anyway: ${stale!.trim()}`)
    }
    const parents = trk.tip === trk.old ? ["-p", trk.old] : ["-p", trk.old, "-p", trk.tip]
    const made = runGit(ctx.trackerGit, ["commit-tree", trkTree, ...parents, "-F", "-"], {
      input: markerMessage(branch, ids, [`${CODE_TRAILER}: ${code.tip}`, ...own]),
    })
    if (!made.ok) throw new Error(`git commit-tree: ${gitReason(made)}`)
    tm = made.out.trim()
    moveTrunk(ctx.trackerGit, trk.main, tm, trk.old, `land: ${branch}`)
  } catch (e) {
    backCode()
    backTracker()
    ctx.reload()
    throw e
  }
  ctx.out(`landed ${branch} on the tracker's ${trk.main}: ${tm.slice(0, 12)}, closing ${items.map((i) => i.ref).join(", ")}`)
  let cm: string | null = null
  if (codeMoves) {
    try {
      const made = runGit(ctx.root, ["commit-tree", codeTree, "-p", code.old, "-p", code.tip, "-F", "-"], { input: codeMarkerMessage(branch, tm, trailers) })
      if (!made.ok) throw new Error(`git commit-tree: ${gitReason(made)}`)
      cm = made.out.trim()
      const r = runGit(ctx.root, ["update-ref", "-m", `land: ${branch}`, `refs/heads/${code.main}`, cm, code.old])
      if (!r.ok) throw new Error(`${code.main} moved while landing (it is no longer ${code.old.slice(0, 12)}): ${gitReason(r)}`)
    } catch (e) {
      backCode()
      ctx.reload()
      throw new Error(`${message(e)} — the tracker has landed ${branch} and the code has not: naima land ${branch} --repair finishes it`)
    }
    ctx.out(`landed ${branch} on ${code.main}: ${cm.slice(0, 12)}, naming tracker commit ${tm.slice(0, 12)} and nothing else of the tracker`)
  } else {
    ctx.out(`${branch} changes no code: ${code.main} stays at ${code.old.slice(0, 12)}, which the tracker's marker names`)
  }
  recordMarker(ctx, cm ?? code.tip, ids)
  await reportLanding(ctx, { branch, from: code.old, to: cm ?? code.old, changed })
  const subs = cm ? (gitOrNull(ctx.root, "diff-tree", "-r", "--no-commit-id", code.old, cm) ?? "").split("\n").filter((l) => /^:\d+ 160000 /.test(l)) : []
  if (subs.length) ctx.out(`${plural(subs.length, "submodule")} moved: git submodule update --init`)
  ctx.out(nextAfterLanding(ctx, ids, branch))
  return 0
}

/** What follows a landing: closing those of its items that are closed with a proof (a release, say, is not), then the prune. */
function nextAfterLanding(ctx: Context, ids: readonly string[], branch: string): string {
  ctx.reload()
  const fixable = ctx.registry.fields.get("fixedOn")
  const closable = ids.map((id) => ctx.repo.byId.get(id)).filter((i): i is Item => !!i && !!fixable && appliesTo(fixable, i.type) && isOpen(ctx, i))
  const prune = `naima prune --branch ${branch} --write`
  return closable.length ? `next: naima close ${closable.map(label).join(", ")} once each one's proof is checked, then ${prune}` : `next: ${prune}`
}

/** The ids of the items a tracker marker closes whose type records commits and that do not record `commit` yet. */
function unrecorded(ctx: Context, ids: string[], commit: string): string[] {
  const def = ctx.registry.fields.get(COMMITS)
  if (!def || def.kind !== "strings") return []
  ctx.reload()
  return ids.filter((id) => {
    const item = ctx.repo.byId.get(id)
    if (!item || !appliesTo(def, item.type)) return false
    const had = Array.isArray(item.meta[COMMITS]) ? item.meta[COMMITS] as unknown[] : []
    return !had.includes(commit)
  })
}

/**
 * `land <branch> --repair`: finish a landing that moved one repository and not the other. From the newest tracker
 * marker of `branch`: the code marker it lacks is made from the code commit its `Code:` trailer names, and the record
 * of the code marker in the items it closes is made when missing. Idempotent: a landing paired on both sides is left
 * as it is, and said.
 */
function repairLanding(ctx: Context, branch: string): number {
  const cmain = trunk(ctx.root)
  const tmain = trunk(ctx.trackerGit)
  if (!cmain || !tmain) throw new Error("no trunk (main, master, or origin's HEAD) in the code or in the tracker: nothing to repair")
  for (const [repo, main, name] of [[ctx.root, cmain, ""], [ctx.trackerGit, tmain, " in the tracker"]] as const) {
    const trees = worktrees(repo)
    if (!trees[0]?.self || currentBranch(repo) !== main) {
      throw new Error(`land --repair runs from the main checkout, on ${main}${name}: ${trees[0]?.path ?? "the main worktree"} — only the coordinator lands`)
    }
    const dirty = gitOrNull(repo, "status", "--porcelain", "--untracked-files=no") ?? ""
    if (dirty) throw new Error(`the main checkout${name} has uncommitted changes to tracked files: commit or set them aside first\n${dirty}`)
  }
  const tm = pairedOn(ctx.trackerGit, tmain, CODE_TRAILER).find((m) => landedBranch(m.subject) === branch && m.closes.length)
  if (!tm) throw new Error(`${branch} has no landing on the tracker's ${tmain}: naima land ${branch}`)
  let cm = pairedOn(ctx.root, cmain, TRACKER_TRAILER).find((m) => m.value === tm.sha)?.sha ?? null
  let did = false
  if (!cm && !isAncestor(ctx.root, tm.value, cmain)) {
    const old = mustGit(ctx.root, "rev-parse", `refs/heads/${cmain}`)
    if (!isAncestor(ctx.root, old, tm.value)) {
      throw new Error(
        `${cmain} moved past where the tracker landed ${branch}: ${
          tm.value.slice(0, 12)
        } does not contain it — merge ${cmain} into the branch and land it again`,
      )
    }
    const tree = mustGit(ctx.root, "rev-parse", `${tm.value}^{tree}`)
    const synced = takeTree(ctx.root, old, tree)
    if (!synced.ok) throw new Error(`the main checkout could not take ${branch}'s files (${gitReason(synced)}): nothing repaired`)
    try {
      const made = runGit(ctx.root, ["commit-tree", tree, "-p", old, "-p", tm.value, "-F", "-"], { input: codeMarkerMessage(branch, tm.sha) })
      if (!made.ok) throw new Error(`git commit-tree: ${gitReason(made)}`)
      cm = made.out.trim()
      moveTrunk(ctx.root, cmain, cm, old, `land --repair: ${branch}`)
    } catch (e) {
      takeTree(ctx.root, tree, old)
      throw e
    }
    ctx.out(`landed ${branch} on ${cmain}: ${cm.slice(0, 12)}, naming tracker commit ${tm.sha.slice(0, 12)} — the landing is paired`)
    did = true
  }
  const recorded = cm ?? tm.value
  const missing = unrecorded(ctx, tm.closes, recorded)
  if (missing.length) {
    recordMarker(ctx, recorded, missing)
    did = true
  }
  if (!did) ctx.out(`nothing to repair: ${branch} is landed on both sides, paired (tracker ${tm.sha.slice(0, 12)}, code ${recorded.slice(0, 12)})`)
  return 0
}

/**
 * Sibling mode: every landing is paired. A tracker marker whose `Code:` commit the code's trunk lacks is a landing
 * the code has not taken; a code marker whose `Tracker:` commit is not a marker on the tracker's trunk naming the code
 * tip it merged, a pairing that does not hold; and a landing whose record is missing, a note. Each names
 * `naima land <branch> --repair`. The newest 50 markers of each side are read.
 */
export const landingsPaired: Check = {
  name: "landings-paired",
  says:
    "with the tracker in a repository of its own, every landing is made on both sides and their trailers match: a tracker marker (Closes:, Code:) whose code commit the code's trunk does not hold, or a code marker (Tracker:) whose tracker commit is not a marker on the tracker's trunk naming the code it merged, is a problem naming naima land <branch> --repair, which finishes it; a landing whose code marker is not recorded in the commits of the items it closes is a note naming the same command",
  run(ctx) {
    if (!ctx.sibling) return []
    const cmain = trunk(ctx.root)
    const tmain = trunk(ctx.trackerGit)
    if (!cmain || !tmain) return []
    const tms = pairedOn(ctx.trackerGit, tmain, CODE_TRAILER, 50).filter((m) => landedBranch(m.subject) && m.closes.length)
    const cms = pairedOn(ctx.root, cmain, TRACKER_TRAILER, 50).filter((m) => landedBranch(m.subject))
    const out: Finding[] = []
    const repair = (b: string) => `naima land ${b} --repair`
    for (const tm of tms) {
      const b = landedBranch(tm.subject) ?? ""
      if (!isAncestor(ctx.root, tm.value, cmain)) {
        out.push({
          level: "problem",
          subject: tm.sha,
          message: `the tracker landed ${b} (${tm.sha.slice(0, 12)}) and the code did not: ${cmain} lacks ${
            tm.value.slice(0, 12)
          }, the code its Code: trailer names — ${repair(b)}`,
        })
        continue
      }
      const cm = cms.find((m) => m.value === tm.sha)
      const missing = unrecorded(ctx, tm.closes, cm?.sha ?? tm.value)
      if (missing.length) {
        out.push({
          level: "note",
          subject: tm.sha,
          message: `the landing of ${b} is not recorded in the commits of ${missing.length} item(s) it closes, so naima close cannot find it — ${repair(b)}`,
        })
      }
    }
    for (const cm of cms) {
      const b = landedBranch(cm.subject) ?? ""
      const tm = tms.find((m) => m.sha === cm.value)
      const onTrunk = tm !== undefined || isAncestor(ctx.trackerGit, cm.value, tmain)
      if (!onTrunk) {
        out.push({
          level: "problem",
          subject: cm.sha,
          message: `the code landed ${b} (${cm.sha.slice(0, 12)}) naming tracker commit ${cm.value.slice(0, 12)}, which is not on the tracker's ${tmain} — ${
            repair(b)
          }`,
        })
      } else if (tm && cm.parents[1] && tm.value !== cm.parents[1]) {
        out.push({
          level: "problem",
          subject: cm.sha,
          message: `the code marker of ${b} (${cm.sha.slice(0, 12)}) merged ${cm.parents[1].slice(0, 12)}, but its tracker marker names ${
            tm.value.slice(0, 12)
          } in Code: — the trailers do not match`,
        })
      }
    }
    return out
  },
}

export const land: Command = {
  name: "land",
  says:
    "land a branch on the trunk as one marker commit: a merge whose tree is the branch tip's and whose message names the items it closes (Closes: trailers); the shortcut for git merge --no-ff once the trunk is the branch's ancestor",
  enforces:
    "runs from the main checkout on the trunk, clean in tracked files; refuses a branch the trunk is not an ancestor of, one still holding a claim, one that names no item or an item open and not fixed, and one that changes a behaviour path of a repository with changes/config.json (the project, or a submodule) with no change note added, unless --no-change-note gives the reason; refuses, touching nothing, a branch that changes what has proofs not current — a property or a test suite reading a file it changed, outside models in development — as the landing checks find them on the branch tip's files, unless --stale-proofs gives the reason; moves the trunk only from the commit it read (compare-and-swap); once landed, adds the marker to the commits of each item it closes whose type has that field, in one commit on the trunk right after the marker, so that naima close finds a commit reachable from the trunk; then prints what every landing report says of the files the landing changed, never undoing it",
  usage: 'land <branch> [--closes <item>]... [--no-change-note "<reason>"] [--stale-proofs "<reason>"] | land <branch> --repair',
  options: [
    {
      name: "--repair",
      says:
        "with the tracker in a repository of its own: finish a landing that moved one repository and not the other — make the code marker the tracker's marker names, and record it in the items it closes; does nothing to a landing already paired",
    },
    { name: "--closes", says: "an item the landing closes, instead of those the branch claimed in its commits; repeat for several" },
    {
      name: "--no-change-note",
      says:
        "why the branch changes behaviour paths with no change note — a refactor, a test, nothing a person or an agent sees; recorded in the marker as a No-change-note: trailer",
    },
    {
      name: "--stale-proofs",
      says:
        "why the branch lands although proofs of what it changed are not current — a suite that runs for days, due as a long run the owner starts; recorded in the marker as a Stale-proofs: trailer",
    },
  ],
  examples: [
    "land agent/export-alpha",
    "land agent/export-alpha --closes export-drops",
    'land agent/tidy-loader --no-change-note "a refactor of the loader: nothing a person or an agent sees changes"',
    'land agent/scheduler --stale-proofs "the liveness property runs for two days: it is due as a long run, and the owner will start it"',
  ],
  async run(args, ctx) {
    const p = parse(args, {
      closes: { type: "string", multiple: true },
      "no-change-note": { type: "string" },
      "stale-proofs": { type: "string" },
      repair: { type: "boolean" },
    })
    const branch = p.positionals[0]
    if (!branch || p.positionals.length > 1) throw usageError(this)
    const stale = str(p, "stale-proofs")
    if (stale !== undefined && (!stale.trim() || stale.includes("\n"))) throw new Error("--stale-proofs takes the reason, on one line")
    if (bool(p, "repair")) {
      if (!ctx.sibling) {
        throw new Error("land --repair finishes a landing of a tracker kept in a repository of its own: this project's tracker is committed with its code")
      }
      return repairLanding(ctx, branch)
    }
    if (ctx.sibling) return await landBoth(ctx, branch, strs(p, "closes"), str(p, "no-change-note"), stale)
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
    recordMarker(ctx, marker, items.map((i) => i.id))
    await reportLanding(ctx, { branch, from: old, to: marker, changed })
    const subs = (gitOrNull(ctx.root, "diff-tree", "-r", "--no-commit-id", old, marker) ?? "").split("\n").filter((l) => /^:\d+ 160000 /.test(l))
    if (subs.length) ctx.out(`${plural(subs.length, "submodule")} moved: git submodule update --init`)
    ctx.out(nextAfterLanding(ctx, items.map((i) => i.id), branch))
    return 0
  },
}

export interface FirstParent {
  sha: string
  parents: string[]
  tree: string
  subject: string
  closes: string[]
  /** The code commit a tracker commit names in its `Code:` trailer, in sibling mode; empty otherwise. */
  code: string
  /** Why the owner let it onto the trunk by hand, from its `Trunk-reason:` trailers; empty otherwise. */
  reason: string
}

/** The trunk's first-parent line, oldest first, in one `git log`. */
function firstParentLine(root: string, main: string): FirstParent[] {
  const format =
    `%H%x1f%P%x1f%T%x1f%s%x1f%(trailers:key=${CLOSES},valueonly,separator=%x1d)%x1f%(trailers:key=${CODE_TRAILER},valueonly,separator=%x1d)%x1f%(trailers:key=${TRUNK_REASON},valueonly,separator=%x1d)%x1e`
  const out = gitOrNull(root, "log", "--first-parent", "--reverse", `--format=${format}`, `refs/heads/${main}`) ?? ""
  return out.split("\x1e").map((r) => r.replace(/^\n/, "")).filter(Boolean).map((r) => {
    const [sha = "", parents = "", tree = "", subject = "", closes = "", code = "", reason = ""] = r.split("\x1f")
    return {
      sha,
      parents: parents.split(" ").filter(Boolean),
      tree,
      subject,
      closes: closes.split("\x1d").map((c) => c.trim()).filter(Boolean),
      code: code.split("\x1d")[0]?.trim() ?? "",
      reason: reason.split("\x1d").map((c) => c.trim()).filter(Boolean).join("; "),
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

/** Each commit made on the trunk after `from`, merges left out, with the status and path of every file it changed, in one `git log`. */
function directChanges(root: string, main: string, from: string): Map<string, { status: string; path: string }[]> {
  const out =
    gitOrNull(root, "log", "--first-parent", "--no-merges", "--no-renames", "--name-status", "-z", "--format=%x1e%H", `${from}..refs/heads/${main}`) ?? ""
  const commits = new Map<string, { status: string; path: string }[]>()
  for (const record of out.split("\x1e").filter(Boolean)) {
    const [sha = "", ...rest] = record.split("\0")
    const tokens = rest.map((t) => t.replace(/^\n/, "")).filter(Boolean)
    const files: { status: string; path: string }[] = []
    for (let i = 0; i + 1 < tokens.length; i += 2) files.push({ status: tokens[i] ?? "", path: tokens[i + 1] ?? "" })
    commits.set(sha.trim(), files)
  }
  return commits
}

/**
 * Whether a commit made on the trunk only adds to the tracker data: every file it changed is in the data directory,
 * outside rules, waivers and naima.json, and is new, or is an item's README.md to which it only adds lines (its
 * meta.json untouched, since a changed meta.json is a file that is not new). The READMEs are diffed only here.
 */
export function onlyAddsTrackerData(ctx: Context, sha: string, files: { status: string; path: string }[]): boolean {
  if (!files.length) return false
  const data = ctx.trackerPrefix ? `${ctx.trackerPrefix}/` : ""
  const kept = [ctx.registry.types.get("rules")?.dir ?? "rules", WAIVERS].map((d) => `${data}${d}/`)
  const itemDirs = new Set([...ctx.registry.types.values()].map((t) => t.dir))
  const readmes: string[] = []
  for (const { status, path } of files) {
    if (!path.startsWith(data) || path === `${data}${DATA_FILE}` || kept.some((k) => path.startsWith(k))) return false
    if (status === "A") continue
    const [dir = "", , name, ...more] = path.slice(data.length).split("/")
    if (status !== "M" || name !== "README.md" || more.length || !itemDirs.has(dir)) return false
    readmes.push(path)
  }
  if (!readmes.length) return true
  const r = runGit(ctx.trackerGit, ["diff", "--numstat", "-z", `${sha}^`, sha, "--", ...readmes])
  if (!r.ok) return false
  const counts = r.out.split("\0").filter((l) => l.trim()).map((l) => l.replace(/^\n/, "").split("\t"))
  return counts.length === readmes.length && counts.every(([, deleted]) => deleted === "0")
}

/**
 * Whether a commit made on the trunk only closes items, as `naima close` does: every file it changed is in the data
 * directory, each item it removes from its type's folder is added under the closed archive with the same files, and
 * anything else it adds is new, outside rules, waivers and naima.json, as a commit that only adds to the tracker.
 */
export function onlyClosesItems(ctx: Context, sha: string, files: { status: string; path: string }[]): boolean {
  if (!files.length) return false
  const data = ctx.trackerPrefix ? `${ctx.trackerPrefix}/` : ""
  const closed = ctx.registry.types.get("closed")?.dir
  if (!closed) return false
  const itemDirs = new Set([...ctx.registry.types.values()].map((t) => t.dir).filter((d) => d !== closed))
  const kept = [ctx.registry.types.get("rules")?.dir ?? "rules", WAIVERS].map((d) => `${data}${d}/`)
  // A group's status follows its items (an epic's): closing its last item moves it, in the same commit.
  const groups = new Set([...ctx.registry.types.values()].filter((t) => t.traits?.includes("group")).map((t) => t.dir))
  const removed = new Set<string>()
  const added = new Set<string>()
  const slugs = new Set<string>()
  for (const { status, path } of files) {
    if (!path.startsWith(data)) return false
    const [dir = "", slug = "", ...rest] = path.slice(data.length).split("/")
    if (status === "D" && itemDirs.has(dir) && slug && rest.length) {
      removed.add(`${slug}/${rest.join("/")}`)
      slugs.add(slug)
    } else if (status === "A" && dir === closed && slug && rest.length) added.add(`${slug}/${rest.join("/")}`)
    else if (status === "A" && !kept.some((k) => path.startsWith(k)) && path !== `${data}${DATA_FILE}`) continue // a new record beside, as a metrics record
    else if (status === "M" && rest.join("/") === META && groups.has(dir) && onlyStatusChanged(ctx, sha, path)) continue // the epic the close finishes
    else return false
  }
  if (!removed.size) return false
  return [...removed].every((f) => added.has(f)) && [...added].every((f) => slugs.has(f.split("/")[0] ?? ""))
}

/** Whether a commit made on the trunk is naima init's: it adds the tracker's naima.json, so the tracker begins with it. */
export function initsTracker(ctx: Context, files: { status: string; path: string }[]): boolean {
  const data = ctx.trackerPrefix ? `${ctx.trackerPrefix}/` : ""
  return files.some(({ status, path }) => status === "A" && path === `${data}${DATA_FILE}`)
}

/** Whether the commit changed nothing in the item file at `path` but its status. */
function onlyStatusChanged(ctx: Context, sha: string, path: string): boolean {
  const read = (rev: string): Record<string, unknown> | null => {
    const r = runGit(ctx.trackerGit, ["show", `${rev}:${path}`])
    try {
      return r.ok ? (JSON.parse(r.out) as Record<string, unknown>) : null
    } catch {
      return null
    }
  }
  const before = read(`${sha}^`), after = read(sha)
  if (!before || !after) return false
  const { status: _b, ...restBefore } = before
  const { status: _a, ...restAfter } = after
  return isDeepStrictEqual(restBefore, restAfter)
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

/** The note on a commit the owner let onto the trunk by hand, past the trunk guard, with its reason. */
const byHand = (main: string, c: FirstParent): string =>
  `${main} took ${c.sha.slice(0, 12)} "${c.subject}" by hand, past the trunk guard, with the reason: ${c.reason}`

/** Why a first-parent commit is not a marker; empty when it is one. */
function notAMarker(ctx: Context, c: FirstParent, trees: Map<string, string>): string[] {
  if (c.parents.length !== 2) return []
  const [first = "", second = ""] = c.parents
  const why: string[] = []
  if (!runGit(ctx.trackerGit, ["merge-base", "--is-ancestor", first, second]).ok) why.push("a merge not up to date: the branch did not contain the trunk")
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

/** What the trunk guard adds to the check while it is on: the commit it asks from, and the commits it also accepts. */
export interface Guarded {
  from(ctx: Context, repo: string, line: readonly FirstParent[]): number
  accepts(ctx: Context, sha: string, files: { status: string; path: string }[]): boolean
}

export const landingsAreMarkers = (guarded: Guarded | null = null): Check => ({
  name: "landings-are-markers",
  says:
    "from the first landing marker on the trunk's first-parent line (a merge whose first parent the second contains, whose tree is the second's, with a Closes: trailer), every first-parent commit is a marker: a fast-forward, a commit made on the trunk, a merge not up to date, or one without a Closes: naming an item done or fixed is a note naming it, one note per commit, with the commit as its subject so that a waiver can accept it. A commit made on the trunk that only adds to the tracker data — new files in the data directory outside rules/, waivers/ and naima.json, and lines added to an item's README.md, its meta.json untouched — is accepted without a note, and so is a commit that only closes items as naima close does (each moved whole from its type's folder to the closed archive), the commit right after a marker that only adds the marker to the commits of items it closes, the record naima land makes, and naima init's commit, the one that adds naima.json. Any other tracker step that changes more than it adds (an update of Naima, a waiver, a release record, an epic set done) is made on an item's branch and landed. Before the first marker nothing is asked, unless the trunk guard is on: then the check asks from the commit that added the guard's hook to the trunk, so a project is not noted for what it committed before the guard; a commit the owner let through the guard with a Trunk-reason: trailer is a note that gives the reason",
  run(ctx) {
    // The markers that close items are the tracker's: the project's trunk, or the tracker's own in sibling mode.
    const repo = ctx.trackerGit
    const main = trunk(repo)
    if (!main) return []
    const line = firstParentLine(repo, main)
    const merges = line.filter((c) => c.parents.length === 2)
    const trees = treesOf(repo, merges.map((c) => c.parents[1] ?? ""))
    const firstMarker = line.findIndex((c) =>
      c.parents.length === 2 && c.closes.length > 0 && trees.get(c.parents[1] ?? "") === c.tree &&
      runGit(repo, ["merge-base", "--is-ancestor", c.parents[0] ?? "", c.parents[1] ?? ""]).ok
    )
    // From the first marker, or from the commit that put the guard on the trunk when that is earlier.
    const guardStart = guarded ? guarded.from(ctx, repo, line) : -1
    const start = [firstMarker, guardStart].filter((i) => i !== -1).reduce((a, b) => Math.min(a, b), Infinity)
    if (start === Infinity) return []
    const direct = directChanges(repo, main, line[start]?.sha ?? "")
    const waive = (sha: string) => `, or accept it once: naima waive landings-are-markers ${sha} --reason "<why>" --as <who>`
    const out: Finding[] = []
    /** A tracker marker of a branch that changed no tracker file: one parent, no change, Closes: and Code: trailers. */
    const emptyMarker = (c: FirstParent | undefined) => !!c && ctx.sibling && c.parents.length === 1 && c.closes.length > 0 && !!c.code
    for (const [i, c] of line.entries()) {
      if (i <= start) continue
      if (c.parents.length !== 2) {
        const files = direct.get(c.sha) ?? []
        if (emptyMarker(c) && !files.length) continue
        if (initsTracker(ctx, files) || onlyAddsTrackerData(ctx, c.sha, files) || onlyClosesItems(ctx, c.sha, files)) continue
        if (guarded?.accepts(ctx, c.sha, files)) continue
        const prev = line[i - 1]
        const afterMarker = prev && prev.closes.length && (prev.parents.length === 2 || emptyMarker(prev))
        // In sibling mode the record names the code marker, in its Code: trailer; otherwise the marker just before it.
        if (afterMarker && recordsMarker(ctx, c.sha, files, { sha: ctx.sibling ? c.code : prev.sha, closes: prev.closes })) continue
        if (c.reason) {
          out.push({ level: "note", subject: c.sha, message: byHand(main, c) + waive(c.sha) })
          continue
        }
        out.push({
          level: "note",
          subject: c.sha,
          message: `${main} took ${c.sha.slice(0, 12)} "${c.subject}" without a landing marker — a fast-forward, or a commit made on ${main} ` +
            `that does more than add to the tracker data: land branches with naima land (or git merge --no-ff, the trunk an ancestor of the branch, ` +
            `with a ${CLOSES}: trailer)${waive(c.sha)}`,
        })
        continue
      }
      const why = notAMarker(ctx, c, trees)
      if (why.length && c.reason) out.push({ level: "note", subject: c.sha, message: byHand(main, c) + waive(c.sha) })
      else if (why.length) {
        out.push({
          level: "note",
          subject: c.sha,
          message: `${main} took ${c.sha.slice(0, 12)} "${c.subject}", not a landing marker: ${why.join("; ")}${waive(c.sha)}`,
        })
      }
    }
    return out
  },
})
