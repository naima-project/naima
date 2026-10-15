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
`Naima is active in this repository: version 1.0.0, commit 45ba22c1134c.`
The version is the latest release tag at or before the locked commit. After
that comes what Naima found about newer versions, and a reminder of what you
can ask for: an explanation of Naima and its documentation, a check for an
update, or an update. `naima hello` never changes the lock and never writes
anything in your project.

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
| `update` | It also tells you what the newer Naima would change, and the agent asks whether you want it. |

The default is `check` because it only reads, and changes nothing. Even with
`update`, nothing is applied until you say yes.

## Finding out what an update would change

```sh
naima update --check
```

This tells you whether the [source](glossary.md#source) has a newer Naima
than the one you are locked to. It exits with 1 when it does. In that case
it also lists what would change:

- the commits, by their titles;
- any change to the data [format](glossary.md#format), which means a
  [migration](glossary.md#migration) the update will run for you;
- rules added to or removed from [the rules page](rules.md);
- settings in `naima.json` that the newer Naima no longer reads, by name,
  for example `plugins.coordination.options.resources`.

To find this out, Naima reads the newer version's code straight from its own
git copy, into a temporary folder that it deletes afterwards. Your project
is not touched.

## Updating

```sh
naima update
naima check
git add naima-tracker && git commit -m "Update Naima to <commit>"
```

`naima update` shows what changes, downloads the newer Naima, switches the
program to it, migrates your data if the format changed, and records the new
commit in the lock. If anything fails along the way, the previous version
stays in place. You then review the change and commit it, like any other.

To move to a particular commit of the source's main branch rather than the
newest one, use `naima update --to <commit>`.

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
`naima plugin set <plugin> <option>=` removes it.

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

## What can go wrong

| Naima says | Do |
|---|---|
| the program directory has local changes, or commits its source does not have | someone changed Naima in place: publish the change as a fork and set `source` ([modifying Naima](install.md#modifying-naima)) |
| it cannot reach the locked commit | the source was rewritten or deleted: point `source` at a repository that has it |
| no network, and no copy yet | connect once; once the commit is in the user's cache every copy of it works offline |

Everything about the lock, alignment and the copy: [install](install.md).
