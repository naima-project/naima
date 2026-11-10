// The view `checkpoints`: every checkpoint record (`naima checkpoint`, the data directory's `checkpoints/`), with the gate
// it was run for, what it ran and what failed, and what is owed since the last one that passed (the `Checks-owed:`
// trailers of the landings), with the project's check mode. The Roadmap draws them as squares under its time axis.

import { checkMode, type Context, owedSince, readCheckpoints } from "../../core/api.ts"

export interface CheckpointsData {
  mode: "continuous" | "checkpoint"
  records: { id: string; on: string; gate?: string; passed: boolean; ran: string[]; failed: string[]; tip: string }[]
  /** What the landings since the last passing checkpoint owe, and how many landings owe it; empty in continuous mode. */
  owed: { names: string[]; landings: number }
}

export function checkpointsData(ctx: Context): CheckpointsData {
  const mode = checkMode(ctx)
  return {
    mode,
    records: readCheckpoints(ctx).map((r) => ({
      id: r.id,
      on: r.on,
      ...(r.gate ? { gate: r.gate } : {}),
      passed: r.passed,
      ran: r.ran ?? [],
      failed: r.failed ?? [],
      tip: String(r.tip ?? "").slice(0, 12),
    })),
    owed: mode === "checkpoint" ? owedSince(ctx) : { names: [], landings: 0 },
  }
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;")

export const checkpointsUiView = {
  name: "checkpoints",
  title: "Checkpoints",
  says:
    "every checkpoint run (naima checkpoint): its day, the gate it was for, what it ran and what failed; and what the landings since the last passing one owe, with the project's check mode",
  // The new UI draws it on the Roadmap, not as a view of its own.
  screen: true,
  render(_params: Record<string, string[]>, ctx: Context) {
    const d = checkpointsData(ctx)
    const rows = d.records.map((r) =>
      `<li>${esc(r.on.slice(0, 10))} ${r.gate ? esc(r.gate) : "every gate"}: ${r.passed ? "passed" : `failed (${esc(r.failed.join(", "))})`}</li>`
    )
    return {
      data: d,
      html: `<p>Checks: ${d.mode}.${d.owed.names.length ? ` Owed: ${esc(d.owed.names.join(", "))}.` : ""}</p><ul>${rows.join("")}</ul>`,
    }
  },
}
