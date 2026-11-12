// The workers' console's reads, as views of `naima ui`: the ready queue with the worker places free, and a worker
// branch's work against the branch it lands on. Both only read: the queue is `naima queue --ready`'s list as data,
// the work is git's diff of the branch since it left its base.

import { type Context, fieldValue, gitOrNull, label, readyRecord, runGit } from "../../core/api.ts"
import { baseOf } from "./lines.ts"
import { readyNow } from "./ready.ts"
import type { Policy } from "./worktrees.ts"

const esc = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")

/** One item of the ready queue, in the order work starts. */
export interface ReadyRow {
  id: string
  ref: string
  title: string
  /** The owner said to start it now. */
  start: boolean
  priority?: string
  /** The day the owner approved it. */
  on: string
  meeting?: string
}

/** What the view `ready` gives: the approved items no live claim holds, in order, and the worker places. */
export interface ReadyData {
  maxWorkers: number
  free: number
  waiting: ReadyRow[]
}

export function readyData(ctx: Context, policy: Policy): ReadyData {
  const r = readyNow(ctx, policy)
  return {
    maxWorkers: r.maxWorkers,
    free: r.free,
    waiting: r.waiting.map((i) => {
      const rec = readyRecord(i)
      const priority = fieldValue(i, { name: "priority", kind: "enum" })
      return {
        id: i.meta.id,
        ref: label(i),
        title: String(i.meta.title ?? ""),
        start: !!rec?.start,
        ...(priority ? { priority: String(priority) } : {}),
        on: rec?.on ?? "",
        ...(rec?.meeting ? { meeting: rec.meeting } : {}),
      }
    }),
  }
}

/** The ready queue as a view of naima ui. */
export function readyUiView(policy: Policy) {
  return {
    name: "ready",
    title: "Ready queue",
    says: "the approved work no branch holds yet, in the order it starts, and the worker places free; the list naima queue --ready prints",
    order: 21,
    screen: true,
    render(_params: Record<string, string[]>, ctx: Context) {
      const d = readyData(ctx, policy)
      const rows = d.waiting.map((w) => `<li><code>${esc(w.ref)}</code> ${esc(w.title)}${w.start ? " <strong>(start now)</strong>" : ""}</li>`)
      return {
        data: d,
        html: `<p>${d.free} of ${d.maxWorkers} worker places free.</p>${rows.length ? `<ol>${rows.join("")}</ol>` : "<p>Nothing approved waits.</p>"}`,
      }
    },
  }
}

/** A file a branch changed since it left its base: lines added and removed, null for a binary file. */
export interface DiffFile {
  path: string
  added: number | null
  removed: number | null
}

/** What the view `worker-diff` gives for a branch. */
export interface WorkerDiff {
  branch: string
  /** Where it lands: its line's branch, else the trunk. */
  base: string | null
  /** Its newest commit. */
  last: { hash: string; subject: string; at: string } | null
  files: DiffFile[]
  /** The patch, asked with patch=1: of one file with file=<path>, else of all; cut at PATCH_MAX characters. */
  patch?: string
  cut?: true
}

export const PATCH_MAX = 200_000

/** `git diff --numstat` lines, as files. */
export function numstat(out: string): DiffFile[] {
  return out.split("\n").filter(Boolean).map((l) => {
    const [a, r, ...p] = l.split("\t")
    return { path: p.join("\t"), added: a === "-" ? null : Number(a), removed: r === "-" ? null : Number(r) }
  })
}

const BRANCH = /^[A-Za-z0-9._\/-]+$/

export function workerDiff(root: string, branch: string, patch: boolean, file?: string): WorkerDiff {
  if (!BRANCH.test(branch) || branch.startsWith("-") || branch.includes("..")) throw new Error(`not a branch name: ${branch}`)
  const tip = gitOrNull(root, "rev-parse", "--verify", "--quiet", `refs/heads/${branch}^{commit}`)
  if (!tip) throw new Error(`no branch ${branch}`)
  const base = baseOf(root, branch)
  const fork = base ? gitOrNull(root, "merge-base", base, tip) : null
  const lastOut = gitOrNull(root, "log", "-1", "--format=%H%x00%s%x00%cI", tip)
  const [hash, subject, at] = (lastOut ?? "").split("\0")
  const last = hash ? { hash, subject: subject ?? "", at: at ?? "" } : null
  const range = fork ? [fork, tip] : [tip]
  const files = fork ? numstat(runGit(root, ["diff", "--numstat", "--no-renames", ...range]).out) : []
  const out: WorkerDiff = { branch, base, last, files }
  if (patch && fork) {
    if (file !== undefined && !files.some((f) => f.path === file)) throw new Error(`${branch} did not change ${file}`)
    const text = runGit(root, ["diff", "--no-color", "--no-renames", ...range, ...(file !== undefined ? ["--", file] : [])]).out
    out.patch = text.length > PATCH_MAX ? text.slice(0, PATCH_MAX) : text
    if (text.length > PATCH_MAX) out.cut = true
  }
  return out
}

/** A worker branch's work against its base, as a view of naima ui: `branch=<b>`, and `patch=1` (`file=<path>`) for the patch. */
export const workerDiffUiView = {
  name: "worker-diff",
  title: "Worker's diff",
  says:
    "a branch's files changed since it left the branch it lands on, with lines added and removed, and its last commit; with patch=1 the patch, of one file with file=<path>",
  order: 22,
  screen: true,
  render(params: Record<string, string[]>, ctx: Context) {
    const branch = params["branch"]?.[0]
    if (!branch) return { data: null, html: "<p>Name a branch: ?branch=&lt;branch&gt;</p>" }
    const d = workerDiff(ctx.root, branch, params["patch"]?.[0] === "1", params["file"]?.[0])
    const rows = d.files.map((f) => `<tr><td><code>${esc(f.path)}</code></td><td>+${f.added ?? "bin"}</td><td>-${f.removed ?? "bin"}</td></tr>`)
    return { data: d, html: `<p>${esc(branch)} against ${esc(d.base ?? "nothing")}</p><table>${rows.join("")}</table>` }
  },
}
