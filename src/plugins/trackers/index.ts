// The standard trackers: bugs, todos, features, tests, and the closed archive.
//
// Three words that are not synonyms:
//   fixed     the code change exists (`fixedOn` is set). Nothing is proven.
//   resolved  fixed, and proven by an item that `verifies` it and has passed.
//   closed    resolved, and moved to the archive with its proof.

import {
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
  runChecks,
  setFieldValue,
  type SummarySection,
  today,
  trunk,
  typeOrThrow,
  usageError,
} from "../../core/api.ts"

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

function readOptions(options: Record<string, unknown>): { commitsRequiredFrom: string } {
  const v = options["commitsRequiredFrom"] ?? DEFAULT_COMMITS_REQUIRED_FROM
  if (typeof v !== "string" || !ISO_DATE.test(v)) {
    throw new Error(`trackers: options.commitsRequiredFrom must be a date, YYYY-MM-DD, got ${JSON.stringify(v)}`)
  }
  return { commitsRequiredFrom: v }
}

/** Whether one of `item`'s `commits` is a real commit, and reachable from the trunk. False with no trunk to read. */
function hasCommitFromTrunk(ctx: Context, item: Item): boolean {
  const t = trunk(ctx.root)
  if (!t) return false
  return (fieldValue(item, COMMITS) ?? []).some((h) => commitExists(ctx.root, h) && isAncestor(ctx.root, h, t))
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

const provenButOpen: Check = {
  name: "proven-but-open",
  says: "an open item whose proof has passed is reported so it can be closed",
  run: (ctx) =>
    ctx.repo.items
      .filter((i) => i.type !== "closed" && isOpen(ctx, i) && lifecycle(ctx, i) === "resolved")
      .map((i): Finding => ({ level: "note", message: `${label(i)} is resolved — naima close ${i.slug}`, item: i })),
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
  says: "every archived item is verified by an item that has passed",
  run: (ctx) =>
    ctx.repo.items
      .filter((i) => i.type === "closed" && !linked(ctx, i, "verified-by").some((p) => proves(ctx, p)))
      .map((i): Finding => ({ level: "problem", message: `${label(i)} is closed without a passed proof`, item: i })),
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
  says: "every hash an item's commits field names is a commit git has",
  run: (ctx) =>
    ctx.repo.items.flatMap((i): Finding[] => {
      const bad = (fieldValue(i, COMMITS) ?? []).filter((h) => h !== LEGACY_COMMIT && !commitExists(ctx.root, h))
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

const close: Command = {
  name: "close",
  says: "archive a resolved item: fixed, and proven by an item that has passed",
  enforces:
    "an item is archived only when fixed and proven: fixedOn set and a verified-by item that has passed, with every write hook agreeing; --force takes a hook's refusal on, for the one who owns the evidence",
  usage: "close <item> [--force]",
  options: [{
    name: "--force",
    says: "close it although a write hook refuses — for the one who owns the evidence, say an item this branch claims whose proof someone else performed",
  }],
  examples: ["close export-drops", "close export-drops --force"],
  async run(args, ctx) {
    const p = parse(args, { force: { type: "boolean" } })
    const ref = p.positionals[0]
    if (!ref?.trim()) throw usageError(this)
    const item = ctx.repo.resolve(ref)
    const state = lifecycle(ctx, item)
    if (state === "closed") throw new Error(`${label(item)} is already closed`)
    const problem = await proofProblem(ctx, item)
    if (problem) throw new Error(`${label(item)} cannot be closed: ${problem}`)
    if (state !== "resolved") {
      throw new Error(`${label(item)} is ${state}: closing takes fixedOn and a verified-by item that has passed`)
    }
    if (!bool(p, "force") && !hasCommitFromTrunk(ctx, item)) {
      throw new Error(
        `${label(item)} cannot be closed: none of its commits is a real commit reachable from the trunk — set commits, or close --force`,
      )
    }
    // One write: the move carries the new fields, so a refusal leaves the item as it was, where it was.
    const archived: Item = { ...item, meta: { ...item.meta, status: "closed" } }
    setFieldValue(archived, CLOSED_FROM, item.type)
    setFieldValue(archived, CLOSED_ON, today(ctx))
    const moved = moveItem(ctx, archived, typeOrThrow(ctx, "closed"), { force: bool(p, "force") })
    ctx.out(`closed → ${label(moved)}`)
    return 0
  },
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
  const { commitsRequiredFrom } = readOptions(options)
  const closedNamesCommits: Check = {
    name: "closed-names-its-commits",
    says: `an item closed on or after ${commitsRequiredFrom} names a commit reachable from the trunk`,
    run: (ctx) =>
      ctx.repo.items
        .filter((i) => i.type === "closed" && (fieldValue(i, CLOSED_ON) ?? "") >= commitsRequiredFrom && !hasCommitFromTrunk(ctx, i) && !isGrandfathered(i))
        .map((i): Finding => ({ level: "problem", message: `${label(i)} is closed without a commit reachable from the trunk`, item: i })),
  }
  const phrases = readExcusePhrases(options)
  return {
    name: "trackers",
    contract: CONTRACT,
    says: "bugs, todos, features, tests, and the archive of closed bugs",
    about: ABOUT,
    options: [{
      name: "excusePhrases",
      says: "the phrases (any case) by which an open agent's test says it could not run because something was held; test-excuses-itself notes them",
      default: JSON.stringify(EXCUSE_PHRASES),
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
        says: "the archive: resolved items, each with its proof",
        statuses: { closed: { category: "done", says: "fixed, proven, archived" } },
        initialStatus: "closed",
        creatable: false,
        traits: [FIXABLE],
      },
    ],
    fields: [
      { name: "fixedOn", kind: "date", says: "when the code landed; absent means unfixed", traits: [FIXABLE] },
      { name: "closedOn", kind: "date", says: "when the item was archived", appliesTo: ["closed"] },
      { name: "closedFrom", kind: "string", says: "the type the item was archived from", appliesTo: ["closed"] },
      {
        name: "runBy",
        kind: "enum",
        says: "who can perform the proving gesture — the instrument, not the effort",
        values: {
          agent: "settled by a command: a unit test, a grep, an API call",
          "agent-hands": "settled by an agent driving the running software",
          human: "needs a person: a judgement of how it looks, a physical act, a reserved decision",
          build: "needs an artefact nobody here makes: a signed build, a second machine",
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
          'the git commit hashes that fixed it, each reachable from the trunk — or "legacy" on an item closed before this field existed, set once by migration, never retrofitted by guessing',
        traits: [FIXABLE],
      },
    ],
    relations: [
      { name: "verifies", inverse: "verified-by", says: "is the gesture that proves" },
      { name: "verified-by", inverse: "verifies", says: "is proven by" },
    ],
    checks: [
      partialWithoutClause,
      provenButOpen,
      fixNamesGesture,
      closedHasProof,
      humanSaysWhy,
      commitsAreReal,
      closedNamesCommits,
      regressionSawRed,
      inspectionProvesNothing,
      untickedNamesPassed,
      excusesItself(phrases),
    ],
    commands: [close, bugs],
    summary: [bugCounts],
  }
}
