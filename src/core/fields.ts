// Field validation and parsing. A field's definition is the only thing that
// decides what a valid value is; unknown fields are preserved and not checked.

import type { FieldDef, FieldKind, Item, Registry } from "./types.ts"

const DATE = /^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$/

/** YYYY, YYYY-MM or YYYY-MM-DD naming a month and a day that exist. */
function isDate(value: string): boolean {
  const m = DATE.exec(value)
  if (!m) return false
  const [, year, month, day] = m
  if (month === undefined) return true
  const mm = Number(month)
  if (mm < 1 || mm > 12) return false
  if (day === undefined) return true
  const y = Number(year)
  const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0
  const last = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][mm - 1] ?? 0
  const dd = Number(day)
  return dd >= 1 && dd <= last
}

/** Why `value` is not a valid value of `def`, or null when it is. */
export function fieldError(def: FieldDef, value: unknown): string | null {
  if (value === undefined || value === null) return null
  switch (def.kind) {
    case "string":
      return typeof value === "string" ? null : "is not a string"
    case "strings":
      return Array.isArray(value) && value.every((v) => typeof v === "string") ? null : "is not a list of strings"
    case "date":
      return typeof value === "string" && isDate(value) ? null : "is not a date (YYYY, YYYY-MM or YYYY-MM-DD)"
    case "boolean":
      return typeof value === "boolean" ? null : "is not true or false"
    case "number":
      return typeof value === "number" && Number.isFinite(value) ? null : "is not a number"
    case "object":
      return typeof value === "object" && !Array.isArray(value) ? null : "is not a JSON object"
    case "enum": {
      const values = Object.keys(def.values ?? {})
      const one = (v: unknown) => typeof v === "string" && values.includes(v)
      if (def.multiple && Array.isArray(value)) return value.length && value.every(one) ? null : `is not a list of: ${values.join(", ")}`
      return one(value) ? null : `is not one of: ${values.join(", ")}${def.multiple ? ", or a list of them" : ""}`
    }
  }
}

/** Turn a command-line `field=value` into a stored value. Throws with the reason. */
export function parseFieldValue(def: FieldDef, raw: string): unknown {
  let value: unknown = raw
  if (def.kind === "strings") value = jsonStrings(raw) ?? raw.split(",").map((s) => s.trim()).filter(Boolean)
  // Several values of a field that takes several are a list; one stays a string, as it is stored.
  if (def.kind === "enum" && def.multiple && raw.includes(",")) value = raw.split(",").map((s) => s.trim()).filter(Boolean)
  if (def.kind === "boolean") value = raw === "true" ? true : raw === "false" ? false : raw
  if (def.kind === "number") value = raw.trim() === "" ? raw : Number(raw)
  if (def.kind === "object") {
    try {
      value = JSON.parse(raw)
    } catch {
      value = raw // not JSON: reported as not an object below
    }
  }
  const error = fieldError(def, value)
  if (error) throw new Error(`${def.name}: "${raw}" ${error}`)
  return value
}

/** A JSON list of strings, as `["a", "b, c"]`, so a value may hold a comma; undefined for anything else. */
function jsonStrings(raw: string): string[] | undefined {
  if (!raw.trim().startsWith("[")) return undefined
  try {
    const v: unknown = JSON.parse(raw)
    return Array.isArray(v) && v.every((x) => typeof x === "string") ? v.map((x) => x.trim()).filter(Boolean) : undefined
  } catch {
    return undefined
  }
}

/** Whether a field's list of values is open — a string's or strings', where an off-list value is a note — rather than an enum's, fixed. */
export const isOpenList = (def: FieldDef): boolean => (def.kind === "string" || def.kind === "strings") && !!def.values && Object.keys(def.values).length > 0

/** The values a field of an open list holds that are not on its list; none when the list is fixed, empty, or the value is of another kind. */
export function offList(def: FieldDef, value: unknown): string[] {
  if (!isOpenList(def)) return []
  const held = typeof value === "string" ? [value] : Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : []
  return held.filter((v) => !Object.hasOwn(def.values ?? {}, v))
}

export const appliesTo = (def: FieldDef, type: string): boolean => !def.appliesTo || def.appliesTo.includes(type)

/** The fields that belong to an item's type. */
export function fieldsOf(registry: Registry, item: Item): FieldDef[] {
  return [...registry.fields.values()].filter((f) => appliesTo(f, item.type))
}

/** Rank of an enum value by declaration order; `fallback` when unset or unknown. */
export function enumRank(def: FieldDef | undefined, value: unknown, fallback: number): number {
  if (!def?.values || typeof value !== "string") return fallback
  const i = Object.keys(def.values).indexOf(value)
  return i === -1 ? fallback : i
}

/** A field as a reader names it: its name and its kind. A declared FieldDef is one; so is `{ name, kind } as const`. */
export interface FieldRef<K extends FieldKind = FieldKind> {
  readonly name: string
  readonly kind: K
}

/** The value a field of kind K holds. */
export type ValueOf<K extends FieldKind> = K extends "strings" ? string[]
  : K extends "boolean" ? boolean
  : K extends "number" ? number
  : K extends "object" ? Record<string, unknown>
  : string

const isKind = (kind: FieldKind, v: unknown): boolean => {
  switch (kind) {
    case "strings":
      return Array.isArray(v) && v.every((x) => typeof x === "string")
    case "boolean":
      return typeof v === "boolean"
    case "number":
      return typeof v === "number"
    case "object":
      return !!v && typeof v === "object" && !Array.isArray(v)
    default:
      return typeof v === "string"
  }
}

/**
 * An item's value of a field, typed by the field's kind; undefined when it is
 * unset or holds a value of another kind (which the fields check reports).
 * What plugins read fields through: a misspelt field is a misspelt constant,
 * which does not compile, not a key that quietly reads undefined.
 */
export function fieldValue<K extends FieldKind>(item: Item, ref: FieldRef<K>): ValueOf<K> | undefined {
  const v = item.meta[ref.name]
  return isKind(ref.kind, v) ? (v as ValueOf<K>) : undefined
}

/** Every value an item holds of an enum field that may take several — one stored as a string, several as a list; none when unset. */
export function fieldValues(item: Item, ref: FieldRef<"enum">): string[] {
  const v = item.meta[ref.name]
  if (typeof v === "string") return [v]
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []
}

/** Set an item's value of a field in memory (undefined removes it); saveMeta writes it. */
export function setFieldValue<K extends FieldKind>(item: Item, ref: FieldRef<K>, value: ValueOf<K> | undefined): void {
  if (value === undefined) delete item.meta[ref.name]
  else item.meta[ref.name] = value
}
