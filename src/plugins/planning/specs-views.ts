// The new UI's Specs place reads two views of the planning plugin: every requirement with the checks linked to it and
// the specifications it relates to, and every specification with its versions, their text and the items that follow
// them. Each gives the tracker's records as they are; the UI derives the marks and the differences from them.

import { type Context, fieldValue, isOpen, type Item, label, linked, proves, readReadme, refutes } from "../../core/api.ts"

/** A linked item, as the views name it. */
export interface Ref {
  id: string
  ref: string
  type: string
  title: string
  status: string
}

/** How a check proves a requirement: a test, a property of a model, a test whose gesture runs a metric, or another item. */
export type CheckKind = "test" | "property" | "metric" | "other"

export interface CheckRef extends Ref {
  kind: CheckKind
  /** Whether its status says it passed or holds, or that it fails. */
  passes: boolean
  fails: boolean
  /** A property's model and property file. */
  model?: string
  property?: string
  /** The metric a test's gesture runs (`naima metrics run <metric>`). */
  metric?: string
}

export interface SpecsRequirementRow extends Ref {
  created: string
  gate?: string
  askedBy?: string
  askedOn?: string
  checks: CheckRef[]
  satisfiedBy: Ref[]
  /** The specifications it relates to, each version as an item. */
  specs: Ref[]
}

export interface SpecVersion extends Ref {
  version: number
  created: string
  /** The page of this version, its title line left out. */
  text: string
}

export interface SpecificationRow {
  spec: string
  current: string | null
  versions: SpecVersion[]
  /** The items that follow some version of it, open ones first, each with the version it follows. */
  followedBy: (Ref & { version: number; open: boolean })[]
  /** The requirements that relate to some version of it. */
  requirements: Ref[]
}

const str = (v: unknown): string => (typeof v === "string" ? v : "")
const refOf = (i: Item): Ref => ({ id: str(i.meta["id"]), ref: label(i), type: i.type, title: str(i.meta["title"]), status: str(i.meta["status"]) })
const unique = <T>(xs: T[]): T[] => xs.filter((x, n) => xs.indexOf(x) === n)
const METRIC = /naima metrics run ([a-z0-9][a-z0-9._-]*)/i

function checkOf(ctx: Context, i: Item): CheckRef {
  const passes = proves(ctx, i), fails = refutes(ctx, i)
  if (i.type === "properties") {
    const model = str(i.meta["model"]), property = str(i.meta["property"])
    return { ...refOf(i), kind: "property", passes, fails, ...(model ? { model } : {}), ...(property ? { property } : {}) }
  }
  if (i.type === "tests") {
    const metric = METRIC.exec(`${str(i.meta["title"])}\n${readReadme(i)}`)?.[1]
    return metric && metric !== "--record" ? { ...refOf(i), kind: "metric", passes, fails, metric } : { ...refOf(i), kind: "test", passes, fails }
  }
  return { ...refOf(i), kind: "other", passes, fails }
}

const origin = (i: Item): { askedBy?: string; askedOn?: string } => {
  const o = i.meta["origin"]
  if (!o || typeof o !== "object") return {}
  const r = o as Record<string, unknown>
  return { ...(str(r["askedBy"]) ? { askedBy: str(r["askedBy"]) } : {}), ...(str(r["on"]) ? { askedOn: str(r["on"]) } : {}) }
}

/** Every requirement that is not dropped, with what checks it, what satisfies it and the specifications it relates to. */
export function specsRequirements(ctx: Context): SpecsRequirementRow[] {
  return ctx.repo.items.filter((i) => i.type === "requirements" && i.meta.status !== "dropped").map((r) => {
    const satisfied = linked(ctx, r, "satisfied-by")
    const checks = unique([...linked(ctx, r, "verified-by"), ...satisfied.filter((i) => i.type === "tests" || i.type === "properties")])
    const gate = str(r.meta["gate"])
    return {
      ...refOf(r),
      created: str(r.meta["created"]),
      ...(gate ? { gate } : {}),
      ...origin(r),
      checks: checks.map((c) => checkOf(ctx, c)),
      satisfiedBy: satisfied.filter((i) => !checks.includes(i)).map(refOf),
      specs: unique([...linked(ctx, r, "relates-to"), ...linked(ctx, r, "specified-by")]).filter((i) => i.type === "specs").map(refOf),
    }
  })
}

const specName = (s: Item): string => fieldValue(s, { name: "spec", kind: "string" }) ?? s.slug
const versionOf = (s: Item): number => fieldValue(s, { name: "version", kind: "number" }) ?? 1

/** Every specification by name, its versions oldest first with their pages, and what follows and relates to it. */
export function specifications(ctx: Context): SpecificationRow[] {
  const byName = new Map<string, Item[]>()
  for (const s of ctx.repo.items.filter((i) => i.type === "specs")) byName.set(specName(s), [...(byName.get(specName(s)) ?? []), s])
  return [...byName].sort(([a], [b]) => a.localeCompare(b)).map(([spec, all]) => {
    const vs = [...all].sort((a, b) => versionOf(a) - versionOf(b))
    const current = vs.filter((s) => s.meta.status === "current").at(-1)
    const followedBy = vs.flatMap((s) => linked(ctx, s, "specifies").map((i) => ({ ...refOf(i), version: versionOf(s), open: isOpen(ctx, i) })))
    followedBy.sort((a, b) => Number(b.open) - Number(a.open))
    return {
      spec,
      current: current ? `${spec}-v${versionOf(current)}` : null,
      versions: vs.map((s) => ({ ...refOf(s), version: versionOf(s), created: str(s.meta["created"]), text: readReadme(s).replace(/^#[^\n]*\n+/, "") })),
      followedBy,
      requirements: unique(vs.flatMap((s) => linked(ctx, s, "relates-to").filter((i) => i.type === "requirements"))).map(refOf),
    }
  })
}

const esc = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;")

/** The views, in the shape the `ui-views` point takes; screen: the new UI draws them, so no tab lists them. */
export const specsRequirementsView = {
  name: "specs-requirements",
  title: "Requirements and their checks",
  says: "every requirement that is not dropped, with the tests, properties and metrics linked to check it, what satisfies it and the specifications it relates to; the new UI's Specs place reads it",
  screen: true,
  render(_params: Record<string, string[]>, ctx: Context) {
    const rows = specsRequirements(ctx)
    const html = `<table><tbody>${
      rows.map((r) => `<tr><td><code>${esc(r.ref)}</code> ${esc(r.title)}</td><td>${r.checks.map((c) => esc(c.ref)).join(", ") || "no check"}</td></tr>`).join("")
    }</tbody></table>`
    return { data: { rows }, html }
  },
}

export const specificationsView = {
  name: "specs-specifications",
  title: "Specifications and their versions",
  says: "every specification by name with each version's page, which is current and which are drafts, and the items that follow it; the new UI's Specs place reads it",
  screen: true,
  render(_params: Record<string, string[]>, ctx: Context) {
    const rows = specifications(ctx)
    const html = `<ul>${rows.map((r) => `<li>${esc(r.spec)}: current ${esc(r.current ?? "none")}, ${r.versions.length} versions</li>`).join("")}</ul>`
    return { data: { rows }, html }
  },
}
