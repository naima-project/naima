// Reviews: the record that an agent did the review a rule verified by an agent
// asks for (`verifiedBy: agent`). No check holds such a rule, so the agent
// reads its change against the rule and says what it checked with
// `naima reviewed <rule> --item <item> "<what was checked>"`: one file under
// reviews/, landed with the change. When the change lands, the landing report
// shows every review it carries, and notes each agent-verified rule that
// covers a file the landing changed (the rule's `covers`) with no review.

import { randomUUID } from "node:crypto"
import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import {
  type Command,
  commitOn,
  type Context,
  findPrivate,
  gitOrNull,
  guardPrivate,
  isGitRepo,
  label,
  message,
  parse,
  pathMatches,
  privateContext,
  str,
  today,
  usageError,
  writeFileAtomic,
} from "../../core/api.ts"

/** The data directory reviews are written to, one file each. */
export const REVIEWS = "reviews"

export interface Review {
  /** The rule reviewed, as `naima rules` names it. */
  rule: string
  /** The item the change lands with, by its label. */
  item: string
  /** What the agent checked, and what it found. */
  what: string
  by: string
  /** The day, YYYY-MM-DD. */
  date: string
  /** The file under reviews/. */
  file: string
}

const FIELDS = ["rule", "item", "what", "by", "date"] as const

/** A rule as reviews need it: its name, how it is verified, and the files it covers. */
export interface ReviewedRule {
  item: string
  verifiedBy: string | null
  covers: readonly string[]
}

/** Every review on disk; a file that is not one is skipped, and said. */
export function readReviews(ctx: Context): { reviews: Review[]; bad: string[] } {
  const dir = join(ctx.trackerRoot, REVIEWS)
  const reviews: Review[] = []
  const bad: string[] = []
  if (!existsSync(dir)) return { reviews, bad }
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".json")).sort()) {
    try {
      const raw = JSON.parse(readFileSync(join(dir, file), "utf8")) as Record<string, unknown>
      const missing = FIELDS.filter((k) => typeof raw?.[k] !== "string" || !(raw[k] as string).trim())
      if (missing.length) bad.push(`${ctx.trackerDir}/${REVIEWS}/${file}: not a review — missing ${missing.join(", ")}`)
      else reviews.push({ ...(raw as Omit<Review, "file">), file })
    } catch (e) {
      bad.push(`${ctx.trackerDir}/${REVIEWS}/${file}: not a review — ${message(e)}`)
    }
  }
  return { reviews, bad }
}

/** The rule `ref` names among `rules`: by its full name, or by the short name after the plugin's when only one has it. */
function ruleNamed(rules: readonly ReviewedRule[], ref: string): ReviewedRule | undefined {
  const exact = rules.find((r) => r.item === ref)
  if (exact) return exact
  const short = rules.filter((r) => r.item.split("/").pop() === ref)
  return short.length === 1 ? short[0] : undefined
}

/** `naima reviewed`: record that the review an agent-verified rule asks for was done, on the item the change lands with. */
export const reviewedCommand = (rulesOf: (ctx: Context) => ReviewedRule[], agent: string): Command => ({
  name: "reviewed",
  says:
    "record that an agent reviewed a change against a rule verified by an agent (no check holds it): which rule, the item the change lands with, and what was checked; naima land shows the review, and notes a change to what such a rule covers that lands with none",
  enforces:
    `the rule is an active rule verified by ${agent}, the item exists, and what was checked is said; each review is one new file under ${REVIEWS}/, landed with the change`,
  usage: 'reviewed <rule> --item <item> "<what was checked, and what was found>" [--by <who>]',
  options: [
    { name: "--item", says: "the item the reviewed change lands with" },
    { name: "--by", says: "who reviewed", default: "git's user.name" },
  ],
  examples: [
    'reviewed stance-ui/ui-consistent-help --item bugs/help-moves "the header keeps the help link last on every page, the new settings page included"',
  ],
  run(args, ctx) {
    const p = parse(args, { item: { type: "string" }, by: { type: "string" } })
    const [ref, ...words] = p.positionals
    const what = words.join(" ").trim()
    const itemRef = str(p, "item")?.trim()
    if (!ref || !what || !itemRef) throw usageError(this)
    const rule = ruleNamed(rulesOf(ctx), ref)
    if (!rule) throw new Error(`no active rule is called ${JSON.stringify(ref)} — naima rules lists them`)
    if (rule.verifiedBy !== agent) {
      throw new Error(
        `${rule.item} is ${
          rule.verifiedBy ? `verified by ${rule.verifiedBy}, a check: naima check runs it` : "verified by nothing named"
        }, not by an agent's review: there is nothing to record`,
      )
    }
    const item = ctx.repo.resolve(itemRef)
    const by = str(p, "by")?.trim() || (isGitRepo(ctx.root) ? gitOrNull(ctx.root, "config", "user.name") : null)
    if (!by) throw new Error("say who reviewed: --by <name>, or set git's user.name")
    const allowance = guardPrivate("the review", findPrivate(what, privateContext()), ctx.allowPrivate)
    const review = { rule: rule.item, item: label(item), what: allowance ? `${what} ${allowance}` : what, by, date: today(ctx) }
    const dir = join(ctx.trackerRoot, REVIEWS)
    mkdirSync(dir, { recursive: true })
    const file = `${review.date}-${randomUUID()}.json`
    writeFileAtomic(join(dir, file), JSON.stringify(review, null, 2) + "\n")
    ctx.out(
      `wrote ${ctx.trackerDir}/${REVIEWS}/${file}: ${rule.item} reviewed for ${label(item)} — commit it ${
        commitOn(ctx.root, true)
      }, with the change it reviews`,
    )
    return 0
  },
})

/** What a landing report is given: the files the landing changed, from the project root. */
interface Landing {
  changed: string[]
}

/**
 * What a landing says of agent reviews: each review it carries, and each agent-verified rule that covers a file it
 * changed outside the tracker data and has no review in it, with the command that records one.
 */
export function reviewLines(ctx: Context, landing: Landing, rules: readonly ReviewedRule[], agent: string): string[] {
  const prefix = `${ctx.trackerDir}/${REVIEWS}/`
  const landed = new Set(landing.changed.filter((f) => f.startsWith(prefix)).map((f) => f.slice(prefix.length)))
  const reviews = readReviews(ctx).reviews.filter((r) => landed.has(r.file))
  const out = reviews.map((r) => `reviewed ${r.rule} for ${r.item}: ${r.what} (${r.by}, ${r.date})`)
  const code = landing.changed.filter((f) => !f.startsWith(`${ctx.trackerDir}/`))
  for (const rule of rules.filter((r) => r.verifiedBy === agent && r.covers.length)) {
    if (reviews.some((r) => r.rule === rule.item)) continue
    const touched = code.filter((f) => rule.covers.some((c) => pathMatches(f, c)))
    if (!touched.length) continue
    const shown = touched.slice(0, 3).join(", ") + (touched.length > 3 ? `, and ${touched.length - 3} more` : "")
    out.push(
      `note: this landing changes ${shown}, which ${rule.item} covers, and records no review of it: an agent reviews the change against the rule, and records it with naima reviewed ${rule.item} --item <item> "<what was checked>"`,
    )
  }
  return out
}
