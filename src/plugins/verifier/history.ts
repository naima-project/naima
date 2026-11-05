// The property-runs view: every property with the runs recorded on it, oldest first, for the failed-tests matrix of the
// new UI. Each check of a property attaches its run as run-<time>.json, with the verdict (holds, violated, error) and
// when it was made: that is the property's history, read here as it is, one entry a run. A property never checked
// has no history and is not listed, unless its status refutes (violated) and was set after its last run, or with
// none: that status is then its latest result, a failed run at the time it was set (from: "status").

import { existsSync, readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { ATTACHMENTS, type Context, type Item, label, refutedAt } from "../../core/api.ts"

/** One recorded run of a property: when, and whether it held; a run that ended in an error did not. */
export interface HistoryRun {
  at: string
  ok: boolean
  verdict: string
  /** "status" for the failure its status says, set after its last recorded run. */
  from?: "status"
}

export interface HistoryRow {
  id: string
  ref: string
  title: string
  type: string
  status: string
  runs: HistoryRun[]
}

const RUN_FILE = /^run-.+\.json$/

/** The runs recorded on a property, oldest first. */
export function propertyRuns(item: Item): HistoryRun[] {
  const dir = join(item.dir, ATTACHMENTS)
  if (!existsSync(dir)) return []
  return readdirSync(dir).filter((f) => RUN_FILE.test(f)).flatMap((f) => {
    try {
      const r = JSON.parse(readFileSync(join(dir, f), "utf8")) as { at?: unknown; verdict?: unknown }
      if (typeof r.at !== "string" || typeof r.verdict !== "string") return []
      return [{ at: r.at, ok: r.verdict === "holds", verdict: r.verdict }]
    } catch {
      return []
    }
  }).sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0))
}

/** Every property of `type` with at least one recorded run or a status that says it fails. */
export function propertyHistory(ctx: Context, type: string): HistoryRow[] {
  return ctx.repo.items.filter((i) => i.type === type).flatMap((item) => {
    const runs = propertyRuns(item)
    const failedAt = refutedAt(ctx, item)
    if (failedAt && !((runs.at(-1)?.at ?? "") > failedAt)) runs.push({ at: failedAt, ok: false, verdict: String(item.meta["status"]), from: "status" })
    if (!runs.length) return []
    return [{
      id: String(item.meta["id"] ?? ""),
      ref: label(item),
      title: String(item.meta["title"] ?? ""),
      type: item.type,
      status: String(item.meta["status"] ?? ""),
      runs,
    }]
  })
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;")

/** The view of the properties of `type`: its data is `{ rows }`; the new UI's failed-tests screen reads it. */
export const propertyRunsView = (type: string) => ({
  name: "property-runs",
  title: "Property runs",
  says: "every property with the runs recorded on it, oldest first: when, and its verdict (holds, violated, error); the new UI's failed-tests matrix reads it",
  screen: true,
  render(_params: Record<string, string[]>, ctx: Context) {
    const rows = propertyHistory(ctx, type)
    const html = rows.length
      ? `<table><thead><tr><th>Property</th><th>Runs</th><th>Last</th></tr></thead><tbody>${
        rows.map((r) => `<tr><td><code>${esc(r.ref)}</code> ${esc(r.title)}</td><td>${r.runs.length}</td><td>${esc(r.runs.at(-1)!.verdict)}</td></tr>`).join("")
      }</tbody></table>`
      : "<p>No property has a recorded run.</p>"
    return { data: { rows }, html }
  },
})
