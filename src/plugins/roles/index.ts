// The roles of the company of agents, as data: each role says what it owns
// and what it refuses — a role is what it refuses, so no one marks their own
// homework — and which kinds of work, and which item types, are on its queue.
// The kinds every role names are the vocabulary of the trackers' `kind` field;
// an item's role is its `role` field when set, else every role whose kinds
// hold its kind or whose types hold its type. `naima roles` lists them, and
// `naima queue --role <role>` (the gates plugin's queue) shows one role's.

import {
  bool,
  byUrgency,
  code,
  type Command,
  type Context,
  CONTRACT,
  type Contribution,
  type ExtensionPoint,
  fieldValue,
  fieldValues,
  isOpen,
  type Item,
  parse,
  type Plugin,
  table,
  usageError,
} from "../../core/api.ts"

/** A role: what any plugin, or the project's configuration, contributes to the `roles` point. */
export interface RoleDef {
  /** What items carry as `role=<name>`: lowercase, dashes. */
  name: string
  title: string
  /** What the role owns: its work, in words. */
  owns: string
  /** What it refuses, one refusal each: never empty. */
  refuses: string[]
  /** The values of `kind` that put an item on its queue. */
  kinds: string[]
  /** The item types whose every item is on its queue. */
  types: string[]
  /** The flow page that holds its practice, from the program directory. */
  flow?: string
  /** Declared by the project's configuration, not the program: the program's reference leaves it out. */
  configured?: boolean
  /** The open items on its queue, most urgent first: what `naima queue --role` lists. */
  queue(ctx: Context): Item[]
}

const blank = (s: unknown): boolean => typeof s !== "string" || !s.trim()
const strings = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === "string")
const ROLE_NAME = /^[a-z][a-z0-9-]*$/

/** Why `v` is not a role, or null. */
export function roleError(v: unknown): string | null {
  const r = v as Partial<RoleDef> | null
  if (!r || typeof r !== "object") return "is not an object"
  if (typeof r.name !== "string" || !ROLE_NAME.test(r.name)) return "has no name of lowercase letters, digits and dashes"
  if (blank(r.title) || blank(r.owns)) return "does not say its title and what it owns"
  if (!strings(r.refuses) || !r.refuses.length || r.refuses.some(blank)) return "does not say what it refuses: a role is what it refuses"
  if (!strings(r.kinds) || !strings(r.types)) return "has no list of kinds and of types"
  return typeof r.queue === "function" ? null : "has no queue function"
}

/** A role whose queue is computed the way this plugin computes every role's: by `role`, else by `kind` or type. */
export const withQueue = (r: Omit<RoleDef, "queue">): RoleDef => ({ ...r, queue: (ctx) => byUrgency(ctx, queueOf(ctx, r.name)) })

/** The point this plugin declares: every role, by name. Names are stored, in the `role` field. */
export const rolesPoint: ExtensionPoint<RoleDef> = {
  id: "roles",
  says:
    "a role of the company of agents: `title`, what it `owns`, what it `refuses` (never empty), the `kinds` and `types` on its queue, and `queue(ctx)`, its open items most urgent first",
  noun: "role",
  stored: true,
  key: (r) => r.name,
  renamed: (r, name) => withQueue({ ...r, name }),
  validate: roleError,
  gaps: (r) => (blank(r.owns) ? ["does not say what it owns"] : []),
  configured: (r) => r.configured === true,
  document: (roles) => [
    "",
    "**Roles**, listed by `naima roles`; `naima queue --role <role>` shows one's queue",
    ...table(
      ["Role", "Title", "Owns", "Refuses", "Queue: kinds and types"],
      roles.map((r) => [code(r.name), r.title, r.owns, r.refuses.join("; "), [...r.kinds.map(code), ...r.types.map((t) => `every ${code(t)}`)].join(", ")]),
    ),
  ],
}

const role = (
  name: string,
  title: string,
  owns: string,
  refuses: string[],
  kinds: string[],
  types: string[] = [],
  flow?: string,
): RoleDef => withQueue({ name, title, owns, refuses, kinds, types, ...(flow ? { flow } : {}) })

/** The roles every project starts with: the company of agents of docs/purpose.md, each with its refusals. */
export const DEFAULT_ROLES: readonly RoleDef[] = [
  role(
    "owner",
    "Owner",
    "the decisions: judgement, a reserved decision, a credential, a physical act",
    [
      "any machine work",
      "being asked what an agent can find out",
    ],
    ["decision"],
    ["decisions"],
  ),
  role(
    "coordinator",
    "Coordinator",
    "the conversation with the owner; the trunk, as its single writer: it alone lands, pushes it, publishes the site and makes releases; the timer, spawning and merging workers",
    [
      "work a worker could do",
      "more than one question at a time",
    ],
    ["coordination"],
    [],
    "docs/agents/coordinator-and-workers.md",
  ),
  role(
    "lead-developer",
    "Lead developer",
    "the queue: ranking it, sweeping fixed-but-unproven items, preparing branches, the merge train",
    ["merging without the gates", "closing an item on reasoning", "closing its own branch's items"],
    ["review", "design", "research"],
    [],
    "docs/agents/coordinator-and-workers.md",
  ),
  role(
    "implementer",
    "Implementer",
    "one item, one cause, one branch: the code, analysis or text it asks for",
    [
      "widening scope",
      "spawning workers",
      "touching the trunk",
    ],
    ["code", "refactor"],
    [],
    "docs/agents/worker-protocol.md",
  ),
  role(
    "tester",
    "Tester",
    "performing gestures on the running software and writing down what happened",
    [
      "fixing what it finds",
      "testing what it just wrote",
    ],
    ["test"],
    ["tests"],
    "docs/agents/coordinator-and-workers.md",
  ),
  role(
    "evidence-owner",
    "Evidence owner",
    "whether a gesture proves the claim, weighed by the evidence ranking and red-then-green",
    [
      "performing the gesture it then judges",
      "accepting inspection as proof",
    ],
    ["evidence"],
    [],
    "docs/agents/coordinator-and-workers.md",
  ),
  role(
    "filer",
    "Filer",
    "classification, triage fields, reports routed to the right tracker",
    [
      "inventing scope",
      "deciding whether something is proven",
    ],
    ["report", "triage"],
    [],
    "docs/agents/reporting-and-triage.md",
  ),
  role(
    "verification-engineer",
    "Verification engineer",
    "the formal models and properties, and running their verifiers",
    ["changing a model to make a property hold", "calling a property proven past its expiry"],
    ["model", "verification"],
    ["properties"],
  ),
  role(
    "release-manager",
    "Release manager",
    "opening a release item, running its stages in order, recording each stage's output",
    [
      "releasing off a gate that does not hold",
      "deciding to release",
      "judging whether the code is good enough",
    ],
    ["release"],
    ["releases"],
    "docs/agents/release.md",
  ),
  role(
    "documentarian",
    "Documentarian",
    "the words: docs pages with the feature, the changelog, the documentation map",
    [
      "documenting what does not exist in the code",
      "deciding whether to announce",
    ],
    ["writing", "docs"],
    [],
    "docs/agents/documentarian.md",
  ),
  role(
    "announcer",
    "Announcer",
    "release notes, changelog entries, site and README copy, announcements",
    [
      "announcing a feature that is not announceable: user-facing, shipped, documented and checked by a person or end to end",
      "deciding when to announce",
    ],
    ["announcement"],
    [],
    "docs/agents/announcer.md",
  ),
  role(
    "community-steward",
    "Community steward",
    "turning outside issues and pull requests into items, and keeping the link back",
    [
      "merging anything",
      "promising a contributor an outcome",
    ],
    ["community"],
    [],
    "docs/agents/community.md",
  ),
  role(
    "business",
    "Business",
    "researching licence, funding, sponsorship, citation and adoption options, filed as decisions",
    [
      "acting on any of it before the owner decides",
      "committing the project to anything",
    ],
    ["business"],
    [],
    "docs/agents/business.md",
  ),
]

/** The project's roles from `options.roles`: name → { title, owns, refuses, kinds, types }, each adding a role or replacing a default one. */
function readOptions(options: Record<string, unknown>): RoleDef[] {
  const raw = options["roles"] ?? {}
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("roles: options.roles must be an object: role name → { title, owns, refuses, kinds, types }")
  }
  return Object.entries(raw as Record<string, Record<string, unknown>>).map(([name, r]) => {
    const given: Record<string, unknown> = r && typeof r === "object" ? r : {}
    const def = withQueue({ kinds: [], types: [], ...given, name, configured: true } as unknown as Omit<RoleDef, "queue">)
    const why = roleError(def)
    if (why) throw new Error(`roles: role "${name}" ${why}`)
    return def
  })
}

/** Every role any loaded plugin, or the configuration, contributes. */
export const rolesOf = (ctx: Context): Contribution<RoleDef>[] => ctx.registry.contributions("roles") as Contribution<RoleDef>[]

const ROLE = { name: "role", kind: "enum" } as const
const KIND = { name: "kind", kind: "string" } as const

/** The roles whose queue `item` is on: its `role` when set, else every role taking its kind or its type. */
export function rolesFor(ctx: Context, item: Item): string[] {
  const roles = rolesOf(ctx)
  const named = fieldValues(item, ROLE)
  if (named.length) return named
  const kind = fieldValue(item, KIND)
  return roles.filter(({ value: r }) => (kind !== undefined && r.kinds.includes(kind)) || r.types.includes(item.type)).map((c) => c.name)
}

/** The open items on one role's queue. */
export const queueOf = (ctx: Context, name: string): Item[] => ctx.repo.items.filter((i) => isOpen(ctx, i) && rolesFor(ctx, i).includes(name))

/** The kind vocabulary: every kind any role takes, each saying whose queue it puts an item on. */
function kindVocabulary(roles: readonly RoleDef[]): Record<string, string> {
  const whose = new Map<string, string[]>()
  for (const r of roles) for (const k of r.kinds) whose.set(k, [...(whose.get(k) ?? []), r.title.toLowerCase()])
  return Object.fromEntries([...whose].map(([k, rs]) => [k, `work on the ${rs.join(" and ")}'s queue`]))
}

const rolesCommand: Command = {
  name: "roles",
  says: "every role: what it owns, what it refuses, the kinds and types on its queue, and how many open items are on it",
  enforces: "nothing: it only reads; a role that refuses nothing is refused when the plugin loads",
  usage: "roles [--json]",
  options: [{ name: "--json", says: "print the roles as JSON: name, title, owns, refuses, kinds, types, flow, open" }],
  examples: ["roles", "roles --json"],
  run(args, ctx) {
    const p = parse(args, { json: { type: "boolean" } })
    if (p.positionals.length) throw usageError(this)
    const rows = rolesOf(ctx).map(({ name, value: r }) => ({
      name,
      title: r.title,
      owns: r.owns,
      refuses: r.refuses,
      kinds: r.kinds,
      types: r.types,
      flow: r.flow ?? null,
      open: queueOf(ctx, name).length,
    }))
    if (bool(p, "json")) {
      ctx.out(JSON.stringify(rows, null, 2))
      return 0
    }
    for (const r of rows) {
      ctx.out(`${r.name} — ${r.title}: ${r.open} open${r.flow ? `  (${r.flow})` : ""}`)
      ctx.out(`  owns: ${r.owns}`)
      ctx.out(`  refuses: ${r.refuses.join("; ")}`)
      const queue = [...r.kinds.map((k) => `kind=${k}`), ...r.types.map((t) => `every ${t}`)]
      ctx.out(`  queue: ${queue.join(", ") || "only items with role=" + r.name}`)
    }
    return 0
  },
}

export default function roles(options: Record<string, unknown> = {}): Plugin {
  const configured = readOptions(options)
  const replaced = new Set(configured.map((r) => r.name))
  const all = [...DEFAULT_ROLES.filter((r) => !replaced.has(r.name)), ...configured]
  return {
    name: "roles",
    contract: CONTRACT,
    says: "the roles of the company of agents as data: what each owns and refuses, and the kinds of work on its queue",
    about: "A role is what it refuses: each one says what it owns and what it will not do, so no one marks their own homework. " +
      "The roles are data — by default the thirteen of the company of agents (docs/purpose.md), and `plugins.roles.options.roles` adds a project's own or replaces one by name — and any plugin may contribute one to the `roles` point. " +
      "Every kind a role takes is a value of the trackers' `kind` field, so the kinds are one vocabulary and a kind no role takes is a note. " +
      "An item is on a role's queue by its `role` field when set, else by its `kind` or its type; `naima roles` lists the roles with their open counts, and `naima queue --role <role>` lists one's queue, most urgent first.",
    options: [
      {
        name: "roles",
        says:
          'role name → { "title", "owns", "refuses": [...], "kinds": [...], "types": [...] }: adds a role, or replaces the default one of that name. refuses is never empty.',
        default: "{}",
      },
    ],
    points: [rolesPoint],
    contributes: { roles: all },
    fields: [
      {
        name: "role",
        kind: "enum",
        says: "the role whose queue the item is on, when its kind or type does not say: any role a loaded plugin contributes",
        valuesFrom: "roles",
        multiple: true,
      },
    ],
    extends: [{ field: "kind", values: kindVocabulary(all) }],
    uses: { fields: [KIND.name] },
    commands: [rolesCommand],
  }
}
