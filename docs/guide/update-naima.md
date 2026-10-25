# Update Naima

Every project runs one exact version of Naima. Which one is recorded in
`naima.json`, in what we call the [lock](glossary.md#lock). The lock only
changes when someone updates Naima on purpose, and each update is a single
commit you can review ([the rule](rules.md#update-deliberately-as-one-commit)).

You rarely need to do any of this yourself. The agents check for updates,
tell you what a new version would change, and ask you before they apply it.

## What happens when a session starts

At the start of every conversation, the agent runs this:

```sh
naima hello
```

The first line it prints is the one the agent shows you, for example
`I'm Naima, the No-guesswork Artificial Intelligence Meta-Agent, active in this repository: version 1.0.0, commit 45ba22c1134c.`
The version is the latest release tag at or before the locked commit. After
that comes what Naima found about newer versions, then one line for each
long run that is due ([long work](long-work.md#when-a-long-run-is-due)), and
a reminder of what you can ask for: an explanation of Naima and its
documentation, a check for an update, or an update. With an agent tool
that has a session-start hook, you see this greeting directly. `naima hello`
never changes the lock and never starts a run. Its check for a newer Naima
counts as the day's update check.

## During a long session

The session start is not the only time Naima looks. Once a day, the first
naima command to run asks the source again, and if a newer Naima has come
out, the agent tells you, once. When the check keeps failing for a week, you
get an urgent message that repeats every hour until you acknowledge it. How
this works, and how to acknowledge a message, is in
[what Naima tells you while you work](messages.md). The `updates` setting
below applies there too: with `off`, nothing is asked.

How much it looks for updates depends on the `updates` setting in
`naima.json`. You can ask the agent to change it, and it runs this:

```sh
naima update --mode check
```

There are three settings:

| `updates` | What a session start does |
|---|---|
| `off` | It doesn't contact the source at all. |
| `check` | It tells you when a newer Naima exists, and how many commits ahead it is. This is the default. |
| `update` | It also tells you what the newer Naima would change, with its change notes and a rehearsal of its check, and the agent asks whether you want it. |

The default is `check` because it only reads, and changes nothing. Even with
`update`, nothing is applied until you say yes.

## Finding out what an update would change

```sh
naima update --check
```

This tells you whether the [source](glossary.md#source) has a newer Naima
than the one you are locked to. It exits with 1 when it does. In that case
it also tells you what would change, in three parts.

First come the change notes. Every change to how Naima behaves comes with a
short note written by whoever made it ([change notes](../../changes/README.md)).
Naima lists the notes added between your version and the newer one, grouped
so the important ones come first:

- breaking changes, which you have to act on or something stops working;
- changes that need an action, with what to do;
- new features, other changes of behaviour, and fixes.

Then comes what Naima works out by comparing the two versions itself:

- the commits, by their titles;
- any change to the data [format](glossary.md#format), which means a
  [migration](glossary.md#migration) the update will run for you;
- rules added to or removed from [the rules page](rules.md), and the rules
  the notes say changed, which agents will acknowledge again;
- settings in `naima.json` that the newer Naima no longer reads, by name,
  for example `plugins.coordination.options.resources`, and what `naima
  update` will do about them.

Last comes a rehearsal. Naima runs the newer version's own `naima check` on
your project and tells you what would newly fail and what would newly be
noted. A line such as `newly failing: …` is something to fix after the
update, or before it.

To find all this out, Naima reads the newer version's code straight from its
own git copy, into a temporary folder that it deletes afterwards, and runs
its check from there. Your project is not touched. If the newer Naima
changes the data format, the rehearsal can't run on data that hasn't been
migrated yet. It says so, and the check at the end of the update takes its
place.

## Updating

```sh
naima update
git add naima-tracker && git commit -m "Update Naima to <commit>"
```

`naima update` shows what changes, downloads the newer Naima, switches the
program to it and records the new commit in the lock. If anything fails along
the way, the previous version stays in place. Then the newer Naima finishes
the update itself:

- it migrates your data if the format changed;
- it fixes what is mechanical in `naima.json`: an option a note says was
  renamed gets its new name and keeps its value, and an option the newer
  Naima doesn't read any more is removed. Each change is printed with the
  value it held, so nothing disappears unseen;
- it names the rules that changed, so the agents read them again and
  acknowledge them in their next session note;
- it adds what makes every agent run `naima hello` at the start of a
  session, if your project doesn't have it yet: a line in your entry file,
  such as `AGENTS.md`, and the session-start and turn-end hooks of each agent
  tool you use that has them, or a newer form of hooks installed before ([the entry point](install.md#the-agent-harness-entry-point));
- it runs `naima check`, and files a todo for each problem or note that is
  new since the version you had, so nothing it couldn't fix by itself is
  forgotten. A todo it has already filed isn't filed twice.

Everything ends up in the tracker folder, apart from that line and those
hooks. For each of them, the update prints one sentence saying what it
installed and why, for example:

```text
Installed a <tool> session-start hook in <its settings file>: every new conversation starts by running naima hello, and you see its greeting directly: which Naima is active, whether a newer one exists, what waits on your decision.
```

Its last line names every file to commit. You review the change and commit
it as one, like any other.

To move to a particular commit of the source's main branch rather than the
newest one, use `naima update --to <commit>`.

### When the update asks to be run once more

The update starts in the version you had and finishes in the new one. The
part that starts it, the [launcher](install.md#the-permissions), comes from
the version you had, and it decides which files the update may write. A
launcher from before the session-start hooks doesn't let the update write
your entry file or a tool's settings. In that case the update moves the
lock, migrates and checks everything else, and ends with a line like this
one, exiting with 0:

```text
Naima moved to 0fde22566318; run naima update once more to finish: the line in AGENTS.md that tells agents to run naima hello and <tool>'s session-start hook in <its settings file>
```

Run `naima update` again. The second time the new version starts it, so it
writes what was left and prints the usual last line with the files to
commit. Until then, `naima hello` and `naima check` both say that the
update is unfinished, and what is left.

## Going back to the previous version

```sh
naima rollback
naima check
git add naima-tracker && git commit -m "Roll Naima back to <commit>"
```

`naima rollback` looks through the git history of `naima.json` and puts back
the lock that was there before the current one. It first tells you what it
undoes. It is one commit, just like an update. To go back to some other
commit, use `naima update --to <commit>`.

There is one limit. Migrations only run forward, so an older Naima can't
read data that a newer one has already migrated. In that case `naima
rollback` refuses and names the commit that did the migration. Revert that
commit with `git revert`, and the data and the lock go back together.

If you go back to a Naima from before the `updates` setting existed, the
setting is removed from `naima.json`, and Naima tells you so.

## When the program is damaged

The program is the copy of Naima in `naima-tracker/naima/`. Before every
command, Naima makes sure that copy is at the locked commit
([alignment](install.md#every-run-aligns-the-program)). If the copy is
damaged, Naima repairs it when it can do so without losing anyone's work,
and tells you in one line what it did:

| What Naima finds | What it does |
|---|---|
| Files deleted from the program, and nothing else changed | It restores them from git. |
| A copy git can no longer read | It moves the copy aside to `naima.broken-<date>`, next to it, and makes a fresh one. It never deletes it. |
| No program at all | It makes a fresh copy. |
| The program at a different commit from the lock | It switches it to the lock. |

A fresh copy comes from somewhere on your own disk when possible, such as
another worktree's program or the Naima you are running, so no network is
needed. Only otherwise does it download from the source.

If someone has changed files in the program by hand, Naima won't touch it.
Publish those changes as a fork instead ([modifying Naima](install.md#modifying-naima)).
And if your project has no program at all, run any copy of Naima you have
from inside the project ([fresh clones and worktrees](install.md#fresh-clones-and-worktrees)).

## Settings nothing reads any more

`naima check` points out any option in `naima.json`'s plugins table that the
plugin doesn't recognise. Usually that is something a newer Naima stopped
using, or a typo. It names the option, and
`naima plugin set <plugin> <option>=` removes it. `naima update` removes
these options by itself, and says which ones it removed.

## When a teammate updated

Pull their commit and run any `naima` command: it notices the lock moved,
says `naima: locked commit moved <a> → <b>` once, and follows it.

### On a branch opened before the update

`naima check` fails with `one-format` when a branch's new [items](glossary.md#item) are in the old
format and the [trunk](glossary.md#trunk)'s in the new one. Merge the trunk into the branch, then
run `naima update` again: it finishes the migration of the branch's items, or
does nothing.

With several branches open, update on a branch of its own and merge it first.

## When `naima.json` names a different source

If a pulled `naima.json` names another repository — someone switched to a
fork — every command refuses to run it, naming both. Find out why it changed,
then:

```sh
naima update --accept-source
```

It also rewrites `naima-tracker/README.md`, which names the source a fresh
clone restores the program from, when Naima wrote that file; commit it with
`naima.json`.

## When the repository has moved

A repository that moved, say to another GitHub organization, still answers
at its old address, which redirects. `naima update`, `naima update --check`
and `naima hello` say so when they reach the source, with the new address:
set `source` in `naima.json` to it, then run `naima update --accept-source`.

## What can go wrong

| Naima says | Do |
|---|---|
| the program directory has local changes, or commits its source does not have | someone changed Naima in place: publish the change as a fork and set `source` ([modifying Naima](install.md#modifying-naima)) |
| it cannot reach the locked commit | the source was rewritten or deleted: point `source` at a repository that has it |
| no network, and no copy yet | connect once; once the commit is in the user's cache every copy of it works offline |

Everything about the lock, alignment and the copy: [install](install.md).
