# Planning: epics, milestones and gates

When the owner names a body of work, a release or a date, the coordinator,
which is the agent talking to the owner, turns what they said into tracker
data straight away through the CLI. Don't edit `naima.json` or a `meta.json`
by hand.

| The owner says…                                                     | Run                                                                                                 |
| ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| "these belong together", "the onboarding work"                      | `naima new epics "<title>"`, then `naima epic add <epic> <item>...`                                 |
| "that's a gate for the beta", "this must be done before we release" | `naima gate new <name> "<title>" --says "<what it is for>"`, then `naima gate add <name> <item>...` |
| "by the first of December", "for 0.9"                               | add `--due YYYY-MM-DD` and `--version <v>` to `gate new`                                            |
| "only when it is proven", "tested, not just written"                | add `--holds-on proof`                                                                              |
| "how far is the beta?"                                              | `naima gate show <name>`; `naima epic` for epics                                                    |
| "when did the beta open?", "what happened in September?"            | `naima view timeline`                                                                               |
| "we handed build 3 out", "we decided in the meeting"                | `naima event <YYYY-MM-DD> "<what>" --kind build\|decision\|policy\|fact [--at HH:MM]`               |
| "first the specification, then the model", "this waits for that"    | `naima link <item> blocked-by <what it waits on>`                                                   |
| "what can start now?", "what is next?"                              | `naima ready [gate]`; the whole plan in order: `naima order [gate]`                                 |
| "keep a diary", "write down what happened today"                    | `naima event <today> "<what happened, and why>" --kind diary`; read it back with `naima diary`      |
| "every paid feature needs a test", "is every endpoint tested?"      | declare the list in `plugins.gates.options.coverage`, then `naima coverage --check`                 |
| "the launch needs every paid feature tested"                        | `naima gate new <name> "<title>" --coverage <list>`                                                 |

Whoever prepares a gate's items doesn't also mark the gate as met. The status
of a gate or an epic is derived from its items and is never set by hand, so
the agent that did the work is never the one that decides the release is
ready.

These rules hold:

- **One gate per release or merge condition.** Before `gate new`, run
  `naima gates`, and if a gate with that meaning already exists, `gate add`
  to it. A name uses lowercase letters, digits, `.`, `-` and `_`.
- **Put the epic on the gate, not each item**, when the whole epic is what
  the gate waits for: `naima gate add beta epics/onboarding`. The gate then
  stands for the epic's items, and an item added to the epic later joins it.
- **An epic's status is derived.** Don't `naima set` it. Close or remove its
  items instead. A write that sets it against them is refused.
- **A date is the owner's.** Don't invent a `--due`. Ask, or leave it out
  ([asking the human](asking-the-human.md)). An overdue milestone shows up as
  a `naima check` note, and you report it rather than moving the date.
- **Never copy a timeline or a list.** The timeline is derived from the items
  and from git, so use `naima event` only for what can't be derived. A
  coverage list is named by its source and read from there, and a test proves
  an entry with `covers=<entry>` (or `<list>:<entry>`) rather than through a
  table someone keeps by hand.
- **A plan is a graph, not a list.** Record what each item waits on with
  `blocked-by` and take the next item from `naima ready`. Never link a cycle.
  `naima check` fails one and names its items, because none of them could
  ever start.
- **The diary is written as things happen.** A diary event dated today
  records the moment it was written. One written later for an earlier day
  gives its time with `--at`, or else it sorts first in its day. Decisions
  don't need a diary event, because `naima diary` already includes each one
  with its reason.
- **Commit what the commands wrote**, meaning the epic's folder, the items,
  `naima-tracker/naima-data/naima.json` and any `events/` file, together with
  the work that led to it.

What each command prints, and every option, is in the
[reference](../reference/reference.md). The page for people is
[plan with epics, milestones and gates](../guide/plan-with-epics-milestones-and-gates.md).
