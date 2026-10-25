// What may be announced, computed, never declared: a feature is announceable
// when it is user-facing, shipped, documented, and proven by a passed item
// checked by a person or end to end. `naima announce` lists the announceable
// features — the only true source of release notes — and a check fails when
// the project's public copy (README, site) names a feature that is not.

import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import {
  bool,
  type Check,
  type Command,
  type Context,
  CONTRACT,
  fieldValue,
  fieldValues,
  type Finding,
  type Item,
  label,
  linked,
  parse,
  type Plugin,
  proves,
  refutes,
  str,
  usageError,
} from "../../core/api.ts"

interface Options {
  featureTypes: string[]
  shippedStatuses: string[]
  checkedBy: string[]
  checkedEvidence: string[]
  copy: string[]
}

function readOptions(o: Record<string, unknown>): Options {
  const list = (name: string, fallback: string[]): string[] => {
    const v = o[name]
    if (v === undefined) return fallback
    if (!Array.isArray(v) || !v.every((x) => typeof x === "string")) throw new Error(`announce: options.${name} must be a list of strings`)
    return v
  }
  return {
    featureTypes: list("featureTypes", ["features"]),
    shippedStatuses: list("shippedStatuses", ["shipped"]),
    checkedBy: list("checkedBy", ["human", "agent-hands"]),
    checkedEvidence: list("checkedEvidence", ["owner-gesture"]),
    copy: list("copy", ["README.md"]),
  }
}

// Its own fields, and those of the trackers and docs plugins it reads by name.
const FACING = { name: "facing", kind: "enum" } as const
const MAJOR = { name: "major", kind: "boolean" } as const
const DOCS = { name: "docs", kind: "strings" } as const
const RUN_BY = { name: "runBy", kind: "enum" } as const
const EVIDENCE_KIND = { name: "evidenceKind", kind: "enum" } as const
const FIXED_ON = { name: "fixedOn", kind: "date" } as const
const GATE = { name: "gate", kind: "enum" } as const
/** The archive `naima close` moves an item to, keeping its fields and naming its former type in `closedFrom`. */
const CLOSED = "closed"

/** One feature, as `naima announce --json` prints it: whether it may be announced, and what it lacks if not. */
export interface Announceability {
  item: string
  title: string
  major: boolean
  shippedOn: string | null
  announceable: boolean
  /** What stops it, in words; empty when announceable. */
  lacks: string[]
  /** The passed items that checked it, by a person or end to end. */
  checkedBy: string[]
}

const DATE = /^\d{4}-\d{2}-\d{2}$/

export default function announce(options: Record<string, unknown> = {}): Plugin {
  const opts = readOptions(options)
  /** A feature closed into the archive: shipped, since closing takes it fixed and proven. */
  const archived = (i: Item): boolean => i.type === CLOSED && opts.featureTypes.includes(String(i.meta["closedFrom"] ?? ""))
  const isFeature = (i: Item): boolean => opts.featureTypes.includes(i.type) || archived(i)

  /** Whether a proof counts: it proves now, and a person or the running software performed it. */
  const checks = (ctx: Context, proof: Item): boolean =>
    proves(ctx, proof) && !refutes(ctx, proof) &&
    (opts.checkedBy.includes(fieldValue(proof, RUN_BY) ?? "") || opts.checkedEvidence.includes(fieldValue(proof, EVIDENCE_KIND) ?? ""))

  function announceability(ctx: Context, item: Item): Announceability {
    const lacks: string[] = []
    if (fieldValue(item, FACING) !== "user") lacks.push("not user-facing: set facing=user")
    if (!opts.shippedStatuses.includes(item.meta.status) && !archived(item)) lacks.push(`not shipped: it is ${item.meta.status}`)
    if (!(fieldValue(item, DOCS) ?? []).length) lacks.push("not documented: set docs=<path>[#heading]")
    const proofs = linked(ctx, item, "verified-by")
    const by = proofs.filter((p) => checks(ctx, p))
    if (proofs.some((p) => refutes(ctx, p))) lacks.push("refuted by an item that verifies it")
    else if (!by.length) {
      lacks.push(`not checked: no passed item verifies it with runBy ${opts.checkedBy.join("|")} or evidenceKind ${opts.checkedEvidence.join("|")}`)
    }
    return {
      item: label(item),
      title: String(item.meta.title ?? ""),
      major: fieldValue(item, MAJOR) === true,
      shippedOn: fieldValue(item, FIXED_ON) ?? null,
      announceable: !lacks.length,
      lacks,
      checkedBy: by.map(label),
    }
  }

  const command: Command = {
    name: "announce",
    says:
      "the features that may be announced — user-facing, shipped, documented and checked by a person or end to end — major first: the source of release notes",
    enforces: "nothing: it only lists, and only features user-facing, shipped, documented and checked by a person or end to end",
    usage: "announce [--since <date>] [--gate <gate>] [--all] [--json]",
    options: [
      { name: "--since", says: "only features shipped (fixedOn) on or after the date, YYYY-MM-DD" },
      { name: "--gate", says: "only features on that gate: what a release off it announces" },
      { name: "--all", says: "also every user-facing feature that is not announceable, with what it lacks" },
      { name: "--json", says: "print each feature as JSON: item, title, major, shippedOn, announceable, lacks, checkedBy" },
    ],
    examples: ["announce", "announce --since 2026-09-01", "announce --gate v1 --all", "announce --json"],
    run(args, ctx) {
      const p = parse(args, { since: { type: "string" }, gate: { type: "string" }, all: { type: "boolean" }, json: { type: "boolean" } })
      const since = str(p, "since")
      const gate = str(p, "gate")
      if (p.positionals.length || (since !== undefined && !DATE.test(since))) throw usageError(this)
      const rows = ctx.repo.items
        .filter(isFeature)
        .filter((i) => gate === undefined || fieldValues(i, GATE).includes(gate))
        .map((i) => announceability(ctx, i))
        .filter((a) => since === undefined || (a.shippedOn !== null && a.shippedOn >= since))
        .filter((a) => a.announceable || (bool(p, "all") && !a.lacks.some((l) => l.startsWith("not user-facing"))))
        .sort((a, b) => Number(b.major) - Number(a.major) || (b.shippedOn ?? "").localeCompare(a.shippedOn ?? "") || a.item.localeCompare(b.item))
      if (bool(p, "json")) {
        ctx.out(JSON.stringify(rows, null, 2))
        return 0
      }
      const yes = rows.filter((a) => a.announceable)
      ctx.out(`${yes.length} announceable${since ? ` since ${since}` : ""}${gate ? ` on ${gate}` : ""}`)
      for (const a of yes) ctx.out(`  ${a.major ? "★" : "·"} ${a.item}  ${a.title}${a.shippedOn ? `  (shipped ${a.shippedOn})` : ""}`)
      const no = rows.filter((a) => !a.announceable)
      if (no.length) ctx.out(`${no.length} user-facing, not announceable`)
      for (const a of no) ctx.out(`  ✗ ${a.item}  ${a.title} — ${a.lacks.join("; ")}`)
      return 0
    },
  }

  const copyNamesOnlyAnnounceable: Check = {
    name: "copy-names-only-announceable",
    says: "the project's public copy (the copy option: README.md by default) names no feature, by its label or its title, that is not announceable",
    run(ctx) {
      const out: Finding[] = []
      const features = ctx.repo.items.filter(isFeature).map((i) => ({ item: i, a: announceability(ctx, i) })).filter((f) => !f.a.announceable)
      for (const path of opts.copy) {
        const file = join(ctx.root, path)
        if (!existsSync(file)) continue
        const text = readFileSync(file, "utf8").toLowerCase().replace(/\s+/g, " ")
        for (const { item, a } of features) {
          const title = a.title.toLowerCase().replace(/\s+/g, " ").trim()
          if (text.includes(a.item.toLowerCase()) || (title && text.includes(title))) {
            out.push({ level: "problem", item, message: `${path} names ${a.item}, which is not announceable: ${a.lacks.join("; ")}` })
          }
        }
      }
      return out
    },
  }

  return {
    name: "announce",
    contract: CONTRACT,
    says: "announceability, computed: a feature may be announced only once user-facing, shipped, documented and checked by a person or end to end",
    about:
      "What may be announced is computed, never declared. A feature is **announceable** when it is user-facing (`facing: user`), shipped (a status in `shippedStatuses`, or closed into the archive), documented (its `docs` field names a page) and checked: a passed item verifies it whose `runBy` is in `checkedBy` — a person, or an agent driving the running software, end to end — or whose `evidenceKind` is in `checkedEvidence`. A refuting proof outweighs any that proves. " +
      "`naima announce` lists the announceable features, major ones (`major: true`) first, since a date or on a gate: the only source of release notes, changelog entries and announcements. With `--all` it adds every user-facing feature that is not announceable, with what it lacks. " +
      "The check `copy-names-only-announceable` fails when a file of the `copy` option names, by its label or its full title, a feature that is not announceable, so the README and the site never promise what is not true.",
    options: [
      { name: "featureTypes", says: "item types whose items are features", default: '["features"]' },
      { name: "shippedStatuses", says: "statuses in which a feature is shipped", default: '["shipped"]' },
      {
        name: "checkedBy",
        says: "values of a proof's `runBy` that count as checked: by a person, or end to end on the running software",
        default: '["human", "agent-hands"]',
      },
      { name: "checkedEvidence", says: "values of a proof's `evidenceKind` that count as checked, whoever ran it", default: '["owner-gesture"]' },
      {
        name: "copy",
        says: "files, from the project root, of public copy that may name only announceable features; one missing is skipped",
        default: '["README.md"]',
      },
    ],
    fields: [
      {
        name: "facing",
        kind: "enum",
        says: "whom the feature is for: only a user-facing one is ever announced",
        values: { user: "someone using the software sees it", internal: "only who works on the software sees it" },
        appliesTo: opts.featureTypes,
      },
      { name: "major", kind: "boolean", says: "a feature an announcement leads with", appliesTo: opts.featureTypes },
    ],
    uses: { types: opts.featureTypes, fields: [DOCS.name, RUN_BY.name, FIXED_ON.name], relations: ["verified-by"] },
    commands: [command],
    checks: [copyNamesOnlyAnnounceable],
  }
}
