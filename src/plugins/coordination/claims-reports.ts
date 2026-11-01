// What `naima claims` shows beside the claims, any plugin contributing: the
// coordinator reads the claims at each owner turn, so what it must see then —
// the runs Naima watches, say — is reported there.

import { code, type Context, type ExtensionPoint, message, table } from "../../core/api.ts"

/** One section under the claims: `lines(ctx)`, nothing when there is nothing to say. */
export interface ClaimsReport {
  name: string
  says: string
  lines(ctx: Context): string[]
}

/** The point this plugin declares: a section `naima claims` prints after the claims. */
export const claimsReportsPoint: ExtensionPoint<ClaimsReport> = {
  id: "claims-reports",
  says:
    "a section `naima claims` prints after the claims, and gives under `reports` with --json: `name`, `says`, and `lines(ctx) → lines`, none when there is nothing to report",
  noun: "claims report",
  key: (r) => r.name,
  validate: (v) => {
    const r = v as Partial<ClaimsReport> | null
    if (!r || typeof r !== "object" || typeof r.name !== "string") return "has no name"
    return typeof r.lines === "function" ? null : "has no lines function"
  },
  gaps: (r) => (typeof r.says === "string" && r.says.trim() ? [] : ["does not say what it reports"]),
  document: (
    rs,
  ) => ["", "**Claims reports**, printed by `naima claims` after the claims", ...table(["Report", "What it says"], rs.map((r) => [code(r.name), r.says]))],
}

/** Every contributed section with something to say; one that throws says so in its own section. */
export function claimsReports(ctx: Context): { name: string; lines: string[] }[] {
  const out: { name: string; lines: string[] }[] = []
  for (const c of ctx.registry.contributions("claims-reports")) {
    const r = c.value as ClaimsReport
    let lines: string[]
    try {
      lines = r.lines(ctx)
    } catch (e) {
      lines = [`could not report: ${message(e)}`]
    }
    if (lines.length) out.push({ name: r.name, lines })
  }
  return out
}
