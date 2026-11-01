// The standard trackers: bugs, todos, features, tests, and the closed archive.
//
// Three words that are not synonyms:
//   fixed     the code change exists (`fixedOn` is set). Nothing is proven.
//   resolved  fixed, and proven by an item that `verifies` it and has passed.
//   closed    resolved, and moved to the archive with its proof.
//
// And one way out that is no resolution: retired, an item of any type that
// no longer applies, archived on the owner's word with the reason, the
// owner's consent and what replaced it (`naima retire`).

import { existsSync, readdirSync } from "node:fs"
import { join } from "node:path"
import {
  appliesTo,
  ATTACHMENTS,
  bool,
  type Check,
  type Command,
  commitExists,
  type Context,
  CONTRACT,
  fieldValue,
  type Finding,
  isAncestor,
  isOpen,
  isRetired,
  type Item,
  label,
  linked,
  moveItem,
  parse,
  type Plugin,
  proves,
  readReadme,
  refutes,
  rendered,
  RETIRED,
  runChecks,
  setFieldValue,
  str,
  type SummarySection,
  today,
  trunk,
  typeOrThrow,
  usageError,
  type WriteHook,
} from "../../core/api.ts"
import { declaredRepositories, type ForeignVerdict, parseForeign, verifyForeign } from "./foreign.ts"

/**
 * A retired item in words — `closed/x (title) retired on 2026-11-01: why; replaced by features/y` — from the fields and
 * the relation naima retire writes, read by name: plugins never import each other.
 */
function retiredSays(ctx: Context, item: Item): string {
  const on = typeof item.meta["closedOn"] === "string" ? ` on ${item.meta["closedOn"]}` : ""
  const why = typeof item.meta["retiredBecause"] === "string" ? `: ${item.meta["retiredBecause"]}` : ""
  const by = linked(ctx, item, "replaced-by").map(label)
  return `${label(item)} (${item.meta.title}) retired${on}${why}${by.length ? `; replaced by ${by.join(", ")}` : ""}`
}

/** The evidence ranking, strongest first: the values of a test's `evidenceKind`. */
export const EVIDENCE: ReadonlyArray<readonly [string, string]> = [
  ["owner-gesture", "the owner performed the gesture and saw the result"],
  ["observation", "a screenshot, a log line or a number, kept with the item"],
  ["live-read", "the live state, read by tooling: a query, an API call, the running program's own answer"],
  ["diff", "a before-and-after comparison: counts, sizes, outputs"],
  ["inspection", "the code looks right — which proves nothing"],
]

const ABOUT = `Three words that are not synonyms:

- **fixed** — the code change exists: \`fixedOn\` is set. Nothing is proven.
- **resolved** — fixed, and proven by an item that \`verifies\` it and whose status \`proves\` (a passed test, a property that holds).
- **closed** — resolved, and moved to \`closed/\` by \`naima close\`, carrying its proof.

A todo whose work is a judgement with no code, a review or a decision (its \`kind\` says which), has nothing to fix and no test to pass. Once its status is \`done\` or \`dropped\`, \`naima close <item> --reason "<what was settled, and where it is written>"\` archives it without a proof. The reason is kept in \`closedBecause\`, and \`naima check\` lists every such item as a note, \`closed-without-proof\`, so nothing is closed this way unseen.

An item of any type that no longer applies (a property whose model was replaced, a requirement given up, a todo filed by mistake) is ended with \`naima retire <item> --reason "<why>" [--replaced-by <item>] --consent "<the owner's yes, restated>"\`, and only on the owner's word. It is moved to \`closed/\` with status \`retired\`, keeping the reason in \`retiredBecause\`, the consent in \`retiredConsent\`, the type it came from in \`closedFrom\` and the day in \`closedOn\`; \`--replaced-by\` links it to what replaced it, and the replacement shows the inverse, \`replaces\`. There is no delete: an item filed by mistake is retired with that reason. A retired item leaves every queue, gate and long run, and stays readable (\`naima show\`, \`naima list closed --status retired\`). So that a retirement never hides a failing proof, \`naima check\` lists every retired item (\`retired-items\`), a gate that depended on a retired item or proof shows it, and a requirement whose proof was retired is no longer counted as proven and is flagged.

"How many bugs are left" means the unfixed count; \`naima bugs\` never adds the three together.

\`fixedOn\` applies to every type tagged \`fixable\` — bugs, todos, features and the archive here, and any other plugin's or project's type that carries the tag.

An item whose proof needs a person says why in \`humanBecause\`. Only a judgement, a reserved decision, a credential or a physical act makes something a person's: needing the running software makes it \`agent-hands\`, not \`human\`.

## The evidence ranking

Not all evidence is worth the same. From strongest to weakest, the values of a test's \`evidenceKind\`:

${EVIDENCE.map(([k, says], n) => `${n + 1}. \`${k}\` — ${says}`).join("\n")}

No number without its comparison: a count, a timing or a size proves something only beside the value it is compared with — before and after, expected and seen.

A regression test is one that \`verifies\` a bug. It proves the fix only if it was seen failing first, on the code before the fix: red, then green. \`redSeen\` records the day it was seen red, and the page's notes say how. \`naima check\` notes a passed regression test with no \`redSeen\`, and a passed test whose evidence is \`inspection\`.

## Stale pages

A page can outlive its answer. Two notes, never failures, find it: an open item's unticked \`- [ ]\` clause that names a test which has since passed, as \`tests/<slug>\` or as "the linked test" once every item verifying it has passed — \`unticked-clause-names-passed-test\`; and an open test marked \`runBy: agent\` whose page, below its title, excuses it with a resource being held — \`test-excuses-itself\`, matching the phrases in the option \`excusePhrases\`. Each can be weighed, or switched off, under \`plugins.trackers.checks\`.`

const FIXED_ON = { name: "fixedOn", kind: "date" } as const
const EVIDENCE_KIND = { name: "evidenceKind", kind: "enum" } as const
const RED_SEEN = { name: "redSeen", kind: "date" } as const

/** The phrases by which an agent's test says it could not run because something was held, unless the project gives its own. */
export const EXCUSE_PHRASES = ["held by", "was held", "is held", "in use by", "locked by", "busy", "unavailable"]

/** The trait of a type whose items are fixed, then proven, then closed: `fixedOn` applies to every type that carries it, whoever declares the type. */
export const FIXABLE = "fixable"
const CLOSED_FROM = { name: "closedFrom", kind: "string" } as const
const CLOSED_ON = { name: "closedOn", kind: "date" } as const
const RUN_BY = { name: "runBy", kind: "enum" } as const
const HUMAN_BECAUSE = { name: "humanBecause", kind: "enum" } as const
const COMMITS = { name: "commits", kind: "strings" } as const
const CLOSED_BECAUSE = { name: "closedBecause", kind: "string" } as const
const RETIRED_BECAUSE = { name: "retiredBecause", kind: "string" } as const
const RETIRED_CONSENT = { name: "retiredConsent", kind: "string" } as const
/** The relation from a retired item to what replaced it; the replacement shows the inverse. */
export const REPLACED_BY = "replaced-by"
const KIND = { name: "kind", kind: "string" } as const

/** The kinds of todo whose work is a judgement with no code — a review, a decision — closed with a reason instead of a proof. */
export const CLOSED_WITH_REASON = ["review", "decision"]

/** Whether `item` was closed with a reason, as a review or a decision, instead of with a proof. */
const closedWithReason = (item: Item): boolean => item.type === "closed" && !!fieldValue(item, CLOSED_BECAUSE)

/**
 * The one guessed value `commits` may hold: it marks an item closed before
 * this field existed, grandfathered in by the migration that shipped it — not
 * retrofitted with an invented hash. Never satisfies `naima close`'s own
 * requirement: only a real commit, reachable from the trunk, does that.
 */
export const LEGACY_COMMIT = "legacy"

/** The date, YYYY-MM-DD, from which an archived item is checked for a commit. Before it, nothing is retrofitted by guessing. */
const DEFAULT_COMMITS_REQUIRED_FROM = "2026-10-01"
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

function readOptions(options: Record<string, unknown>): { commitsRequiredFrom: string; repositories: string[] } {
  const v = options["commitsRequiredFrom"] ?? DEFAULT_COMMITS_REQUIRED_FROM
  if (typeof v !== "string" || !ISO_DATE.test(v)) {
    throw new Error(`trackers: options.commitsRequiredFrom must be a date, YYYY-MM-DD, got ${JSON.stringify(v)}`)
  }
  const r = options["repositories"] ?? []
  if (!Array.isArray(r) || !r.every((x) => typeof x === "string" && x.trim())) {
    throw new Error("trackers: options.repositories must be a list of git URLs")
  }
  return { commitsRequiredFrom: v, repositories: r as string[] }
}

/** Whether one of `item`'s `commits` is a real commit of the project, reachable from the trunk: read locally, never the network. */
function hasCommitFromTrunk(ctx: Context, item: Item): boolean {
  const t = trunk(ctx.root)
  if (!t) return false
  return (fieldValue(item, COMMITS) ?? []).some((h) => !parseForeign(h) && commitExists(ctx.root, h) && isAncestor(ctx.root, h, t))
}

/**
 * Whether one of `item`'s `commits` counts as its fix: a real commit reachable from the trunk, or a commit of another
 * repository the project declares (`<repository>@<hash>`) on that repository's default branch. Otherwise the reasons
 * each commit of another repository did not count, so a refusal says why; ok false with no trunk to read.
 */
function commitFromTrunk(ctx: Context, item: Item, repositories: readonly string[]): { ok: boolean; why: string[] } {
  if (hasCommitFromTrunk(ctx, item)) return { ok: true, why: [] }
  const listed = fieldValue(item, COMMITS) ?? []
  const foreign = listed.flatMap((h) => {
    const f = parseForeign(h)
    return f ? [{ entry: h, f }] : []
  })
  if (!foreign.length) return { ok: false, why: [] }
  const declared = declaredRepositories(ctx, repositories)
  const why: string[] = []
  for (const { entry, f } of foreign) {
    const v: ForeignVerdict = verifyForeign(ctx, f, declared)
    if (v.ok) return { ok: true, why: [] }
    why.push(`${entry}: ${v.why}`)
  }
  return { ok: false, why }
}

/** Whether `item` is grandfathered: closed before `commits` existed, marked so by the migration, not by a guess. */
const isGrandfathered = (item: Item): boolean => (fieldValue(item, COMMITS) ?? []).includes(LEGACY_COMMIT)

export type Lifecycle = "unfixed" | "fixed" | "resolved" | "closed"

const report = (title: string): string =>
  `# ${title}\n\nWhat happened, what was seen, and what is still open.\n\n## Evidence\n\nAttach screenshots and logs in attachments/.\n`
const work = (title: string): string => `# ${title}\n\nWhat has to be done, and how it will be known to be done.\n\n- [ ] \n`
const gesture = (title: string): string =>
  `# ${title}\n\nThe gesture that proves it, step by step, and what a pass looks like.\n\n## Result\n\nWhat was seen, when, and by whom.\n`

/** Where an item stands on the fixed → resolved → closed line. A proof that refutes outweighs any that proves. */
export function lifecycle(ctx: Context, item: Item): Lifecycle {
  if (item.type === "closed") return "closed"
  if (!fieldValue(item, FIXED_ON)) return "unfixed"
  const proofs = linked(ctx, item, "verified-by")
  return proofs.some((p) => proves(ctx, p)) && !proofs.some((p) => refutes(ctx, p)) ? "resolved" : "fixed"
}

/**
 * Why the proof of `item` does not stand now, or null: an item verifying it
 * refutes it, or `naima check` finds a problem on an item verifying it — a
 * property that holds on a model changed since its run, say. `close` refuses
 * on either: a proof that was once good is not a proof.
 */
export async function proofProblem(ctx: Context, item: Item): Promise<string | null> {
  const proofs = linked(ctx, item, "verified-by")
  const refuting = proofs.filter((p) => refutes(ctx, p))
  if (refuting.length) return `it is refuted by ${refuting.map((p) => `${label(p)} [${p.meta.status}]`).join(", ")}`
  const ids = new Set(proofs.map((p) => p.meta.id))
  const stale = (await runChecks(ctx)).problems.filter((f) => f.item && ids.has(f.item.meta.id))
  if (stale.length) return `its proof does not hold now: ${stale.map((f) => f.message).join("; ")}`
  return null
}

const partialWithoutClause: Check = {
  name: "partial-says-what-is-left",
  says: "a partial item carries at least one unticked `- [ ]` clause",
  run: (ctx) =>
    ctx.repo.items
      .filter((i) => i.meta.status === "partial" && !readReadme(i).split("\n").some((l) => /^\s*[-*]\s*\[ \]/.test(l)))
      .map((i): Finding => ({ level: "note", message: `${label(i)} is partial but its page has no unticked clause`, item: i })),
}

/** Whether `item` is fixed, not archived, and proven: what naima close takes, the commit from the trunk aside. */
const provenNotClosed = (ctx: Context, i: Item): boolean => i.type !== "closed" && !isRetired(ctx, i) && lifecycle(ctx, i) === "resolved"

const provenButOpen: Check = {
  name: "proven-but-open",
  says:
    "an item that is fixed, whose proof has passed and one of whose commits is on the trunk, and that is still open, fails: naima land closes it in the landing, naima close closes it by hand; one whose commits are not on the trunk yet, a branch's before its landing, is a note",
  run: (ctx) =>
    ctx.repo.items
      .filter((i) => provenNotClosed(ctx, i))
      .map((i): Finding =>
        hasCommitFromTrunk(ctx, i)
          ? { level: "problem", message: `${label(i)} is fixed and proven, and still open — naima close ${label(i)}`, item: i }
          : { level: "note", message: `${label(i)} is resolved, and none of its commits is on the trunk yet: its landing closes it`, item: i }
      ),
}

/** The items fixed whose proof is linked and has not passed yet: what the landing of that proof closes. */
const waitingForProof = (ctx: Context): Item[] =>
  ctx.repo.items.filter((i) => i.type !== "closed" && !isRetired(ctx, i) && lifecycle(ctx, i) === "fixed" && linked(ctx, i, "verified-by").length > 0)

const fixedWaitingForProof: Check = {
  name: "fixed-waiting-for-proof",
  says:
    "an item that is fixed and whose linked proof has not passed yet is listed as a note, waiting for its proof: the landing that marks it passed closes it",
  run: (ctx) =>
    waitingForProof(ctx).map((i): Finding => ({
      level: "note",
      message: `${label(i)} is fixed, waiting for its proof: ${linked(ctx, i, "verified-by").map((p) => `${label(p)} [${p.meta.status}]`).join(", ")}`,
      item: i,
    })),
}

/** `naima hello`: the items fixed and proven still open, and those fixed waiting for their proof, a line each. */
const closingSection: SummarySection = {
  name: "closing",
  hello: true,
  render(ctx) {
    const open = ctx.repo.items.filter((i) => provenNotClosed(ctx, i) && hasCommitFromTrunk(ctx, i)).map(label)
    const waiting = waitingForProof(ctx).map(label)
    const shown = (l: string[]) => (l.length > 3 ? `${l.slice(0, 3).join(", ")} and ${l.length - 3} more` : l.join(", "))
    return rendered({ proven: open, waiting }, (d) => [
      ...(d.proven.length ? [`${d.proven.length} fixed and proven, still open: naima close ${shown(d.proven)}`] : []),
      ...(d.waiting.length ? [`${d.waiting.length} fixed, waiting for its proof: ${shown(d.waiting)}`] : []),
    ])
  },
}

const fixNamesGesture: Check = {
  name: "fix-names-its-gesture",
  says: "a fixed item names the gesture that would prove it",
  run: (ctx) =>
    ctx.repo.items
      .filter((i) => i.type !== "closed" && isOpen(ctx, i) && lifecycle(ctx, i) === "fixed" && linked(ctx, i, "verified-by").length === 0)
      .map((i): Finding => ({ level: "note", message: `${label(i)} is fixed, and nothing verifies it`, item: i })),
}

const closedHasProof: Check = {
  name: "closed-carries-proof",
  says: "every archived item is verified by an item that has passed, unless it was closed with a reason as a review or a decision, or retired",
  run: (ctx) =>
    ctx.repo.items
      .filter((i) => i.type === "closed" && !closedWithReason(i) && !isRetired(ctx, i) && !linked(ctx, i, "verified-by").some((p) => proves(ctx, p)))
      .map((i): Finding => ({ level: "problem", message: `${label(i)} is closed without a passed proof`, item: i })),
}

const closedWithoutProof: Check = {
  name: "closed-without-proof",
  says: "every item closed with a reason instead of a proof (a todo of kind review or decision, naima close --reason) is listed as a note with its reason",
  run: (ctx) =>
    ctx.repo.items
      .filter(closedWithReason)
      .map((i): Finding => ({
        level: "note",
        message: `${label(i)} was closed without a proof, as a ${fieldValue(i, KIND) ?? "todo"}: ${fieldValue(i, CLOSED_BECAUSE)}`,
        item: i,
      })),
}

const retiredItems: Check = {
  name: "retired-items",
  says:
    "every retired item is listed as a note, with its reason and what replaced it, so nothing is retired unseen; one that does not carry the reason and the owner's consent naima retire records is a problem",
  run: (ctx) =>
    ctx.repo.items.filter((i) => isRetired(ctx, i)).map((i): Finding => {
      const lacks = [RETIRED_BECAUSE, RETIRED_CONSENT].filter((f) => !fieldValue(i, f)).map((f) => f.name)
      return lacks.length
        ? { level: "problem", item: i, message: `${label(i)} is retired without ${lacks.join(" and ")}: only naima retire retires, with the owner's consent` }
        : { level: "note", item: i, message: `${retiredSays(ctx, i)} — consent: ${fieldValue(i, RETIRED_CONSENT)}` }
    }),
}

/** A status that only naima retire sets: never set, nor taken off, by hand. */
const retiredOnlyByRetire: WriteHook = {
  name: "retired-only-by-retire",
  says: "an item's status becomes retired only by naima retire, with the reason and the owner's consent, and a retired item's status is never changed by hand",
  beforeWrite(write) {
    const { item, before } = write
    if (write.kind !== "update" || !before) return
    if ((item.meta.status === RETIRED) !== (before.status === RETIRED)) {
      return `${label(item)}: the status retired is set only by naima retire, with the reason and the owner's consent, and never taken off by hand`
    }
  },
}

const humanSaysWhy: Check = {
  name: "human-says-why",
  says: "an open item whose proof needs a person (runBy human) says why in humanBecause",
  run: (ctx) =>
    ctx.repo.items
      .filter((i) => fieldValue(i, RUN_BY) === "human" && isOpen(ctx, i) && fieldValue(i, HUMAN_BECAUSE) === undefined)
      .map((i): Finding => ({
        level: "problem",
        message: `${label(i)} is handed to a person without saying why — set humanBecause, or runBy if an agent can do it`,
        item: i,
      })),
}

const commitsAreReal: Check = {
  name: "commits-are-real",
  says: "every hash an item's commits field names is a commit git has; one of another repository, <repository>@<hash>, is checked by closed-names-its-commits",
  run: (ctx) =>
    ctx.repo.items.flatMap((i): Finding[] => {
      const bad = (fieldValue(i, COMMITS) ?? []).filter((h) => h !== LEGACY_COMMIT && !parseForeign(h) && !commitExists(ctx.root, h))
      return bad.length ? [{ level: "problem", message: `${label(i)}: commits names ${bad.join(", ")}, which git does not have`, item: i }] : []
    }),
}

/** A test that verifies a bug, open or archived: it proves the fix only if it was seen failing first. */
const isRegression = (ctx: Context, t: Item): boolean =>
  linked(ctx, t, "verifies").some((v) => v.type === "bugs" || (v.type === "closed" && v.meta["closedFrom"] === "bugs"))

const regressionSawRed: Check = {
  name: "regression-test-saw-red",
  says: "a passed test that verifies a bug records the day it was seen failing first, in redSeen",
  run: (ctx) =>
    ctx.repo.items
      .filter((i) => i.type === "tests" && proves(ctx, i) && fieldValue(i, RED_SEEN) === undefined && isRegression(ctx, i))
      .map((i): Finding => ({
        level: "note",
        message: `${label(i)} passed as a regression test, and no red run is recorded — set redSeen once it is seen failing before the fix`,
        item: i,
      })),
}

const inspectionProvesNothing: Check = {
  name: "inspection-proves-nothing",
  says: "a passed test whose evidenceKind is inspection is noted: reading the code is no evidence",
  run: (ctx) =>
    ctx.repo.items
      .filter((i) => i.type === "tests" && proves(ctx, i) && fieldValue(i, EVIDENCE_KIND) === "inspection")
      .map((i): Finding => ({
        level: "note",
        message: `${label(i)} passed on inspection — "the code looks right" proves nothing: run it, or name stronger evidence`,
        item: i,
      })),
}

/** The files a test carries as its evidence: its attachments, the placeholder aside. */
const evidenceFiles = (i: Item): string[] => {
  const dir = join(i.dir, ATTACHMENTS)
  return existsSync(dir) ? readdirSync(dir).filter((f) => f !== ".gitkeep") : []
}

const passedCarriesEvidence: Check = {
  name: "passed-test-carries-evidence",
  says:
    "a passed test an agent performed by driving the running software (runBy agent-hands) carries what shows it passed, an attachment of what was run and what it printed; one with none is noted",
  run: (ctx) =>
    ctx.repo.items
      .filter((i) => i.type === "tests" && proves(ctx, i) && fieldValue(i, RUN_BY) === "agent-hands" && !evidenceFiles(i).length)
      .map((i): Finding => ({
        level: "note",
        message: `${label(i)} passed with nothing attached to show it: attach what was run and what it printed (naima attach ${
          label(i)
        } <file> --own), or record it through its suite`,
        item: i,
      })),
}

const UNTICKED = /^\s*[-*]\s*\[ \]/

const untickedNamesPassed: Check = {
  name: "unticked-clause-names-passed-test",
  says:
    "an open item's unticked clause that names a test which has passed — as tests/<slug>, or as its linked test once every item verifying it has passed — is noted: tick it, or reopen the test",
  run(ctx) {
    const passed = new Map(ctx.repo.items.filter((i) => i.type === "tests" && proves(ctx, i)).map((t) => [`tests/${t.slug}`, t]))
    if (!passed.size) return []
    const out: Finding[] = []
    for (const i of ctx.repo.items) {
      if (i.type === "closed" || !isOpen(ctx, i)) continue
      const named = new Set<string>()
      let linkedTest = false
      for (const line of readReadme(i).split("\n").filter((l) => UNTICKED.test(l))) {
        for (const m of line.matchAll(/tests\/[a-z0-9-]+/g)) if (passed.has(m[0])) named.add(m[0])
        if (/\blinked test\b/i.test(line)) linkedTest = true
      }
      for (const n of named) {
        out.push({ level: "note", message: `${label(i)}: an unticked clause names ${n}, which has passed — tick it, or reopen the test`, item: i })
      }
      const proofs = linked(ctx, i, "verified-by")
      if (linkedTest && proofs.length && proofs.every((t) => proves(ctx, t))) {
        out.push({
          level: "note",
          message: `${label(i)}: an unticked clause names its linked test, ${proofs.map(label).join(", ")}, which has passed — tick it, or reopen the test`,
          item: i,
        })
      }
    }
    return out
  },
}

const excusesItself = (phrases: string[]): Check => ({
  name: "test-excuses-itself",
  says: "an open test marked runBy agent whose page says a resource was held (the option excusePhrases) is noted: an agent's gesture waits on no one",
  run: (ctx) =>
    ctx.repo.items.flatMap((i): Finding[] => {
      if (i.type !== "tests" || !isOpen(ctx, i) || fieldValue(i, RUN_BY) !== "agent") return []
      const page = readReadme(i).split("\n").filter((l) => !/^#\s/.test(l)).join("\n").toLowerCase()
      const hit = phrases.find((p) => page.includes(p.toLowerCase()))
      return hit === undefined ? [] : [{
        level: "note",
        message: `${label(i)} is runBy agent, and its page excuses it: "${hit}" — run it now, or say who must (runBy, humanBecause)`,
        item: i,
      }]
    }),
})

function readExcusePhrases(options: Record<string, unknown>): string[] {
  const v = options["excusePhrases"]
  if (v === undefined) return EXCUSE_PHRASES
  if (!Array.isArray(v) || !v.every((x) => typeof x === "string" && x.trim())) throw new Error("trackers: options.excusePhrases must be a list of strings")
  return v as string[]
}

const closeCommand = (repositories: readonly string[]): Command => ({
  name: "close",
  says: "archive a resolved item: fixed, and proven by an item that has passed; or a finished review or decision, with the reason",
  enforces:
    "an item is archived only when fixed and proven: fixedOn set and a verified-by item that has passed, with every write hook agreeing; --force takes a hook's refusal on, for the one who owns the evidence. --reason closes, without fixedOn, proof or commit, only a todo whose kind is review or decision and whose status is done or dropped; the reason is kept in closedBecause and naima check lists it",
  usage: 'close <item> [--force] [--reason "<why>"]',
  options: [
    {
      name: "--force",
      says: "close it although a write hook refuses — for the one who owns the evidence, say an item this branch claims whose proof someone else performed",
    },
    {
      name: "--reason",
      says:
        "close a todo whose work is a judgement with no code — kind review or decision, its status done or dropped — without a proof: what was settled and where it is written, kept in closedBecause and listed by naima check as closed-without-proof",
    },
  ],
  examples: [
    "close export-drops",
    "close export-drops --force",
    'close review-last-two-days --reason "each change reviewed with the owner; the decisions are in the item\'s notes"',
  ],
  async run(args, ctx) {
    const p = parse(args, { force: { type: "boolean" }, reason: { type: "string" } })
    const ref = p.positionals[0]
    if (!ref?.trim() || p.positionals.length > 1) throw usageError(this)
    const item = ctx.repo.resolve(ref)
    const state = lifecycle(ctx, item)
    if (state === "closed") throw new Error(`${label(item)} is already closed`)
    const reason = str(p, "reason")?.trim()
    if (reason !== undefined) return closeWithReason(ctx, item, reason, bool(p, "force"))
    const problem = await proofProblem(ctx, item)
    if (problem) throw new Error(`${label(item)} cannot be closed: ${problem}`)
    if (state !== "resolved") {
      throw new Error(`${label(item)} is ${state}: closing takes fixedOn and a verified-by item that has passed`)
    }
    const found = bool(p, "force") ? { ok: true, why: [] } : commitFromTrunk(ctx, item, repositories)
    if (!found.ok) {
      throw new Error(
        `${label(item)} cannot be closed: none of its commits is a real commit reachable from the trunk, or one of a declared repository on its default branch${
          found.why.length ? ` (${found.why.join("; ")})` : ""
        } — set commits, or close --force`,
      )
    }
    // One write: the move carries the new fields, so a refusal leaves the item as it was, where it was.
    const archived: Item = { ...item, meta: { ...item.meta, status: "closed" } }
    setFieldValue(archived, CLOSED_FROM, item.type)
    setFieldValue(archived, CLOSED_ON, today(ctx))
    const moved = moveItem(ctx, archived, typeOrThrow(ctx, "closed"), { force: bool(p, "force") })
    ctx.out(`closed → ${label(moved)}`)
    // A closed item can't be changed: a feature closed without saying whom it is for is never announced.
    const facing = ctx.registry.fields.get("facing")
    if (facing && appliesTo(facing, item.type) && item.meta["facing"] === undefined) {
      ctx.out(`  it was closed without facing, so naima announce does not list it until you set it: naima set ${label(moved)} facing=user`)
    }
    return 0
  },
})

const retire: Command = {
  name: "retire",
  says: "end an item of any type that no longer applies, on the owner's word: archived with the reason, the consent and what replaced it",
  enforces:
    "an item is retired only with a reason and the owner's consent, each on one line, and with every write hook agreeing; it moves to the archive with status retired, the reason in retiredBecause, the consent in retiredConsent, the type it came from in closedFrom and the day in closedOn; --replaced-by links it to an item that exists and is not itself; an item already in the archive is refused; nothing is deleted",
  usage: 'retire <item> --reason "<why>" [--replaced-by <item>] --consent "<the owner\'s yes, restated>"',
  options: [
    { name: "--reason", says: "why it no longer applies, on one line: kept in retiredBecause, and said wherever it was counted on" },
    { name: "--consent", says: "the owner's yes, restated, on one line: kept in retiredConsent; an agent retires nothing without it" },
    { name: "--replaced-by", says: "the item that replaced it: linked replaced-by, and the replacement shows replaces" },
  ],
  examples: [
    'retire scheduler-no-deadlock --reason "its model was deleted with the old scheduler design" --replaced-by scheduler-v2-no-deadlock --consent "yes, retire the two old scheduler properties"',
    'retire export-twice --reason "filed by mistake: a duplicate of bugs/export-drops" --consent "yes, retire it"',
  ],
  run(args, ctx) {
    const p = parse(args, { reason: { type: "string" }, consent: { type: "string" }, "replaced-by": { type: "string" } })
    const ref = p.positionals[0]
    if (!ref?.trim() || p.positionals.length > 1) throw usageError(this)
    const oneLine = (flag: string, what: string): string => {
      const v = str(p, flag)?.trim()
      if (!v) throw new Error(`--${flag} is required: ${what}`)
      if (v.includes("\n")) throw new Error(`--${flag} takes ${what}, on one line`)
      return v
    }
    const reason = oneLine("reason", "why it no longer applies")
    const consent = oneLine("consent", "the owner's yes, restated — an item is retired only on the owner's word")
    const item = ctx.repo.resolve(ref)
    if (item.type === "closed") {
      throw new Error(isRetired(ctx, item) ? `${label(item)} is already retired` : `${label(item)} is already in the archive, closed with its proof`)
    }
    const by = str(p, "replaced-by")
    const replacement = by === undefined ? undefined : ctx.repo.resolve(by)
    if (replacement && replacement.meta.id === item.meta.id) throw new Error(`${label(item)} cannot be replaced by itself`)
    if (replacement && isRetired(ctx, replacement)) throw new Error(`${label(replacement)} is retired itself: name what replaced it now`)
    // One write: the move carries the new fields and the link, so a refusal leaves the item as it was, where it was.
    // The link is stored on the retired item alone; the replacement reads it as its inverse, so nothing else changes.
    const links = replacement ? [...(item.meta.links ?? []), { rel: REPLACED_BY, id: replacement.meta.id }] : item.meta.links
    const archived: Item = { ...item, meta: { ...item.meta, status: RETIRED, ...(links ? { links } : {}) } }
    setFieldValue(archived, CLOSED_FROM, item.type)
    setFieldValue(archived, CLOSED_ON, today(ctx))
    setFieldValue(archived, RETIRED_BECAUSE, reason)
    setFieldValue(archived, RETIRED_CONSENT, consent)
    const moved = moveItem(ctx, archived, typeOrThrow(ctx, "closed"))
    ctx.out(`retired → ${label(moved)}: ${reason}${replacement ? `; replaced by ${label(replacement)}` : ""}`)
    return 0
  },
}

/**
 * Close a todo whose work is a judgement with no code — a review, a decision — with the reason instead of a proof:
 * it has no fixedOn, no test and no commit to show, and its status (done or dropped) already says it is finished.
 */
function closeWithReason(ctx: Context, item: Item, reason: string, force: boolean): number {
  if (!reason || reason.includes("\n")) throw new Error("--reason takes what was settled and where it is written, on one line")
  const kind = fieldValue(item, KIND)
  if (item.type !== "todos" || !kind || !CLOSED_WITH_REASON.includes(kind)) {
    throw new Error(
      `${label(item)} cannot be closed with a reason: only a todo of kind ${CLOSED_WITH_REASON.join(" or ")} is, its work a judgement with no code to prove — ${
        item.type === "todos" ? `set its kind if that is what it is (naima set ${label(item)} kind=review), or ` : ""
      }close it with fixedOn and a passed proof`,
    )
  }
  if (isOpen(ctx, item)) {
    throw new Error(`${label(item)} is ${item.meta.status}: mark it finished first (naima set ${label(item)} status=done, or status=dropped), then close it`)
  }
  const archived: Item = { ...item, meta: { ...item.meta, status: "closed" } }
  setFieldValue(archived, CLOSED_FROM, item.type)
  setFieldValue(archived, CLOSED_ON, today(ctx))
  setFieldValue(archived, CLOSED_BECAUSE, reason)
  const moved = moveItem(ctx, archived, typeOrThrow(ctx, "closed"), { force })
  ctx.out(`closed → ${label(moved)}, without a proof, as a ${kind}: ${reason}`)
  return 0
}

const bugs: Command = {
  name: "bugs",
  says: "how many bugs have no code written, and how many are fixed but unproven",
  enforces: "nothing: it only counts",
  usage: "bugs",
  examples: ["bugs"],
  run(_args, ctx) {
    const open = ctx.repo.items.filter((i) => i.type === "bugs" && isOpen(ctx, i))
    const by = (s: Lifecycle) => open.filter((i) => lifecycle(ctx, i) === s)
    const unfixed = by("unfixed")
    ctx.out(`bugs: ${open.length} open`)
    ctx.out(`  unfixed (no code)     ${unfixed.length}`)
    ctx.out(`  fixed, not proven     ${by("fixed").length}`)
    ctx.out(`  resolved, not closed  ${by("resolved").length}`)
    for (const i of unfixed) ctx.out(`    ${label(i)}  ${i.meta.title}`)
    return 0
  },
}

const bugCounts: SummarySection = {
  name: "bugs",
  render(ctx) {
    const open = ctx.repo.items.filter((i) => i.type === "bugs" && isOpen(ctx, i))
    const n = (s: Lifecycle) => open.filter((i) => lifecycle(ctx, i) === s).length
    const data = { open: open.length, unfixed: n("unfixed"), fixed: n("fixed"), resolved: n("resolved") }
    return rendered(data, (d) => (d.open ? [`  ${d.unfixed} unfixed · ${d.fixed} fixed, unproven · ${d.resolved} resolved, not closed`] : []))
  },
}

export default function trackers(options: Record<string, unknown> = {}): Plugin {
  const { commitsRequiredFrom, repositories } = readOptions(options)
  const closedNamesCommits: Check = {
    name: "closed-names-its-commits",
    says:
      `an item closed on or after ${commitsRequiredFrom} names a commit reachable from the trunk, or one of another repository the project declares (<repository>@<hash>) on that repository's default branch — one that cannot be read, offline, is reported as not checkable, never accepted — unless it was closed with a reason as a review or a decision, or retired`,
    run: (ctx) =>
      ctx.repo.items
        .filter((i) =>
          i.type === "closed" && (fieldValue(i, CLOSED_ON) ?? "") >= commitsRequiredFrom && !closedWithReason(i) && !isRetired(ctx, i) &&
          !isGrandfathered(i)
        )
        .flatMap((i): Finding[] => {
          const found = commitFromTrunk(ctx, i, repositories)
          if (found.ok) return []
          const why = found.why.length ? `: ${found.why.join("; ")}` : ""
          return [{ level: "problem", message: `${label(i)} is closed without a commit reachable from the trunk${why}`, item: i }]
        }),
  }
  const phrases = readExcusePhrases(options)
  return {
    name: "trackers",
    contract: CONTRACT,
    says: "bugs, todos, features, tests, and the archive of closed and retired items",
    about: ABOUT,
    options: [{
      name: "excusePhrases",
      says: "the phrases (any case) by which an open agent's test says it could not run because something was held; test-excuses-itself notes them",
      default: JSON.stringify(EXCUSE_PHRASES),
    }, {
      name: "repositories",
      says:
        "the git URLs of other repositories, besides the Naima the project runs and the plugins it pins from git, whose commits an item's commits may name as <repository>@<hash>",
      default: "[]",
    }],
    types: [
      {
        id: "bugs",
        dir: "bugs",
        title: "Bugs",
        says: "something that is broken",
        statuses: {
          open: { category: "open", says: "nothing on the page has been done" },
          partial: { category: "open", says: "some of it has, and the page says what is left" },
          wontfix: { category: "done", says: "deliberately not fixed; the reason is on the page" },
        },
        initialStatus: "open",
        template: report,
        traits: [FIXABLE],
      },
      {
        id: "todos",
        dir: "todos",
        title: "Todos",
        says: "work that is not a defect: a task, a decision, a tidy-up",
        statuses: {
          open: { category: "open", says: "not started" },
          partial: { category: "open", says: "started; the page says what is left" },
          done: { category: "done", says: "finished" },
          dropped: { category: "done", says: "deliberately not done; the reason is on the page" },
        },
        initialStatus: "open",
        template: work,
        // naima update files here what the new Naima's check finds and it could not fix (core/updates.ts).
        traits: [FIXABLE, "follow-up"],
      },
      {
        id: "features",
        dir: "features",
        title: "Features",
        says: "what the software does, or is asked to do",
        statuses: {
          requested: { category: "open", says: "asked for; no code exists" },
          planned: { category: "open", says: "agreed and scheduled" },
          shipped: { category: "done", says: "on the trunk, with its documentation" },
          withdrawn: { category: "done", says: "decided against" },
        },
        initialStatus: "requested",
        traits: [FIXABLE],
      },
      {
        id: "tests",
        dir: "tests",
        title: "Tests",
        says: "a gesture that proves something, and its result",
        statuses: {
          open: { category: "open", says: "not yet performed" },
          partial: { category: "open", says: "performed in part" },
          failed: { category: "open", refutes: true, says: "performed, and what it proves does not hold" },
          passed: { category: "done", proves: true, says: "performed, and it holds; the page carries the measurement" },
          withdrawn: { category: "done", says: "no longer applies: what it would prove was reversed; the page says by what" },
        },
        initialStatus: "open",
        template: gesture,
      },
      {
        id: "closed",
        dir: "closed",
        title: "Closed",
        says: "the archive: resolved items, each with its proof, and retired items, each with its reason",
        statuses: {
          closed: { category: "done", says: "fixed, proven, archived" },
          retired: {
            category: "done",
            flags: [RETIRED],
            says: "no longer applies: archived by naima retire on the owner's word, with the reason, the consent and what replaced it",
          },
        },
        initialStatus: "closed",
        creatable: false,
        // archive: fields that describe what an item was (whom a feature is for, where it is documented) may apply here too.
        traits: [FIXABLE, "archive"],
      },
    ],
    fields: [
      { name: "fixedOn", kind: "date", says: "when the code landed; absent means unfixed", traits: [FIXABLE] },
      { name: "closedOn", kind: "date", says: "when the item was archived", appliesTo: ["closed"] },
      { name: "closedFrom", kind: "string", says: "the type the item was archived from", appliesTo: ["closed"] },
      {
        name: "closedBecause",
        kind: "string",
        says: "why an item was closed without a proof: a todo of kind review or decision, closed by naima close --reason",
        appliesTo: ["closed"],
      },
      { name: "retiredBecause", kind: "string", says: "why a retired item no longer applies, as naima retire --reason gave it", appliesTo: ["closed"] },
      {
        name: "retiredConsent",
        kind: "string",
        says: "the owner's yes to retiring it, restated, as naima retire --consent gave it",
        appliesTo: ["closed"],
      },
      {
        name: "runBy",
        kind: "enum",
        says: "who can perform the proving gesture — the instrument, not the effort",
        values: {
          agent: "settled by a command: a unit test, a grep, an API call",
          "agent-hands": "settled by an agent driving the running software",
          human: "needs a person: a judgement of how it looks, a physical act, a reserved decision",
          build: "needs an artifact nobody here makes: a signed build, a second machine",
        },
        appliesTo: ["tests", "bugs", "todos"],
      },
      {
        name: "humanBecause",
        kind: "enum",
        says: "why only a person can perform the proof, when runBy is human",
        values: {
          judgement: "how it looks, sounds or feels: no instrument can settle it",
          decision: "a decision reserved to the owner",
          credential: "a secret, an account or a signature only a person holds",
          physical: "a physical act or a machine only a person has at hand",
        },
        appliesTo: ["tests", "bugs", "todos"],
      },
      {
        name: "evidenceKind",
        kind: "enum",
        says: "what the test's evidence is, from the ranking: strongest first",
        values: Object.fromEntries(EVIDENCE),
        appliesTo: ["tests"],
      },
      { name: "redSeen", kind: "date", says: "the day a regression test was seen failing on the code before the fix: red, then green", appliesTo: ["tests"] },
      { name: "area", kind: "string", says: "where it lives: the surface somebody would have open while working on it" },
      { name: "kind", kind: "string", says: "the mode of work it demands: code, decision, research, writing…" },
      {
        name: "commits",
        kind: "strings",
        says:
          'the git commit hashes that fixed it, each reachable from the trunk; a fix made in another repository the project declares (the Naima it runs, a plugin or stance pinned from git, or one listed in the trackers option repositories) as <repository>@<hash>, on that repository\'s default branch — or "legacy" on an item closed before this field existed, set once by migration, never retrofitted by guessing',
        traits: [FIXABLE],
      },
    ],
    relations: [
      { name: "verifies", inverse: "verified-by", says: "is the gesture that proves" },
      { name: "verified-by", inverse: "verifies", says: "is proven by" },
      { name: REPLACED_BY, inverse: "replaces", says: "was retired, and replaced by" },
      { name: "replaces", inverse: REPLACED_BY, says: "replaces the retired item" },
    ],
    checks: [
      partialWithoutClause,
      provenButOpen,
      fixedWaitingForProof,
      fixNamesGesture,
      closedHasProof,
      closedWithoutProof,
      retiredItems,
      humanSaysWhy,
      commitsAreReal,
      closedNamesCommits,
      regressionSawRed,
      inspectionProvesNothing,
      passedCarriesEvidence,
      untickedNamesPassed,
      excusesItself(phrases),
    ],
    commands: [closeCommand(repositories), retire, bugs],
    hooks: [retiredOnlyByRetire],
    summary: [bugCounts, closingSection],
  }
}
