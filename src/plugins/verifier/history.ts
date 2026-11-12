// The property-runs view: every property with the runs recorded on it, oldest first, for the failed-tests matrix of the
// new UI. Each check of a property attaches its run as run-<time>.json, with the verdict (holds, violated, error) and
// when it was made: that is the property's history, read here as it is, one entry a run. A property never checked
// has no history and is not listed, unless its status refutes (violated) and was set after its last run, or with
// none: that status is then its latest result, a failed run at the time it was set (from: "status").

import { createHash } from "node:crypto"
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

// ── every verification run, for the Specs place of the new UI ────────────────

/** One recorded verification run of a property, with what the record says of its size and whether its inputs changed since. */
export interface VerificationRun {
  ref: string
  id: string
  title: string
  status: string
  file: string
  at: string
  verdict: string
  verifier: string
  model: string
  property: string
  commit?: string
  seconds?: number
  states?: number
  transitions?: number
  /** The states after minimisation, when the run reduced the state space. */
  reducedStates?: number
  /** The state space was reused from an earlier run on the same inputs. */
  reused?: boolean
  /** Whether every input still has the hash the run recorded; null when the run recorded none. */
  current: boolean | null
  /** The inputs whose content changed since the run, or that are gone. */
  changed: string[]
}

const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined)
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {})

/** Every run recorded on a property of `type`, newest first; each input's hash is compared with the file as it is now. */
export function verificationRuns(ctx: Context, type: string): VerificationRun[] {
  const hashes = new Map<string, string | null>()
  const hashOf = (path: string): string | null => {
    if (!hashes.has(path)) {
      const at = join(ctx.root, path)
      hashes.set(path, existsSync(at) ? createHash("sha256").update(readFileSync(at)).digest("hex") : null)
    }
    return hashes.get(path)!
  }
  const out: VerificationRun[] = []
  for (const item of ctx.repo.items.filter((i) => i.type === type)) {
    const dir = join(item.dir, ATTACHMENTS)
    if (!existsSync(dir)) continue
    for (const f of readdirSync(dir).filter((f) => RUN_FILE.test(f))) {
      let r: Record<string, unknown>
      try {
        r = obj(JSON.parse(readFileSync(join(dir, f), "utf8")))
      } catch {
        continue
      }
      if (typeof r["at"] !== "string" || typeof r["verdict"] !== "string") continue
      const details = obj(r["details"]), lts = obj(details["lts"]), reduced = obj(details["reduced"])
      const inputs = Array.isArray(r["inputs"]) ? r["inputs"].map(obj).filter((i) => typeof i["path"] === "string" && typeof i["sha256"] === "string") : []
      const changed = inputs.filter((i) => hashOf(String(i["path"])) !== i["sha256"]).map((i) => String(i["path"]))
      const commit = typeof r["commit"] === "string" ? r["commit"] : undefined
      const seconds = num(r["seconds"]), states = num(lts["states"]), transitions = num(lts["transitions"]), reducedStates = num(reduced["states"])
      out.push({
        ref: label(item),
        id: String(item.meta["id"] ?? ""),
        title: String(item.meta["title"] ?? ""),
        status: String(item.meta["status"] ?? ""),
        file: f,
        at: r["at"],
        verdict: r["verdict"],
        verifier: typeof r["verifier"] === "string" ? r["verifier"] : "",
        model: typeof r["model"] === "string" ? r["model"] : "",
        property: typeof r["property"] === "string" ? r["property"] : "",
        ...(commit ? { commit } : {}),
        ...(seconds !== undefined ? { seconds } : {}),
        ...(states !== undefined ? { states } : {}),
        ...(transitions !== undefined ? { transitions } : {}),
        ...(reducedStates !== undefined ? { reducedStates } : {}),
        ...(lts["reused"] === true ? { reused: true } : {}),
        current: inputs.length ? changed.length === 0 : null,
        changed,
      })
    }
  }
  return out.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))
}

/** The view of every verification run: its data is `{ rows }`; the new UI's Specs place reads it. */
export const verificationRunsView = (type: string) => ({
  name: "verification-runs",
  title: "Verification runs",
  says:
    "every run recorded on a property, newest first: the model and property file, when, on which commit and how long when recorded, the states, the verdict, and whether its inputs changed since; the new UI's Specs place reads it",
  screen: true,
  render(_params: Record<string, string[]>, ctx: Context) {
    const rows = verificationRuns(ctx, type)
    const html = rows.length
      ? `<table><tbody>${
        rows.map((r) => `<tr><td><code>${esc(r.ref)}</code></td><td>${esc(r.at)}</td><td>${esc(r.verdict)}</td></tr>`).join("")
      }</tbody></table>`
      : "<p>No property has a recorded run.</p>"
    return { data: { rows }, html }
  },
})
