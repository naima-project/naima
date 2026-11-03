# Work on several goals at once: development lines

A development line is a long-lived branch for one goal of the project, such as the next release, kept apart from the [trunk](glossary.md#trunk) until the trunk
is ready to take it. Work for a later goal goes on its line while the trunk finishes the goal before it, or while the trunk is frozen. The agents run these
commands for you, unless you want to run them yourself.

## What a line is

A line is the branch `line/<gate>`, tied to one [gate](glossary.md#gate) of the trunk, its goal. Naima stores nothing about it: where it started, how far it
lags the trunk and when it was last updated all come from git. A line starts only from the trunk, never from another line.

```sh
naima line new release-1.2     # line/release-1.2, from the trunk
naima line list                # the open lines: gate, latest update, how far each lags, the items fixed on it
naima line use release-1.2     # this chat works on that line
naima line use --trunk         # this chat works on the trunk again
```

`naima line new` refuses a gate the project does not declare. The line starts with a commit of its own that changes nothing, so that every branch opened from it
carries a commit the trunk lacks: that is how Naima tells which line a branch belongs to.

## Work on a line

An item's work happens on its own branch, as anywhere else ([several branches](several-branches.md)), but the branch starts from the line and lands back on it:

```sh
naima open export-speed --as ada               # from the line of the item's gate, or of this chat
naima land ada/export-speed                    # lands on line/release-1.2, and closes nothing
```

- `naima open` starts the branch from the line given with `--line <gate>`; else, when the item stands on a gate that has an open line, from that line; else from
  the line this chat works on; else from the trunk. `--trunk` always starts from the trunk. It says first where it starts: `on line line/release-1.2`.
- An item whose own goal comes before a line's goal never goes on that line, since it could never land: its goal would wait for the line, and the line for its
  goal. `naima open --line` refuses it; with the chat on such a line, `naima open` starts it from the trunk, and says why.
- `naima show` on the trunk says of an item fixed on an open line: `fixed on line line/<gate>, not yet on the trunk`.
- `naima land` of a branch of a line lands it on the line, as one merge whose tree is the branch tip's. It closes nothing: the item stays fixed, named in the
  merge's `Fixes:` trailer, and is closed when the line lands. The trunk does not move, and its copy of the item is untouched.
- Before it lands on the line, the landing checks run on the branch's files, as they do before a landing on the trunk: in the branch's worktree when it is clean
  at its tip, else in a checkout of the tip made for them. A failing check refuses the landing. A proof that is not current is only said, since the line's
  landing on the trunk is the one that asks for it. Each check prints one line, where it ran and what it found.
- The coordination option `maxWorkers` counts per line: the trunk is one line, each development line another.

Items, notes, decisions and diary entries are filed on the trunk, and Naima's settings in `naima.json` change only there. On a line, and on a branch opened from
one, Naima refuses to write them: filing an item, a note or a description, a field set by hand, a link, an event, an attachment and any change to `naima.json`
each stop with a message saying to run the command in the trunk's checkout, where the line gets it at its next sync. Only an item's own work travels with its
code on the line, and Naima writes it there: its fixed mark (`fixedOn`), its test runs (the status and last run a test or a property records), its session note,
and its change note, which is a file of the code.

## Keep a line up to date with the trunk

The trunk goes into a line, never the other way round, and never by a rebase.

```sh
naima line sync release-1.2
```

It opens a short branch `sync/<gate>` from the line in its own worktree and merges the trunk into it. When the merge is clean, it lands on the line at once,
with a `Sync:` trailer naming the trunk commit it took, and the short branch is removed. When the merge conflicts, it stops there: resolve the conflicts in that
worktree, commit the merge, and run `naima land sync/<gate>`.

A fix belongs on the trunk and reaches the lines by their next sync. Only a defect in code that exists only on the line is fixed on the line.

## Goals: their order, and when one is finished

Lines land in the order of their goals, so the gates have an order:

```sh
naima gate set release-1.2 --after launch     # release-1.2 comes after launch
```

Gates with a version are ordered by version, and gates with a due date by date; `--after` adds to that order and never replaces it, so a release named after
another goal still comes after every earlier release. A goal is finished when its version is released (a git tag carries it), or, for a gate with no version,
when it holds and its due date, if any, has come.

## Freezes

A freeze belongs to a goal, not to a line:

```sh
naima gate set launch --freeze 2026-11-01     # from that date until launch is finished
naima gate set launch --freeze ""             # the owner clears it
```

While a goal is frozen and not finished, no landing on the trunk may close a feature, wherever it comes from; fixes still land. Lines of later goals keep taking
features, since nothing on a line reaches the trunk. A line that holds only fixes may land on the trunk during its own goal's freeze. The owner can clear a
freeze at any time, which a frozen goal needs when one of its own features has not reached the trunk yet.

## Land a line on the trunk

A line lands when the trunk and the line are both ready:

- the trunk is ready when every goal ordered before the line's goal is finished and no freeze refuses what the line closes;
- the line is ready when it is up to date with the trunk and its goal holds on its tip.

```sh
naima line sync release-1.2
naima gate show release-1.2 --line   # the gate judged on the line's tip, and whether the line may land
naima land line/release-1.2          # one merge that closes every item fixed on the line
naima prune --branch line/release-1.2 --write
```

`naima land` refuses a line that is not ready and says why. A branch that was opened from the line and had not landed when the line did belongs to the trunk
from then on: bring it up to date with the trunk and land it there.

## Withdraw a fixed mark

When an item marked fixed on a line turns out to hold less than it claimed, the coordinator withdraws the mark, so that the line's landing leaves the item open:

```sh
naima line unfix release-1.2 export-speed --reason "only the reader was built: the writer is left"
```

It puts one marker on the line, with an `Unfixes:` trailer naming the item and the reason in its message, and takes the item's `fixedOn` off the line's copy.
The item's work stays on the line and reaches the trunk with it. A later landing on the line that fixes the item marks it fixed again. Once the line has landed,
what is left of the item is best split off into an item of its own.

## Abandon a line

```sh
naima line abandon release-1.2
```

It tags the line's commits as `archive/line/<gate>`, so none is lost, and deletes the branch. Nothing is written on the trunk: the items fixed on the line are
open there again, since the trunk never saw their fix. A branch opened from the abandoned line cannot land anywhere; `naima line abandon` lists each one, and
`naima prune --branch <branch> --archive --write` removes it.

## What protects the lines

- The trunk guard also guards every `line/*` branch: a line takes only landings and withdrawn marks, and a commit made on it by hand is refused. Every checkout
  runs the main checkout's copy of the guard, so a line made before the program moved needs no sync to be guarded ([the trunk guard](commit-hooks.md)).
- `naima land` refuses to put on the trunk a branch that carries commits of a line that has not landed, and refuses a branch carrying commits of two lines.
- The trunk guard refuses the same by hand: a merge onto the trunk that carries the work of a line that has not landed, or of an abandoned one, is refused even
  when it looks like a landing marker or gives a `Trunk-reason:`; only the line's own landing brings its work.
- `landings-are-markers` reads each open line's history as it reads the trunk's, and reports as a problem a trunk that holds the work of a line that has not
  landed or was abandoned.
- `naima check`, `naima stale`, `naima recover` and `naima claim --preparing` measure a branch of a line against its line, not the trunk; `naima prune` deletes
  a branch that a line already holds; `naima claim` refuses on a line, as on the trunk.
- Naima's own settings in `naima.json` (the lock, the gates, the options) are kept on the trunk only: on a line, and on a branch of one, every command that
  would change `naima.json` is refused, `naima update` and `naima plugin` among them, so the lock never moves on a line.

## Which line you are on

`naima line use` records this chat's line outside the repository, in the session record Naima keeps in the git directory. `naima open`, `naima claims` and
`naima queue --ready` follow it and say first which line they act on; `--line` and `--trunk` override it. `naima land` follows the branch's own line, and says
it. `naima hello` lists the open lines, each with its gate and latest update, and the line this chat works on. A worker needs none of this: its branch shows its
line. Two chats in one checkout share one session record unless `NAIMA_SESSION` is set, so such chats name their line with `--line`.

Lines need the tracker committed with the code: a project that keeps its tracker in a repository of its own cannot use them yet.
