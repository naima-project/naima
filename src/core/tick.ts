// The tick: what a daemon would do, done by the commands themselves. Naima
// runs no process in the background; every command that works on a project
// starts with a tick, and the tick runs whatever housekeeping is due — the
// daily update check, the jobs plugins contribute — and says what is due to
// the owner, as messages. Any number of naima processes may tick at once, in
// any worktree of the clone, with no lock
// (features/updates-discovered-during-long-sessions-too-not).
//
// Nothing is ever rewritten. Every decision is one file created exclusively,
// so the filesystem decides who wins, and every file appears whole: it is
// written beside its name and hard-linked into place, which fails when the
// name exists. The state lives outside the repository, in the clone's git
// directory, shared by its worktrees and never committed:
//
//   <git common dir>/naima/tick/
//     <job>/<slot>                 an attempt claimed: the process that made it runs the job for that slot
//     <job>/<slot>.done            its outcome: ok or not, when, the notices it raised
//     <job>/<slot>.retry-<n>       a further attempt, after a failure or a claim whose process died
//     shown/<id>/<hour>|once       a message shown: an urgent one once an hour, any other once
//     messages/<id>.json           an urgent message raised, once per clone (its item travels with the tracker)
//     acks/<id>                    a message acknowledged by the owner, seen at once by every worktree
//     wake/<epoch seconds>         the next time anything can be due: a hook reads it without starting Naima
//
// A slot is a job's period: the day for a daily job, the hour for an hourly
// one. The winner of a new slot prunes the slots older than the job keeps; a
// missing file is never an error.

import { createHash, randomUUID } from "node:crypto"
import { linkSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { message } from "./errors.ts"
import { runGit } from "./git.ts"

export const MINUTE = 60_000
export const HOUR = 60 * MINUTE
export const DAY = 24 * HOUR

/** How a message weighs: info and warning are shown once, urgent once an hour until the owner acknowledges it. */
export type Level = "info" | "warning" | "urgent"
export const LEVELS: readonly Level[] = ["info", "warning", "urgent"]

/** Something Naima has to tell the owner. */
export interface Notice {
  /** Deterministic: the same thing said twice is one message. Letters, digits, dots and dashes. */
  id: string
  level: Level
  text: string
  /** The command that acknowledges it, for a message that waits on the owner; absent for one shown once. */
  ack?: string
}

/** What one run of a job came to. */
export interface JobOutcome {
  ok: boolean
  /** Why it failed, kept in the tick's own state (never in the repository). */
  error?: string
  /** What it found for the owner. */
  notices?: Notice[]
}

/** When a job is due and what it does about failure: the scheduling part of a job. */
export interface Schedule {
  name: string
  every: "hour" | "day"
  /** The run's own bound; a claim older than this and a minute, with no outcome, is retried. Default 30 s. */
  timeoutMs?: number
  /** After a failed attempt, the next is due this much later, in the same slot. Default an hour. */
  retryAfterMs?: number
  /** A failing streak this many days long raises an urgent message. */
  escalateAfterDays?: number
}

/** A job the tick can run: its schedule, and the run. */
export interface TickTask extends Schedule {
  run(signal: AbortSignal): Promise<JobOutcome> | JobOutcome
  /** The urgent message a failing streak since `since` (YYYY-MM-DD) raises. */
  escalation?(since: string): { title: string; text: string }
}

/** Where the messages that outlive a tick are kept: the tracker's items, which travel with git. */
export interface MessageStore {
  /** The messages not yet acknowledged that the tracker holds. */
  pending(): Notice[]
  /** Write the message as an item; called once per clone, by the tick that raised it. */
  raise(id: string, title: string, text: string, created: string): void
  /** The ids the tracker holds as acknowledged. */
  acknowledged(): Set<string>
}

const GRACE = MINUTE
const DEFAULT_TIMEOUT = 30_000
/** Attempts in one slot at most: a day of hourly retries, and room to spare. */
const MAX_ATTEMPTS = 48
/** How long the slots are kept: long enough to see a failing streak of any escalation, and short enough to stay few. */
const KEEP: Record<Schedule["every"], number> = { day: 21 * DAY, hour: 2 * DAY }
/** The longest a hook waits before asking the tick again: a message raised on another machine arrives by git, unannounced. */
const WAKE_AT_MOST = HOUR
const WAKE_AT_LEAST = MINUTE

const NAME = /^[a-z0-9][a-z0-9.-]*$/

/** The tick's directory for the project at `root`: in the clone's git directory, shared by every worktree. Null outside git. */
export function tickDir(root: string): string | null {
  const given = process.env["NAIMA_TICK_DIR"]
  if (given) return given
  const r = runGit(root, ["rev-parse", "--git-common-dir"])
  return r.ok && r.out.trim() ? join(resolve(root, r.out.trim()), "naima", "tick") : null
}

/** The slot `now` falls in: the day, or the hour, in UTC. */
export function slotOf(every: Schedule["every"], now: Date): string {
  const iso = now.toISOString()
  return every === "day" ? iso.slice(0, 10) : iso.slice(0, 13)
}

/** When a slot starts, in milliseconds. */
const slotStart = (slot: string): number => Date.parse(slot.length === 10 ? `${slot}T00:00:00Z` : `${slot}:00:00Z`)
const slotLength = (every: Schedule["every"]): number => (every === "day" ? DAY : HOUR)

const attemptName = (slot: string, n: number): string => (n === 0 ? slot : `${slot}.retry-${n}`)

/**
 * Create `path` holding `content`, only if it does not exist: true when this call made it. The content is written
 * beside it and hard-linked into place, so it appears whole or not at all; where hard links are not supported, an
 * exclusive create stands in, and a reader takes a file it cannot parse for one not yet written.
 */
export function publish(path: string, content: string): boolean {
  mkdirSync(dirname(path), { recursive: true })
  const temp = join(dirname(path), `.${randomUUID()}.tmp`)
  writeFileSync(temp, content)
  try {
    linkSync(temp, path)
    return true
  } catch (e) {
    const code = (e as { code?: string }).code
    if (code === "EEXIST") return false
    if (code !== "EPERM" && code !== "ENOTSUP" && code !== "ENOSYS" && code !== "EXDEV") throw e
    try {
      writeFileSync(path, content, { flag: "wx" })
      return true
    } catch (e2) {
      if ((e2 as { code?: string }).code === "EEXIST") return false
      throw e2
    }
  } finally {
    rmSync(temp, { force: true })
  }
}

const names = (dir: string): string[] => {
  try {
    return readdirSync(dir)
  } catch {
    return []
  }
}

function readJson(path: string): Record<string, unknown> | null {
  try {
    const v: unknown = JSON.parse(readFileSync(path, "utf8"))
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null
  } catch {
    return null
  }
}

const remove = (path: string): void => {
  try {
    rmSync(path, { recursive: true, force: true })
  } catch {
    // another process removed it first, or it is in use: the next pruning tries again
  }
}

/** A recorded outcome, as read back. */
interface Done {
  ok: boolean
  at: number
  error?: string
  notices: Notice[]
}

const isNotice = (v: unknown): v is Notice => {
  const n = v as Notice
  return !!n && typeof n.id === "string" && NAME.test(n.id) && LEVELS.includes(n.level) && typeof n.text === "string"
}

function readDone(path: string): Done | null {
  const v = readJson(path)
  if (!v || typeof v["ok"] !== "boolean" || typeof v["at"] !== "string") return null
  return {
    ok: v["ok"],
    at: Date.parse(v["at"]),
    ...(typeof v["error"] === "string" ? { error: v["error"] } : {}),
    notices: Array.isArray(v["notices"]) ? v["notices"].filter(isNotice) : [],
  }
}

/** The attempts of `slot` in a job's directory, in order: each with its outcome, or null while it runs. */
function attempts(dir: string, slot: string, present: Set<string>): { name: string; done: Done | null }[] {
  const out: { name: string; done: Done | null }[] = []
  for (let n = 0; n < MAX_ATTEMPTS && present.has(attemptName(slot, n)); n++) {
    const name = attemptName(slot, n)
    out.push({ name, done: present.has(`${name}.done`) ? readDone(join(dir, `${name}.done`)) : null })
  }
  return out
}

/** When the claim `name` was made: what it says, or the file's own time. */
function claimedAt(dir: string, name: string): number {
  const at = readJson(join(dir, name))?.["at"]
  if (typeof at === "string" && !Number.isNaN(Date.parse(at))) return Date.parse(at)
  try {
    return statSync(join(dir, name)).mtimeMs
  } catch {
    return 0
  }
}

/** What a job's state says now: the attempt to claim, if one is due, and when it is due next otherwise. */
export function decide(job: Schedule, dir: string, now: Date): { claim: string | null; next: number } {
  const t = now.getTime()
  const slot = slotOf(job.every, now)
  const nextSlot = slotStart(slot) + slotLength(job.every)
  const tried = attempts(dir, slot, new Set(names(dir)))
  const last = tried.at(-1)
  if (!last) return { claim: attemptName(slot, 0), next: t }
  if (tried.length >= MAX_ATTEMPTS) return { claim: null, next: nextSlot }
  const after = last.done
    ? last.done.ok ? null : last.done.at + (job.retryAfterMs ?? HOUR)
    : claimedAt(dir, last.name) + (job.timeoutMs ?? DEFAULT_TIMEOUT) + GRACE
  if (after === null) return { claim: null, next: nextSlot }
  if (after <= t) return { claim: attemptName(slot, tried.length), next: t }
  return { claim: null, next: Math.min(after, nextSlot) }
}

/** Remove the slots of a job older than it keeps, and stray temporary files: done by the winner of a new slot. */
function prune(job: Schedule, dir: string, now: Date): void {
  const oldest = now.getTime() - KEEP[job.every]
  for (const name of names(dir)) {
    if (name.startsWith(".")) {
      try {
        if (statSync(join(dir, name)).mtimeMs < now.getTime() - DAY) remove(join(dir, name))
      } catch { /* gone */ }
      continue
    }
    const slot = name.split(".")[0] ?? ""
    const start = slotStart(slot)
    if (!Number.isNaN(start) && start < oldest) remove(join(dir, name))
  }
}

/** Run `job` now if it is due and this process wins its attempt; resolves once the outcome is recorded. Null when not run here. */
export async function runIfDue(job: TickTask, tick: string, clock: () => Date): Promise<JobOutcome | null> {
  const dir = join(tick, job.name)
  const now = clock()
  const { claim } = decide(job, dir, now)
  if (!claim || !publish(join(dir, claim), JSON.stringify({ at: now.toISOString(), pid: process.pid }))) return null
  if (claim === slotOf(job.every, now)) prune(job, dir, now)
  const outcome = await bounded(job, (signal) => job.run(signal))
  publish(join(dir, `${claim}.done`), JSON.stringify({ ...outcome, at: clock().toISOString() }))
  return outcome
}

/**
 * Record `outcome` as the job's attempt for now, when one is due and this process wins it: for a command that has
 * just done the job's work itself (naima hello checks for updates), so the tick does not do it again. True when recorded.
 */
export function record(job: Schedule, tick: string, now: Date, outcome: JobOutcome): boolean {
  const dir = join(tick, job.name)
  const { claim } = decide(job, dir, now)
  if (!claim || !publish(join(dir, claim), JSON.stringify({ at: now.toISOString(), pid: process.pid }))) return false
  if (claim === slotOf(job.every, now)) prune(job, dir, now)
  publish(join(dir, `${claim}.done`), JSON.stringify({ ...outcome, at: now.toISOString() }))
  return true
}

/** The run, ended after its timeout: a run that throws or overruns is a failed outcome. */
async function bounded(job: Schedule, run: (signal: AbortSignal) => Promise<JobOutcome> | JobOutcome): Promise<JobOutcome> {
  const ms = job.timeoutMs ?? DEFAULT_TIMEOUT
  const abort = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  const late = new Promise<JobOutcome>((done) => {
    timer = setTimeout(() => {
      abort.abort()
      done({ ok: false, error: `it did not finish within ${Math.round(ms / 1000)} s` })
    }, ms)
  })
  try {
    return await Promise.race([Promise.resolve().then(() => run(abort.signal)), late])
  } catch (e) {
    return { ok: false, error: message(e) }
  } finally {
    clearTimeout(timer)
  }
}

/** The outcomes of a job's slots, newest slot first, each slot's attempts in order. */
function history(dir: string): { slot: string; outcomes: Done[] }[] {
  const present = new Set(names(dir))
  const slots = [...new Set([...present].filter((n) => !n.startsWith(".")).map((n) => n.split(".")[0] ?? ""))]
    .filter((s) => !Number.isNaN(slotStart(s)))
    .sort()
    .reverse()
  return slots.map((slot) => ({ slot, outcomes: attempts(dir, slot, present).map((a) => a.done).filter((d): d is Done => d !== null) }))
}

/** The last successful outcome of a job, or null. */
export function lastSuccess(job: Pick<Schedule, "name">, tick: string): Done | null {
  for (const h of history(join(tick, job.name))) {
    const ok = h.outcomes.filter((d) => d.ok).at(-1)
    if (ok) return ok
  }
  return null
}

/** The day (YYYY-MM-DD) the job's current failing streak began: its first failure since its last success. Null when it is not failing. */
export function failingSince(job: Pick<Schedule, "name">, tick: string): string | null {
  let since: string | null = null
  for (const h of history(join(tick, job.name))) {
    if (h.outcomes.some((d) => d.ok)) break
    if (h.outcomes.some((d) => !d.ok)) since = h.slot.slice(0, 10)
  }
  return since
}

/** Days from `since` to `now`'s day. */
const daysSince = (since: string, now: Date): number => Math.round((slotStart(now.toISOString().slice(0, 10)) - slotStart(since)) / DAY)

/** A message's id from what it is about: lower case, safe as a file and a slug. */
export const messageId = (...parts: string[]): string => parts.join("-").toLowerCase().replace(/[^a-z0-9.]+/g, "-").replace(/^-+|-+$/g, "").replace(/-+/g, "-")

/** A uuid derived from a message's id: the same message raised in two places is one item. */
export function idUuid(id: string): string {
  const h = createHash("sha256").update(`naima-message:${id}`).digest("hex")
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${((parseInt(h.slice(16, 17), 16) & 3) | 8).toString(16)}${h.slice(17, 20)}-${h.slice(20, 32)}`
}

/** The command that acknowledges message `id`. */
export const ackCommand = (id: string): string => `naima messages ack ${id}`

/** The urgent messages raised in this clone, as the tick keeps them. */
export function raisedHere(tick: string): (Notice & { title: string; created: string })[] {
  const out: (Notice & { title: string; created: string })[] = []
  for (const name of names(join(tick, "messages"))) {
    if (!name.endsWith(".json")) continue
    const v = readJson(join(tick, "messages", name))
    const n = { id: v?.["id"], level: v?.["level"], text: v?.["text"] }
    if (!isNotice(n) || typeof v?.["title"] !== "string" || typeof v["created"] !== "string") continue
    out.push({ ...n, ack: ackCommand(n.id), title: v["title"], created: v["created"] })
  }
  return out
}

/** The messages acknowledged in this clone. */
export const ackedHere = (tick: string): Set<string> => new Set(names(join(tick, "acks")))

/** Acknowledge message `id` in this clone: every worktree sees it at once. False when it was already. */
export const acknowledge = (tick: string, id: string, now: Date): boolean => publish(join(tick, "acks", id), JSON.stringify({ at: now.toISOString() }))

/** When `notice` may be shown next: its slot file under shown/, an hour for an urgent one, once for any other. */
const showSlot = (notice: Notice, now: Date): string => (notice.level === "urgent" ? slotOf("hour", now) : "once")

/** Claim the right to show `notice` now: true for exactly one process per hour (urgent) or ever (any other). */
export function claimShow(tick: string, notice: Notice, now: Date): boolean {
  const dir = join(tick, "shown", notice.id)
  const won = publish(join(dir, showSlot(notice, now)), JSON.stringify({ at: now.toISOString() }))
  if (won && notice.level === "urgent") {
    const oldest = now.getTime() - 2 * DAY
    for (const name of names(dir)) if (name !== "once" && !name.startsWith(".") && slotStart(name) < oldest) remove(join(dir, name))
  }
  return won
}

/** Whether `notice` was already shown in its current slot. */
const shownNow = (tick: string, notice: Notice, now: Date): boolean => names(join(tick, "shown", notice.id)).includes(showSlot(notice, now))

/** Leave the time the tick is next due, for a hook to read without starting Naima, and drop the times gone by. */
export function wake(tick: string, at: number, now: Date): void {
  const t = now.getTime()
  const when = Math.min(Math.max(at, t + WAKE_AT_LEAST), t + WAKE_AT_MOST)
  const dir = join(tick, "wake")
  try {
    publish(join(dir, String(Math.ceil(when / 1000))), "")
  } catch {
    return
  }
  for (const name of names(dir)) if (/^\d+$/.test(name) && Number(name) * 1000 <= t) remove(join(dir, name))
}

/** What one tick did: the jobs it ran here, and the messages it is to show, each claimed. */
export interface TickResult {
  ran: string[]
  shown: Notice[]
}

export interface TickOptions {
  dir: string
  clock: () => Date
  tasks: readonly TickTask[]
  store?: MessageStore
  /** Show nothing: claim no message (the tick of a command whose output is not read by anyone). */
  quiet?: boolean
}

/**
 * A tick, in two halves: `start` claims and starts every job that is due, without waiting; `finish` waits for them
 * (each bounded by its timeout), raises the urgent message of a failing streak, and claims what is due to be shown.
 */
export function startTick(opts: TickOptions): { finish(): Promise<TickResult> } {
  const ran: string[] = []
  const running = opts.tasks.map(async (task) => {
    try {
      if (await runIfDue(task, opts.dir, opts.clock)) ran.push(task.name)
    } catch {
      // the tick never stops the command: a job that cannot record its outcome is retried once its claim is stale
    }
  })
  return {
    async finish() {
      await Promise.all(running)
      const now = opts.clock()
      try {
        escalate(opts, now)
        const shown = opts.quiet ? [] : dueNotices(opts, now).filter((n) => claimShow(opts.dir, n, now))
        wake(opts.dir, nextDue(opts, now), now)
        return { ran, shown }
      } catch {
        return { ran, shown: [] }
      }
    },
  }
}

/** Raise the urgent message of each job whose failing streak is as long as its escalation says: once per clone. */
function escalate(opts: TickOptions, now: Date): void {
  for (const task of opts.tasks) {
    if (!task.escalateAfterDays || !task.escalation) continue
    const since = failingSince(task, opts.dir)
    if (!since || daysSince(since, now) < task.escalateAfterDays) continue
    const id = messageId(task.name, "failing-since", since)
    const { title, text } = task.escalation(since)
    const created = now.toISOString().slice(0, 10)
    if (publish(join(opts.dir, "messages", `${id}.json`), JSON.stringify({ id, level: "urgent", title, text: `${title}. ${text}`, created }))) {
      try {
        opts.store?.raise(id, title, text, created)
      } catch {
        // the tracker could not take it here: the tick's own copy is shown all the same
      }
    }
  }
}

/** Every message that may be shown now, not yet acknowledged, deduplicated by id: the urgent ones first. */
export function currentNotices(tick: string, tasks: readonly Pick<Schedule, "name">[], store?: MessageStore): Notice[] {
  const acked = new Set([...ackedHere(tick), ...(store?.acknowledged() ?? [])])
  const all: Notice[] = [
    ...raisedHere(tick).map(({ id, level, text, ack }) => ({ id, level, text, ...(ack ? { ack } : {}) })),
    ...(store?.pending() ?? []),
    ...tasks.flatMap((t) => lastSuccess(t, tick)?.notices ?? []),
  ]
  const seen = new Set<string>()
  const out = all.filter((n) => !acked.has(n.id) && !seen.has(n.id) && (seen.add(n.id), true))
  return [...out.filter((n) => n.level === "urgent"), ...out.filter((n) => n.level !== "urgent")]
}

const dueNotices = (opts: TickOptions, now: Date): Notice[] => currentNotices(opts.dir, opts.tasks, opts.store).filter((n) => !shownNow(opts.dir, n, now))

/** The next time anything can be due: a job's next attempt, or the next hour of an urgent message still to acknowledge. */
function nextDue(opts: TickOptions, now: Date): number {
  let next = now.getTime() + WAKE_AT_MOST
  for (const task of opts.tasks) next = Math.min(next, decide(task, join(opts.dir, task.name), now).next)
  for (const n of currentNotices(opts.dir, opts.tasks, opts.store)) {
    if (n.level === "urgent") next = Math.min(next, shownNow(opts.dir, n, now) ? slotStart(slotOf("hour", now)) + HOUR : now.getTime())
  }
  return next
}

/** The tick's own folders, which no job may be named after. */
export const TICK_FOLDERS: readonly string[] = ["shown", "messages", "acks", "wake"]

/** The jobs that have left state in the tick's directory, by name: what `naima messages` reads their notices from. */
export const jobsIn = (tick: string): { name: string }[] => names(tick).filter((n) => NAME.test(n) && !TICK_FOLDERS.includes(n)).map((name) => ({ name }))

/** The machine-readable line a message is printed as, on standard error: any tool can recognise it and show the text. */
export const MESSAGE_PREFIX = "NAIMA-MESSAGE "
export const messageLine = (n: Notice): string => `${MESSAGE_PREFIX}${JSON.stringify({ id: n.id, level: n.level, text: n.text, ack: n.ack ?? null })}`
