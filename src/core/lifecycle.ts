// Questions about an item that depend only on what its type declares.

import type { Context, Item, StatusDef } from "./types.ts"
import { flagsOf } from "./vocabulary.ts"

/** The definition of an item's status; undefined for one its type does not declare, never an Object.prototype key. */
export function statusDef(ctx: Context, item: Item): StatusDef | undefined {
  const statuses = ctx.registry.types.get(item.type)?.statuses
  return statuses && Object.hasOwn(statuses, item.meta.status) ? statuses[item.meta.status] : undefined
}

export const isOpen = (ctx: Context, item: Item): boolean => statusDef(ctx, item)?.category !== "done"

/**
 * The flag of a status Naima sets only together with fields it fills (FieldDef.filled), never by hand: a change of an
 * item confined to those fields and a move to such a status is bookkeeping, which the trunk guard takes on the trunk.
 */
export const FILLED = "filled"

/** Does this item's status carry `flag` — one a plugin gave meaning to, or `proves` or `refutes`? */
export const hasFlag = (ctx: Context, item: Item, flag: string): boolean => {
  const s = statusDef(ctx, item)
  return s !== undefined && flagsOf(s).includes(flag)
}

/** Does this item's status count as evidence for what it verifies? */
export const proves = (ctx: Context, item: Item): boolean => hasFlag(ctx, item, "proves")

/** Does this item's status count as evidence against what it verifies? */
export const refutes = (ctx: Context, item: Item): boolean => hasFlag(ctx, item, "refutes")

/** Can items of this type ever count as evidence? */
export const isEvidenceType = (ctx: Context, type: string): boolean =>
  Object.values(ctx.registry.types.get(type)?.statuses ?? {}).some((s) => flagsOf(s).includes("proves"))

/** Does this item's type carry `trait`? */
export const hasTrait = (ctx: Context, item: Item, trait: string): boolean => ctx.registry.types.get(item.type)?.traits?.includes(trait) === true

/** Items linked to `item` by `rel`, in either stored direction. */
export function linked(ctx: Context, item: Item, rel: string): Item[] {
  const out: Item[] = []
  for (const l of ctx.repo.linksOf(item)) {
    if (l.rel !== rel) continue
    const other = ctx.repo.byId.get(l.id)
    if (other && !out.includes(other)) out.push(other)
  }
  return out
}

/** Sum of every plugin's rank terms. Lower is more urgent; done items sink. */
export function urgency(ctx: Context, item: Item): number {
  const base = isOpen(ctx, item) ? 0 : 100
  return ctx.registry.rank.reduce((sum, term) => sum + term.score(item, ctx), base)
}

export function byUrgency(ctx: Context, items: Item[]): Item[] {
  const score = new Map(items.map((i) => [i, urgency(ctx, i)]))
  return [...items].sort((a, b) => (score.get(a) ?? 0) - (score.get(b) ?? 0) || a.slug.localeCompare(b.slug))
}

export const label = (item: Item): string => `${item.type}/${item.slug}`
