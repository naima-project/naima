// Planning: what the result must satisfy, how it must behave, and what the
// owner has decided — as items, so each is proven or checked, never implied.
//
//   requirements  what must hold; delivered by items linked `satisfies`, proven
//                 by tests or properties linked `verifies`; met only once a
//                 proof has passed and none refutes it.
//   specs         how something must behave, versioned `name-vN`: a revision
//                 is a new item that `supersedes` the old; one version per name
//                 is current; items follow a spec by `specified-by`.
//   decisions     a choice or a standing permission of the owner's, dated, in
//                 the owner's words restated; it `settles` the items that
//                 waited on it, and is searched before the owner is asked.
//   releases      a release in progress, opened at its first stage: each
//                 stage's output recorded with `naima note` ("Stage: <name>"),
//                 or named who decided to skip it; a hook refuses `released`
//                 while a stage is unrecorded.
//   artifacts     what the project makes and keeps (artifacts.ts): due by a
//                 day, produced by a todo, made of files; delivering one
//                 records the commit and inputs it was made from.
//
// Data only: five types, their fields and relations, checks that read them,
// two views and two commands. No type derives from another.
//
// It ships two rules: requirements are elicited at every prompt of the owner,
// each with how it is checked or measured; behaviour with states or
// concurrency is designed from a model first, kept in step with the code.

import {
  bool,
  type Check,
  type Command,
  type Context,
  CONTRACT,
  createItem,
  type FieldDef,
  fieldValue,
  type Finding,
  isOpen,
  type Item,
  label,
  linked,
  parse,
  type Plugin,
  proves,
  readReadme,
  refutes,
  rendered,
  saveProse,
  slugify,
  today,
  type TypeDef,
  typeOrThrow,
  usageError,
  type View,
  type WriteHook,
} from "../../core/api.ts"
import { ARTIFACT_FIELDS, ARTIFACT_RELATIONS, artifactsCheck, artifactsType, deliveryHook } from "./artifacts.ts"

// ── requirements ──────────────────────────────────────────────────────────────

/** The trait the gates plugin reads (dependencies.ts): a standard the work is held to, never itself the work. */
const STANDARD = "standard"

const requirementsType: TypeDef = {
  id: "requirements",
  traits: [STANDARD],
  dir: "requirements",
  title: "Requirements",
  says:
    "something the result must satisfy, stated so it can be checked: delivered by the items that satisfy it, proven by the tests or properties that verify it",
  statuses: {
    stated: { category: "open", says: "stated, and not yet proven" },
    met: { category: "done", says: "proven: a test or property linked to it has passed, and none refutes it" },
    dropped: { category: "done", says: "no longer required; the page says why" },
  },
  initialStatus: "stated",
  template: (title) =>
    `# ${title}\n\nWhat the result must satisfy, said so that a test or a property can check it.\n\n## How it is proven\n\nThe tests or properties linked \`verifies\`, and what each measures.\n`,
}

/** Where a requirement's proof stands: a refuting proof outweighs any that proves. */
export type Proven = "proven" | "refuted" | "unproven"

/** The items that prove or would prove a requirement: those verifying it, and any item satisfying it that is itself a proof. */
const proofsOf = (ctx: Context, req: Item): Item[] =>
  [...linked(ctx, req, "verified-by"), ...linked(ctx, req, "satisfied-by").filter((i) => proves(ctx, i) || refutes(ctx, i))]
    .filter((i, n, all) => all.indexOf(i) === n)

export function provenState(ctx: Context, req: Item): Proven {
  const proofs = proofsOf(ctx, req)
  if (proofs.some((p) => refutes(ctx, p))) return "refuted"
  return proofs.some((p) => proves(ctx, p)) ? "proven" : "unproven"
}

const requirementsOf = (ctx: Context): Item[] => ctx.repo.items.filter((i) => i.type === requirementsType.id)

const requirementsCheck: Check = {
  name: "requirements-proven",
  says:
    "a requirement marked met has a proof that passed and none that refutes it; one proven but still stated is noted; one that nothing satisfies or verifies is noted",
  run(ctx) {
    const out: Finding[] = []
    for (const req of requirementsOf(ctx)) {
      const state = provenState(ctx, req)
      const status = req.meta.status
      if (status === "met" && state === "refuted") {
        const by = proofsOf(ctx, req).filter((p) => refutes(ctx, p)).map(label).join(", ")
        out.push({ level: "problem", item: req, message: `${label(req)} is met, but ${by} refutes it — fix it, or naima set ${label(req)} status=stated` })
      } else if (status === "met" && state === "unproven") {
        out.push({
          level: "problem",
          item: req,
          message: `${label(req)} is met, but no proof has passed — naima link <test> verifies ${label(req)}, or naima set ${label(req)} status=stated`,
        })
      } else if (status === "stated" && state === "proven") {
        out.push({ level: "note", item: req, message: `${label(req)} is proven — naima set ${label(req)} status=met` })
      } else if (status === "stated" && !linked(ctx, req, "satisfied-by").length && !linked(ctx, req, "verified-by").length) {
        out.push({
          level: "note",
          item: req,
          message: `${label(req)}: nothing delivers or proves it — naima link <feature> satisfies ${label(req)}; naima link <test> verifies ${label(req)}`,
        })
      }
    }
    return out
  },
}

/** One requirement, as `naima view --json requirements` prints it. */
export interface Trace {
  requirement: string
  title: string
  status: string
  proven: Proven
  satisfiedBy: string[]
  provenBy: string[]
}

const requirementsView: View = {
  name: "requirements",
  says: "every requirement that is not dropped: its status, whether it is proven, what satisfies it and what proves it",
  render(_args, ctx) {
    const rows: Trace[] = requirementsOf(ctx).filter((r) => r.meta.status !== "dropped").map((r) => ({
      requirement: label(r),
      title: String(r.meta.title ?? ""),
      status: r.meta.status,
      proven: provenState(ctx, r),
      satisfiedBy: linked(ctx, r, "satisfied-by").map(label),
      provenBy: proofsOf(ctx, r).map(label),
    }))
    return rendered(rows, (rs) =>
      rs.length
        ? rs.flatMap((r) => [
          `${r.proven === "proven" ? "✓" : "✗"} ${r.requirement}  ${r.title}  [${r.status}] ${r.proven}`,
          `    satisfied by: ${r.satisfiedBy.join(", ") || "nothing"}`,
          `    proven by:    ${r.provenBy.join(", ") || "nothing"}`,
        ])
        : [`no requirements — naima new requirements "<what must hold>"`])
  },
}

// ── specs ─────────────────────────────────────────────────────────────────────

const specsType: TypeDef = {
  id: "specs",
  dir: "specs",
  title: "Specifications",
  says: "how something must behave, versioned name-vN: a revision is a new item that supersedes the old, and one version per name is current",
  statuses: {
    draft: { category: "open", says: "being written or agreed; the items that follow it wait for it" },
    current: { category: "done", says: "the version in force: work follows it, and the close flow checks the code against it" },
    superseded: { category: "done", says: "replaced by a later version, kept as history" },
  },
  initialStatus: "draft",
  template: (title) =>
    `# ${title}\n\nThe behaviour, said so that it can be checked: what goes in, what comes out, and the cases at the edges.\n\n## Changes from the previous version\n\nNone: the first version.\n`,
}

const SPEC: FieldDef = {
  name: "spec",
  kind: "string",
  says: "the name every version of a specification shares; set from the title when the spec is opened",
  appliesTo: ["specs"],
}
const VERSION: FieldDef = {
  name: "version",
  kind: "number",
  says: "the specification's version, N in name-vN; set from the title (`… v2`), else 1",
  appliesTo: ["specs"],
}

const VERSIONED = /\s+v(\d+)$/i
const specName = (s: Item): string => fieldValue(s, { name: SPEC.name, kind: "string" }) ?? s.slug
const versionOf = (s: Item): number => fieldValue(s, { name: VERSION.name, kind: "number" }) ?? 1
/** A spec's versioned name, `name-vN`. */
export const versioned = (s: Item): string => `${specName(s)}-v${versionOf(s)}`
const isSpec = (i: Item): boolean => i.type === specsType.id
const specsOf = (ctx: Context): Item[] => ctx.repo.items.filter(isSpec)

/** One specification, every version of it, as `naima spec --json` prints it. */
export interface SpecRow {
  spec: string
  current: string | null
  versions: number
  drafts: string[]
  /** The open items that follow some version of it, each with the version it follows. */
  followedBy: string[]
}

function specRows(ctx: Context): SpecRow[] {
  const byName = new Map<string, Item[]>()
  for (const s of specsOf(ctx)) byName.set(specName(s), [...(byName.get(specName(s)) ?? []), s])
  return [...byName].sort(([a], [b]) => a.localeCompare(b)).map(([spec, all]) => {
    const vs = [...all].sort((a, b) => versionOf(a) - versionOf(b))
    const current = vs.filter((s) => s.meta.status === "current").at(-1)
    return {
      spec,
      current: current ? versioned(current) : null,
      versions: vs.length,
      drafts: vs.filter((s) => s.meta.status === "draft").map(versioned),
      followedBy: vs.flatMap((s) => linked(ctx, s, "specifies").filter((i) => isOpen(ctx, i)).map((i) => `${label(i)} (${versioned(s)})`)),
    }
  })
}

const spec: Command = {
  name: "spec",
  says: "each specification: its current version, its drafts, and the open items that follow it; or revise one into its next version",
  enforces: "a revision is a new spec item, its next version, that supersedes the old one; the old version is kept as it was",
  usage: "spec [--json] | spec revise <spec>",
  options: [{ name: "--json", says: "print each specification as JSON: spec, current, versions, drafts, followedBy" }],
  examples: ["spec", "spec --json", "spec revise specs/export-format"],
  run(args, ctx) {
    const p = parse(args, { json: { type: "boolean" } })
    const [sub, ref, ...extra] = p.positionals
    if (sub === "revise") {
      if (!ref || extra.length) throw usageError(this)
      const old = ctx.repo.resolve(ref)
      if (!isSpec(old)) throw new Error(`${label(old)} is not a spec — open one: naima new specs "<name>"`)
      const name = specName(old)
      const next = Math.max(...specsOf(ctx).filter((s) => specName(s) === name).map(versionOf)) + 1
      const title = `${String(old.meta.title ?? name).replace(VERSIONED, "")} v${next}`
      const made = createItem(ctx, typeOrThrow(ctx, specsType.id), title, {
        [SPEC.name]: name,
        [VERSION.name]: next,
        links: [{ rel: "supersedes", id: old.meta.id }],
      })
      saveProse(ctx, made, `# ${title}\n${readReadme(old).replace(/^#[^\n]*\n/, "")}`)
      ctx.reload()
      ctx.out(`${label(made)}: ${name}-v${next} (draft) supersedes ${versioned(old)} — edit its page, then naima set ${label(made)} status=current`)
      return 0
    }
    if (sub !== undefined) throw usageError(this)
    const rows = specRows(ctx)
    if (bool(p, "json")) {
      ctx.out(JSON.stringify(rows, null, 2))
      return 0
    }
    if (!rows.length) ctx.out(`no specifications — naima new specs "<name>"`)
    for (const r of rows) {
      ctx.out(
        `${r.spec}  current ${r.current ?? "none"} · ${r.versions} version${r.versions === 1 ? "" : "s"}${
          r.drafts.length ? ` · draft ${r.drafts.join(", ")}` : ""
        }`,
      )
      for (const f of r.followedBy) ctx.out(`  followed by ${f}`)
    }
    return 0
  },
}

const specsCheck: Check = {
  name: "specs-versioned",
  says:
    "one version of a specification is current; a version superseded by a current one is marked superseded; a spec supersedes only an earlier version of itself; an open item following a superseded version is noted",
  run(ctx) {
    const out: Finding[] = []
    const specs = specsOf(ctx)
    for (const r of specRows(ctx)) {
      const current = specs.filter((s) => specName(s) === r.spec && s.meta.status === "current")
      const [first] = current
      if (first && current.length > 1) {
        out.push({
          level: "problem",
          item: first,
          message: `${r.spec} has ${current.length} current versions: ${current.map(versioned).join(", ")} — keep one`,
        })
      }
    }
    for (const s of specs) {
      for (const later of linked(ctx, s, "superseded-by").filter(isSpec)) {
        if (specName(later) !== specName(s) || versionOf(later) <= versionOf(s)) {
          out.push({ level: "problem", item: later, message: `${versioned(later)} supersedes ${versioned(s)}, which is not an earlier version of it` })
        } else if (later.meta.status === "current" && s.meta.status !== "superseded") {
          out.push({
            level: "problem",
            item: s,
            message: `${versioned(s)} is superseded by ${versioned(later)}, which is current — naima set ${label(s)} status=superseded`,
          })
        }
      }
      if (s.meta.status !== "superseded") continue
      const successor = linked(ctx, s, "superseded-by").filter(isSpec).sort((a, b) => versionOf(b) - versionOf(a))[0]
      for (const i of linked(ctx, s, "specifies").filter((i) => isOpen(ctx, i))) {
        out.push({
          level: "note",
          item: i,
          message: `${label(i)} follows ${versioned(s)}, superseded${
            successor ? ` by ${versioned(successor)}` : ""
          } — check it against the current version, then naima link it specified-by that one`,
        })
      }
    }
    return out
  },
}

// ── decisions ─────────────────────────────────────────────────────────────────

const decisionsType: TypeDef = {
  id: "decisions",
  dir: "decisions",
  title: "Decisions",
  says:
    "a choice or a standing permission of the owner's, recorded once: dated, in the owner's words restated, linked to what it settles; searched before the owner is asked",
  statuses: {
    settled: { category: "done", says: "in force: act on it, never ask it again" },
    reopened: { category: "open", says: "the owner reopened it: the question may be asked again, and the answer is a new decision that supersedes this one" },
    superseded: { category: "done", says: "replaced by a later decision, kept as history" },
  },
  initialStatus: "settled",
  template: (title) =>
    `# ${title}\n\n## The owner's words, restated\n\nWhat the owner decided, said once so that nobody asks again.\n\n## Why\n\nThe reason given.\n\n## When to reopen it\n\nWhat would make the question worth asking again; nothing else does.\n`,
}

const DECIDED_ON: FieldDef = {
  name: "decidedOn",
  kind: "date",
  says: "when the owner decided; stamped with today when the decision is recorded",
  appliesTo: ["decisions"],
}
const STANDING: FieldDef = {
  name: "standing",
  kind: "boolean",
  says: "a standing permission: the action it names may be taken again, every time, without asking",
  appliesTo: ["decisions"],
}

const RUN_BY = { name: "runBy", kind: "enum" } as const
const HUMAN_BECAUSE = { name: "humanBecause", kind: "enum" } as const
const isDecision = (i: Item): boolean => i.type === decisionsType.id
const decidedOn = (d: Item): string => fieldValue(d, { name: DECIDED_ON.name, kind: "date" }) ?? String(d.meta["created"] ?? "")
const isStanding = (d: Item): boolean => fieldValue(d, { name: STANDING.name, kind: "boolean" }) === true

/** One decision, as `naima decisions --json` prints it. */
export interface DecisionRow {
  item: string
  title: string
  status: string
  decidedOn: string
  standing: boolean
  settles: string[]
  text: string
}

/** The decisions whose title or page hold every word of `words`, settled ones only unless `all`; newest first. */
export function findDecisions(ctx: Context, words: string[], all = false): DecisionRow[] {
  const wanted = words.map((w) => w.toLowerCase())
  return ctx.repo.items
    .filter((d) => isDecision(d) && (all || d.meta.status === "settled"))
    .map((d): DecisionRow => ({
      item: label(d),
      title: String(d.meta.title ?? ""),
      status: d.meta.status,
      decidedOn: decidedOn(d),
      standing: isStanding(d),
      settles: linked(ctx, d, "settles").map(label),
      text: readReadme(d).replace(/^#[^\n]*\n/, "").trim(),
    }))
    .filter((r) => wanted.every((w) => `${r.title}\n${r.text}`.toLowerCase().includes(w)))
    .sort((a, b) => b.decidedOn.localeCompare(a.decidedOn) || a.item.localeCompare(b.item))
}

const decisions: Command = {
  name: "decisions",
  says: "search the owner's decisions before asking: the settled ones whose title or page hold every word given, newest first",
  enforces: "nothing: it only searches, so a settled question is looked up before it is asked again",
  usage: "decisions [<word>...] [--all] [--json]",
  options: [
    { name: "--all", says: "search the superseded and reopened decisions too" },
    { name: "--json", says: "print the decisions as JSON: item, title, status, decidedOn, standing, settles, text" },
  ],
  examples: ["decisions", "decisions journal", "decisions licence --all --json"],
  run(args, ctx) {
    const p = parse(args, { all: { type: "boolean" }, json: { type: "boolean" } })
    const rows = findDecisions(ctx, p.positionals, bool(p, "all"))
    if (bool(p, "json")) {
      ctx.out(JSON.stringify(rows, null, 2))
      return 0
    }
    if (!rows.length) {
      const what = p.positionals.length ? ` matches "${p.positionals.join(" ")}"` : "s yet"
      ctx.out(`no ${bool(p, "all") ? "" : "settled "}decision${what} — ask the owner, then record the answer: naima new decisions "<the decision>"`)
    }
    for (const r of rows) {
      ctx.out(`${r.item}  ${r.title}  (${r.decidedOn}${r.status === "settled" ? "" : `, ${r.status}`})${r.standing ? " · standing permission" : ""}`)
      if (r.settles.length) ctx.out(`  settles ${r.settles.join(", ")}`)
    }
    return 0
  },
}

const decisionsCheck: Check = {
  name: "decisions-settled",
  says:
    "an open item waiting on the owner's decision (runBy human, humanBecause decision) that a settled decision settles is noted, to be acted on rather than asked; a decision superseded by a settled one is marked superseded",
  run(ctx) {
    const out: Finding[] = []
    for (const i of ctx.repo.items) {
      if (isDecision(i)) {
        for (const later of linked(ctx, i, "superseded-by").filter(isDecision)) {
          if (later.meta.status === "settled" && i.meta.status !== "superseded") {
            out.push({
              level: "problem",
              item: i,
              message: `${label(i)} is superseded by ${label(later)}, which is settled — naima set ${label(i)} status=superseded`,
            })
          }
        }
        continue
      }
      if (!isOpen(ctx, i) || fieldValue(i, RUN_BY) !== "human" || fieldValue(i, HUMAN_BECAUSE) !== "decision") continue
      for (const d of linked(ctx, i, "settled-by").filter((d) => isDecision(d) && d.meta.status === "settled")) {
        out.push({
          level: "note",
          item: i,
          message: `${label(i)} waits on a decision that ${label(d)} settled on ${decidedOn(d)} — act on it; ask the owner only to reopen it`,
        })
      }
    }
    return out
  },
}

// ── releases ──────────────────────────────────────────────────────────────────

/** The stages a release runs through, in order; `naima docs/agents/release.md` names what each one does. */
export const STAGES = ["pre-release checks", "private draft", "test the artifact", "publish", "post-release checks", "announce"] as const

const releasesType: TypeDef = {
  id: "releases",
  dir: "releases",
  title: "Releases",
  says: "a release in progress, staged from pre-release checks to announcing: each stage's output recorded before the next, a skipped stage naming who decided",
  statuses: {
    staging: { category: "open", says: "in progress: opened at its first stage, not every stage is recorded yet" },
    released: { category: "done", says: "every stage is recorded, or skipped and said by whom; published and announced" },
    "rolled-back": { category: "done", says: "a stage found an issue serious enough to stop the release; the page says why" },
  },
  initialStatus: "staging",
  template: (title) =>
    `# ${title}\n\n## Stages\n\n${
      STAGES.map((s) => `- ${s}`).join("\n")
    }\n\nRecord each stage's output with \`naima note <release> "Stage: <name>\\n<what happened>"\`.\nA stage skipped on purpose: \`Stage: <name> — skipped, decided by <who>\`.\n`,
}

const isRelease = (i: Item): boolean => i.type === releasesType.id
const releasesOf = (ctx: Context): Item[] => ctx.repo.items.filter(isRelease)

/** A line `Stage: <name>` in an item's page, case-insensitively. */
const STAGE_LINE = /^stage:\s*(.+?)\s*$/gim
/** The skipped form of a stage line, `<name> — skipped, decided by <who>` (a plain `-` works too). */
const STAGE_SKIPPED = /^(.*?)\s*[—-]+\s*skipped,\s*decided by\s+(.+)$/i

/** Every stage recorded on a release's page, by name (lower-cased): `true` if run, or who decided to skip it. */
function recordedStages(item: Item): Map<string, true | string> {
  const out = new Map<string, true | string>()
  for (const m of readReadme(item).matchAll(STAGE_LINE)) {
    const skipped = STAGE_SKIPPED.exec(m[1]!)
    const name = (skipped ? skipped[1]! : m[1]!).trim().toLowerCase()
    out.set(name, skipped ? skipped[2]!.trim() : true)
  }
  return out
}

/** The stages `naima release` still owes before the release can be marked `released`. */
const missingStages = (item: Item): string[] => {
  const recorded = recordedStages(item)
  return STAGES.filter((s) => !recorded.has(s))
}

/** One release, as `naima view --json releases` prints it. */
export interface ReleaseRow {
  release: string
  title: string
  status: string
  missing: string[]
}

const releasesView: View = {
  name: "releases",
  says: "every release in progress or done: its status and which stages it still owes",
  render(_args, ctx) {
    const rows: ReleaseRow[] = releasesOf(ctx).map((r) => ({
      release: label(r),
      title: String(r.meta.title ?? ""),
      status: r.meta.status,
      missing: missingStages(r),
    }))
    return rendered(
      rows,
      (rs) =>
        rs.length
          ? rs.map((r) => `${r.missing.length ? "✗" : "✓"} ${r.release}  ${r.title}  [${r.status}]${r.missing.length ? `  owes: ${r.missing.join(", ")}` : ""}`)
          : [`no releases — naima new releases "<name>"`],
    )
  },
}

const releasesHook: WriteHook = {
  name: "release-stages",
  says: "a release is marked released only once every stage is recorded, or skipped and said by whom",
  beforeWrite(write) {
    if (!isRelease(write.item) || write.kind !== "update" || !write.before) return
    const asked = write.item.meta.status
    if (asked === "released" && write.before.status !== "released") {
      const missing = missingStages(write.item)
      if (missing.length) {
        return `${label(write.item)} cannot be released: record Stage: ${missing[0]} first — naima note ${label(write.item)} "Stage: ${
          missing[0]
        }\\n<what happened>", or "… — skipped, decided by <who>"`
      }
    }
  },
}

const releasesCheck: Check = {
  name: "release-stages",
  says: "a release marked released has every stage recorded or skipped with who decided; one hand-edited past the hook is a problem",
  run(ctx) {
    const out: Finding[] = []
    for (const r of releasesOf(ctx)) {
      const missing = missingStages(r)
      if (r.meta.status === "released" && missing.length) {
        out.push({
          level: "problem",
          item: r,
          message: `${label(r)} is released, but owes Stage: ${missing.join(", ")} — naima set ${label(r)} status=staging`,
        })
      } else if (r.meta.status === "staging" && !missing.length) {
        out.push({ level: "note", item: r, message: `${label(r)}: every stage is recorded — naima set ${label(r)} status=released` })
      }
    }
    return out
  },
}

// ── sessions ──────────────────────────────────────────────────────────────────

// A dated, append-only record of one test sitting — optional, for a project
// that wants the sitting itself kept (who ran it, what else was noticed),
// not only the test's own result. Several sessions share a `run` name when
// they are one sitting of several tests together.

const sessionsType: TypeDef = {
  id: "sessions",
  dir: "sessions",
  title: "Sessions",
  says:
    "a dated, append-only record of one test sitting: written once and never edited to change what happened — optional, not a daily habit to enforce; the test's own page is usually enough on its own",
  statuses: {
    recorded: { category: "done", says: "written; a session is never reopened — a later sitting is a new session" },
  },
  initialStatus: "recorded",
  creatable: true,
  template: (title) =>
    `# ${title}\n\n## What was sat\n\nThe test or tests this session sat for (\`naima link\` them \`records\`).\n\n## What happened\n\nWritten once; append only. A later sitting is a new session, never an edit to this one.\n`,
}

const SITTING_RUN: FieldDef = {
  name: "sittingRun",
  kind: "string",
  says: "the name shared by every session of one sitting, when several tests were sat together",
  appliesTo: ["sessions"],
}

// ── rules ─────────────────────────────────────────────────────────────────────

/** The rule that requirements come from every conversation, not only from the start of the work. */
export const ELICITATION_RULE = {
  name: "requirements-elicited-at-every-prompt",
  title: "Requirements are elicited at every prompt, each with how it is checked or measured",
  audience: "agents",
  strength: "must",
  text:
    'At every prompt of the owner, an agent checks whether what was said adds a requirement or changes one, and when it does, files it at once as part of the report flow: a new one with `naima new requirements "<what must hold>"`, a changed one by revising its page, and a change to exactly how something behaves as the next version of its specification (`naima spec revise`). A vague wish is restated as something a test can decide, and the agent settles how it will be checked or measured: a test, a property of a model, or, for anything measurable (a time, a size, a count, a rate), a metric with a budget. The agent proposes the check and asks the owner only for what is theirs to give, such as the number a budget holds to; the answer goes on the page of the requirement, and the test or property that checks it (for a metric, a test whose gesture is `naima metrics run <metric>` within its budget) is linked `verifies` once it exists. A requirement on behaviour with states or concurrency is proposed as a model with its properties.',
  why:
    "the owner keeps stating needs in passing, long after the work has started; a requirement heard in chat and never filed is lost, and one filed with no way to check it can never be met, so it is argued over instead of measured.",
  ack: "Elicitation mode on",
  enforcedBy: "requirements-proven",
}

/** The rule that behaviour with states or concurrency starts from a model. */
export const MODEL_FIRST_RULE = {
  name: "behaviour-designed-from-a-model",
  title: "Behaviour with states or concurrency is designed from a model first, kept in step with the code",
  audience: "everyone",
  strength: "should",
  text:
    'Before implementing behaviour that has states or concurrency (a lifecycle, a protocol, a scheduler, a retry loop, two processes sharing data), whoever designs it writes a model of it: a state machine, as data or drawn; an mCRL2 specification; or a state machine encoded in mCRL2, for which the guide gives a template. Another form a tool can check is welcome too. Each property the behaviour must have is an item, a `properties` item checked by `naima verify` where a verifier exists, and the model changes in the same change as the code it describes. A trivial change needs no model; skipping it on non-trivial behaviour needs its reason, written on the item as a note (`naima note <item> "No model: <reason>"`).',
  why:
    "behaviour with states fails in the orders of events nobody thought to test, and a model checker explores every order; a model written after the code only describes the code, defects included, while one written first is what the code is checked against.",
  ack: "Model first mode on",
}

// ── hooks ─────────────────────────────────────────────────────────────────────

const stamp: WriteHook = {
  name: "planning-stamps",
  says:
    "a new spec takes its name and version from its title (`Export format v2` is export-format, version 2) unless given; a new decision is dated today unless given",
  beforeWrite(write, ctx) {
    if (write.kind !== "create") return
    const meta = write.item.meta
    if (write.item.type === specsType.id) {
      const title = String(meta.title ?? "")
      meta[SPEC.name] ??= slugify(title.replace(VERSIONED, ""))
      meta[VERSION.name] ??= Number(VERSIONED.exec(title)?.[1] ?? 1)
    } else if (write.item.type === decisionsType.id) {
      meta[DECIDED_ON.name] ??= today(ctx)
    }
  },
}

export default function planning(): Plugin {
  return {
    name: "planning",
    contract: CONTRACT,
    says: "requirements proven by tests, specifications versioned name-vN, the owner's decisions recorded once, and the artifacts the project makes and keeps",
    about: "Planning as items, so each is proven or checked rather than implied by a test. " +
      "A **requirement** says what must hold: the features, tests or epics that deliver it are linked `satisfies`, the tests or properties that prove it `verifies`; it is `met` only once a proof has passed and none refutes it, and `naima view requirements` traces each one. " +
      "A **specification** says how something must behave, versioned `name-vN`: `naima spec revise <spec>` opens the next version as a draft that `supersedes` the old one, one version per name is `current`, and an item that follows a spec is linked `specified-by` — work starts from the spec, and closes when the code matches it. " +
      "A **decision** is a choice or a standing permission of the owner's, dated and restated in the owner's words: it `settles` the items that waited on it and `supersedes` the decision it replaces. " +
      "Before asking the owner anything, an agent runs `naima decisions <words>`; after the owner answers, it records the answer with `naima new decisions`, so a settled question is never asked again. " +
      'A **release** opens at its first stage (`naima new releases "<name>"`); each stage\'s output is recorded with `naima note`, headed `Stage: <name>` (or `Stage: <name> — skipped, decided by <who>`), and the hook refuses `status=released` while a stage is unrecorded — `naima view releases` shows what each one still owes. ' +
      "A **session** is a dated, append-only record of one test sitting, linked `records` to the test or tests it was for; several share a `run` name when they were sat together. It is optional — most of the time the test's own page and status say enough — and is never edited once written: a later sitting is a new session. " +
      "An **artifact** is something the project makes and keeps — an analysis, a profile, a report, a dataset, a figure: `due` by a day, made by the todo or feature linked `produces`, made of `files` (paths from the project root) or its attachments, made from `inputs` (files or directories) and the data of the tests, properties or other artifacts it `uses`, and replaced by a later version that `supersedes` it. `naima set <artifact> status=delivered` refuses while a file it names is missing or it has none, and otherwise records `madeFrom` — the commit, one digest over its inputs and the data of what it uses, the moment — and `deliveredOn`, from which `naima diary` tells the delivery; neither is set by hand. `artifacts-current` notes an artifact past its due day and not delivered, a delivered one whose inputs changed since it was made, and a planned one nothing produces. " +
      'The plugin ships two rules, listed by `naima rules` when the rules plugin is loaded: requirements are elicited at every prompt of the owner, each with how it is checked or measured (a test, a property, or a metric with a budget), acknowledged as "Elicitation mode on" and held in part by `requirements-proven`, which notes a requirement nothing proves; and behaviour with states or concurrency is designed from a model first (a state machine, mCRL2, or a state machine encoded in mCRL2), its properties as items, kept in step with the code, acknowledged as "Model first mode on".',
    types: [requirementsType, specsType, decisionsType, releasesType, sessionsType, artifactsType],
    fields: [SPEC, VERSION, DECIDED_ON, STANDING, SITTING_RUN, ...ARTIFACT_FIELDS],
    relations: [
      { name: "satisfies", inverse: "satisfied-by", says: "delivers or proves the requirement" },
      { name: "satisfied-by", inverse: "satisfies", says: "is delivered by" },
      { name: "specified-by", inverse: "specifies", says: "follows the specification" },
      { name: "specifies", inverse: "specified-by", says: "is the specification followed by" },
      { name: "supersedes", inverse: "superseded-by", says: "replaces an earlier version, decision or artifact" },
      { name: "superseded-by", inverse: "supersedes", says: "is replaced by" },
      { name: "settles", inverse: "settled-by", says: "is the decision that answers" },
      { name: "settled-by", inverse: "settles", says: "is answered by the decision" },
      { name: "records", inverse: "recorded-by", says: "is the session recording a sitting of" },
      { name: "recorded-by", inverse: "records", says: "has a sitting recorded by the session" },
      ...ARTIFACT_RELATIONS,
    ],
    // What it reads of others: who performs a proof and why, and what proves an item.
    uses: { fields: [RUN_BY.name, HUMAN_BECAUSE.name], relations: ["verified-by"] },
    commands: [spec, decisions],
    views: [requirementsView, releasesView],
    checks: [requirementsCheck, specsCheck, decisionsCheck, releasesCheck, artifactsCheck],
    hooks: [stamp, releasesHook, deliveryHook],
    contributes: { rules: [ELICITATION_RULE, MODEL_FIRST_RULE] },
    // The rules are listed by naima rules when the rules plugin is loaded; without it, planning works the same.
    optional: ["rules"],
  }
}
