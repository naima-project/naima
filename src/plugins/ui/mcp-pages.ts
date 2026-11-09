// A view's raw data in pages, for the MCP server's tool view (mcp.ts): a view's whole data can be megabytes (the
// schedule's), far past what an agent should read. A reply stays within REPLY_BOUND characters of JSON: an answer that
// fits is given whole; one that does not comes shortened to SHORT_BUDGET, with what was cut and how to read it. The
// arguments that choose a part:
//
//   path          where to read in the answer: keys and indexes joined by dots, such as items or routes.0.commits
//   offset, limit a page of the list (or of an object's keys, or of a text's characters) at the path
//   where         entries whose fields equal the values: {type: "bugs", status: "open", gate: "release-1.2"}
//   search        entries whose JSON holds a text
//   since, until  entries dated in a window: a date, a time or a commit (its commit date)
//   fields        only these fields of each entry
//
// A page answers {path, total, offset, count, next, data}, and `cut`, the parts shortened to fit, each with its path
// and its whole length; `next` is the offset of the next page, null at the end. Nothing here reads the project:
// a commit's date comes from the caller.

import type { Json } from "./bridge-handler.ts"

/** The most characters of JSON a reply takes: the server's hard bound. */
export const REPLY_BOUND = 20_000
/** What a page may take, leaving room for the note a cut reply carries. */
const BUDGET = REPLY_BOUND - 500
/** What a bare call's answer takes when it is shortened, so that a first look stays small. */
export const SHORT_BUDGET = 4_000
/** Entries in a page, and characters of a text, when the call does not say. */
export const DEFAULT_LIMIT = 20
export const DEFAULT_TEXT_LIMIT = 8_000
/** An object with more keys than this is a map of entries (commits by hash), shortened like a list. */
const MAP_KEYS = 50
/** How far each try shortens what is nested: entries kept in a list, characters in a text. */
const LADDER: readonly [number, number][] = [[20, 4000], [10, 2000], [5, 1000], [3, 400], [1, 200], [0, 80]]
/** Cut parts listed in a reply at most; the rest are counted. */
const CUTS_LISTED = 25

/** The fields that date an entry, the first found. */
const DATE_KEYS = ["date", "day", "at", "created", "t", "start", "from", "time", "when", "committed"]

/** The paging arguments, as every read tool's schema declares them. */
export const PAGE_PROPERTIES: Record<string, unknown> = {
  path: { type: "string", description: "a part of the answer: keys and indexes joined by dots, such as pieces or routes.0.commits" },
  offset: { type: "integer", minimum: 0, description: "the page's first entry (character, for a text): the reply's next" },
  limit: { type: "integer", minimum: 1, description: `entries (characters) in the page: default ${DEFAULT_LIMIT} (${DEFAULT_TEXT_LIMIT})` },
  where: {
    type: "object",
    additionalProperties: { type: "string" },
    description: "entries whose fields equal these values, such as {status: open}; a|b for either",
  },
  search: { type: "string", description: "entries whose JSON holds this text" },
  since: { type: "string", description: "entries dated from this on: a date, a time or a commit" },
  until: { type: "string", description: "entries dated up to this: a date, a time or a commit" },
  fields: { type: "array", items: { type: "string" }, description: "only these fields of each entry" },
}

export interface PageArgs {
  path?: string
  offset?: number
  limit?: number
  where?: Record<string, string>
  search?: string
  since?: string
  until?: string
  fields?: string[]
}

const PAGE_KEYS = Object.keys(PAGE_PROPERTIES)

/** A call's arguments split into the paging ones and the command's own. */
export function splitArgs(args: { [k: string]: Json }): { page: PageArgs; rest: { [k: string]: Json } } {
  const rest: { [k: string]: Json } = {}
  const page: PageArgs = {}
  for (const [k, v] of Object.entries(args)) {
    if (!PAGE_KEYS.includes(k)) rest[k] = v
    else if (v !== null && v !== undefined) (page as Record<string, unknown>)[k] = v
  }
  const int = (k: "offset" | "limit", min: number) => {
    const v = page[k]
    if (v === undefined) return
    const n = typeof v === "string" ? Number(v) : v
    if (typeof n !== "number" || !Number.isInteger(n) || n < min) throw new Error(`${k} is a whole number from ${min}`)
    page[k] = n
  }
  int("offset", 0)
  int("limit", 1)
  if (page.where !== undefined && (typeof page.where !== "object" || Array.isArray(page.where))) throw new Error("where is an object of field: value")
  if (page.fields !== undefined && !Array.isArray(page.fields)) throw new Error("fields is a list of field names")
  for (const k of ["path", "search", "since", "until"] as const) {
    if (page[k] !== undefined && typeof page[k] !== "string") throw new Error(`${k} is a text`)
  }
  return { page, rest }
}

/** The size a value takes in the reply: its JSON's characters. */
export const replySize = (v: unknown): number => JSON.stringify(v).length

/** A date's or a time's milliseconds, or a commit's by `commitTime`; the end of the day for an `until` date. */
function bound(v: string, end: boolean, commitTime: (ref: string) => number | null): number {
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) {
    const t = Date.parse(`${v}T00:00:00.000Z`)
    if (!Number.isNaN(t)) return end ? t + 86_400_000 - 1 : t
  }
  if (/^\d{4}-\d{2}-\d{2}T/.test(v)) {
    const t = Date.parse(v)
    if (!Number.isNaN(t)) return t
  }
  const t = commitTime(v)
  if (t === null) throw new Error(`${v} is neither a date (2026-11-01), a time nor a commit`)
  return t
}

const timeOf = (v: Json | undefined): number | null => {
  if (typeof v === "number" && Number.isFinite(v) && v > 0) return v < 1e11 ? v * 1000 : v
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v)) {
    const t = Date.parse(v.length === 10 ? `${v}T00:00:00.000Z` : v)
    return Number.isNaN(t) ? null : t
  }
  return null
}

const isObject = (v: Json | undefined): v is { [k: string]: Json } => typeof v === "object" && v !== null && !Array.isArray(v)

/** An entry's date: its first dating field, else one of an object it holds, two levels down at most. */
export function entryTime(entry: Json): number | null {
  let level: Json[] = [entry]
  for (let depth = 0; depth < 3 && level.length; depth++) {
    for (const o of level) {
      if (!isObject(o)) continue
      for (const k of DATE_KEYS) {
        const t = timeOf(o[k])
        if (t !== null) return t
      }
    }
    level = level.flatMap((o) => (isObject(o) ? Object.values(o).filter(isObject) : []))
  }
  return null
}

const at = (v: Json, path: string): Json | undefined => {
  let here: Json | undefined = v
  for (const k of path.split(".")) {
    if (Array.isArray(here) && /^\d+$/.test(k)) here = here[Number(k)]
    else if (isObject(here) && Object.hasOwn(here, k)) here = here[k]
    else return undefined
  }
  return here
}

const matches = (field: Json | undefined, wanted: string): boolean => {
  const options = wanted.toLowerCase().split("|")
  const one = (v: Json | undefined) =>
    options.includes(v === null || v === undefined ? "null" : (typeof v === "object" ? JSON.stringify(v) : String(v)).toLowerCase())
  return Array.isArray(field) ? field.some(one) || one(field) : one(field)
}

const pick = (entry: Json, fields: string[]): Json => {
  if (!isObject(entry)) return entry
  const out: { [k: string]: Json } = {}
  for (const f of fields) {
    const v = at(entry, f)
    if (v !== undefined) out[f] = v
  }
  return out
}

interface Cut {
  path: string
  total: number
  shown: number
  unit?: "characters"
}

/** `v` with every list longer than `keep` entries, map longer than MAP_KEYS keys and text longer than `chars` cut. */
function shorten(v: Json, keep: number, chars: number, path: string, cuts: Cut[]): Json {
  const sub = (k: string | number) => (path ? `${path}.${k}` : String(k))
  if (typeof v === "string") {
    if (v.length <= chars) return v
    cuts.push({ path, total: v.length, shown: chars, unit: "characters" })
    return v.slice(0, chars)
  }
  if (Array.isArray(v)) {
    if (v.length > keep) cuts.push({ path, total: v.length, shown: keep })
    return v.slice(0, keep).map((x, i) => shorten(x, keep, chars, sub(i), cuts))
  }
  if (isObject(v)) {
    const keys = Object.keys(v)
    const kept = keys.length > MAP_KEYS ? keys.slice(0, keep) : keys
    if (kept.length < keys.length) cuts.push({ path, total: keys.length, shown: kept.length })
    return Object.fromEntries(kept.map((k) => [k, shorten(v[k]!, keep, chars, sub(k), cuts)]))
  }
  return v
}

const listed = (cuts: Cut[]): Json => {
  const shown = cuts.slice(0, CUTS_LISTED) as unknown as Json[]
  return cuts.length > CUTS_LISTED ? [...shown, { more: cuts.length - CUTS_LISTED }] : shown
}

/** The reply to one call: the answer whole when it fits and no page was asked for, else the part and page asked. */
export function paged(answer: Json, page: PageArgs, commitTime: (ref: string) => number | null = () => null): Json {
  const asked = Object.keys(page).length > 0
  if (!asked && replySize(answer) <= SHORT_BUDGET) return answer
  const path = page.path ?? ""
  const target = path ? at(answer, path) : answer
  if (target === undefined) {
    const parent = path.includes(".") ? at(answer, path.slice(0, path.lastIndexOf("."))) : answer
    const keys = isObject(parent) ? Object.keys(parent).slice(0, 40).join(", ") : Array.isArray(parent) ? `0 to ${parent.length - 1}` : "none"
    throw new Error(`no ${path} in the answer; what is there: ${keys}`)
  }
  const selects = page.offset !== undefined || page.limit !== undefined || page.where || page.search || page.since || page.until || page.fields
  const entries = Array.isArray(target) || (isObject(target) && (selects || Object.keys(target).length > MAP_KEYS))
  const filters = page.where || page.search || page.since || page.until || page.fields
  if (typeof target === "string" && !filters) return textPage(target, path, page)
  if (!entries) {
    if (selects) {
      throw new Error(`${path || "the answer"} is ${target === null ? "null" : typeof target}, not a list: offset, limit and the filters read a list`)
    }
    return shortened(target, path)
  }
  return listPage(target as Json[] | { [k: string]: Json }, path, page, commitTime)
}

function textPage(text: string, path: string, page: PageArgs): Json {
  const offset = page.offset ?? 0
  let limit = page.limit ?? DEFAULT_TEXT_LIMIT
  for (;;) {
    const data = text.slice(offset, offset + limit)
    const end = offset + data.length
    const reply = { path, total: text.length, unit: "characters", offset, count: data.length, next: end < text.length ? end : null, data }
    if (replySize(reply) <= BUDGET || limit <= 1) return reply
    limit = Math.floor(limit / 2)
  }
}

function shortened(target: Json, path: string): Json {
  for (const [keep, chars] of LADDER) {
    const cuts: Cut[] = []
    const data = shorten(target, keep, chars, path, cuts)
    const reply = { path, shortened: true, cut: listed(cuts), data }
    if (replySize(reply) <= SHORT_BUDGET) return reply
  }
  // An object of many small fields, past every shortening: its keys, each read by its path.
  const keys = isObject(target) ? Object.keys(target) : []
  return { path, shortened: true, keys: keys.slice(0, 500), total: keys.length }
}

function listPage(target: Json[] | { [k: string]: Json }, path: string, page: PageArgs, commitTime: (ref: string) => number | null): Json {
  const isList = Array.isArray(target)
  let all: { key: string; value: Json }[] = isList
    ? target.map((value, i) => ({ key: String(i), value }))
    : Object.entries(target).map(([key, value]) => ({ key, value }))
  const total = all.length
  const where = Object.entries(page.where ?? {})
  if (where.length) {
    all = all.filter(({ key, value }) => where.every(([f, w]) => matches(f === "key" && !isList ? key : isObject(value) ? at(value, f) : undefined, String(w))))
  }
  if (page.search) {
    const s = page.search.toLowerCase()
    all = all.filter(({ key, value }) => (isList ? "" : key + " ").concat(JSON.stringify(value)).toLowerCase().includes(s))
  }
  if (page.since || page.until) {
    const from = page.since ? bound(page.since, false, commitTime) : -Infinity
    const to = page.until ? bound(page.until, true, commitTime) : Infinity
    all = all.filter(({ value }) => {
      const t = entryTime(value)
      return t !== null && t >= from && t <= to
    })
  }
  const offset = page.offset ?? 0
  const sub = (k: string) => (path ? `${path}.${k}` : k)
  for (let limit = page.limit ?? DEFAULT_LIMIT;; limit = Math.max(1, Math.floor(limit / 2))) {
    const slice = all.slice(offset, offset + limit).map((e) => ({ ...e, value: page.fields ? pick(e.value, page.fields) : e.value }))
    for (const [keep, chars] of limit > 1 ? LADDER.slice(0, 3) : LADDER) {
      const cuts: Cut[] = []
      const data = isList
        ? slice.map((e) => shorten(e.value, keep, chars, sub(e.key), cuts))
        : Object.fromEntries(slice.map((e) => [e.key, shorten(e.value, keep, chars, sub(e.key), cuts)]))
      const end = offset + slice.length
      const reply: { [k: string]: Json } = {
        path,
        total: all.length,
        ...(all.length !== total ? { of: total } : {}),
        offset,
        count: slice.length,
        next: end < all.length ? end : null,
        ...(cuts.length ? { cut: listed(cuts) } : {}),
        data: data as Json,
      }
      // An entry's place in the whole list, so that a cut part of it is read by its path.
      if (isList && all.length !== total) reply["indexes"] = slice.map((e) => Number(e.key))
      if (replySize(reply) <= BUDGET) return reply
    }
    if (limit === 1) {
      const one = sub(slice[0]!.key)
      return {
        path,
        total: all.length,
        offset,
        count: 0,
        next: offset + 1 < all.length ? offset + 1 : null,
        data: [],
        says: `the entry ${one} is past the bound even shortened: read it with path ${one}`,
      }
    }
  }
}
