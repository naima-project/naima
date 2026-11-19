// A goal that slips raises itself. A gate with a due date is a goal; once work is left on it, it is at risk when its
// date is near or the pace of the last four weeks would end it past the date, and late once the date has passed. The
// owner does not have to notice: an hourly job says so, once per state, in a message to whoever runs the next
// `naima hello` and the next turn-end tick (a warning for at risk, an urgent message acknowledged by the owner for
// late), and files one question on the agenda of the owner's next meeting. A goal that becomes late after being at risk
// raises again, for the new state; a goal with no work left, or already released, raises nothing. The behaviour is the
// model's: develop/models/goal-alarm/goal-alarm.mcrl2.

import { readFileSync } from "node:fs"
import { join } from "node:path"
import {
  type Context,
  createItem,
  currentBranch,
  DATA_FILE,
  fieldValues,
  isOpen,
  type Item,
  type JobOutcome,
  messageId,
  type Notice,
  saveProse,
  type TickJob,
  today,
  trunk,
} from "../../core/api.ts"
import { daysLeft, gatesOf, releaseTags, versionKey } from "./index.ts"

export type Urgency = "normal" | "risk" | "late"

/** How many days before its date a goal with work left is at risk. */
export const SOON_DAYS = 2
/** The weeks the pace is taken from. */
export const PACE_DAYS = 28

/** A goal's urgency from its date, the work left, and the pace that would end it: the same words as the UI's Home. */
export function urgencyOf(d: { due: string | undefined; left: number; closedInPace: number; daysLeft: number }): Urgency {
  if (!d.due || d.left <= 0) return "normal"
  if (d.daysLeft < 0) return "late"
  if (d.daysLeft <= SOON_DAYS) return "risk"
  // The pace of the last PACE_DAYS days: closed items a day. With none closed there is no forecast, and none is guessed.
  if (d.closedInPace > 0 && Math.ceil(d.left / (d.closedInPace / PACE_DAYS)) > d.daysLeft) return "risk"
  return "normal"
}

/** A goal's urgency and the numbers it came from. */
export interface GoalUrgency {
  gate: string
  title: string
  due: string
  urgency: Urgency
  left: number
  daysLeft: number
}

const closedOn = (i: Item): string | undefined => {
  const v = i.meta["closedOn"] ?? i.meta["fixedOn"]
  return typeof v === "string" ? v.slice(0, 10) : undefined
}

/** Every goal with a date and work left that is not normal, with how it stands; released goals are left out. */
export async function slipping(ctx: Context): Promise<GoalUrgency[]> {
  const tags = releaseTags(ctx)
  const now = Date.parse(`${today(ctx)}T00:00:00Z`)
  const out: GoalUrgency[] = []
  for (const { value: g } of gatesOf(ctx)) {
    if (!g.due || (g.version && tags.has(versionKey(g.version)))) continue
    const result = await g.evaluate(ctx)
    if (result.holds) continue
    const left = result.blocking.length || 1
    const closedInPace = ctx.repo.items.filter((i) => {
      if (isOpen(ctx, i) || !fieldValues(i, { name: "gate", kind: "enum" }).includes(g.name)) return false
      const d = closedOn(i)
      return !!d && now - Date.parse(`${d}T00:00:00Z`) <= PACE_DAYS * 86_400_000 && Date.parse(`${d}T00:00:00Z`) <= now
    }).length
    const n = daysLeft(ctx, g.due)
    const urgency = urgencyOf({ due: g.due, left, closedInPace, daysLeft: n })
    if (urgency !== "normal") out.push({ gate: g.name, title: g.title, due: g.due, urgency, left, daysLeft: n })
  }
  return out
}

const words = (u: GoalUrgency): string => u.urgency === "late" ? `overdue since ${u.due}` : `at risk, due ${u.due}`

/** The message a slipping goal raises: its id says the goal, its date and its state, so each state is said once. */
export function noticeOf(u: GoalUrgency): Notice {
  const id = messageId("goal", u.gate, u.due, u.urgency)
  const text = `Goal ${u.gate} (${u.title}) is ${words(u)}, with ${u.left} item${u.left === 1 ? "" : "s"} left. ` +
    `A question about it is on the owner's next meeting: tell the owner now.`
  return u.urgency === "late" ? { id, level: "urgent", text, ack: `naima messages ack ${id}` } : { id, level: "warning", text }
}

/** The question a slipping goal puts on the owner's next meeting: its title, the same for the same goal, date and state. */
export const questionTitle = (u: GoalUrgency): string => `Goal ${u.gate} is ${words(u)}: what do we do?`

/**
 * The meetings the plugin of discussions declares in naima.json, as it holds them now, that need the owner: the nearest dated
 * one first, then those without a date.
 */
function ownerMeetings(ctx: Context): string[] {
  let all: [string, { needs?: string[]; on?: string }][] = []
  try {
    const raw = JSON.parse(readFileSync(join(ctx.trackerRoot, DATA_FILE), "utf8")) as {
      plugins?: Record<string, { options?: { meetings?: Record<string, { needs?: string[]; on?: string }> } }>
    }
    all = Object.entries(raw.plugins?.["discussions"]?.options?.meetings ?? {}).filter(([, m]) => (m.needs ?? ["owner"]).includes("owner"))
  } catch {
    return []
  }
  const upcoming = all.filter(([, m]) => m.on && m.on >= today(ctx)).sort((a, b) => a[1].on!.localeCompare(b[1].on!))
  return [...upcoming, ...all.filter(([, m]) => !m.on)].map(([name]) => name)
}

/**
 * File the question of a slipping goal on the owner's next meeting, once: nothing when a discussion of that title exists
 * (open or decided), when the project holds no discussions, or when no meeting needs the owner. Null when nothing was filed.
 */
export function askOwner(ctx: Context, u: GoalUrgency): Item | null {
  const type = ctx.registry.types.get("discussions")
  const meeting = ownerMeetings(ctx)[0]
  const title = questionTitle(u)
  if (!type || !meeting || ctx.repo.items.some((i) => i.type === type.id && i.meta.title === title)) return null
  const item = createItem(ctx, type, title, { gate: [u.gate, meeting], due: today(ctx) })
  saveProse(
    ctx,
    item,
    `# ${title}\n\n## The question\n\nGoal ${u.gate} (${u.title}) is ${words(u)}, with ${u.left} item${u.left === 1 ? "" : "s"} left: ` +
      `move the date, cut what is left, or add capacity? Naima raised this by itself when the goal became ${
        u.urgency === "late" ? "overdue" : "at risk"
      }.\n\n## Options\n\n` +
      `- Keep the date and cut scope: name what leaves the goal.\n- Move the date: name the new one.\n- Keep both: name what is added to finish in time.\n`,
  )
  return item
}

/** The hourly job: the messages of the slipping goals, and, on the trunk's checkout, their questions. */
export const goalAlarmJob: TickJob = {
  name: "goal-alarm",
  says:
    "every hour, on the trunk's checkout: each goal (a gate with a due date) that has work left and is at risk (its date is within two days, or the pace of the last four weeks would end it after the date) or late (its date has passed) is said once per state in a message, a warning when at risk and an urgent one the owner acknowledges when late, shown at naima hello and at the turn-end tick, and one question about it is filed on the agenda of the owner's next meeting",
  every: "hour",
  timeoutMs: 30_000,
  canRunHere(ctx) {
    const t = trunk(ctx.root)
    return !!t && currentBranch(ctx.root) === t
  },
  async run(ctx): Promise<JobOutcome> {
    try {
      const goals = await slipping(ctx)
      for (const g of goals) {
        try {
          askOwner(ctx, g)
        } catch {
          // a write the checkout refuses is tried again at the next hour; the message is said all the same
        }
      }
      return { ok: true, notices: goals.map(noticeOf) }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  },
}
