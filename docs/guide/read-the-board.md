# Read the board, the queue and the gates

Every view on this page is [derived](glossary.md#derived), which means it is
worked out from the [items](glossary.md#item) each time you ask and never
stored, so it is always up to date. None of these commands changes anything,
so they can be run at any time. The agents run them for you, but you can run
them yourself whenever you like.

## Where the project stands

```sh
naima summary          # everything, one screen
naima bugs             # how many bugs are left
naima list --open      # every open item, most urgent first
naima board bugs       # one type, grouped by section
naima show <item>      # one item: fields, links both ways, attachments, page
```

`naima summary` has a block for each plugin. Together they show item counts,
bugs, what is next, the gates, who is working on what
([claims](glossary.md#claim-file)) and where the last sessions left off
([session notes](glossary.md#session-note)). With `--markdown` it prints the
same thing as markdown, so you can paste it into a report.

## How many bugs are left

```console
$ naima bugs
bugs: 1 open
  unfixed (no code)     1
  fixed, not proven     0
  resolved, not closed  0
```

These are three separate numbers, and they are never added together. The
answer to "how many are left" is the first one, the unfixed bugs. A fixed bug
that nothing proves yet is counted in a different number, and so is one that
is proven and is only waiting for `naima close`
([three states](rules.md#fixed-resolved-and-closed-are-three-states)).

## Boards

```sh
naima board bugs           # open items, by section
naima board bugs --all     # done ones too
```

A [section](glossary.md#section) is a heading you give to items
(`naima new bugs "…" --section Export`), so that a board reads like a
plan.

## Gates

A [gate](glossary.md#gate) is what a release or a merge waits on. It is
declared once in the configuration, and then items are put on it.

1. Declare it in `naima-tracker/naima-data/naima.json`
   ([configure the project](configure-the-project.md#add-a-release-gate)).

   ```json
   { "plugins": { "gates": { "options": { "gates": {
     "v1": { "title": "First release", "says": "what the first release waits on", "holdsOn": "code" }
   } } } } }
   ```

2. Put items on it.

   ```sh
   naima set second-bug gate=v1
   ```

3. Ask whether it holds.

   ```console
   $ naima gates
   v1 — First release: BLOCKED by 1
     ✗ bugs/second-bug  Second bug
   properties — Every property holds: HOLDS
   ```

`holdsOn` decides what blocks the gate.

- With `"code"`, which is the default, the gate waits for code. An item with
  no fix blocks it. A fixed item that only owes its
  [proof](glossary.md#proof), and the proving gestures themselves, are
  listed as **owed** (`·`) but don't block it.
- With `"proof"`, every open item on the gate blocks it.

`naima gates v1 --check` exits with 1 while the gate is blocked, so a
release script or CI can wait on it.

## The queue

The [queue](glossary.md#queue) is the list of open items on the gates,
split up by who has to carry out their proof ([run by](glossary.md#run-by)).

```console
$ naima queue v1 --human
v1: 2 open — agent 0, human 2, build 0, unclassified 0
  with no code yet: 1; owing only proof: 1
  bugs/second-bug  Second bug  (human)
  tests/looks-right-phone  Looks right on a phone  (judgement)
```

`--human` lists what needs a person, with the reason for each item, which
makes it the list to hand to the [owner](glossary.md#owner). "Unclassified"
counts the items whose `runBy` nobody has set yet. Without a gate name,
`naima queue` covers every gate.

## A role's queue

Each job in the team of agents is a [role](glossary.md#role), which says
what the job owns and what it refuses to do. `naima roles` lists the roles,
each with the number of open items on its queue, and
`naima queue --role <role>` lists one role's queue, most urgent first.

```console
$ naima queue --role tester
tester — Tester: 1 open
  refuses: fixing what it finds; testing what it just wrote
  tests/looks-right-phone  Looks right on a phone
```

An item goes on a role's queue according to its `role` field, if that is
set (`naima set <item> role=documentarian`). Otherwise it goes by the item's
[kind](glossary.md#kind), where `code` belongs to the implementer, `writing`
to the documentarian and `decision` to you, or by its type, so every test
item belongs to the tester. With a gate name, `naima queue v1 --role
implementer` keeps only what is on that gate. A project can add its own roles,
or replace one, under `plugins.roles.options.roles`
([the reference](../reference/reference.md)).

## Other views

`naima view` lists the named views that the loaded plugins offer. Examples
are `next`, which shows open items with the most urgent first, and
`timeline`, which shows when each gate and epic opened and finished, along
with each release and session, all derived from the items and git.
`naima view next --json` gives the data behind a view.

## The window

`naima ui` opens a window. Its first screen, **Home**, shows four panels.
They are the summary (what `naima summary` prints), the gates with whether
each one holds and the items blocking it (what `naima gates` prints), what is
next (what `naima view next` ranks), and the claims, showing who holds what
on every branch (what `naima claims` prints). The other views are tabs.

- **Boards**: one type's board, picked from a list, with the done items when
  you tick the box (what `naima board <type>` prints).
- **Session notes**: the newest notes, from every branch (what
  `naima pass --list` prints).
- **Item**: one item, picked by its reference. It shows the evidence first,
  meaning the files attached to the item and the tests that can prove it,
  each marked proves, refutes or not yet. After that come its fields, its
  other links and its page (what `naima show <item>` prints). Every item
  reference elsewhere in the window links here.
- The metrics, the timeline, the coverage of the project's declared lists,
  and any tabs a plugin adds.

Each tab shows the same data its command prints, read from the files every
time the page loads, so the window and the terminal always agree. Every
command is documented in the [reference](../reference/reference.md).

## How long a `now` item has waited

`naima view next` has an age column, which gives the number of whole days
since an item's priority was last confirmed (from `triagedOn`, or from
`created` for an item that was never triaged). Like everything else here it
is worked out when you read it, not stored. A `now` item that no branch's
[claim](glossary.md#claim-file) names is marked `unclaimed`.

```console
$ naima view next
  high    now     S       bugs/second-bug  Second bug  (6d unclaimed)
```

`naima check` includes the check `unclaimed-now-item-aging`, which adds a
note for every `now` item that has been open longer than
`plugins.triage.options.maxNowAgeDays` (3 days by default) without anyone
claiming it. That way such items show up without anyone having to look at
the queue.
