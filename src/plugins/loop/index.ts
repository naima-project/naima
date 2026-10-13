// The non-stop loop: agents keep working on an explicit target, chosen before
// starting, until only the owner's work is left on it. `naima loop <target>`
// is what the agent runs on every tick of its wake-up timer: done or not, the
// next agent work, the stop verdict, and — once stopped — the owner's ordered
// action list, each line saying why it is his.
//
// A target is one of three:
//   a work list  an item whose README lists steps as `- [ ]` / `- [x]` lines;
//                a step that cannot be done now carries `deferred: <why>`
//   an epic      an item whose type carries the `group` trait: its items
//   a gate       any gate a plugin contributes: what it still waits for
//
// It stops when every remaining line is deferred, or every remaining item is
// the owner's: a reserved decision, or a proof only a person or a build can
// give. The timer is the harness's; this plugin states its cadence.

import {
  bool,
  type Command,
  type Context,
  CONTRACT,
  fieldValue,
  hasTrait,
  isEvidenceType,
  isOpen,
  type Item,
  label,
  linked,
  parse,
  type Plugin,
  positiveInt,
  readReadme,
  str,
} from "../../core/api.ts"

const GROUP = "group"
const HAS_PART = "has-part"
const RUN_BY = { name: "runBy", kind: "enum" } as const
const HUMAN_BECAUSE = { name: "humanBecause", kind: "enum" } as const
const FIXED_ON = { name: "fixedOn", kind: "date" } as const
const DEFAULT_EVERY = 3

/** What `naima loop` reads of a gate: the shape every contribution to the gates point has. */
interface Gate {
  name: string
  title: string
  evaluate(ctx: Context): { blocking: Item[]; owed: Item[] } | Promise<{ blocking: Item[]; owed: Item[] }>
}

/** One line of work left on the target: an item, or a step of a work list. */
export interface Line {
  ref: string
  title: string
  why: string
}

/** What `naima loop <target> --json` prints. */
export interface Verdict {
  target: string
  kind: "list" | "epic" | "gate"
  title: string
  /** The wake-up cadence, in minutes. */
  every: number
  /** Lines done and lines in all: a work list's steps, an epic's items. A gate says only what is left. */
  done?: number
  total?: number
  left: number
  stopped: boolean
  verdict: string
  /** Agent work, most urgent first: what keeps the loop going. */
  next: Line[]
  /** The owner's, in the order he should take them. */
  owner: Line[]
  /** Proving gestures among the owner's that nobody has run yet: what to try while he is away. */
  untried: string[]
  /** What to check on every tick. */
  tick: string[]
}

const valueSays = (ctx: Context, field: string, value: string): string => ctx.registry.fields.get(field)?.values?.[value] ?? value

/** An item's own value of a field, else that of an item verifying it. */
function own(ctx: Context, item: Item, field: { name: string; kind: "enum" }): string | undefined {
  const mine = fieldValue(item, field)
  if (mine !== undefined) return mine
  for (const v of linked(ctx, item, "verified-by")) {
    const theirs = fieldValue(v, field)
    if (theirs !== undefined) return theirs
  }
  return undefined
}

const owesCode = (ctx: Context, item: Item): boolean => fieldValue(item, FIXED_ON) === undefined && !isEvidenceType(ctx, item.type)

/** The order the owner takes his work in: decisions unblock the rest, then what only he holds, then judgements, then builds. */
const OWNER_ORDER = ["decision", "credential", "physical", "judgement", "build"]

/** Whose an open item is: the owner's, with why and its place in his order; or the agents', with what is left to do. */
function classify(ctx: Context, item: Item): { owner: boolean; why: string; rank: number } {
  const because = own(ctx, item, HUMAN_BECAUSE)
  if (because === "decision") return { owner: true, why: `decision: ${valueSays(ctx, HUMAN_BECAUSE.name, because)}`, rank: 0 }
  if (owesCode(ctx, item)) return { owner: false, why: "no code yet", rank: 0 }
  const who = own(ctx, item, RUN_BY)
  if (who === "human") {
    const why = because ?? "human"
    const rank = OWNER_ORDER.indexOf(why)
    return { owner: true, why: `${why}: ${valueSays(ctx, because ? HUMAN_BECAUSE.name : RUN_BY.name, why)}`, rank: rank < 0 ? OWNER_ORDER.length : rank }
  }
  if (who === "build") return { owner: true, why: `build: ${valueSays(ctx, RUN_BY.name, who)}`, rank: OWNER_ORDER.indexOf("build") }
  if (who === undefined) return { owner: false, why: "owes its proof, and nobody said whose: set runBy", rank: 0 }
  return { owner: false, why: `owes its proof: run it (runBy ${who})`, rank: 0 }
}

/** The items an epic groups, a nested group's too. */
function membersOf(ctx: Context, group: Item, seen: Set<Item> = new Set([group])): Item[] {
  return linked(ctx, group, HAS_PART).flatMap((m) => {
    if (seen.has(m)) return []
    seen.add(m)
    return hasTrait(ctx, m, GROUP) ? [m, ...membersOf(ctx, m, seen)] : [m]
  })
}

/** A proving gesture nobody has run: an evidence item still at its type's first status. */
function untriedOf(ctx: Context, item: Item): Item[] {
  const gestures = isEvidenceType(ctx, item.type) ? [item] : linked(ctx, item, "verified-by")
  return gestures.filter((g) => isOpen(ctx, g) && g.meta.status === ctx.registry.types.get(g.type)?.initialStatus)
}

const STEP = /^\s*[-*] \[([ xX])\]\s+(.*)$/
const DEFERRED = /\s*(?:[—–-]+\s*)?\bdeferred:\s*(.*)$/i

/** A work list's steps, from its README: done, open, or open with a written deferral. */
function stepsOf(item: Item): { n: number; text: string; done: boolean; deferral?: string }[] {
  const steps: { n: number; text: string; done: boolean; deferral?: string }[] = []
  for (const line of readReadme(item).split("\n")) {
    const m = STEP.exec(line)
    if (!m) continue
    const body = m[2]!.trim()
    const d = DEFERRED.exec(body)
    const n = steps.length + 1
    if (d && d[1]!.trim()) steps.push({ n, text: body.slice(0, d.index).trim(), done: m[1] !== " ", deferral: d[1]!.trim() })
    else steps.push({ n, text: body, done: m[1] !== " " })
  }
  return steps
}

function ticks(target: string, stopped: boolean): string[] {
  return [
    `run naima loop ${target}: am I done, or did I stop?`,
    "resume what stopped: a worker that ended, a branch that waits for its merge",
    "merge finished branches nobody holds (naima claims), after the gates over the combined result; remove merged worktrees",
    "spawn workers on the next agent work, each preparing on its own branch: landing, publishing and releasing stay with the owner of the trunk",
    "a line that cannot be done now gets a written deferral, never a silent skip",
    ...(stopped ? ["stopped: hand the owner his ordered list; while he is away, run the gestures nobody has tried yet and attach each attempt"] : []),
  ]
}

async function verdictOf(ctx: Context, ref: string, every: number): Promise<Verdict> {
  const gate = ctx.registry.find<Gate>("gates", ref)?.value
  let item: Item | undefined
  if (!gate) {
    try {
      item = ctx.repo.resolve(ref)
    } catch {
      throw new Error(`no gate or item "${ref}" — the target is a work list (an item listing steps), an epic, or a gate: naima gates, naima epic`)
    }
  }
  const base = { every, untried: [] as string[] }
  if (item && !hasTrait(ctx, item, GROUP)) {
    const steps = stepsOf(item)
    if (!steps.length) throw new Error(`${label(item)} lists no steps — write them as "- [ ] step" lines in its README, or name an epic or a gate`)
    const at = (n: number) => `${label(item)}#${n}`
    const left = steps.filter((s) => !s.done)
    const next = left.filter((s) => !s.deferral).map((s) => ({ ref: at(s.n), title: s.text, why: "not done" }))
    const owner = left.filter((s) => s.deferral).map((s) => ({ ref: at(s.n), title: s.text, why: s.deferral! }))
    return finish(label(item), "list", String(item.meta.title ?? ""), { ...base, done: steps.length - left.length, total: steps.length }, next, owner)
  }
  let all: Item[]
  if (gate) {
    const r = await gate.evaluate(ctx)
    all = [...r.blocking, ...r.owed]
  } else all = membersOf(ctx, item!)
  const [target, kind, title] = gate ? [gate.name, "gate" as const, gate.title] : [label(item!), "epic" as const, String(item!.meta.title ?? "")]
  const open = all.filter((i) => isOpen(ctx, i) && !hasTrait(ctx, i, GROUP))
  const sorted = open.map((i) => ({ i, c: classify(ctx, i) }))
  const next = sorted.filter((x) => !x.c.owner).map(({ i, c }) => ({ ref: label(i), title: String(i.meta.title ?? ""), why: c.why }))
  const mine = sorted.filter((x) => x.c.owner).sort((a, b) => a.c.rank - b.c.rank)
  const owner = mine.map(({ i, c }) => ({ ref: label(i), title: String(i.meta.title ?? ""), why: c.why }))
  const untried = [...new Set(mine.flatMap(({ i }) => untriedOf(ctx, i)).map(label))]
  const counts = kind === "epic"
    ? { done: all.filter((i) => !hasTrait(ctx, i, GROUP)).length - open.length, total: all.filter((i) => !hasTrait(ctx, i, GROUP)).length }
    : {}
  return finish(target, kind, title, { ...base, ...counts, untried }, next, owner)
}

function finish(
  target: string,
  kind: Verdict["kind"],
  title: string,
  rest: Pick<Verdict, "every" | "untried"> & Partial<Pick<Verdict, "done" | "total">>,
  next: Line[],
  owner: Line[],
): Verdict {
  const empty = kind === "epic" && rest.total === 0
  const stopped = next.length === 0 && !empty
  const verdict = empty
    ? "NOT DONE: the epic groups no items yet — naima epic add <epic> <item>..."
    : stopped
    ? owner.length ? "STOPPED: only the owner's work is left" : "STOPPED: nothing is left"
    : `NOT DONE: ${next.length} left for agents`
  return {
    target,
    kind,
    title,
    ...rest,
    left: next.length + owner.length,
    stopped,
    verdict,
    next,
    owner,
    untried: stopped ? rest.untried : [],
    tick: ticks(target, stopped),
  }
}

const KIND = { list: "work list", epic: "epic", gate: "gate" } as const

function print(ctx: Context, v: Verdict): void {
  ctx.out(`loop on ${KIND[v.kind]} ${v.target}  ${v.title} — wake every ${v.every} minute${v.every === 1 ? "" : "s"}`)
  ctx.out(`  ${v.total !== undefined ? `${v.done} of ${v.total} done` : `${v.left} left on the gate`} — ${v.verdict}`)
  if (v.next.length) {
    ctx.out("  next for agents:")
    for (const l of v.next) ctx.out(`    → ${l.ref}  ${l.title}  (${l.why})`)
  }
  if (v.stopped && v.owner.length) {
    ctx.out("  the owner's actions, in order:")
    v.owner.forEach((l, n) => ctx.out(`    ${n + 1}. ${l.ref}  ${l.title} — ${l.why}`))
  } else if (v.owner.length) {
    ctx.out(`  the owner's so far: ${v.owner.length} — they do not keep the loop going`)
  }
  if (v.untried.length) {
    ctx.out("  while the owner is away, run the gestures nobody has tried yet and attach each attempt:")
    for (const r of v.untried) ctx.out(`    · ${r}`)
  }
  ctx.out("  each tick:")
  for (const t of v.tick) ctx.out(`    - ${t}`)
}

export default function loop(options: Record<string, unknown> = {}): Plugin {
  const raw = options["every"]
  if (raw !== undefined && (typeof raw !== "number" || !Number.isInteger(raw) || raw < 1)) {
    throw new Error(`loop: options.every is the wake-up cadence in whole minutes, got ${JSON.stringify(raw)}`)
  }
  const every = (raw as number | undefined) ?? DEFAULT_EVERY
  const command: Command = {
    name: "loop",
    says:
      "the non-stop loop on a target chosen before starting — a work list, an epic or a gate: done or not, the next agent work, the stop verdict, and once stopped the owner's ordered action list, each line saying why it is his",
    enforces: "the loop runs only on a target chosen before starting — a work list, an epic or a gate —; with --check, exit 1 while it is not stopped",
    usage: "loop <target> [--every <minutes>] [--json] [--check]",
    options: [
      { name: "--every", says: `the wake-up cadence in minutes, for this run; default the plugin's option every (${DEFAULT_EVERY})` },
      { name: "--json", says: "print the verdict as JSON: target, kind, title, every, done, total, left, stopped, verdict, next, owner, untried, tick" },
      { name: "--check", says: "exit 1 while the loop is not stopped" },
    ],
    examples: ["loop todos/tonight", "loop epics/onboarding --json", "loop beta --check"],
    async run(args, ctx) {
      const p = parse(args, { every: { type: "string" }, json: { type: "boolean" }, check: { type: "boolean" } })
      const [ref, ...extra] = p.positionals
      if (!ref || extra.length) {
        throw new Error("name the target, chosen before starting: a work list (an item listing steps), an epic, or a gate — naima loop <target>")
      }
      const v = await verdictOf(ctx, ref, positiveInt(str(p, "every"), every, "--every"))
      if (bool(p, "json")) ctx.out(JSON.stringify(v, null, 2))
      else print(ctx, v)
      return bool(p, "check") && !v.stopped ? 1 : 0
    },
  }
  return {
    name: "loop",
    contract: CONTRACT,
    says: "the non-stop loop: work on an explicit target until only the owner's work is left, then hand him the ordered list",
    about:
      "`naima loop <target>` is what an agent runs on every tick of its wake-up timer. The target is chosen before starting: a work list — an item whose README lists steps as `- [ ]` and `- [x]` lines, a step that waits carrying `deferred: <why>` — an epic, or a gate. " +
      "The loop stops when what is left needs only the owner: a work list when every line is done or deferred; an epic or a gate when every open item is a reserved decision (`humanBecause: decision`) or a proof only a person or a build can give (`runBy: human`, `runBy: build`). " +
      "Once stopped it prints the owner's actions in order — decisions first, then credentials, physical acts, judgements and builds — each saying why it is his, and the proving gestures nobody has run yet, to try while he is away. " +
      "The timer is the agent harness's; the plugin states its cadence, `every` minutes.",
    options: [{
      name: "every",
      says: "the wake-up cadence the loop states, in whole minutes; `--every` overrides it for one run",
      default: String(DEFAULT_EVERY),
    }],
    uses: { fields: [RUN_BY.name, HUMAN_BECAUSE.name, FIXED_ON.name], relations: [HAS_PART, "verified-by"] },
    commands: [command],
  }
}
