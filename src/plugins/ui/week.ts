// The week's commits, the view `week` of the new UI: what Home's river draws behind today. The trunk's first-parent
// commits of the seven days before the moment shown (now, or a commit of the past), each with its time and its size,
// the lines its change added and removed against its first parent: a landing counts the whole change it brought.
// Read from git alone, in one process.

import { type Context, runGitAsync, trunk } from "../../core/api.ts"

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
}

export interface WeekData {
  /** The branch or commit read: the trunk, or the commit of the past shown. */
  ref: string | null
  /** The end of the week, in seconds: now, or the time of the commit shown. */
  until: number
  days: number
  /** Newest first. */
  commits: WeekCommit[]
}

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
  return { ref: r.ok ? ref : null, until, days, commits: r.ok ? parseWeek(r.out).filter((c) => c.t > since && c.t <= until) : [] }
}

const esc = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")

/** The view: Home reads its data; its HTML lists the commits. */
export const weekView = {
  name: "week",
  title: "Week",
  says:
    "the trunk's first-parent commits of the seven days before the moment shown (or of `days` days, at most 366), newest first, each with its hash, its time, its subject and its size (lines added and removed against its first parent, and files changed): what Home's river draws behind today",
  moments: true,
  screen: true,
  async render(params: Record<string, string[]>, ctx: Context) {
    const asked = Math.floor(Number(params["days"]?.[0] ?? WEEK_DAYS))
    const days = Number.isFinite(asked) ? Math.min(WEEK_DAYS_MOST, Math.max(1, asked)) : WEEK_DAYS
    const data = await weekData(ctx, params["at"]?.[0] ?? null, days)
    const html = data.commits.length
      ? `<ul>${data.commits.map((c) => `<li><code>${c.hash.slice(0, 10)}</code> ${esc(c.subject)} (${c.changes} lines)</li>`).join("")}</ul>`
      : `<p>No commit in the last ${days === 1 ? "day" : `${days} days`}.</p>`
    return { data, html }
  },
}
