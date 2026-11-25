// The week's commits, the view `week` of the new UI: what Home's river draws behind today. The trunk's first-parent
// commits of the seven days before the moment shown (now, or a commit of the past), each with its time and its size,
// the lines its change added and removed against its first parent: a landing counts the whole change it brought.
// Read live, it also carries the development lines the river draws beside the trunk: each open line (a branch
// line/<gate> the trunk lacks) and each line that landed on the trunk within the window (a marker `Land line/<gate>`),
// with the moment it was cut (its opening commit, `Open line/<gate>`), its own first-parent commits in the window, and
// for a landed line its marker and the items it closed. Read from git alone, in one process.

import { type Context, runGit, runGitAsync, trunk } from "../../core/api.ts"

/** How many days the river looks back by default, and the most a reader may ask for (its parameter `days`). */
export const WEEK_DAYS = 7
export const WEEK_DAYS_MOST = 366
/** How many commits the view sends at most: the river bins them, and a busier week than this is drawn from its newest. */
export const WEEK_MAX = 3000
const GIT_MS = 30_000

export interface WeekCommit {
  /** The commit's full hash. */
  hash: string
  /** Its committer time, in seconds. */
  t: number
  /** Lines added plus lines removed, against its first parent. */
  changes: number
  files: number
  subject: string
  /** The items of each kind the commit touched in the tracker (bugs, features, tests, decisions, ...), by the type in the
   *  item's folder: how many distinct items; absent when it touched none or the tracker's files are not read. */
  kinds?: Record<string, number>
  /** False when the commit's tree has no tracker where the project keeps it now (the data kept elsewhere then, or not
   *  yet made): Home cannot be read at it, and the moments shown keep to the commits that have one. Absent otherwise. */
  tracker?: false
}

export interface WeekData {
  /** The branch or commit read: the trunk, or the commit of the past shown. */
  ref: string | null
  /** The end of the week, in seconds: now, or the time of the commit shown. */
  until: number
  days: number
  /** Newest first. */
  commits: WeekCommit[]
  /** The development lines of the window, read live; none at a commit of the past. */
  lines: RiverLine[]
}

/** A development line as the river draws it beside the trunk. */
export interface RiverLine {
  gate: string
  branch: string
  /** Its opening commit's first parent, the trunk commit it was cut from, and the opening's time in seconds: where it
   *  branches off; null when its opening commit is not found. */
  cut: { hash: string; t: number } | null
  /** Its own first-parent commits in the window, newest first, each with its size against its first parent. */
  commits: WeekCommit[]
  /** Its landing on the trunk: the marker, its time in seconds and the items it closed; null while the line is open. */
  landed: { hash: string; t: number; closes: { id: string; ref: string; title: string }[] } | null
}

/** The prefix of a line's branch, the subject of the commit that opens one, and of the marker that lands one. */
const LINE = "line/"
const OPEN = "Open "
const LANDED = /^Land (line\/\S+)$/

/** `git log --shortstat` records, each opened by the byte 0x1e, as commits. */
export function parseWeek(out: string): WeekCommit[] {
  const commits: WeekCommit[] = []
  for (const record of out.split("\x1e")) {
    const [head = "", ...rest] = record.split("\n")
    const [hash, t, ...subject] = head.split("\t")
    if (!hash || !t) continue
    const stat = rest.join(" ")
    const n = (re: RegExp) => Number(stat.match(re)?.[1] ?? 0)
    commits.push({
      hash,
      t: Number(t),
      files: n(/(\d+) files? changed/),
      changes: n(/(\d+) insertions?\(\+\)/) + n(/(\d+) deletions?\(-\)/),
      subject: subject.join("\t"),
    })
  }
  return commits
}

const SHORTSTAT = ["--first-parent", "--diff-merges=first-parent", "--shortstat", `-n${WEEK_MAX}`, "--format=%x1e%H%x09%ct%x09%s"]

/** The tracker's item folders in a commit's changed paths: <prefix><type>/<slug>/..., the type told by the folder. */
export function parseKinds(out: string, prefix: string): Map<string, Record<string, number>> {
  const found = new Map<string, Record<string, number>>()
  const seen = new Set<string>()
  for (const record of out.split("\x1e")) {
    const [hash = "", ...paths] = record.split("\n")
    if (!hash.trim()) continue
    const kinds: Record<string, number> = {}
    for (const path of paths) {
      const m = path.startsWith(prefix) ? /^([a-z][a-z-]*)\/([^/]+)\//.exec(path.slice(prefix.length)) : null
      if (!m || m[1] === "closed" || seen.has(`${hash}\0${m[1]}/${m[2]}`)) continue
      seen.add(`${hash}\0${m[1]}/${m[2]}`)
      kinds[m[1]!] = (kinds[m[1]!] ?? 0) + 1
    }
    if (Object.keys(kinds).length) found.set(hash.trim(), kinds)
  }
  return found
}

/** Marks each commit with the kinds of item it touched, asked of git in one more log limited to the tracker's data folder. */
async function withKinds(ctx: Context, ref: string, since: number, until: number, commits: WeekCommit[]): Promise<WeekCommit[]> {
  const prefix = ctx.trackerPrefix ? `${ctx.trackerPrefix}/` : ""
  if (!commits.length || ctx.sibling) return commits
  const r = await runGitAsync(
    ctx.root,
    [
      "log",
      "--first-parent",
      "--diff-merges=first-parent",
      "--name-only",
      `-n${WEEK_MAX}`,
      `--since=@${since}`,
      `--until=@${until}`,
      "--format=%x1e%H",
      ref,
      "--",
      `${prefix}.`,
    ],
    GIT_MS,
  )
  if (!r.ok) return commits
  const kinds = parseKinds(r.out, prefix)
  return commits.map((c) => (kinds.has(c.hash) ? { ...c, kinds: kinds.get(c.hash)! } : c))
}

/** A line's opening commit on `ref` (its branch, or a landed tip): its first parent and its time; null when none. */
async function cutOf(ctx: Context, ref: string, branch: string): Promise<RiverLine["cut"]> {
  const subject = `${OPEN}${branch}`
  const r = await runGitAsync(ctx.root, ["log", "--first-parent", "--fixed-strings", `--grep=${subject}`, "--format=%P%x09%ct%x09%s", ref, "--"], GIT_MS)
  for (const l of r.ok ? r.out.split("\n") : []) {
    const [parents = "", t = "", ...s] = l.split("\t")
    const parent = parents.split(" ")[0]
    if (s.join("\t") === subject && parent) return { hash: parent, t: Number(t) }
  }
  return null
}

/** A line's own first-parent commits in `range` (base..tip) from `since` to `until` (seconds), newest first. */
async function ownCommits(ctx: Context, range: string, since: number, until: number): Promise<WeekCommit[]> {
  const r = await runGitAsync(ctx.root, ["log", ...SHORTSTAT, `--since=@${since}`, `--until=@${until}`, range, "--"], GIT_MS)
  return r.ok ? parseWeek(r.out).filter((c) => c.t > since && c.t <= until) : []
}

/** An item closed by a landing, by its id: its reference and title, or the id alone when this checkout lacks it. */
const closed = (ctx: Context, id: string): { id: string; ref: string; title: string } => {
  const i = ctx.repo.byId.get(id)
  return i ? { id, ref: `${i.type}/${i.slug}`, title: String(i.meta.title ?? "") } : { id, ref: id, title: "" }
}

/** The lines of the window: the open ones, and those whose landing marker is among the trunk's `commits`. */
export async function riverLines(ctx: Context, main: string, commits: readonly WeekCommit[], since: number, until: number): Promise<RiverLine[]> {
  const refs = await runGitAsync(ctx.root, ["for-each-ref", "--format=%(refname:short)", "--no-merged", main, `refs/heads/${LINE}`], GIT_MS)
  const open = (refs.ok ? refs.out.split("\n") : []).map((b) => b.trim()).filter((b) => b.startsWith(LINE) && b.length > LINE.length)
  const landed = commits.flatMap((c) => {
    const m = LANDED.exec(c.subject)
    return m && m[1]!.length > LINE.length ? [{ branch: m[1]!, c }] : []
  })
  const opens = open.map(async (branch): Promise<RiverLine> => {
    const [cut, own] = await Promise.all([cutOf(ctx, branch, branch), ownCommits(ctx, `${main}..${branch}`, since, until)])
    return { gate: branch.slice(LINE.length), branch, cut, commits: own, landed: null }
  })
  const lands = landed.map(async ({ branch, c }): Promise<RiverLine> => {
    const [cut, own, trailers] = await Promise.all([
      cutOf(ctx, `${c.hash}^2`, branch),
      ownCommits(ctx, `${c.hash}^1..${c.hash}^2`, since, until),
      runGitAsync(ctx.root, ["log", "-1", "--format=%(trailers:key=Closes,valueonly,separator=%x1d)", c.hash, "--"], GIT_MS),
    ])
    const ids = trailers.ok ? trailers.out.replaceAll("\x1d", "\n").split("\n").map((v) => v.trim()).filter(Boolean) : []
    return { gate: branch.slice(LINE.length), branch, cut, commits: own, landed: { hash: c.hash, t: c.t, closes: ids.map((id) => closed(ctx, id)) } }
  })
  return Promise.all([...opens, ...lands])
}

/** The commits marked whose tree has no tracker at the place the project keeps it, asked of git in one process
 *  (cat-file --batch-check of each commit's <hash>:<prefix>); unchanged when the tracker is the repository's root or
 *  another repository's. */
export function withoutTracker(ctx: Context, commits: WeekCommit[]): WeekCommit[] {
  const prefix = ctx.trackerPrefix
  if (!prefix || !commits.length) return commits
  const r = runGit(ctx.root, ["cat-file", "--batch-check"], { input: commits.map((c) => `${c.hash}:${prefix}`).join("\n") + "\n" })
  if (!r.ok) return commits
  const answers = r.out.split("\n")
  return commits.map((c, i) => (/ missing$/.test(answers[i] ?? "") ? { ...c, tracker: false as const } : c))
}

/** The commits of the `days` days before `at` (a commit's full hash), or before now on the trunk: a week by default. */
export async function weekData(ctx: Context, at: string | null, days: number = WEEK_DAYS): Promise<WeekData> {
  const ref = at ?? trunk(ctx.root) ?? "HEAD"
  const until = at
    ? Number((await runGitAsync(ctx.root, ["log", "-1", "--format=%ct", at, "--"], GIT_MS)).out.trim()) || Math.floor(ctx.now().getTime() / 1000)
    : Math.floor(ctx.now().getTime() / 1000)
  const since = until - days * 86400
  const r = await runGitAsync(
    ctx.root,
    [
      "log",
      "--first-parent",
      "--diff-merges=first-parent",
      "--shortstat",
      `-n${WEEK_MAX}`,
      `--since=@${since}`,
      `--until=@${until}`,
      "--format=%x1e%H%x09%ct%x09%s",
      ref,
      "--",
    ],
    GIT_MS,
  )
  const commits = withoutTracker(ctx, r.ok ? await withKinds(ctx, ref, since, until, parseWeek(r.out).filter((c) => c.t > since && c.t <= until)) : [])
  const main = trunk(ctx.root)
  const lines = at === null && main && r.ok ? await riverLines(ctx, main, commits, since, until) : []
  return { ref: r.ok ? ref : null, until, days, commits, lines }
}

const esc = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")

/** The view: Home reads its data; its HTML lists the commits. */
export const weekView = {
  name: "week",
  title: "Week",
  says:
    "the trunk's first-parent commits of the seven days before the moment shown (or of `days` days, at most 366), newest first, each with its hash, its time, its subject and its size (lines added and removed against its first parent, and files changed): what Home's river draws behind today; read live, also the development lines of those days, open or landed on the trunk then, each with where it was cut, its own commits, and for a landed one its marker and the items it closed: what the river draws beside the trunk",
  moments: true,
  screen: true,
  async render(params: Record<string, string[]>, ctx: Context) {
    const asked = Math.floor(Number(params["days"]?.[0] ?? WEEK_DAYS))
    const days = Number.isFinite(asked) ? Math.min(WEEK_DAYS_MOST, Math.max(1, asked)) : WEEK_DAYS
    const data = await weekData(ctx, params["at"]?.[0] ?? null, days)
    const html = data.commits.length
      ? `<ul>${data.commits.map((c) => `<li><code>${c.hash.slice(0, 10)}</code> ${esc(c.subject)} (${c.changes} lines)</li>`).join("")}</ul>`
      : `<p>No commit in the last ${days === 1 ? "day" : `${days} days`}.</p>`
    const lines = data.lines.length
      ? `<ul>${
        data.lines.map((l) =>
          `<li><code>${esc(l.branch)}</code> ${l.commits.length} commits${l.landed ? `, landed with ${l.landed.closes.length} items` : ""}</li>`
        ).join("")
      }</ul>`
      : ""
    return { data, html: html + lines }
  },
}
