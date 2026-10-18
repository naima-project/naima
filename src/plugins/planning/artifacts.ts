// Artifacts: what the project makes and keeps — an analysis, a profile, a
// report, a dataset, a figure. An artifact is due by a day, produced by the
// todo or feature linked `produces`, and made of files: paths in the
// repository (`files`) or its own attachments. Delivering it (status
// `delivered`) records what it was made from — the commit, and one digest
// over its `inputs` and the data of the items it `uses` — so that it can be
// made again, and found stale when those change. The diary tells each
// delivery from `deliveredOn`; nothing else is written for it.

import { createHash } from "node:crypto"
import { existsSync, readFileSync } from "node:fs"
import { basename, join, resolve } from "node:path"
import {
  ATTACHMENTS,
  type Check,
  type Context,
  type FieldDef,
  fieldValue,
  type Finding,
  gitOrNull,
  type Item,
  label,
  linked,
  META,
  posixRelative,
  type RelationDef,
  today,
  type TypeDef,
  walkFiles,
  type WriteHook,
} from "../../core/api.ts"

export const ARTIFACTS = "artifacts"
const PLANNED = "planned"
const DELIVERED = "delivered"
const SUPERSEDED = "superseded"

export const artifactsType: TypeDef = {
  id: ARTIFACTS,
  dir: "artifacts",
  title: "Artifacts",
  says:
    "something the project makes and keeps — an analysis, a profile, a report, a dataset, a figure: due by a day, made of files, and recorded with the commit and inputs it was made from when delivered",
  statuses: {
    [PLANNED]: { category: "open", says: "to be made: a todo or a feature linked `produces` makes it" },
    "in-progress": { category: "open", says: "being made" },
    [DELIVERED]: { category: "done", says: "made and kept: its files exist, and the commit and inputs it was made from are recorded in madeFrom" },
    [SUPERSEDED]: { category: "done", says: "replaced by a later artifact that supersedes it, kept as history" },
  },
  initialStatus: PLANNED,
  template: (title) =>
    `# ${title}\n\nWhat it is, who it is for, and the question it answers.\n\n## How it is made\n\nThe command or the steps, run from the project root, and the files they read (the \`inputs\` field), so that it can be made again.\n`,
}

const DUE: FieldDef = {
  name: "due",
  kind: "date",
  says: "the day it is due; past it and not delivered, naima check notes it",
  appliesTo: [ARTIFACTS],
}
const INPUTS: FieldDef = {
  name: "inputs",
  kind: "strings",
  says: "the files or directories it is made from, from the project root: with the data of the items it uses, what the digest in madeFrom covers",
  appliesTo: [ARTIFACTS],
}
const FILES: FieldDef = {
  name: "files",
  kind: "strings",
  says: "the files it consists of, from the project root; the files in its attachments/ count too",
  appliesTo: [ARTIFACTS],
}
const MADE_FROM: FieldDef = {
  name: "madeFrom",
  kind: "object",
  says:
    "recorded on delivery, never by hand: the commit it was made at (commit), one sha256 digest over its inputs and the data of the items it uses (inputs), and the moment (at)",
  appliesTo: [ARTIFACTS],
}
const DELIVERED_ON: FieldDef = {
  name: "deliveredOn",
  kind: "date",
  says: "the day it was delivered, recorded on delivery: the diary tells it on that day",
  appliesTo: [ARTIFACTS],
}

export const ARTIFACT_FIELDS: FieldDef[] = [DUE, INPUTS, FILES, MADE_FROM, DELIVERED_ON]

const PRODUCES = "produces"
const PRODUCED_BY = "produced-by"
const USES = "uses"

export const ARTIFACT_RELATIONS: RelationDef[] = [
  { name: PRODUCES, inverse: PRODUCED_BY, says: "is the work that makes the artifact" },
  { name: PRODUCED_BY, inverse: PRODUCES, says: "is made by" },
  { name: USES, inverse: "used-by", says: "is made from the data of: a test, a property, another artifact" },
  { name: "used-by", inverse: USES, says: "has its data used by the artifact" },
]

const isArtifact = (i: Item): boolean => i.type === ARTIFACTS
const pathsOf = (item: Item, field: FieldDef): string[] => fieldValue(item, { name: field.name, kind: "strings" }) ?? []
const sha256 = (data: string | Uint8Array): string => createHash("sha256").update(data).digest("hex")
/** JSON with every object's keys sorted, so the same data always digests the same. */
const canonical = (v: unknown): string =>
  JSON.stringify(
    v,
    (_k, x: unknown) =>
      x && typeof x === "object" && !Array.isArray(x)
        ? Object.fromEntries(Object.entries(x as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
        : x,
  )

/**
 * One digest over what an artifact is made from: every file under each of its `inputs` (one that names nothing
 * counts as absent), and each item it `uses` — its fields but its links, its page and its attachments, by its id,
 * so a link added elsewhere or a move to the archive changes nothing.
 */
export function inputsDigest(ctx: Context, artifact: Item): string {
  const entries: [string, string][] = []
  for (const path of pathsOf(artifact, INPUTS)) {
    const files = walkFiles(resolve(ctx.root, path))
    if (!files.length) entries.push([path, "absent"])
    for (const f of files) entries.push([posixRelative(ctx.root, f), sha256(readFileSync(f))])
  }
  for (const used of linked(ctx, artifact, USES)) {
    const { links: _links, ...data } = used.meta
    entries.push([used.meta.id, sha256(canonical(data))])
    for (const f of walkFiles(used.dir)) if (basename(f) !== META) entries.push([`${used.meta.id}/${posixRelative(used.dir, f)}`, sha256(readFileSync(f))])
  }
  return sha256(canonical(entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))))
}

interface MadeFrom {
  commit?: string
  inputs: string
  at: string
}

const madeFromOf = (item: Item): MadeFrom | undefined => {
  const v = item.meta[MADE_FROM.name]
  return v && typeof v === "object" && typeof (v as MadeFrom).inputs === "string" ? (v as MadeFrom) : undefined
}

const RECORDED = [MADE_FROM.name, DELIVERED_ON.name]

export const deliveryHook: WriteHook = {
  name: "artifacts-delivered",
  says:
    "an artifact becomes delivered only with its files — every path in files exists, and there is at least one, there or in its attachments — and is then stamped with madeFrom (the commit, the digest over its inputs and the data of what it uses, the moment) and deliveredOn; any other write that changes those two is refused",
  beforeWrite(write, ctx) {
    const { item, before } = write
    if (write.kind === "move" || !isArtifact(item)) return
    if (item.meta.status !== DELIVERED || before?.status === DELIVERED) {
      const changed = RECORDED.filter((f) => canonical(item.meta[f]) !== canonical(before?.[f]))
      if (changed.length && !write.force) {
        return `${label(item)}: ${changed.join(" and ")} ${
          changed.length > 1 ? "are" : "is"
        } recorded on delivery, never by hand — naima set ${item.slug} status=${DELIVERED}`
      }
      return
    }
    const files = pathsOf(item, FILES)
    const missing = files.filter((f) => !existsSync(resolve(ctx.root, f)))
    if (missing.length) return `${label(item)} names files that do not exist: ${missing.join(", ")} — make them first, or correct files`
    if (!files.length && !walkFiles(join(item.dir, ATTACHMENTS), { skipHidden: true }).length) {
      return `${label(item)} has no files to deliver — naima set ${item.slug} files=<path>,… or naima attach ${item.slug} <file>`
    }
    const commit = gitOrNull(ctx.root, "rev-parse", "HEAD")
    item.meta[MADE_FROM.name] = { ...(commit ? { commit } : {}), inputs: inputsDigest(ctx, item), at: ctx.now().toISOString() }
    item.meta[DELIVERED_ON.name] = today(ctx)
  },
}

export const artifactsCheck: Check = {
  name: "artifacts-current",
  says:
    "as notes: an artifact past its due day and not delivered; a delivered artifact whose inputs, or the data of the items it uses, changed since it was made; a planned artifact nothing produces",
  run(ctx) {
    const out: Finding[] = []
    const day = today(ctx)
    for (const a of ctx.repo.items.filter(isArtifact)) {
      const status = a.meta.status
      const due = fieldValue(a, { name: DUE.name, kind: "date" })
      if (due && due < day && status !== DELIVERED && status !== SUPERSEDED) {
        out.push({
          level: "note",
          item: a,
          message: `${
            label(a)
          } was due on ${due} and is ${status} — deliver it (naima set ${a.slug} status=${DELIVERED}), or move the day (naima set ${a.slug} due=<YYYY-MM-DD>)`,
        })
      }
      if (status === PLANNED && !linked(ctx, a, PRODUCED_BY).length) {
        out.push({ level: "note", item: a, message: `${label(a)} is planned and nothing produces it — naima link <todo> ${PRODUCES} ${label(a)}` })
      }
      if (status !== DELIVERED) continue
      const made = madeFromOf(a)
      if (made && made.inputs === inputsDigest(ctx, a)) continue
      out.push({
        level: "note",
        item: a,
        message: made
          ? `${label(a)}: its inputs changed since it was made${
            made.commit ? ` at ${made.commit.slice(0, 12)}` : ""
          } — make it again and deliver it (naima set ${a.slug} status=in-progress, then status=${DELIVERED}), or deliver a new artifact that supersedes it`
          : `${label(a)} is delivered with no record of what it was made from — naima set ${a.slug} status=in-progress, then status=${DELIVERED}`,
      })
    }
    return out
  },
}
