// Audits: an independent check of what was built against what was decided —
// the decisions, requirements, specifications or designs it checks against are
// linked `audits`, the todo that asked for it `fulfils`. Its page holds what
// was checked and the findings; its `verdict` says, in one word, how the work
// stands. An audit is concluded only with a verdict, and dated `auditedOn`.

import { type Check, type FieldDef, fieldValue, type Finding, type Item, label, type RelationDef, today, type TypeDef, type WriteHook } from "../../core/api.ts"

export const AUDITS = "audits"
const CONCLUDED = "concluded"

export const auditsType: TypeDef = {
  id: AUDITS,
  dir: "audits",
  title: "Audits",
  says:
    "an independent check of what was built against what was decided: what it checks against linked audits, its findings on its page, and a verdict once concluded",
  statuses: {
    "in-progress": { category: "open", says: "being carried out: the findings are not complete" },
    [CONCLUDED]: { category: "done", says: "finished: the findings are on its page and the verdict field holds the verdict" },
    superseded: { category: "done", says: "replaced by a later audit that supersedes it, kept as history" },
  },
  initialStatus: "in-progress",
  template: (title) =>
    `# ${title}\n\n## What was checked\n\nThe work audited, and what it was checked against (\`naima link\` each \`audits\`).\n\n## Findings\n\nEach finding, with the evidence for it.\n\n## Verdict\n\nHow the work stands against what was decided, in a few sentences; the field \`verdict\` says it in one word.\n`,
}

const VERDICT: FieldDef = {
  name: "verdict",
  kind: "enum",
  says: "how the audited work stands against what was decided; required to conclude the audit",
  values: {
    pass: "the work matches what was decided",
    "pass-with-findings": "the work matches in substance; the findings name what is left to fix",
    fail: "the work does not match what was decided: the findings say where",
  },
  appliesTo: [AUDITS],
}

const AUDITED_ON: FieldDef = {
  name: "auditedOn",
  kind: "date",
  says: "the day of the audit; stamped with today when the audit is recorded",
  appliesTo: [AUDITS],
}

export const AUDIT_FIELDS: FieldDef[] = [VERDICT, AUDITED_ON]

export const AUDIT_RELATIONS: RelationDef[] = [
  { name: "audits", inverse: "audited-by", says: "is the audit that checks the work against" },
  { name: "audited-by", inverse: "audits", says: "is checked by the audit" },
  { name: "fulfils", inverse: "fulfilled-by", says: "carries out the work asked for by" },
  { name: "fulfilled-by", inverse: "fulfils", says: "is carried out by" },
]

const isAudit = (i: Item): boolean => i.type === AUDITS
const verdictOf = (i: Item): string | undefined => fieldValue(i, { name: VERDICT.name, kind: "enum" }) as string | undefined

/** A new audit is dated today unless given; an audit is concluded only with a verdict. */
export const auditHook: WriteHook = {
  name: "audit-verdict",
  says: "a new audit is dated today unless given; an audit is concluded only once its verdict is set; --force takes it past",
  beforeWrite(write, ctx) {
    if (!isAudit(write.item)) return
    const meta = write.item.meta
    if (write.kind === "create") meta[AUDITED_ON.name] ??= today(ctx)
    if (!write.force && meta.status === CONCLUDED && write.before?.status !== CONCLUDED && !verdictOf(write.item)) {
      return `${label(write.item)} cannot be concluded without a verdict — naima set ${
        label(write.item)
      } verdict=<pass|pass-with-findings|fail> status=${CONCLUDED}`
    }
  },
}

export const auditsCheck: Check = {
  name: "audits-concluded",
  says: "a concluded audit has a verdict; one concluded past the hook without one is a problem",
  run(ctx) {
    const out: Finding[] = []
    for (const a of ctx.repo.items.filter(isAudit)) {
      if (a.meta.status === CONCLUDED && !verdictOf(a)) {
        out.push({
          level: "problem",
          item: a,
          message: `${label(a)} is concluded but has no verdict — naima set ${label(a)} verdict=<pass|pass-with-findings|fail>`,
        })
      }
    }
    return out
  },
}
