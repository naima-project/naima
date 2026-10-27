// Messages to the owner: what the tick finds that the owner should know or
// decide (core/tick.ts). An urgent one — the update check failing for days,
// say — is an item of the type `messages`, created once by the tick that
// raised it with an id derived from what it is about, so it reaches whoever
// works on the project next, on any machine; acknowledging it is the owner's
// status change. How often one is shown is the tick's own state, outside the
// repository. Any other message is said once, and kept nowhere but there.

import { existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { randomUUID } from "node:crypto"
import { bool, parse, usageError } from "./args.ts"
import { ATTACHMENTS, META, README, saveMeta, writeJson } from "./item.ts"
import { isOpen } from "./lifecycle.ts"
import { commitOn, dirsAcrossBranches, worktrees } from "./git.ts"
import {
  ackCommand,
  ackedHere,
  acknowledge,
  currentNotices,
  idUuid,
  jobsIn,
  type Level,
  LEVELS,
  type MessageStore,
  type Notice,
  raisedHere,
  tickDir,
} from "./tick.ts"
import type { Command, Context, FieldDef, Item, TypeDef } from "./types.ts"

/** The trait of the type messages to the owner are items of: the tick finds it by the trait. */
export const MESSAGES_TRAIT = "messages"

export const messagesType: TypeDef = {
  id: "messages",
  dir: "messages",
  title: "Messages",
  says: "what Naima has to tell the owner and waits on them to read, such as an update check failing for days: created by the tick, acknowledged by the owner",
  statuses: {
    unread: { category: "open", says: "raised, and not yet acknowledged by the owner: an urgent one is shown at most once an hour" },
    acknowledged: { category: "done", says: "the owner has read it: naima messages ack <id>" },
  },
  initialStatus: "unread",
  creatable: false,
  traits: [MESSAGES_TRAIT],
  transitions: { acknowledged: [] },
}

export const LEVEL: FieldDef = {
  name: "level",
  kind: "enum",
  says: "how much a message weighs: info and warning are said once, urgent is shown once an hour until acknowledged",
  values: { info: "worth knowing", warning: "worth acting on", urgent: "the owner should know now: shown once an hour until acknowledged" },
  traits: [MESSAGES_TRAIT],
}

/** The type that holds messages, by its trait; null when no loaded type carries it. */
const typeOf = (ctx: Context): TypeDef | null => [...ctx.registry.types.values()].find((t) => t.traits?.includes(MESSAGES_TRAIT)) ?? null

const messageItems = (ctx: Context): Item[] => {
  const type = typeOf(ctx)
  return type ? ctx.repo.items.filter((i) => i.type === type.id) : []
}

/** A message item's level: its field, or urgent when it holds none. */
const levelOf = (item: Item): Level => (LEVELS.includes(item.meta["level"] as Level) ? item.meta["level"] as Level : "urgent")

/** A message item as the tick shows it: its title, and the command that acknowledges it. */
const noticeOf = (item: Item): Notice => ({ id: item.slug, level: levelOf(item), text: item.meta.title, ack: ackCommand(item.slug) })

/** The page of a message item. */
const page = (id: string, title: string, text: string): string =>
  `# ${title}\n\n${text}\n\nOnce the owner has read it, they acknowledge it: \`${ackCommand(id)}\`. Nobody acknowledges it on their behalf.\n`

/**
 * Write message `id` as an item, unless the tracker holds it already — here, in another worktree, or on another local
 * branch. It is built beside the type's folder and renamed into place, so a reader never sees half of it.
 */
function raise(ctx: Context, id: string, title: string, text: string, created: string): void {
  const type = typeOf(ctx)
  if (!type) return
  const base = join(ctx.trackerRoot, type.dir)
  if (existsSync(join(base, id))) return
  if (dirsAcrossBranches(ctx.trackerGit, ctx.trackerPrefix ? `${ctx.trackerPrefix}/${type.dir}` : type.dir)?.has(id)) return
  const inside = ctx.trackerPrefix
  if (inside && worktrees(ctx.root).some((w) => !w.self && existsSync(join(w.path, inside, type.dir, id)))) return
  const temp = join(base, `.${id}.${randomUUID()}`)
  mkdirSync(join(temp, ATTACHMENTS), { recursive: true })
  try {
    writeFileSync(join(temp, ATTACHMENTS, ".gitkeep"), "")
    writeFileSync(join(temp, README), page(id, title, text))
    writeJson(join(temp, META), { id: idUuid(id), title, status: type.initialStatus, created, level: "urgent" })
    renameSync(temp, join(base, id))
    ctx.reload()
  } catch {
    // another process put it there first
  } finally {
    rmSync(temp, { recursive: true, force: true })
  }
}

/** The tracker as the tick's message store. */
export function itemStore(ctx: Context): MessageStore {
  return {
    pending: () => messageItems(ctx).filter((i) => isOpen(ctx, i)).map(noticeOf),
    acknowledged: () => new Set(messageItems(ctx).filter((i) => !isOpen(ctx, i)).map((i) => i.slug)),
    raise: (id, title, text, created) => raise(ctx, id, title, text, created),
  }
}

export const messagesCommand: Command = {
  name: "messages",
  says:
    "list what Naima has to tell the owner: the urgent messages not yet acknowledged, which the tick shows at most once an hour, then what it said once, such as a newer Naima; with ack, the owner acknowledges a message, which stops it being shown, in every worktree and, once the tracker is committed, on every machine",
  enforces: "a message is acknowledged only by the owner's command, never on their behalf; an acknowledgement is never undone",
  usage: "messages [--all] [--json] | messages ack <id>",
  options: [
    { name: "--all", says: "also list the messages already acknowledged" },
    { name: "--json", says: "print the messages as JSON: id, level, text, status, and the command that acknowledges each" },
  ],
  examples: ["messages", "messages --all", "messages ack update-check-failing-since-2026-10-18"],
  run(args, ctx) {
    const p = parse(args, { all: { type: "boolean" }, json: { type: "boolean" } })
    const tick = tickDir(ctx.root)
    const items = messageItems(ctx)
    if (/^ack$/.test(p.positionals[0] ?? "")) {
      const id = p.positionals[1]
      if (!id || p.positionals.length > 2) throw usageError(messagesCommand)
      const item = items.find((i) => i.slug === id)
      const raised = tick ? raisedHere(tick).some((m) => m.id === id) : false
      if (!item && !raised) throw new Error(`no message ${id} — naima messages lists them`)
      if (tick) acknowledge(tick, id, ctx.now())
      if (item && isOpen(ctx, item)) {
        saveMeta(ctx, { ...item, meta: { ...item.meta, status: "acknowledged" } })
        ctx.out(`${id}: acknowledged — commit it ${commitOn(ctx.root, true)}, so every machine sees it`)
      } else ctx.out(`${id}: acknowledged`)
      return 0
    }
    if (p.positionals.length) throw usageError(messagesCommand)
    const acked = new Set([...(tick ? ackedHere(tick) : []), ...items.filter((i) => !isOpen(ctx, i)).map((i) => i.slug)])
    const current = tick ? currentNotices(tick, jobsIn(tick), itemStore(ctx)) : items.filter((i) => isOpen(ctx, i)).map(noticeOf)
    const rows = current.map((n) => ({ ...n, status: n.ack ? "unread" : "said" }))
    if (bool(p, "all")) {
      for (const i of items) if (acked.has(i.slug)) rows.push({ ...noticeOf(i), status: "acknowledged" })
      for (const m of tick ? raisedHere(tick) : []) {
        if (acked.has(m.id) && !rows.some((r) => r.id === m.id)) {
          rows.push({ id: m.id, level: m.level, text: m.title, ack: m.ack ?? ackCommand(m.id), status: "acknowledged" })
        }
      }
    }
    if (bool(p, "json")) {
      ctx.out(
        JSON.stringify(rows.map((r) => ({ id: r.id, level: r.level, text: r.text, status: r.status, ack: r.status === "unread" ? r.ack : null })), null, 2),
      )
      return 0
    }
    if (!rows.length) ctx.out("no messages")
    for (const r of rows) ctx.out(`${r.level.padEnd(7)} ${r.status.padEnd(12)} ${r.id}\n  ${r.text}${r.status === "unread" && r.ack ? `\n  ${r.ack}` : ""}`)
    return 0
  },
}
