# Plugin contract

The interfaces are in [`src/core/types.ts`](../../src/core/types.ts); what a
plugin may call is [`src/core/api.ts`](../../src/core/api.ts). This page says
what each part is for.

## Shape

```ts
import type { Plugin, PluginApi } from "../src/core/api.ts"   // types only: erased when it runs

export default function myPlugin(options: Record<string, unknown>, api: PluginApi): Plugin {
  return { name: api.plugin, says: "one line", contract: api.contract, /* contributions */ }
}
```

A plugin module's default export is a **factory**: it takes the options the
project gives it and the **plugin API**, and returns the manifest. The API is
every function of `core/api.ts` — `createItem`, `saveMeta`, `fieldValue`,
`linked`, `runChecks`, … — frozen, with the plugin's own scope: `api.plugin`,
the name the project gives it, and `api.name(point, declared)`, the name its
own contribution goes by after a [rename](#names). A plugin that uses only
what it is handed imports nothing of the core, so it runs wherever it lives.
A plugin inside the program may import `core/api.ts` instead; nothing may
import `core/internal.ts`, which holds what only the entry point, the loader
and the tests use (opening a project, composing plugins, the registry,
migrations) — `test/arch.test.ts` fails on a plugin that does.

The first-party plugins are loaded unless the project switches one off or
replaces it. A third-party plugin is added under `plugins` in `naima.json`,
with optional `options`; a first-party plugin takes its options, and its
replacement, the same way ([configuration](../guide/config.md#the-plugins-table)):

```json
{ "plugins": { "mine": { "source": "plugins/mine.ts", "options": {} }, "docs": { "options": { "reference": "docs/reference.md" } } } }
```

A plugin is registered under the name its entry has. The factory is called
with the entry's `options`; a plugin that carries migrations must accept the
options as they stand before its own migrations run, since it is loaded then
to collect them.

### Where a plugin's code is

A `source` (or a `replacedBy`) is pinned, so what runs is what the project
reviewed:

| Source | Pinned by |
|---|---|
| `"plugins/mine.ts"` | a path inside the program, locked with it: a fork of Naima that carries the plugin |
| `{ "path": "tools/mine.mjs", "sha256": "…" }` | a file of the project, and its sha256: a changed file is refused, naming its new hash, until the pin is updated |
| `{ "git": "https://…", "commit": "…", "path": "index.mjs" }` | a module of a git repository, and the full commit: fetched once into `naima-tracker/plugins/<name>/`, which `naima-tracker/.gitignore` ignores; a checkout with local changes is refused |

The pin covers the module it names: a plugin pinned by its sha256 is one
self-contained file, since what it imports is not pinned with it; one pinned
by commit may import anything in its repository.

### The contract version

A manifest says the contract it is written for: `contract`, the `CONTRACT`
of `core/api.ts` it was built against — this core speaks **2**. A plugin
written for a newer contract is refused when the project loads, naming both
versions, instead of running against an API it does not know. One that says
none is read as contract 1, the shape before `contract` existed, and keeps
working: its top-level `gates` or `verifiers` are contributions to those
points as any top-level key named after a point is, and a view or summary
section that returns plain lines is read as text whose data is those lines
([views and summaries](#views-and-summaries)).

### What a plugin can and cannot do

The registry and the configuration are frozen once the project is loaded,
and so is every manifest, with everything it holds: a plugin reads another's
contributions and cannot change or remove them. The API holds nothing that
opens a project, loads code, migrates data or moves the program. This is an
interface boundary, not a sandbox: a plugin is code in the same process, and
the launcher's permissions (read the project, write the tracker folder, run
`git` and the programs contributions declare) are what fence the process.
A plugin from outside the program is trusted because the project pinned it.

## Contributions

Every kind of contribution is an **extension point**: the core declares its
own, a plugin may declare more, and any plugin contributes to any point that
some loaded plugin declares. A contribution goes under the point's id in
`contributes`; for the core's points, the same key at the top of the manifest
says the same thing and is typed.

| Part | What it declares |
|---|---|
| `says` | one line: what the plugin is (required) |
| `about` | longer markdown: the concepts a reader needs before the reference |
| `options` | the keys the plugin reads from its `options`: `name`, `says`, `default` (a first-party plugin infers each default from the repository) |
| `points` | extension points it declares ([below](#extension-points)) |
| `contributes` | contributions to any point, by point id: `{ "gates": [...] }` |
| `optional` | points it contributes to only when some loaded plugin declares them; without one those contributions are dropped instead of refused |
| `uses` | what it reads that another plugin declares, by point: `{ fields: ["fixedOn"], relations: ["verifies"] }` ([below](#cooperation-without-imports)) |

The core's points, each also a typed key of the manifest:

| Point | What a contribution is |
|---|---|
| `commands` | `naima <name>`: `says`, `usage`, `options` (one per `--flag` in the usage), `examples` (invocations without the leading `naima`); optional and recommended, `enforces`: the policy or invariant it holds, or `nothing:` and what it does instead — a command without it is a note in `naima check`, never a problem; `run(args, ctx)` returns an exit code (may be async) |
| `types` | item types: `id`, `dir`, `statuses` (each `open` or `done`, with open-ended `flags`; `proves` — evidence for what the item verifies — and `refutes` — evidence against it, which blocks a gate and a close — are two, also said as keys), `initialStatus`, a README `template`, `creatable: false` for archives, plain `traits`, an optional `transitions` map ([extending](#extending-another-plugins-types-and-fields)) |
| `fields` | fields with a kind (`string`, `strings`, `date`, `enum`, `boolean`, `number`, `object`), enum values in rank order — or `valuesFrom` a point, and `multiple` for several — and the types they apply to, by name (`appliesTo`) or by trait (`traits`); `configured: true` when the values come from the project's configuration, so the program's reference does not list them |
| `extends` | additive changes to another plugin's types and fields ([extending](#extending-another-plugins-types-and-fields)) |
| `relations` | link relations; each names its inverse, which must also be declared |
| `checks` | `run(ctx) → Finding[]`, or a promise of them; `problem` fails `naima check`, `note` does not; the project may weigh each one `off`, `note` or `problem` ([check severity](../guide/config.md#check-severity)); `staged: true` for one that reads only the change staged for the next commit, which `naima check --staged` — what the pre-commit hook runs — runs alone ([commit hooks](../guide/commit-hooks.md)) |
| `views` | `naima view <name>`: a named rendering of derived state, `render(args, ctx) → { data, text() }` ([below](#views-and-summaries)) |
| `dirs` | directories under the tracker root the plugin owns that are not item types |
| `summary` | a block of `naima summary`, `render(ctx) → { data, text() }` |
| `rank` | an additive urgency term; lower is more urgent |
| `hooks` | [write hooks](#write-hooks): `beforeWrite(write, ctx)`, which may change what is written or refuse it, and `afterWrite(write, ctx)`, on every item write |
| `migrations` | its own data migrations, in order from its format 1: `from`, `says`, and pure `config(raw)`, `item(meta)`, `stale(meta)`; its format is 1 + their number ([migrations](format.md#migrations)) |

First-party plugins declare two more: the `gates` plugin declares `gates` (a
named condition: `title`, `says`, `decides`, `evaluate(ctx) → { holds,
blocking, owed }`), the `verifier` plugin `verifiers`
([below](#the-verifier-contract)). The [reference](reference.md#extension-points)
lists every point with who declares it and who contributes to it.

A contribution to a point no loaded plugin declares, and any manifest key the
contract does not know, is refused when the project loads: a misspelt key is
never silently ignored.

## Extension points

A point is data: an `ExtensionPoint` in [`src/core/types.ts`](../../src/core/types.ts).

```ts
const notifiersPoint: ExtensionPoint<Notifier> = {
  id: "notifiers",                       // the key under contributes, and the kind of qualified ids
  says: "somewhere to send a message",
  noun: "notifier",                      // one contribution, in words
  key: (n) => n.name,                    // the name a contribution goes by
  stored: false,                         // true when its names are written into the data
  renamed: (n, name) => ({ ...n, name }),     // a copy under a project's rename
  validate: (v) => typeof (v as Notifier)?.notify === "function" ? null : "has no notify function",
  gaps: (n) => n.says ? [] : ["does not say where it sends"],   // what the docs check reports
  document: (ns) => ns.map((n) => `- ${n.name}: ${n.says}`),    // its lines in the reference
}

export default (): Plugin => ({ name: "notify", says: "…", points: [notifiersPoint], commands: [/* reads ctx.registry.contributions("notifiers") */] })
// and in any other plugin:
export default (): Plugin => ({ name: "chat", says: "…", contributes: { notifiers: [{ name: "room", says: "the team room", notify: (m) => … }] } })
```

A point's contributions are read with `ctx.registry.contributions(id)` —
each with its qualified id, the name it goes by, and whose it is — and one by
name with `ctx.registry.find(id, ref)`. A contribution `validate` refuses is
refused when the project loads; `configured(c)` marks one the project's
configuration makes, which the program's reference leaves out. The core's own
points are declared exactly this way (`src/core/points.ts`): adding a kind
of contribution never takes a change to the core. The on-disk layout is not
a point: `<type>/<slug>/{README.md,meta.json,attachments/}` is the
compatibility boundary between forks ([the format](format.md)).

## Extending another plugin's types and fields

Data only: no type derives from another, and nothing is overridden. Three
mechanisms, used together:

- **Traits.** A type carries plain tags, `traits: ["fixable"]`, and a field
  declared with `traits: ["fixable"]` applies to every type that carries one,
  whoever declares it. `fixedOn` applies to every `fixable` type: the
  `trackers` plugin's bugs, todos, features and archive, and a third-party
  `incidents` type that says it is fixable. `appliesTo` still names types
  exactly; a field with both applies to both. The core reads one trait
  itself: `naima update` files what the new Naima's check finds and it could
  not fix in the first creatable type that carries `follow-up` — the
  `trackers` plugin's todos.
- **Extensions.** A plugin — or the project, under `extends` in
  [`naima.json`](format.md#naimajson) — adds to a type it does not own:
  statuses, traits, transitions; or to a field: enum values, the open list of
  values of a `string` or `strings` field, more types or traits it applies to.
  A value is what it means, or `{ title, says }`. It never redefines: a status it names that exists
  keeps its category (open stays open), its flags only grow, and a field
  keeps its kind. Refused otherwise, when the project loads.

  ```ts
  extends: [
    { type: "bugs", statuses: { blocked: { category: "open", flags: ["waiting"], says: "waiting on another team" } } },
    { field: "runBy", values: { pager: "settled by whoever holds the pager" }, appliesTo: ["incidents"] },
  ]
  ```
- **Flags and transitions.** A status's `flags` are open-ended tags any
  plugin may give meaning to and any plugin may read (`hasFlag(ctx, item,
  "waiting")`); `proves` and `refutes` are the two the first-party plugins
  read. A type's optional `transitions` maps a status to those it may move
  to; a status it does not name moves to any. The core's `status-moves` write
  hook holds it on every write, and a forced write takes the move on.

A field whose enum values are the names of a point's contributions says
`valuesFrom`: the `gate` field takes its values from every gate contributed
to the `gates` point, and with `multiple: true` an item may hold one value as
a string or several as a list (`naima set <item> gate=v1,v2`).

An enum's values are a fixed list: any other value fails the `fields`
check. A `string` or `strings` field with values — `area` and `kind`, once
a project or a plugin lists them — has an open list: a value off it is a note
from the core's `values` check, naming the items that hold it, and nothing is
refused or rewritten. `naima types` prints every list with its counts.

## Views and summaries

A view and a summary section render their data once, and say how it reads:

```ts
const next: View = {
  name: "next",
  says: "open items, most urgent first",
  render: (args, ctx) => rendered(rowsOf(ctx), (rows) => rows.map(line), (rows) => table(rows)),
}
```

`rendered(data, text, markdown?)` makes the `{ data, text(), markdown?() }`
a renderer prints: `naima view <name>` and `naima summary` print the text,
`--json` the data itself, `--markdown` the markdown — the text, when the
rendering has none of its own. No format derives the data again.

A summary section marked `alongside: true` is also printed at the foot of
`naima board` and `naima queue`, and one marked `hello: true` is printed by
`naima hello`, its lines as they are, after the update check: what waits on
the owner's decision, such as a long run that is due. `naima hello` prints
nothing of a project that does not open.

**What may be async.** A check's `run`, a view's and a summary section's
`render`, a gate's `evaluate` and a command's `run` may return a promise; the
core awaits each, so a check that shells out to an external tool needs no
special case. A check that rejects is reported as a problem, as one that
throws is. A rank term is not async: it is summed while items are sorted.

## Names

Every contribution has a **qualified id**, `<plugin>/<name>` — `trackers/fixedOn`,
`triage/next` — unique among its kind whatever other plugins declare, and a
**short name** it goes by: the name it declares, or the one the project's
`rename` gives it. Stored data keeps short names: a `meta.json` holds
`fixedOn`, never `trackers/fixedOn`.

- **A name that only runs** — a command, a view, a check, a summary section,
  a rank term, a write hook — may be declared by several plugins. Each still runs, and
  `naima plugins` shows its qualified id; its short name stops resolving the
  moment a second plugin declares it, with an error naming both qualified ids
  (`naima ops/list`, `naima view ops/next`).
- **A name stored in the data** — a type (and its directory), a field, a
  relation, a directory, a gate, a verifier — cannot be declared twice, since
  both would be written under it. Loading refuses, naming both qualified ids
  and the rename that resolves it:

```json
{ "rename": { "fields": { "ops/priority": "severity" } } }
```

`rename` maps an extension point's id (`types`, `fields`, `relations`,
`dirs`, `gates`, `verifiers`, `commands`, `views`, `checks`, `summary`,
`rank`, `hooks`, or any point a plugin declares with `renamed`) to qualified
ids and the short name each goes by instead. A renamed type's directory
follows its new name, and a relation's inverse follows its relation. A plugin
reads its own names through the `scope` its factory receives —
`scope.name("fields", "priority")` is `severity` in the project above — so a
rename never hides its own data from it. The core and the first-party
plugins read their names as declared, so only a third-party plugin's
contributions can be renamed; a rename naming anything no loaded plugin
declares is refused.

A command named after one the entry point answers before any plugin loads
(`init`, `update`, `carry`, `guide`, `help`) is refused too: it could never
run.

**Documentation is part of the manifest.** Every `says`, every example and
every option entry is what `naima docs` turns into the reference, and with the
`docs` plugin loaded `naima check` fails on a contribution that lacks its own
([the rule](../guide/rules.md#features-are-documented-as-part-of-their-implementation)).

## The context

Every hook receives a `Context`: the project `root`, the data directory
`trackerRoot` and its path from the root `trackerDir`, the `program` directory
(never part of the project's files: pass it to `projectFiles`), the
`config`, the merged `registry`, the `repo` (items, `byId`, `resolve`,
`linksOf` with inverses), `reload()` for a change made on disk without the
helpers, `out`/`err`, and `now()`. Write through the public helpers
(`createItem`, `saveMeta`, `saveProse`, `setFields`, `addLink`, `moveItem`, `writeJson`,
`writeFileAtomic`) so that ids and validation stay consistent, every plugin's
[write hooks](#write-hooks) run, and no crash leaves a file half written. Read a field through
`fieldValue(item, { name: "fixedOn", kind: "date" } as const)`, typed by its
kind (and `setFieldValue` to change one): the project compiles with
`noPropertyAccessFromIndexSignature`, so `item.meta.fixdOn` is an error, not a
silent `undefined`. Every write through the helpers is seen by the next read
of `repo`, with no reload to remember. The `registry` and the
`config` are frozen once the project is loaded: a plugin reads another's
contributions and cannot change them.

## Exit codes

A command's `run` returns `0` when what it did or checked holds, `1` when it
does not (a check, a gate, a verdict), and throws to refuse. The entry point
adds the rest:

| Code | Meaning |
|---|---|
| `0` | done; what was checked holds |
| `1` | done; what was checked does not hold |
| `2` | refused: bad usage, or a state the user must change first — a plain `Error`, or a `NaimaError` whose `code` says which (`usageError(cmd)` gives one with `code: "usage"`) |
| `70` | internal error: the engine's own (a `TypeError`, …) or something thrown that is not an `Error` — a bug; `NAIMA_DEBUG=1` prints its stack |
| `75` | reserved: the program asks the launcher to run it again. A command that returns it is reported as `1`, so it never runs twice |

Render anything caught with `message(e)`, never `(e as Error).message`.

## Write hooks

Every item write the core's helpers make — `createItem`, `saveMeta`,
`saveProse`, `setFields`, `addLink`, `moveItem`, and so every command built on
them (`new`, `set`, `note`, `describe`, `link`, `unlink`, `close`, `verify`,
`triage`) — runs every plugin's
write hooks, in plugin load order:

```ts
hooks: [{
  name: "no-large-notes",
  says: "what it does, in one line: it is the reference",
  beforeWrite(write, ctx) {          // before anything is on disk
    if (write.item.meta["size"] === "L") return "large notes are not allowed — split it, or set size=S"
    write.item.meta["checkedOn"] = today(ctx)   // or change what is written
  },
  afterWrite(write, ctx) {},         // after it, with the item as written
}]
```

A `Write` is `{ kind, item, before, to?, prose?, force }`: `kind` is `create`,
`update` or `move`; `item` is the item as it is about to be written (on a
create its directory does not exist yet); `before` its fields as they are on
disk, `null` for a create; `to` the type a move goes to; `prose`, on an
`update` that `saveProse` makes, the page (`README.md`) about to be written,
which a hook may change or refuse — `splitProse` cuts it into title,
description and the Notes section, which the core's `notes-append-only` hook
keeps append-only; `force` the command's `--force`, which a hook may honour.

- **Order.** `beforeWrite` runs in load order, each hook seeing the changes
  of the hooks before it; then the write; then `afterWrite`, in the same
  order.
- **A refusal** is a returned string: a sentence saying what to do instead.
  The first one stops the write, and every later hook; nothing is on disk,
  and the helper throws a `NaimaError` (code `vetoed`, exit `2`) whose message
  is the sentence and the hook's name. A command that refuses leaves the item
  as it was in memory too.
- **A refusal with no sentence** — an empty or blank string — is a bug in the
  hook, reported as an internal error: a hook that vetoes says why.
- **Not item writes:** `writeJson` and `writeFileAtomic` on a plugin's own
  files (a claim, a run record, a session note), and the data migrations,
  which rewrite every item to a new format.

The first-party hooks — triage stamping `triagedOn`, a property reopening when
what it was verified on changes, `holds` written only by `naima verify`, and
no branch closing an item it claims — are listed in the
[reference](reference.md).

**A hook needs a check counterpart.** A hook runs only on writes the core's
helpers make; a hand edit of `meta.json`, or a directory moved by hand, never
meets it. A hook that protects a state of the tracker — not a move from one
state to another, and not a value it fills in — comes with a
check (a `checks` [contribution](#contributions)) that asserts the same state on the tracker as it is, so
`naima check` fails where the command would have refused:
`holds-only-by-verify` and `property-reopens-when-changed` with
`property-evidence`, `no-closing-own-claims` with `closed-not-claimed`, `epic-status` with `epics`.

## Cooperation without imports

Plugins do not import each other. They cooperate through what they declare:
the `trackers` plugin's `close` accepts any item whose status `proves`, so a
`verifier` property that holds closes a bug exactly as a passed test does, and
refuses on any whose status `refutes`, or that a check reports; the `gates`
plugin lists every gate contributed to its `gates` point, including the
verifier's `properties` gate (a contribution the verifier makes `optional`,
so it is dropped when no gates plugin is loaded); `triage` and `gates` each add a `rank` term and the core
sums them.

What one plugin reads of another's vocabulary it declares in `uses`, by
point: the `gates` plugin uses the fields `fixedOn`, `runBy` and
`humanBecause` and the relations `verifies` and `verified-by`; `beta-markers`
uses `closedFrom`; `docs` uses its feature types. Each name must resolve —
a short name, or a qualified id — when the project loads, or loading fails
naming it and who uses it: switching off or replacing the plugin that
declares it is a loud error, never a silently empty gate. `naima plugins`
and the reference list each plugin's uses.


## The verifier contract

A verifier is an adapter to a formal-methods tool (a model checker, a
theorem prover, a spatial logic checker), contributed to the `verifier`
plugin's `verifiers` point by any plugin — `contributes: { verifiers: [myChecker] }`:

```ts
const myChecker: Verifier = {
  id: "my-checker",
  says: "what it checks, in one line",
  async verify({ model, property, options }, ctx) {
    // model: absolute path of the model file; property: in the tool's own language;
    // options: the item's `verifierOptions` object.
    return { verdict: "holds", output: "…", /* counterexample: "…" */ }
  },
  // optional: every file a run reads, the model included, as absolute paths
  inputs: ({ model }, ctx) => [model, includedBy(model)],
  // optional: the tool's version
  version: async (ctx) => await toolVersion(),
}
```

**Inputs and version.** A tool that reads more than the model — an included
file, a library of definitions — declares it with `inputs`; one whose verdict
depends on its release declares `version`. `naima verify` records each input
with its sha256, the version, and one digest over all of them; `naima check`
asks the adapter again and reports a property that holds stale when an input
changed, the model reads other files, or the version moved. An input outside
the project is refused. Without `inputs`, the model alone is recorded.

| Verdict | Item status | Meaning |
|---|---|---|
| `holds` | `holds` (proves) | the property holds on this model |
| `violated` | `violated` | the tool found a counterexample; return it as `counterexample` |
| `error` | `error` | the tool could not run or reach a verdict |
| `unknown` | `error` | the tool ran and could not decide (a bound was hit) |

**Programs it starts.** A verifier that runs an external tool declares it:
`runs: ["mcrl22lps", "lps2pbes", "pbessolve", "lps2lts"]` — each a name looked up on
`PATH`, or an absolute path; one word, no comma. `runs` is not the verifier's
alone: a contribution to any point may declare the programs it starts, and
the core collects them from every point.
The launcher allows the program exactly the declared programs, besides
`git`: it asks the program about to run (`naima runs --json`, under read
permission only) when the project loads a third-party plugin or a
replacement, declares metrics, or switches on `verifier-mcrl2` or
`verifier-voxlogica` — first-party plugins that are off until `naima.json`
names them, since they start a model checker. Anything
undeclared fails with Deno's own `Requires run access`.

An adapter that throws is recorded as `error` with the message as output. So
is a result outside the contract — a verdict not in the table, or no string
`output` — with an output that says what was wrong.
Map the tool's exit status and output to a verdict; never report `holds` on
a run that did not complete.

## Evidence from a verifier

A `properties` item names `verifier`, `model` (a path from the project root)
and `property`. `naima verify` runs the adapter and attaches the run —
verdict, output, the model's sha256 and the options', every input with its
sha256, the tool's version and one digest over inputs and version — plus the
counterexample as its own file. `naima check` fails when a property claims to
hold and its property, verifier, model path, options, model contents, an
input's contents, the set of inputs or the tool's version have changed since
the run. The shipped adapter, `example-regex`, is a stand-in that
reads `#include <path>` lines and declares them as inputs; the real ones,
`mcrl2` and `voxlogica`, are separate opt-in plugins (`verifier-mcrl2`,
`verifier-voxlogica`), each declaring the tool it starts, its inputs and its
version.

## Testing a plugin

`core/testing.ts` builds a throwaway project with a fixed clock and captured
output:

```ts
const p = tempProject([myPlugin({})], { git: true })
await p.run("my-command", "arg")
assert.match(p.output.join("\n"), /expected/)
p.cleanup()
```
