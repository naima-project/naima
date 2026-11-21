// What waits on a person: the one definition `naima waiting`, `naima hello` and the UI (the bridge's view `waiting`)
// all read, so that each says the same things and the same count. Plugins contribute what they know waits for an
// owner to the point `waiting` (the gates: the owner gate's items, what is fixed and owes a proof by a person's hands,
// what is open and run by a person's hands; the metrics: a test a person runs that fails by its latest result). An
// item is listed once, under the first source that names it. Of these, a person sees what waits on them and what waits
// on nobody in particular (the item's waitsOn field, core/people.ts); a decision comes before a proof to give.

import { personAtKeyboard, samePerson, waitsOnOf } from "./people.ts"
import type { Context, ExtensionPoint } from "./types.ts"

/** Why something waits for an owner. */
export type WaitsFor = "owner" | "proof" | "failing"

/** One thing that waits for an owner, as a source gives it. */
export interface WaitingEntry {
  ref: string
  title: string
  /** owner: their decision or their hands; proof: it is fixed and owes a proof by a person's hands; failing: a test they run fails. */
  why: WaitsFor
  /** Whose hands its proof needs: its runBy, or "" when unclassified. */
  runBy?: string
  /** The item that proves it, when another does. */
  proof?: { ref: string; title: string }
  /** For a failing test: the day of its latest failed result. */
  failedOn?: string
}

/** One thing that waits, as `naima waiting` lists it: with the person it waits on, when it names one. */
export interface WaitingRow extends WaitingEntry {
  waitsOn?: string
  /** The source that named it. */
  source: string
}

/** A plugin's contribution to the point `waiting`: what it knows waits for an owner. */
export interface WaitingSource {
  name: string
  says: string
  waiting(ctx: Context): WaitingEntry[] | Promise<WaitingEntry[]>
}

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v)

export const waitingPoint: ExtensionPoint<WaitingSource> = {
  id: "waiting",
  says:
    "what waits for an owner, as one source sees it: naima waiting, naima hello and the UI's waiting views list every source's together, each item once, filtered to the person at the keyboard",
  noun: "waiting source",
  key: (s) => s.name,
  renamed: (s, name) => ({ ...s, name }),
  validate: (v) =>
    !isObject(v) ? "is not an object" : typeof v["name"] !== "string" ? "has no name" : typeof v["waiting"] !== "function" ? "has no waiting function" : null,
  gaps: (s) => (typeof s.says === "string" && s.says.trim() ? [] : ["does not say what it lists"]),
  document: (all) => ["", "**Waiting sources**, listed together by `naima waiting`", ...all.map((s) => `- \`${s.name}\`: ${s.says}`)],
}

/** Who a list is for: a person by name, everyone (null), or, absent, the person at the keyboard. */
export type For = string | null | undefined

/**
 * What waits on a person: every source's entries, each item once, in the sources' order, a decision before a proof;
 * of these, those that wait on that person or on nobody in particular. `person` absent is the person at the keyboard,
 * null is everyone; with nobody known at the keyboard, everything is listed.
 */
export async function waitingOn(ctx: Context, person?: For): Promise<WaitingRow[]> {
  const who = person === undefined ? personAtKeyboard(ctx.root)?.name ?? null : person
  const seen = new Set<string>()
  const out: WaitingRow[] = []
  for (const c of ctx.registry.contributions("waiting")) {
    const source = c.value as WaitingSource
    let entries: WaitingEntry[]
    try {
      entries = await source.waiting(ctx)
    } catch {
      continue // a source that cannot say what waits leaves the others' list whole
    }
    for (const e of entries) {
      if (seen.has(e.ref)) continue
      seen.add(e.ref)
      let on: string | undefined
      try {
        on = waitsOnOf(ctx.repo.resolve(e.ref))
      } catch {
        on = undefined
      }
      if (who && on && !samePerson(on, who)) continue
      out.push({ ...e, ...(on ? { waitsOn: on } : {}), source: c.name })
    }
  }
  const rank = (r: WaitingRow): number => (r.why === "proof" ? 1 : 0)
  return out.map((r, i) => ({ r, i })).sort((a, b) => rank(a.r) - rank(b.r) || a.i - b.i).map((x) => x.r)
}

/** One row as `naima waiting` prints it. */
export const waitingLine = (r: WaitingRow): string => {
  const why = r.why === "proof" ? "fixed; owes a proof by your hands" : r.why === "failing" ? `fails${r.failedOn ? ` since ${r.failedOn}` : ""}` : "needs you"
  return `  ${r.ref}  ${r.title}  (${why}${r.waitsOn ? `; waits on ${r.waitsOn}` : ""})`
}
