// Waivers: a recorded, reasoned exemption from one check's finding on one subject.
// A waived finding is not a failure; the waiver stays visible as a note of every
// `naima check`, and one that waives nothing any more is noted too.

import { randomUUID } from "node:crypto"
import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { parse, str, usageError } from "./args.ts"
import { message } from "./errors.ts"
import { writeFileAtomic } from "./files.ts"
import { commitOn, currentBranch } from "./git.ts"
import { today } from "./item.ts"
import { findPrivate, guardPrivate, privateContext } from "./private.ts"
import type { Check, Command, Context, Finding } from "./types.ts"

/** The data directory waivers are written to, one file each. */
export const WAIVERS = "waivers"

export interface Waiver {
  /** The name of the check whose finding it waives. */
  check: string
  /** What the finding is about, as the check names it in its finding's `subject`. */
  subject: string
  reason: string
  /** Who waived it. */
  by: string
  /** The day it was waived, YYYY-MM-DD. */
  date: string
  /** The file under `waivers/`. */
  file: string
}

const FIELDS = ["check", "subject", "reason", "by", "date"] as const

/** Every waiver on disk, and a problem for each file that is not one. */
export function readWaivers(ctx: Context): { waivers: Waiver[]; problems: Finding[] } {
  const dir = join(ctx.trackerRoot, WAIVERS)
  const waivers: Waiver[] = []
  const problems: Finding[] = []
  if (!existsSync(dir)) return { waivers, problems }
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".json")).sort()) {
    const where = `${ctx.trackerDir}/${WAIVERS}/${file}`
    try {
      const raw = JSON.parse(readFileSync(join(dir, file), "utf8")) as Record<string, unknown>
      const missing = FIELDS.filter((k) => typeof raw?.[k] !== "string" || !(raw[k] as string).trim())
      if (missing.length) problems.push({ level: "problem", message: `${where}: not a waiver — missing ${missing.join(", ")}` })
      else waivers.push({ ...(raw as Omit<Waiver, "file">), file })
    } catch (e) {
      problems.push({ level: "problem", message: `${where}: not a waiver — ${message(e)}` })
    }
  }
  return { waivers, problems }
}

/**
 * Apply the waivers to what the checks found: a finding a waiver names, by check and subject, is dropped; each
 * waiver in use becomes a note; one whose check ran and found nothing on its subject is noted as waiving nothing.
 */
export function applyWaivers(ctx: Context, found: { check: string; findings: Finding[] }[]): Finding[] {
  const { waivers, problems } = readWaivers(ctx)
  const used = new Set<Waiver>()
  const out: Finding[] = [...problems]
  for (const { check, findings } of found) {
    for (const f of findings) {
      const w = f.subject === undefined ? undefined : waivers.find((w) => w.check === check && w.subject === f.subject)
      if (w) used.add(w)
      else out.push(f)
    }
  }
  const ran = new Set(found.map((f) => f.check))
  const known = new Set(ctx.registry.checks.map((c) => c.name))
  for (const w of waivers) {
    const where = `${ctx.trackerDir}/${WAIVERS}/${w.file}`
    if (used.has(w)) out.push({ level: "note", message: `waived: ${w.check} on ${w.subject} — ${w.reason} (${w.by}, ${w.date}; ${where})` })
    else if (!known.has(w.check)) out.push({ level: "note", message: `${where} waives ${w.check}, which is no loaded check: it waives nothing` })
    else if (ran.has(w.check)) {
      out.push({
        level: "note",
        message: `${where} waives ${w.check} on ${w.subject}, which no longer exists or no longer fails it: the waiver waives nothing and can be removed`,
      })
    }
  }
  return out
}

/** `naima waive`: exempt one finding of one check, with its reason, as one new file. */
export const waive: Command = {
  name: "waive",
  says:
    "exempt one check's finding on one subject, a problem or a note, with the reason, as a recorded waiver: `naima check` no longer reports the finding, so a problem no longer fails it, and lists the waiver as a note instead",
  enforces:
    "a waiver names a loaded check, a subject that check reports a finding on now, a reason and who waived it; it is one new file under waivers/, and one waiver per check and subject",
  usage: 'waive <check> <subject> --reason "<why>" [--as <who>]',
  options: [
    { name: "--reason", says: "why the finding is accepted rather than fixed: recorded with the waiver and shown by every `naima check`" },
    { name: "--as", says: "who waives it", default: "the current branch's first segment, as in <who>/<what>" },
  ],
  examples: [
    'waive session-note-ack passes/2026-10-10-<uuid>.md --reason "written before the session acknowledged the rules; adding a line now would falsify it"',
  ],
  async run(args, ctx) {
    const p = parse(args, { reason: { type: "string" }, as: { type: "string" } })
    const [name, subject, ...rest] = p.positionals
    const reason = (str(p, "reason") ?? "").trim()
    if (!name || !subject || rest.length || !reason) throw usageError(this)
    const check: Check | undefined = ctx.registry.checks.find((c) => c.name === name)
    if (!check) throw new Error(`no loaded check is called ${JSON.stringify(name)} — naima plugins lists them`)
    const branch = currentBranch(ctx.root)
    const by = (str(p, "as") ?? (branch.includes("/") ? branch.split("/")[0] : "") ?? "").trim()
    if (!by) throw new Error(`who waives it: --as <who>, since the branch ${branch} names no one`)
    if (readWaivers(ctx).waivers.some((w) => w.check === name && w.subject === subject)) {
      throw new Error(`${name} on ${subject} is already waived — ${WAIVERS}/ holds it`)
    }
    const findings = await check.run(ctx, {})
    if (!findings.some((f) => f.subject === subject)) {
      const subjects = [...new Set(findings.flatMap((f) => (f.subject === undefined ? [] : [f.subject])))]
      throw new Error(
        `${name} reports nothing on ${subject}: nothing to waive${subjects.length ? ` — it reports on: ${subjects.join(", ")}` : ""}`,
      )
    }
    const allowance = guardPrivate("the waiver", findPrivate(`${subject}\n${reason}`, privateContext()), ctx.allowPrivate)
    const waiver = { check: name, subject, reason: allowance ? `${reason} ${allowance}` : reason, by, date: today(ctx) }
    const dir = join(ctx.trackerRoot, WAIVERS)
    mkdirSync(dir, { recursive: true })
    const file = `${waiver.date}-${randomUUID()}.json`
    writeFileAtomic(join(dir, file), JSON.stringify(waiver, null, 2) + "\n")
    // A waiver changes what the project holds to: it is landed, or committed on the trunk it would be a commit to waive.
    ctx.out(`wrote ${ctx.trackerDir}/${WAIVERS}/${file} — commit it ${commitOn(ctx.root, true)}`)
    return 0
  },
}
