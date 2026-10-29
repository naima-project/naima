// The standard attribution: what anything Naima uses from outside declares to be
// credited (core/credits.ts). Provisional.

import type { Attribution } from "./types.ts"

/** The fields an attribution declares, in the order they are printed. */
const ORDER: Record<keyof Attribution, true> = { name: true, homepage: true, source: true, authors: true, license: true, version: true }
export const ATTRIBUTION_FIELDS = Object.keys(ORDER) as (keyof Attribution)[]

/** Which fields hold a list of names rather than one string. */
const ORDER_LISTS: Partial<Record<keyof Attribution, readonly string[]>> = { authors: [] }

const nonEmpty = (v: unknown): v is string => typeof v === "string" && v.trim() !== ""

/** The fields `a` lacks, or declares with the wrong shape: empty when it is a whole attribution. */
export function attributionGaps(a: unknown): string[] {
  const o = (a && typeof a === "object" ? a : {}) as Record<string, unknown>
  const names = (v: unknown): boolean => Array.isArray(v) && v.length > 0 && v.every(nonEmpty)
  return ATTRIBUTION_FIELDS.filter((k) => !(Array.isArray(ORDER_LISTS[k]) ? names(o[k]) : nonEmpty(o[k])))
}
