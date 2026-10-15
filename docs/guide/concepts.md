# Concepts

This page explains the mechanics behind Naima's commands, for anyone using
it. If you want the overview first, [the primer](primer.md) gives it. How
these ideas are used day to day is described in
[how the project runs](how-the-project-runs.md). Each term is defined once in
the [glossary](glossary.md), and the rules built on these ideas are on
[the rules page](rules.md).

## Items

Every [item](glossary.md#item), whether it is a bug, a todo, a feature, a
test, a property or a rule, is a directory under the tracker:

```
naima-tracker/naima-data/<type>/<slug>/README.md       the prose
naima-tracker/naima-data/<type>/<slug>/meta.json       the fields
naima-tracker/naima-data/<type>/<slug>/attachments/    the evidence
```

`meta.json` always holds `id` (a permanent uuid), `title` and `status`, and
the other fields in it are declared by plugins. The slug is a readable name
made from the words of the title, in whatever script they are written. Latin
letters lose their accents, while Cyrillic, Chinese, Japanese, Korean and
every other letter are kept as they are. The slug may change, but the id
never does, and links refer to ids. If another local branch already uses a
slug under the same type, it isn't taken again
([across branches](../agents/worktree-isolation.md#item-slugs-across-branches)).
On the command line you can name an item by its id, by `type/slug`, by its
slug, or by any fragment of a slug that matches exactly one item.

Which types, statuses and fields exist depends on the loaded plugins, and the
[reference](../reference/reference.md) lists them. Each status belongs either
to the `open` category or to the `done` category. A status can also `prove`,
which means it counts as [evidence](glossary.md#evidence) for whatever the
item `verifies`.

## Links

A link is stored as `{ "rel": "<relation>", "id": "<uuid>" }` in the item's
`links`. Only the direction that was written is stored. The inverse
(`verifies` ↔ `verified-by`, `blocks` ↔ `blocked-by`) is worked out when the
tracker is read, so the two directions can't disagree.

## Fixed, resolved, closed

These are three different states, and they mean different things:

- **fixed** means the change exists (the code, the corrected table, the
  rewritten paragraph) and `fixedOn` is set. Nothing has been proven yet.
- **resolved** means the item is fixed and proven by an item that `verifies`
  it and whose status proves, such as a test that passed or a property that
  holds.
- **closed** means the item is resolved and `naima close` has moved it to the
  archive, together with its [proof](glossary.md#proof).

A status can also **refute**, as a failed test or a violated property does.
In that case the item it verifies is not resolved, whatever else proves it,
and it blocks every [gate](glossary.md#gate) the two are on. `naima close`
also refuses a proof that `naima check` reports as no longer current.

"How many bugs are left" is the count of unfixed bugs (`naima bugs`). The
number of bugs that are fixed but not yet proven is a separate number, and
the two are never added together.

## Evidence

Evidence is kept with the claim it supports, in the item's `attachments/`. A
property checked by a formal-methods tool counts as evidence in the same way
a passed test does. `naima verify` attaches the run and the hash of the model
it ran on, and `naima check` fails if the model, or the property,
[verifier](glossary.md#verifier) or options it was run with, has changed
since then.

Evidence is ranked from strongest to weakest, and a test says which kind it
carries in its `evidenceKind` field:

| Rank | `evidenceKind` | The evidence |
|---|---|---|
| 1 | `owner-gesture` | the owner performed the gesture and saw the result |
| 2 | `observation` | a screenshot, a log line or a number, kept with the item |
| 3 | `live-read` | the live state, read by tooling: a query, an API call, the running program's own answer |
| 4 | `diff` | a before-and-after comparison: counts, sizes, outputs |
| 5 | `inspection` | "the code looks right", which proves nothing |

A count, a timing or a size only proves something when it is shown next to
the value it is compared with, such as before and after, or expected and
seen.

A regression test, meaning a test that verifies a bug, only proves the fix if
it was seen failing on the code before the fix and then passing on the fix
(red, then green). Its `redSeen` field records the day it was seen red.
`naima check` adds a note for a passed regression test with no `redSeen`, and
for a passed test whose evidence is `inspection`.

An item's page can also fall behind what has happened since. Two more notes
catch that. One is for an open item with an unticked `- [ ]` clause naming a
test that has since passed. The other is for an agent's test whose page
excuses it because something was held
([prove and close](prove-and-close.md#3-perform-it-keep-the-evidence)).

## Derived, never stored

Boards, queues, gate states, urgency and summaries are computed each time
you ask for them and never written to disk, so there is no stored copy that
could go out of date. `naima check` checks the whole tracker against its
invariants, much as a test suite checks the code.

## Gates

A gate is a named condition, such as a release or a merge, that depends on
items. An item joins a gate by carrying `gate: <name>`. How each gate decides
whether it holds is described in the
[reference](../reference/reference.md#gates).

## Coordination across branches

Some state doesn't belong to any single branch, such as who is working on
what and where each session left off. It is written as one file per session,
on that session's own branch, and put back together when it is read from
every local branch. That means the [trunk](glossary.md#trunk) and every
unmerged branch, each read from the disk of the
[worktree](glossary.md#worktree) that has it checked out (uncommitted files
included), or from its ref when no worktree does. Remote-tracking refs are
not read. Because of this, two sessions never edit the same file. The
[flows](glossary.md#flow) that go with this are described in
[flows](../agents/README.md).
