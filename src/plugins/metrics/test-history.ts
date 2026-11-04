// The test-runs view: every test item with the runs recorded on it, oldest first, for the failed-tests matrix of the
// new UI. A recorded run of a suite hands each test item that names its tests a record of its own, attached as
// test-run-<time>.json (suites.ts, attachToItems): that is the item's history, read here as it is, one entry a run.
// Test items no recorded run speaks for have no history and are not listed.

import { existsSync, readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { ATTACHMENTS, type Context, type Item, label } from "../../core/api.ts"

/** One recorded run of a test item: when, at which commit, and whether every test it covers that ran passed. */
export interface HistoryRun {
  at: string
  commit: string
  ok: boolean
}

/** A test item and its recorded runs, oldest first. */
export interface HistoryRow {
  id: string
  ref: string
  title: string
  type: string
  status: string
  runBy?: string
  runs: HistoryRun[]
}

const RUN_FILE = /^test-run-.+\.json$/

/** The runs recorded on a test item, oldest first. */
export function itemHistory(item: Item): HistoryRun[] {
  const dir = join(item.dir, ATTACHMENTS)
  if (!existsSync(dir)) return []
  return readdirSync(dir).filter((f) => RUN_FILE.test(f)).flatMap((f) => {
    try {
      const r = JSON.parse(readFileSync(join(dir, f), "utf8")) as { at?: unknown; commit?: unknown; result?: unknown }
      if (typeof r.at !== "string" || (r.result !== "passed" && r.result !== "failed")) return []
      return [{ at: r.at, commit: typeof r.commit === "string" ? r.commit : "", ok: r.result === "passed" }]
    } catch {
      return []
    }
  }).sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0))
}

/** Every test item with at least one recorded run. */
export function testHistory(ctx: Context): HistoryRow[] {
  return ctx.repo.items.filter((i) => i.type === "tests").flatMap((item) => {
    const runs = itemHistory(item)
    if (!runs.length) return []
    const runBy = item.meta["runBy"]
    return [{
      id: String(item.meta["id"] ?? ""),
      ref: label(item),
      title: String(item.meta["title"] ?? ""),
      type: item.type,
      status: String(item.meta["status"] ?? ""),
      ...(typeof runBy === "string" ? { runBy } : {}),
      runs,
    }]
  })
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;")

/** The view: its data is `{ rows }`, each test item with its recorded runs; the new UI's failed-tests screen reads it. */
export const testRunsView = {
  name: "test-runs",
  title: "Test runs",
  says:
    "every test item with the runs recorded on it by suites' runs, oldest first: when, the commit, passed or failed; the new UI's failed-tests matrix reads it",
  screen: true,
  render(_params: Record<string, string[]>, ctx: Context) {
    const rows = testHistory(ctx)
    const html = rows.length
      ? `<table><thead><tr><th>Test</th><th>Runs</th><th>Last</th></tr></thead><tbody>${
        rows.map((r) =>
          `<tr><td><code>${esc(r.ref)}</code> ${esc(r.title)}</td><td>${r.runs.length}</td><td>${r.runs.at(-1)!.ok ? "passed" : "failed"}</td></tr>`
        ).join("")
      }</tbody></table>`
      : "<p>No test item has a recorded run.</p>"
    return { data: { rows }, html }
  },
}
