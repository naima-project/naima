// The contract. Everything a plugin can contribute, and everything the core
// hands back to it, is declared here and nowhere else.

import type { PluginApi } from "./api.ts"
import type { JobOutcome } from "./tick.ts"

/** A typed cross-reference. `id` is always a permanent item id, never a slug. */
export interface Link {
  rel: string
  id: string
}

/** A link as read: stored on the item, or implied by the inverse of one stored elsewhere. */
export interface ResolvedLink extends Link {
  implied: boolean
}

/** The fields of an item (`meta.json`). `id`, `title` and `status` are checked on read; unknown fields are preserved untouched. */
export interface Meta {
  id: string
  title: string
  status: string
  links?: Link[]
  [field: string]: unknown
}

/** An item is a directory: `README.md` (prose), `meta.json` (fields), `attachments/`. */
export interface Item {
  type: string
  slug: string
  dir: string
  meta: Meta
}

export type StatusCategory = "open" | "done"

export interface StatusDef {
  category: StatusCategory
  /** A status that counts as evidence for whatever this item `verifies`: the flag `proves`, said as a key. */
  proves?: boolean
  /** A status that counts as evidence against it — a failed test, a violated property: it blocks a gate and a close. The flag `refutes`, said as a key. */
  refutes?: boolean
  /**
   * Plain tags on the status, open-ended: any plugin may give one meaning and
   * any plugin may read it (`hasFlag`). `proves` and `refutes` are two, which
   * the keys above say too.
   */
  flags?: string[]
  says: string
}

export interface TypeDef {
  id: string
  /** Directory under the tracker root that holds this type's items. */
  dir: string
  title: string
  says: string
  statuses: Record<string, StatusDef>
  initialStatus: string
  /** False for archives: items arrive by being moved, never by being opened. */
  creatable?: boolean
  /** The README a new item starts with. */
  template?: (title: string) => string
  /** Plain tags, no hierarchy: a field declared for a tag (`fixable`, say) applies to every type that carries it. */
  traits?: string[]
  /** The statuses each status may move to; a status it does not name may move to any. Absent: every move is allowed. */
  transitions?: Record<string, string[]>
}

export type FieldKind = "string" | "strings" | "date" | "enum" | "boolean" | "number" | "object"

export interface FieldDef {
  name: string
  kind: FieldKind
  says: string
  /**
   * Value -> meaning. For `enum`, the fixed list: any other value is a
   * problem; declaration order is rank order. For `string` and `strings`, an
   * open list: a value off it is a note, never refused.
   */
  values?: Record<string, string>
  /** A value's title, where one was declared: value -> title. */
  titles?: Record<string, string>
  /** Type ids the field belongs to. With `traits`, the field belongs to both; with neither, to every type. */
  appliesTo?: string[]
  /** Traits the field belongs to: every type carrying one of them, whoever declares the type. */
  traits?: string[]
  /** Its enum `values` come from the project's configuration, not the program: the program's reference does not list them. */
  configured?: boolean
  /** For `enum`: its values are the names of every contribution to this extension point (`gates`, say), each meaning its title or says. */
  valuesFrom?: string
  /** For `enum`: an item may hold several of its values — one as a string, several as a list. */
  multiple?: boolean
  /**
   * A record Naima fills when it writes something else, never a value anyone sets: the signature of a signed write,
   * the record of an attachment. A change of an item confined to such fields is bookkeeping of an addition, which
   * the trunk guard takes on the trunk with it.
   */
  filled?: boolean
}

/**
 * An additive change to another plugin's type or field — never a
 * redefinition of what it is. On a type: new statuses (an existing one only
 * with the category it has), traits, allowed transitions. On a field: new enum
 * values, and more types or traits it applies to.
 */
export interface Extension {
  /** The type it extends: a short name or a qualified id. */
  type?: string
  /** The field it extends: a short name or a qualified id. */
  field?: string
  statuses?: Record<string, StatusDef>
  traits?: string[]
  transitions?: Record<string, string[]>
  /** New values of an enum, or of a string field's open list: value -> what it means, or { title, says }. */
  values?: Record<string, string | ValueDef>
  appliesTo?: string[]
}

/** One value of a field's list: a title to show, and what it means. */
export interface ValueDef {
  title?: string
  says: string
}

export interface RelationDef {
  name: string
  inverse: string
  says: string
}

export interface Finding {
  level: "problem" | "note"
  message: string
  item?: Item
  /** What the finding is about, named so a waiver can name it too (`naima waive <check> <subject>`): a check that sets it lets its finding be waived. */
  subject?: string
}

/** What `naima check` is asked for, beyond the tracker itself. */
export interface CheckOptions {
  /** Report every worktree's state as the coordinator sees it, not only this one's: a sibling's missing claim is a problem too, not only a note. */
  allWorktrees?: boolean
  /** Only checks that read the change staged for the next commit (`check.staged === true`): what a pre-commit hook runs. */
  staged?: boolean
}

export interface Check {
  name: string
  says: string
  /** May be async: a check that runs an external tool awaits it. */
  run(ctx: Context, options?: CheckOptions): Finding[] | Promise<Finding[]>
  /** True for a check that reads only the change staged for the next commit: `naima check --staged`, what a pre-commit hook runs, runs these alone. */
  staged?: boolean
  /** The external programs the check starts besides git, which the launcher grants (`naima runs` lists them). */
  runs?: string[]
}

/** One documented option: a command's `--flag`, or a plugin's configuration key. */
export interface OptionDoc {
  /** `--flag` for a command; the key under `options` for a plugin. */
  name: string
  says: string
  /** The value used when the option is absent, as written in the config or on the command line. */
  default?: string
}

export interface Command {
  name: string
  says: string
  usage: string
  /** Every `--flag` the usage names. */
  options?: OptionDoc[]
  /** Complete invocations, without the leading `naima`. */
  examples?: string[]
  /** The policy or invariant the command enforces, and how; one that enforces none says `nothing` and what it does instead. */
  enforces?: string
  /**
   * For a command whose work can last more than a few seconds: how it reports its progress, or why it cannot and
   * what it reports instead (rule long-work/long-work-reports-progress, checked by `progress-declared`).
   */
  long?: { reports: string } | { cannot: string; instead: string }
  /**
   * True for a command a git hook runs, which only reads: no tick beside it and no question to GitHub about the
   * tracker's privacy, so a commit waits for nothing else; every write it tries is refused.
   */
  hook?: boolean
  /** True for a command still provisional: it runs when called, but `naima --help` and the reference do not list it. */
  hidden?: boolean
  /** The external programs the command starts besides git, which the launcher grants (`naima runs` lists them). */
  runs?: string[]
  run(args: string[], ctx: Context): number | Promise<number>
}

/**
 * What a view or a summary section renders: its data, once, and how that data
 * reads — as lines of text, and optionally as markdown. `naima view --json`
 * and `naima summary --json` print the data itself, so no renderer derives it
 * again. `rendered(data, text, markdown?)` makes one.
 */
export interface Rendered<D = unknown> {
  readonly data: D
  text(): string[]
  markdown?(): string[]
}

/** A named rendering of derived state, printed by `naima view <name>`. May be async. */
export interface View {
  name: string
  says: string
  render(args: string[], ctx: Context): Rendered | Promise<Rendered>
}

/** A block of `naima summary`. May be async; one with nothing to say renders no lines. */
export interface SummarySection {
  name: string
  /** True for a block also printed at the foot of `naima board` and `naima queue`, beside the work: the evidence the items stand on. */
  alongside?: boolean
  /** True for a block also printed by `naima hello`, at the start of a session: what waits on the owner's decision, such as a long run that is due. */
  hello?: boolean
  /** Where the project is going, in two or three lines, as `naima hello` says it after the update check and before what waits on the owner: the next goal and the next release, each with its status. A block with nothing to say renders no lines. */
  goals?(ctx: Context): Rendered | Promise<Rendered>
  /** What the agent can do on request, a line each, as `naima hello` says it among its offers, after what waits on the owner: such as generating code from a model the project has. A block with nothing to offer renders no lines. */
  offers?(ctx: Context): Rendered | Promise<Rendered>
  render(ctx: Context): Rendered | Promise<Rendered>
}

/** A block `naima guide` prints first, inside a project, before the documentation pages: what an agent reads before anything else. May be async; one with nothing to say renders no lines. */
export interface GuideSection {
  name: string
  says: string
  render(ctx: Context): Rendered | Promise<Rendered>
  /** Whether a sub-agent is given this section as it starts (naima subagent --hook), such as the project's rules for agents. */
  subagents?: boolean
}

/**
 * A job the tick runs when it is due (core/tick.ts): once per slot — the hour or the day — whichever naima process
 * wins it, retried after a failure, its notices shown to the owner as messages. Nothing it does may need the owner:
 * it finds, and says; it never starts long work nor applies a change.
 */
export interface TickJob {
  /** Lower case, digits and dashes: the folder its state is kept in. */
  name: string
  says: string
  every: "hour" | "day"
  /** Its run is ended after this long, and counts as failed. Default 30 s. */
  timeoutMs?: number
  /** After a failed run, the next is due this much later. Default an hour. */
  retryAfterMs?: number
  /** A failing streak this many days long raises an urgent message: the one `escalation` says. */
  escalateAfterDays?: number
  escalation?(since: string): { title: string; text: string }
  run(ctx: Context, signal: AbortSignal): Promise<JobOutcome> | JobOutcome
}

/** One additive term of an item's urgency. Lower is more urgent. */
export interface RankTerm {
  name: string
  score(item: Item, ctx: Context): number
  /**
   * For a term named after an enum field: the value of that field that makes an item as urgent as the project's
   * schema allows. What the core sets on an item it files as urgent (the sweep todo of an exposed tracker).
   */
  urgent?: string
}

/**
 * A kind of contribution, declared as data: the core declares its own —
 * types, fields, relations, directories, checks, commands, views, summary
 * sections, rank terms, migrations — and any plugin may declare one more the
 * same way, which every plugin can then contribute to.
 */
// deno-lint-ignore no-explicit-any
export interface ExtensionPoint<T = any> {
  /** The key contributions go under, in a manifest's `contributes`; also the kind of their qualified ids, and of `rename`. */
  id: string
  says: string
  /** One contribution, in words: "gate", "verifier". */
  noun: string
  /** The name a contribution goes by within the point. */
  key(c: T): string
  /** Its names are written into the data: two contributions may not share one, and a project renames one of them instead. */
  stored?: boolean
  /** A copy of `c` going by `name`, for a rename; without it the point's contributions cannot be renamed. */
  renamed?(c: T, name: string): T
  /** Why a contribution is not one, or null: checked when the project loads, so a malformed one never runs. */
  validate?(c: unknown): string | null
  /** What a contribution lacks of its documentation, each said after its name: the `docs` plugin's `documented` check reports them. */
  gaps?(c: T): string[]
  /** The attribution of something from outside Naima a contribution stands for (a tool it installs, say): `naima credits` prints it. Provisional. */
  credit?(c: T): Partial<Attribution>
  /** True for a contribution the project's configuration makes, not the program: the program's reference leaves it out. */
  configured?(c: T): boolean
  /** The reference's markdown for one plugin's contributions to this point, those the configuration makes left out. */
  document?(cs: readonly T[], plugin: string): string[]
  /**
   * The contributions a folder of files holds, for a plugin that names one under `contributes` instead of listing them:
   * `dir` is the folder's absolute path, `settings` what the plugin says its files may depend on. Throws, saying which
   * file and why, when one is not a contribution.
   */
  fromFolder?(dir: string, settings: Readonly<Record<string, string>>): T[]
}

/** A plugin's contributions to a point, kept as files in a folder: its path relative to the plugin's `home`, and the settings the files may depend on. */
export interface FolderContribution {
  folder: string
  settings?: Readonly<Record<string, string>>
}

/**
 * One write of one item, as the write hooks see it (docs/reference/plugin-contract.md#write-hooks).
 * `create` opens an item, `update` rewrites its fields, `move` archives or moves it to another type's directory.
 */
export interface Write {
  kind: "create" | "update" | "move"
  /**
   * The item as it is about to be written. A `beforeWrite` hook may change its `meta`; what it leaves is what is written.
   * On a create its directory does not exist yet, and its slug is the one asked for.
   */
  item: Item
  /** Its fields as they are on disk; null for a create, or for an item whose meta.json is unreadable. */
  before: Meta | null
  /** For a move: the type it moves to. */
  to?: TypeDef
  /**
   * For a write of an item's prose (saveProse: naima note, naima describe): the README as it is about to be written.
   * A `beforeWrite` hook may change it; what it leaves is what is written. Absent on every other write.
   */
  prose?: string
  /** The command's `--force`: whoever gave it takes on what a hook would otherwise refuse. A hook decides whether it lets it through. */
  force: boolean
  /**
   * The write carries text its writer authored on the command line — a title, a description, a note, a free-text field
   * (naima new, describe, note, set) — rather than a record Naima fills or generates: what a no-leaks signature covers.
   */
  authored?: boolean
  /** For a create: who asked for the item, who files it and what it comes from, as `naima new` was told (core/origin.ts). */
  origin?: OriginRequest
}

/** What a create is told of its origin; the core's hook `origin-once` fills the rest (core/origin.ts). */
export interface OriginRequest {
  /** The role that asked: owner, coordinator, worker, agent, person or unknown; absent, agent. */
  askedBy?: string
  /** The name of the person who asked, when askedBy is person. */
  person?: string
  /** Who files it; absent, git's user.name. */
  by?: string
  /** The id of the item it was derived from. */
  from?: string
}

/**
 * A write of free text or a file that is not an item's: a session note, an event, an attachment. A hook's
 * `beforeText` may refuse it, or add to `record` what the writer stores with it (a session note's front matter, an
 * attachment's record).
 */
export interface TextWrite {
  /** What is written, as a refusal names it: "the session note", "attachment proof.out". */
  what: string
  record: Record<string, unknown>
}

/**
 * What a plugin puts in place in the project's clone where it is missing (a git hook, a file), run by `naima init`
 * and `naima update` after their own work. `install` returns what it did, a line each, said to whoever ran it.
 */
export interface Setup {
  name: string
  says: string
  install(ctx: Context): string[] | Promise<string[]>
}

/**
 * A hook a plugin asks the agent tool to run, which Naima installs in the tool's settings beside its own hooks at
 * `naima init`, `naima update` and `naima stance adopt`, and removes once the plugin is gone (core/plugin-hooks.ts).
 * It runs a naima command: Naima writes the line that starts it through the project's launcher.
 */
export interface AgentHookContribution {
  name: string
  says: string
  /** The agent tool whose terms `event` and `matcher` are in, by adapter id, as naima.json's `agents` names it. */
  tool: string
  /** The tool's event: `PostToolUse`, say. */
  event: string
  /** Which occasions of the event it runs on, in the tool's own syntax: `Edit|Write`, say; every one when absent. */
  matcher?: string
  /** The naima command it runs, as words after `naima`: `["stance-ui", "hook"]`. */
  command: string[]
}

/** A hook on every item write the core's helpers make, run in plugin load order. */
export interface WriteHook {
  name: string
  says: string
  /**
   * Before anything is on disk. Return a refusal — a sentence saying what to do instead — to stop the write, or
   * nothing to let it through; it may change `write.item.meta`. The first refusal stops the write and every later hook.
   */
  beforeWrite?(write: Write, ctx: Context): string | undefined | void
  /** After the write, with the item as written (for a move, where it now is). */
  afterWrite?(write: Write, ctx: Context): void
  /** Before a write of free text or a file that is not an item's (TextWrite): refuse it as `beforeWrite` does, or add to its `record`. */
  beforeText?(text: TextWrite, ctx: Context): string | undefined | void
}

/** What a plugin declares. Every contribution is optional. */
export interface Plugin {
  name: string
  says: string
  /** The contract it is written for (`CONTRACT` in core/api.ts). Absent: contract 1, the shape before it was said. */
  contract?: number
  /** Longer documentation, in markdown: the concepts a reader needs before the reference. */
  about?: string
  /** What kind of plugin it is, when it is more than a plugin: `"stance"` for a stance, which `naima stance adopt` adopts (docs/guide/stances.md). */
  kind?: "stance"
  /** For a stance: example projects or files it ships, as paths inside its repository, which `naima stance examples` lists. */
  examples?: string[]
  /** The keys the plugin reads from its `options`, each with the default it infers. */
  options?: OptionDoc[]
  types?: TypeDef[]
  fields?: FieldDef[]
  relations?: RelationDef[]
  /** Directories under the tracker root the plugin owns that are not item types. */
  dirs?: string[]
  checks?: Check[]
  commands?: Command[]
  views?: View[]
  summary?: SummarySection[]
  /** Blocks `naima guide` prints first, inside a project. */
  guide?: GuideSection[]
  rank?: RankTerm[]
  /** Jobs the tick runs when they are due. */
  jobs?: TickJob[]
  /** Hooks on every item write, in load order. */
  hooks?: WriteHook[]
  /** What it puts in place in a clone where missing, run by `naima init` and `naima update`. */
  setup?: Setup[]
  /** Additive changes to other plugins' types and fields. */
  extends?: Extension[]
  /** Its own data migrations, in order from its format 1: its format is 1 + their number (docs/reference/format.md#migrations). */
  migrations?: Migration[]
  /** Extension points it declares: new kinds of contribution any plugin can make. */
  points?: ExtensionPoint[]
  /**
   * Contributions to any point, by point id. A typed key above is the same as its point's entry here. To a point that reads
   * files (`fromFolder`), a plugin may name a folder instead, relative to its `home`: `"rules/"`, or `{ folder, settings }`.
   */
  contributes?: Record<string, readonly unknown[] | string | FolderContribution>
  /**
   * Where the plugin is, as a file URL, normally its module's `import.meta.url`: a folder it names under `contributes` is
   * read relative to it. The loader sets it to the module's own file for a plugin loaded from a source that leaves it out.
   */
  home?: string
  /** Points it contributes to only when a loaded plugin declares them: without one, those contributions are dropped rather than refused. */
  optional?: string[]
  /**
   * What it reads that another plugin declares, by point id: `{ fields: ["fixedOn"], relations: ["verifies"] }`.
   * Each name must resolve when the project loads, or loading fails naming it — so replacing or switching off the
   * plugin that declares it is an error, never a silent no-op.
   */
  uses?: Record<string, readonly string[]>
  /** Who made the plugin, where it is published, its licence and version: what `naima credits` prints. A plugin from outside Naima declares it; a first-party plugin is credited as Naima. Provisional. */
  attribution?: Attribution
  /** What the plugin runs or builds on without installing it (a program found on PATH, say): one attribution each, printed by `naima credits`. Provisional. */
  credits?: Attribution[]
}

/**
 * The standard credit for something Naima uses from outside: a tool, a stance, an external plugin. Provisional
 * (decisions in Naima's tracker: discussions/attribution-what-owner-means-by-what-naima).
 */
export interface Attribution {
  /** What it is called, as its authors call it. */
  name: string
  /** Its home page. */
  homepage: string
  /** Where its source is published. */
  source: string
  /** Its authors, by name when they are few, otherwise the team or organisation that makes it. */
  authors: string[]
  /** Its licence: an SPDX identifier, with a sentence when it bundles others. */
  license: string
  /** The version Naima uses. */
  version: string
}

type Json = Record<string, unknown>

/** One step of a data format: the core's, or one plugin's own. Pure, deterministic, forward only. */
export interface Migration {
  /** The format it reads; it writes `from + 1`. */
  from: number
  says: string
  /** The new naima.json from the old one, without `format` or `formats`. Pure. */
  config?(raw: Json): Json
  /** The new meta.json of one item from the old one. Pure. */
  item?(meta: Json): Json
  /** True when an item still has the shape this migration replaces: `check` reports it. */
  stale?(meta: Json): boolean
}

export type PluginOptions = Record<string, unknown>
/** What a plugin's factory is told of the project it runs in: the name the project gives it, and the names its contributions go by. */
export interface PluginScope {
  readonly plugin: string
  /**
   * The short name this plugin's contribution of `kind`, declared as
   * `declared`, goes by: the project's rename of it, else `declared`. A plugin
   * whose names may be renamed reads its own fields, types and relations by
   * these names, never by the literal it declared.
   */
  name(kind: string, declared: string): string
}

/** A plugin module's default export: its manifest, made from the options the project gives it and the API the core hands it. */
export type PluginFactory = (options: PluginOptions, api: PluginApi) => Plugin

/** A first-party plugin: its name and its factory, loaded unless the project switches it off or replaces it. */
export interface FirstParty {
  name: string
  factory: PluginFactory
  /** Loaded only when the project's plugins table has an entry for it: a plugin that starts a program is not granted one by default. */
  optIn?: boolean
}

/** How much a check's finding weighs in this project: off, a note, or a problem that fails `naima check`. */
export type Severity = "off" | "note" | "problem"

/**
 * Where a plugin's code is, pinned: a path inside the program (locked with
 * it); a file of the project, pinned by its sha256; or a module of a git
 * repository, pinned by commit and fetched into the tracker folder.
 */
export type PluginSource = string | { path: string; sha256: string } | { git: string; commit: string; path: string }

/** One entry of naima.json's `plugins` table: how the project configures the plugin of that name. */
export interface PluginConfig {
  /** False switches the plugin off: it is not loaded. */
  enabled: boolean
  /** The plugin's own options, as it documents them. */
  options: PluginOptions
  /** A third-party plugin's code. */
  source?: PluginSource
  /** A first-party plugin's replacement: the code that runs under its name instead. */
  replacedBy?: PluginSource
  /** The severity of the plugin's checks, by check name, as the project weighs them. */
  checks: Record<string, Severity>
}

/** `naima-data/naima.json`: the data format, the lock, and only what the tool cannot infer. */
export interface Config {
  /** The data format (docs/reference/format.md). */
  format: number
  /** Each plugin's own data format, by plugin name; a plugin absent from it is at format 1. */
  formats: Record<string, number>
  /** The git URL (or path) of the Naima this project runs: Naima's own, or a fork. */
  source: string
  /** The commit of `source` this project runs: the lock. */
  commit: string
  /** The release of `source` the commit is, when the project runs one: its version, without the v. */
  version?: string
  /** The SHA-256 of that release's archive, as installed: what a later download of it must match. */
  sha256?: string
  /** `"signed"`: run a locked commit only when git verifies its signature. Absent: no signature is asked for. */
  verify?: "signed"
  /** The program directory, relative to the data directory. */
  program: string
  /** Every plugin the project configures, first-party or third-party, by name. A first-party plugin it does not name is loaded as it is. */
  plugins: Record<string, PluginConfig>
  /** The project's renames: kind → qualified id → the short name that contribution goes by, for names two plugins would both store. */
  rename: Record<string, Record<string, string>>
  /** The project's own additive changes to the loaded plugins' types and fields. */
  extends: Extension[]
  /** The agent-harness entry files `check` and `init` act on, project-root relative. Absent: sensible defaults (`DEFAULT_ENTRY_FILES`). */
  entryFiles: string[]
  /** The agent tools the project uses, by adapter id, whose session-start hooks init and update install. Absent: those whose files the project holds, and the one Naima runs inside. */
  agents?: string[]
  /** What a session start (`naima hello`) does about a newer Naima: off, check (the default) or update. */
  updates: "off" | "check" | "update"
}

/** One contribution as the registry holds it: whose it is, the name it goes by, and its qualified id. */
export interface Contribution<T = unknown> {
  /** `<plugin>/<declared name>`: unique among its kind, whatever other plugins declare. */
  readonly id: string
  /** The short name it goes by: its declared name, or the project's rename of it. */
  readonly name: string
  readonly plugin: string
  readonly value: T
}

/**
 * Every loaded contribution, merged. Read-only: frozen once built, so no
 * plugin can change another's. A kind whose names are stored in the data is a
 * map by name; commands and views, which only run, may share a short name,
 * and are then keyed by qualified id — `find` takes either.
 */
export interface Registry {
  readonly plugins: readonly Plugin[]
  readonly types: ReadonlyMap<string, TypeDef>
  readonly fields: ReadonlyMap<string, FieldDef>
  readonly relations: ReadonlyMap<string, RelationDef>
  readonly dirs: ReadonlySet<string>
  readonly checks: readonly Check[]
  /** By the name it is invoked by: its short name, or its qualified id while another plugin's command shares the short name. */
  readonly commands: ReadonlyMap<string, Command>
  /** By the name it is invoked by, as commands are. */
  readonly views: ReadonlyMap<string, View>
  readonly summary: readonly SummarySection[]
  readonly rank: readonly RankTerm[]
  /** Every plugin's write hooks, in load order. */
  readonly hooks: readonly WriteHook[]
  /** Every extension point, the core's and the plugins', by id, in the order the reference documents them. */
  readonly points: ReadonlyMap<string, ExtensionPoint>
  /** Every contribution of a kind (`types`, `fields`, `commands`, …), in load order, with its qualified id. */
  contributions(kind: string): readonly Contribution[]
  /** The contribution of `kind` that `ref` names — its qualified id, or its short name while no other shares it; undefined when none does. Throws when `ref` is ambiguous, naming each qualified id. */
  find<T = unknown>(kind: string, ref: string): Contribution<T> | undefined
}

export interface Repo {
  /** Every readable item: a meta.json that is a JSON object whose id, title and status are strings. */
  items: Item[]
  /** Items that could not be read, as findings. */
  unreadable: Finding[]
  byId: Map<string, Item>
  /** Find one item by id, `type/slug`, slug, or a unique slug fragment. Throws when none or several match. */
  resolve(ref: string): Item
  /** Stored links plus the inverses of links pointing here. */
  linksOf(item: Item): ResolvedLink[]
}

export interface Context {
  /** Absolute project root: the git repository that holds the data. */
  root: string
  /** Absolute data directory: `<root>/naima-tracker/naima-data` unless moved. */
  trackerRoot: string
  /** The data directory from the project root, with forward slashes: what paths are printed from. */
  trackerDir: string
  /**
   * Absolute top of the git repository that holds the data: `root` when the tracker is committed with the code, the
   * data directory itself when it is a repository of its own (sibling mode). Every git call about tracker files goes here.
   */
  trackerGit: string
  /** The data directory from `trackerGit`, with forward slashes: `trackerDir` with one repository, empty in sibling mode. */
  trackerPrefix: string
  /** The tracker is a repository of its own beside the code's: its commits pair with the code's by trailers and branch names. */
  sibling: boolean
  /** Absolute program directory: the Naima that runs. Never part of the project's own files. */
  program: string
  /** Frozen, like the registry. */
  readonly config: Config
  readonly registry: Registry
  /** The items, read on first access, again after any write through the core's helpers, and after `reload()`. */
  readonly repo: Repo
  /** Forget the items read, for a change made on disk without the helpers (by hand, by git). */
  reload(): void
  out(line?: string): void
  err(line: string): void
  now(): Date
  /**
   * The reason given with `--allow-private` for this command: a write holding private infrastructure goes through and
   * the reason is recorded; without it such a write is refused (core/private.ts).
   */
  allowPrivate?: string
  /**
   * The path given with `--revised` for this command: the no-leaks checklist the writer signs to have followed before
   * a write of free text or a file (the privacy plugin's hook `signed-writes`).
   */
  revised?: string
}
