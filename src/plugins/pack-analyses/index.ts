// A worked example of a non-software item-type pack: Naima swaps software's
// practice (code, reviewed and tested) for a data analysis's own practice
// (a command, run again on the same data and checked for the same result).
// One type, reusing the generic proof machinery (`verifies`/`verified-by`,
// `tests`) rather than inventing a parallel one.
//
// Opt in with `plugins.pack-analyses: {}` in naima.json; none of this exists
// until a project asks for it.

import {
  type Check,
  type Context,
  CONTRACT,
  type FieldDef,
  fieldValue,
  type Finding,
  type Item,
  label,
  linked,
  type Plugin,
  proves,
  refutes,
  type TypeDef,
} from "../../core/api.ts"

const analysesType: TypeDef = {
  id: "analyses",
  dir: "analyses",
  title: "Analyses",
  says:
    "a step of a data analysis that produces a result from the project's own data: proven, like a feature, by the tests that verify it — here, a run of the same command on the same data",
  statuses: {
    proposed: { category: "open", says: "described, not yet run" },
    confirmed: { category: "done", flags: ["positive"], says: "run, and a test verifying it has passed: reproducible" },
    refuted: { category: "done", says: "run, and a test verifying it failed: not reproducible, or wrong" },
    dropped: { category: "done", says: "no longer needed; the page says why" },
  },
  initialStatus: "proposed",
  template: (title) =>
    `# ${title}\n\nThe result this step produces, and from what data.\n\n## How it is reproduced\n\nThe exact command, run from the project root (the \`command\` field), and what output counts as the same result.\n`,
}

const COMMAND: FieldDef = {
  name: "command",
  kind: "string",
  says: "the exact command, run from the project root, that reproduces this step from the project's data",
  appliesTo: ["analyses"],
}

const isAnalysis = (i: Item): boolean => i.type === analysesType.id
const analysesOf = (ctx: Context): Item[] => ctx.repo.items.filter(isAnalysis)

/** The tests that prove or refute an analysis: those linked `verified-by`. */
const proofsOf = (ctx: Context, a: Item): Item[] => linked(ctx, a, "verified-by")

const analysesCheck: Check = {
  name: "analyses-reproduced",
  says:
    "an analysis marked confirmed has a test verifying it that passed, and none that failed; one proven but still proposed, or refuted but still proposed, is noted",
  run(ctx) {
    const out: Finding[] = []
    for (const a of analysesOf(ctx)) {
      const proofs = proofsOf(ctx, a)
      const refuted = proofs.some((p) => refutes(ctx, p))
      const proven = proofs.some((p) => proves(ctx, p))
      const status = a.meta.status
      if (status === "confirmed" && refuted) {
        out.push({
          level: "problem",
          item: a,
          message: `${label(a)} is confirmed, but ${proofs.filter((p) => refutes(ctx, p)).map(label).join(", ")} refutes it — naima set ${
            label(a)
          } status=proposed`,
        })
      } else if (status === "confirmed" && !proven) {
        out.push({
          level: "problem",
          item: a,
          message: `${label(a)} is confirmed, but no test has passed — naima new tests "<rerun ${
            fieldValue(a, { name: "command", kind: "string" }) ?? "it"
          }>", naima link it verifies ${label(a)}`,
        })
      } else if (status === "proposed" && refuted) {
        out.push({ level: "note", item: a, message: `${label(a)} is refuted by a failed test — naima set ${label(a)} status=refuted` })
      } else if (status === "proposed" && proven) {
        out.push({ level: "note", item: a, message: `${label(a)} is reproduced — naima set ${label(a)} status=confirmed` })
      }
    }
    return out
  },
}

export default function packAnalyses(): Plugin {
  return {
    name: "pack-analyses",
    contract: CONTRACT,
    says: "a worked example of a non-software item-type pack: one type, `analyses`, for a data-analysis step proven by a reproducible run rather than code",
    about: "Naima is born for software, but the same discipline manages any versioned work by swapping software's practice for the work's own. " +
      "An **analysis** is one step of a data analysis — a figure, a table, a derived dataset — that a `command` reproduces from the project's own data. " +
      "It is proposed, then proven the same way a requirement is: a `tests` item, linked `verifies` the analysis, whose status `proves` (it passed: the command was run again and gave the same result) or `refutes` (it failed) it. " +
      "`naima check` notes an analysis confirmed without a passing proof, or proven but still proposed — the same shape as a requirement, for work that has no code. " +
      "This is one worked example, not a framework: a paper's sections and reviews, or another kind of non-software work, is its own pack, following the same pattern — a type or two, reusing `tests` and `verifies` rather than inventing new proof machinery.",
    types: [analysesType],
    fields: [COMMAND],
    // What it reads of the trackers plugin: the relation a test verifies an item by.
    uses: { relations: ["verified-by"] },
    checks: [analysesCheck],
  }
}
