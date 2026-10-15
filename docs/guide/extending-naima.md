# Extending Naima: writing a plugin

This page is for programmers who want Naima to do something specific to their
own project, such as a new [item](glossary.md#item) type, a field, a check, a
command, or a way of proving something. If you only want to use a
[plugin](glossary.md#plugin) someone else wrote, there is a shorter page for
that: [add a plugin someone gave you](add-a-plugin.md). Terms are defined in
the [glossary](glossary.md).

Almost everything in Naima is a plugin. The eight plugins that ship with it
([first-party](glossary.md#first-party-plugin): `trackers`, `coordination`,
`triage`, `gates`, `beta-markers`, `verifier`, `docs`, `rules`) are written in
the same way a project's own plugin would be, and the small core only loads
them and runs what they declare. At the end of the page there is a worked
example of using Naima for research rather than software.

## What a plugin declares

A plugin is a module whose default export is a factory. Given the project's
options and a small API object, the factory returns a **manifest**, which
lists what the plugin adds along with the documentation for each thing. That
way [the reference](../reference/reference.md) is generated from the code
instead of being written by hand and drifting out of date. A plugin can add
to any of several **extension points**: item types, statuses, fields,
relations, checks, views, gates, verifiers, commands, summary sections, rank
terms and data migrations. A project can also declare new extension points of
its own, as happened when the `verifier` plugin was added and needed a
completely new concept (a model-checker run). Each extension point says what
a contribution to it looks like and how it is checked.

## Sharing a project's vocabulary

When a plugin reads a field, type or relation that it doesn't own itself,
for example when `gates` reads the `fixedOn` field that `trackers` declares,
it declares that it `uses` it. Then, if that field goes missing because the
plugin that owns it was switched off or replaced, loading the project fails
with a clear message instead of quietly doing nothing. Two plugins can also
agree on a role rather than a literal name, such as "the field that marks an
item fixed", whichever field actually fills that role. That way one plugin
doesn't need to know the other's field names at all.

## Extending another plugin's types and fields

There are two ways to extend what another plugin has already declared, and
they are meant to be used together:

- **Traits.** A type can carry a tag, such as `fixable`, so that a field
  doesn't have to list by name every type it applies to. A field that applies
  "to every fixable type" keeps working as new types are added, and two
  plugins can't collide by both naming the same type explicitly.
- **Additive `extends`.** A project, or another plugin, can add a new status
  to an existing type (for example a `blocked` status on bugs) or a new value
  to an existing field's list. It can only add things. It can't redefine what
  a status already means, or move a status between the open and done halves
  of its type's life cycle.

None of this is a class hierarchy, because the owner explicitly prefers data
to inheritance. A status can also declare flags alongside the built-in
open/done one, such as `refutes: true` for a status that actively defeats a
claim rather than just failing to support it, and a map of which statuses it
may move to.

## Write-time hooks

Every write a plugin can make (creating an item, setting a field, linking two
items, moving or closing one) goes through hooks, which run in the order the
plugins were loaded. A `beforeWrite` hook can refuse the write outright, with
a message that a person or an agent can act on, and an `afterWrite` hook runs
once the write has gone through. This lets a plugin, without any change to
the core, stamp a date automatically, reset a property to open when what it
checks has changed, or refuse a status set by hand when that status should
only ever be set by a passing verifier.

## Views

A [view](glossary.md#plugin) (`naima view <name>`) returns both its data and
a way to render it as text, so the same view can be printed, exported as
JSON, or included in markdown without being computed twice. A check, a gate
or a view may do its work asynchronously, for example by calling an external
tool as part of a check, and the core doesn't prevent that.

## Proof currency

A property or test that passed once doesn't stay proven forever. If what it
checks has changed, whether that is the property's statement, the verifier it
runs or the model it reads, the proof is stale and no longer counts.
[`naima close`](prove-and-close.md) runs every check before it closes an
item, and refuses if any check reports a problem with what the item names as
its proof. So a stale proof can't close anything, even before a plugin
declares its own precise rule for when its evidence is current.

## Names

Every contribution any plugin declares gets a qualified id of the form
`<plugin>/<name>` (`gates/v1`, `trackers/fixedOn`). The data on disk, in
`meta.json` and `naima.json`, keeps the short name because it is easier to
read, and the short name is resolved automatically as long as only one plugin
in the project declares it. If a second plugin declares the same short name,
Naima refuses to load and names both qualified ids, until the project's
`naima.json` says which is which with a `rename` map.

## Configuring a plugin

Every plugin, first-party or not, is configured in the same way, under
`plugins` in `naima.json`. It can have its own `options`, `enabled: false`
switches it off, `replacedBy` swaps in a fork or an alternative, and `checks`
weighs its checks as `off`, `note` or `problem`. [Configuration](config.md)
has the full shape, and the common cases are covered in
[configure the project](configure-the-project.md).

## Plugins from outside the program

A plugin doesn't have to live inside Naima's own program directory. A
project can point `plugins.<name>.source` at a file of its own (pinned by its
sha256) or at a git repository (pinned by a full commit), without forking
Naima, and [add a plugin someone gave you](add-a-plugin.md) walks through
both. A plugin written this way declares the contract version it was written
for, so a plugin written against an older Naima fails to load with a clear
message instead of running against an API it doesn't match. What it can
import from the core is a small, explicit set of functions, kept separate
from everything the core keeps for itself.

## Data migrations

Each plugin keeps its own data-format number next to the core's, in
`naima.json`. A plugin that needs to rename a field or change where it keeps
something contributes its own migration, which `naima update` runs right
after the core's. Moving one plugin's data forward never forces the other
plugins' formats to change. The core's own migrations are described in
[migrations](../reference/format.md#migrations).

## Trusting the source

Every run realigns the program directory to the exact source and commit
that `naima.json` names, and refuses to run rather than quietly follow a
change to either of them. The full rule is in
[every run aligns the program](install.md#every-run-aligns-the-program). A
verifier adapter that needs to run an external tool (for example a model
checker's pipeline) declares the programs it runs, so the launcher can allow
exactly those and nothing else.

## Two small, project-facing behaviours

These two affect every project, not only plugin authors:

- **Slug uniqueness.** `naima new` checks the name it is about to give an
  item against the unmerged work on every branch, not only its own, so that
  two people working on separate branches don't give two different items the
  same folder name. In the rare case where a collision still happens, the
  item's id is used instead.
- **Triage fallbacks.** An item that has no [impact](glossary.md#impact) or
  [priority](glossary.md#priority) set yet is ranked in the middle of the
  scale, not at the bottom or the top. An item with no
  [effort](glossary.md#effort) set is ranked as the worst case, because
  effort is never guessed ([triage](triage.md)).

## A worked example: adopting Naima for a data analysis

None of the above is specific to software. A research group replicating a
published study can track it just like a codebase. The work is filed with
`naima new todos "redo
table 2 from the raw survey"`, triaged, claimed by whoever does it in their
own [worktree](glossary.md#worktree), and closed only once a test item proves
it. Here the proof is a script that recomputes the table and a note recording
that the new numbers match the paper's claim. Bugs, todos and features
already cover most of this, and [what Naima is for](../purpose.md) has more
examples.

A plugin is only needed when the built-in types no longer fit, for instance
when a group wants its own kind of tracked item, with its own field naming
the command that reproduces it. `pack-analyses` ships with Naima as a minimal
example of exactly that kind of plugin, with one type and nothing else:

```json
"plugins": { "pack-analyses": {} }
```

```sh
naima new analyses "Table 2, rebuilt from the raw survey" --set command="scripts/table2.sh"
naima new tests "Rerun scripts/table2.sh and diff against table 2"
naima link <the test> verifies <the analysis>
naima set <the test> status=passed      # the rerun matched
naima set <the analysis> status=confirmed
```

An `analyses` item is proven in the same way as a requirement. `naima check`
adds a note for one that is confirmed without a passing test, and for one
that is already proven but still `proposed`. Reading its source
([`naima/src/plugins/pack-analyses/index.ts`](https://github.com/vincenzoml/naima/blob/main/naima/src/plugins/pack-analyses/index.ts))
is the quickest way to see how little a non-software pack needs to add: one
type, one field, and a check that reuses `verifies`/`verified-by` instead of
inventing its own way of proving things. A paper's sections and reviews are
the second worked example, for work that has no command to rerun at all (see
[Writing a paper: sections and reviews](paper-sections-and-reviews.md)).
Another kind of non-software work would get its own pack, built in the same
way.
