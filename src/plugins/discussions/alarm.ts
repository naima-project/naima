// A meeting with a date raises its own alarm. A dated meeting with the owner that is not held, and is not on now, says
// so from its day on: on the day it is due, after it missed. The owner does not have to notice: an hourly job says it
// in an urgent message to whoever runs the next `naima hello` and the next turn-end tick, once an hour, the same kind
// of message as an overdue goal's. It differs in one thing: nobody acknowledges it. It lasts as long as its cause
// (a live message, core/tick.ts) and stops when the owner holds the meeting, moves its date or drops it. The meeting's
// states and this behaviour are the model's: develop/models/meeting/alarm/alarm.mcrl2.

import { type Context, type JobOutcome, messageId, type Notice, type TickJob } from "../../core/api.ts"

/** A dated meeting with the owner whose day has come and that is not held. */
export interface MeetingAlarm {
  name: string
  title: string
  /** Its date, YYYY-MM-DD. */
  on: string
  alarm: "due" | "missed"
  /** How many items are on its agenda still open. */
  open: number
}

/** The message a meeting raises: its id says the meeting, its date and its state, so a new day or a new date is a new message. */
export function noticeOf(a: MeetingAlarm): Notice {
  const when = a.alarm === "due" ? `is today (${a.on})` : `was due on ${a.on} and was not held`
  const text = `Meeting ${a.name} (${a.title}) ${when}, with ${a.open} item${a.open === 1 ? "" : "s"} on its agenda. ` +
    `Tell the owner now and open it before any other work: naima meeting ${a.name}. ` +
    `This message comes back every hour until the owner holds the meeting, moves its date (naima meeting date ${a.name} <day>) or drops it (naima meeting date ${a.name} none).`
  return { id: messageId("meeting", a.name, a.on, a.alarm), level: "urgent", text, live: true }
}

/** What the job needs from the plugin: the meetings whose day has come as they stand now, and whether this checkout is the trunk's. */
export interface AlarmSource {
  alarms(ctx: Context): MeetingAlarm[]
  onTrunk(ctx: Context): boolean
}

/** The hourly job, run on the trunk's checkout, whose meetings are the project's. */
export const meetingAlarmJob = (source: AlarmSource): TickJob => ({
  name: "meeting-alarm",
  says:
    "every hour, on the trunk's checkout: each dated meeting with the owner whose day has come and that is not held (due on its day, missed after it) is said in an urgent message shown at naima hello and at the turn-end tick, once an hour, until the owner holds the meeting, moves its date or drops it; nobody acknowledges it",
  every: "hour",
  timeoutMs: 30_000,
  canRunHere: (ctx) => source.onTrunk(ctx),
  run(ctx): JobOutcome {
    try {
      return { ok: true, notices: source.alarms(ctx).map(noticeOf) }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  },
  // Said no more the moment the meeting is held, moved or dropped: on the trunk's checkout it is read again; elsewhere the job's own word stands.
  stillHolds(ctx, notice): boolean {
    if (!source.onTrunk(ctx)) return true
    try {
      return source.alarms(ctx).some((a) => noticeOf(a).id === notice.id)
    } catch {
      return true
    }
  },
})
