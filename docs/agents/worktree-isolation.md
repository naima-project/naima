# Worktree isolation

Worktree isolation is a requirement of the system, not a preference. Every
other [flow](../guide/glossary.md#flow) is written to follow it, and a
procedure that breaks it has a defect. Each rule below is also stated on
[the rules page](../guide/rules.md#branches-and-worktrees), where it is marked
as enforced or as a convention. This page explains why each rule exists and
how to follow it.

## The five rules

### 1. A worktree writes to its own branch and nowhere else

No tool, flow or session writes into another checkout or commits onto a
branch it isn't on. Reading other branches is fine, and that is how every
shared view is built.

### 2. Nobody commits on the trunk while branches are being prepared

If someone commits on the [trunk](../guide/glossary.md#trunk) while a branch
is being prepared, that branch is left out of date. The trunk is no longer
its ancestor, so before it can land, the worker has to merge the trunk in,
resolve any conflicts and run its gates again. Work in progress therefore
goes on a branch:

```sh
naima open <item> --as <who> --name <what>
```

If it happens anyway, move the commit onto the branch and rewind the trunk,
so that git proves the result rather than a merge covering it up:

```sh
git -C <worktree> cherry-pick <sha>     # the commit joins the branch
git reset --keep <sha>^                 # the trunk goes back one; --keep, never --hard
```

The commit then lands with the branch, as a
[marker](../guide/glossary.md#marker) (rule 3). Once the trunk's first-parent
line contains a marker, `naima check` notes every commit made directly on the
trunk after it (the check `landings-are-markers`), unless the commit only
adds to the tracker data
([the rule](../guide/rules.md#every-landing-is-a-marker-naming-the-items-it-closes)).

Whether a project allows direct commits on the trunk at all is the
[owner](../guide/glossary.md#owner)'s call. This rule is only about not doing
it while a branch is being prepared.

### 3. A branch lands up to date, as a marker

A branch keeps being prepared until the trunk is its ancestor, which means it
could be fast-forwarded. It then lands as a
[marker](../guide/glossary.md#marker), which is a merge commit that changes
nothing in what the branch tip holds and names the items it closes. The
coordinator lands it with:

```sh
naima land <branch>
```

The same commit made by hand looks like this:

```sh
git merge-base --is-ancestor main <branch> && \
  git merge --no-ff <branch> -m "Land <branch>" -m "Closes: <item id>"
```

If it refuses, stop. Don't resolve anything on the trunk and don't force it.
The refusal tells you that the trunk moved after the branch was prepared
against it, and the reason it moved decides what to do. Usually that means
merging the trunk into the branch and resolving there (step 6 of
[closing a worktree](closing-a-worktree.md)).

The reason for this rule is that the marker's tree is the branch tip's tree,
so what lands is exactly what the branch's gates judged. Any conflict
resolution belongs on the branch, where the agent that wrote the code is
working. The trunk's first-parent line then becomes the record of landings,
with one marker for each, and `M^1..M^2` lists the commits that marker `M`
landed.

### 4. No shared mutable file

Nothing should require two sessions to edit the same path to register,
announce or log something. That rules out a registry, an index, a board or a
"who is doing what" file.

Where a collection is needed, each session writes its own file, named by a
uuid, into a directory, and the collection is put back together when it is
read. Naima does this for its own state:

| Collection | What each session writes | Recombined by |
|---|---|---|
| who is working on what | `<tracker>/CLAIMS/<uuid>.json` | `naima claims`, `naima summary` |
| where each session left off | `<tracker>/PASSES/<date>-<uuid>.md` | `naima pass --list`, `naima summary` |
| an [item](../guide/glossary.md#item)'s place on a board | the item's own `section` field | `naima board` |

The views read every local branch: the trunk, every branch not yet merged
into it, and whatever branch each [worktree](../guide/glossary.md#worktree)
is on. A branch checked out in a worktree is read from that worktree's disk,
including uncommitted files. This means that when two workers have
uncommitted claims on the same item, each sees the other's, and the trunk
sees both. It also means a file deleted there but not yet committed is gone
from every view. A branch that no worktree is on is read from its ref, as
committed. Remote-tracking refs aren't read, so a branch that exists only on
another machine is seen once it has been fetched and checked out, or merged.

#### Item slugs across branches

Items are directories, `<type>/<slug>/`, so if two branches open an item with
the same title, both would write `<type>/<slug>/meta.json` and end up in an
add/add conflict. `naima new` prevents this. Before it writes, it reads the
slugs that every other local branch holds under that type, from each
worktree's disk (uncommitted items included) or from the branch's ref, and
takes the next free one (`<slug>-2`, …). When it can't read all the branches,
because git fails or the clone is shallow, the new slug ends with the first
eight characters of the item's uuid instead, which no other branch can pick.

This makes collisions less likely but doesn't rule them out. A branch that
exists only on another machine and hasn't been fetched isn't seen, so two
such branches can still pick the same slug. Outside git there are no other
branches, and nothing is added.

### 5. The smell

> You are about to append a line to a file another session also appends to.

If you notice this, stop and use a directory of uuid-named files instead.

## What is still allowed

- **Reading any branch.** That's how the views work.
- **Several branches claiming one item.** `naima claim` tells you who else
  holds the item rather than refusing, because the point is to know about it,
  not to lock it.

## The shared-stash hazard

`git stash` keeps one stack for the whole repository, not one per worktree,
so every worktree shares it. A bare `git stash pop` in your checkout can
apply another session's stash and put its half-finished work into your
files. A stash taken just to measure a clean baseline can also swap files out
from under a process that is reading them at that moment.

- **Prefer a temporary WIP commit** to a stash: `git commit -m "WIP: not
  reviewed"`, which you undo later with `git reset --soft HEAD^` or amend
  away. A commit belongs to you alone, whereas the stash stack doesn't.
- **If a stash is unavoidable**, push it with a unique message (`git stash
  push -m "<branch>-<why>"`) and apply it by its sha
  (`git stash apply stash@{n}` only right after pushing it, or
  `git apply "$(git stash show -p <sha>)"`). Never use a bare `pop`. To drop
  it, find the entry again by its message rather than by its position,
  because positions shift as other sessions push and pop.
- **Never stash to measure a baseline while a resource is running.** A
  baseline is recorded once and read back
  ([closing a worktree](closing-a-worktree.md#5-run-the-gates-and-read-what-breaks)),
  rather than measured again by temporarily removing someone else's changes.

## Safety rules

- **A worktree writes to its own branch and nowhere else.** Enforced: no
  Naima command writes to a path outside the worktree it was run in.
- **Nobody commits on the trunk while a branch is being prepared.** This is a
  convention while `preparing` is unset, and checked once it is set
  (`naima claim --preparing`,
  [closing a worktree](closing-a-worktree.md#0-say-the-branch-is-being-prepared)).
- **A branch lands up to date, as a marker.** Enforced: `naima land` refuses
  a branch whose ancestor isn't the trunk, and moves the trunk only if it
  hasn't moved in the meantime. A landing made by hand is a convention that
  is checked afterwards. From the first marker on the trunk's first-parent
  line onwards, the check `landings-are-markers` notes every commit on that
  line that isn't a marker, except a commit made on the trunk that only adds
  to the tracker data. Nothing blocks such a commit yet, and a git hook
  that a project can opt into is [planned](../planned.md#blocking-a-landing-that-is-not-a-marker).
- **No shared mutable file.** Convention, kept by the one-file-per-session
  layout above. Nothing yet fails a hand-made shared log kept outside the
  tracker, which makes this a candidate property for a later model.
- **Never `git stash pop` in a shared worktree set.** Candidate property for
  a later model. Nothing yet checks that a stash was applied by sha rather
  than popped, so for now this is read rather than verified.
