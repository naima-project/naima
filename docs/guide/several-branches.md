# Work on several branches at once

Several people or agents can work on one project at the same time without
getting in each other's way, using nothing but git. Each piece of work has its
own [worktree](glossary.md#worktree) and its own [branch](glossary.md#branch)
([the rule](rules.md#one-worktree-per-piece-of-work)). The agents run the
commands on this page for you, unless you want to run them yourself.

## Start a piece of work

```sh
naima open export-drops --as ada --name export-alpha --note "fixing the alpha channel"
cd ../project-worktrees/export-alpha
git add naima-tracker && git commit -m "Claim export-drops"
```

- `naima open` makes a second checkout in its own folder, on a new branch
  from the [trunk](glossary.md#trunk), and claims the item there. The branch
  is named `<who>/<what>` (here `ada/export-alpha`), and the folder is
  `<what>` in the worktrees directory, which is `<project>-worktrees` beside
  the main checkout. `naima check` fails on a worktree or branch that doesn't
  follow this scheme, and on a worktree that has work but no claim
  ([the rule](rules.md#worktrees-and-branches-are-named-by-one-scheme-and-every-worktree-carries-a-claim)).
  Install the project's dependencies there before running anything.
- The first `naima` command run in the new worktree fetches its own copy of
  Naima from the main checkout's copy, at the same locked commit.
- The claim is a single file belonging to this branch, saying what it works
  on, and `naima claim` adds items to it. Others see it straight away, but
  nobody is locked out. Several branches may claim the same
  [item](glossary.md#item), and `claim` tells you who else holds it.

## See who is doing what

```sh
naima claims        # every claim, from every local branch
naima summary       # the same, with the last session notes
```

These views read every local branch and every worktree's folder, including
uncommitted files. A branch that exists only on someone else's machine shows
up once it has been fetched and checked out.

## Finish a piece of work

From inside the worktree:

```sh
naima claim --preparing     # told when the trunk moves under the branch
naima release export-drops
naima pass "Fixed export of the alpha channel; proven by tests/export-keeps-alpha; layered PSD files not tried"
naima check
git add -A && git commit -m "Release the claim; session note"
git merge --no-edit main
```

- `naima release` drops this branch's claim. Run it here, not on the
  [trunk](glossary.md#trunk).
- `naima pass` writes a [session note](glossary.md#session-note) saying what
  changed, what is proven, and what was **not** verified.
- Merging the trunk into the branch first makes the trunk its ancestor,
  which landing requires. Resolve any conflicts here and run the checks
  again.

Then, from the main checkout, on the trunk:

```sh
naima land ada/export-alpha                     # one marker commit, Closes: export-drops
naima prune --branch ada/export-alpha --write   # the worktree and the branch
```

`naima land` makes a [marker](glossary.md#marker), which is a merge commit
with the branch tip's tree that names each item it closes in a `Closes:`
trailer. To do the same by hand, run this:
`git merge-base --is-ancestor main ada/export-alpha && git
merge --no-ff ada/export-alpha -m "Land ada/export-alpha" -m "Closes: <item
id>"`.

`prune --branch` deletes a branch only when its commits are held by the
trunk or by an `archive/<branch>` tag. `--archive` makes that tag, for work
that is set aside rather than merged.

If `naima land` refuses because the trunk is not an ancestor of the branch,
stop, because the trunk has moved. Merge it into the branch again, on the
branch ([the rule](rules.md#every-landing-is-a-marker-naming-the-items-it-closes)).

## One writer: no locks

Naima has no locks. A claim says who is working on what, and it never
excludes anyone. The things that only one session at a time should touch,
which are the trunk, the published site and the release tags, have a single
writer, the coordinator. Only the coordinator lands branches on the trunk,
pushes it, publishes the site and makes releases, always from the trunk, and
when it matters the owner decides what lands and when. Every worker prepares
its part on its own branch (the code, the site's sources, a draft of the
release notes) and hands the branch over to be landed
([the rule](rules.md#no-locks-the-coordinator-is-the-single-writer)).

A role can own a kind of work without writing to the trunk. A project
declares its own roles in the roles plugin's `roles` option. For example, a
website manager could prepare the site's changes, and its queue
(`naima queue --role website-manager`) would list the items of kind `site`
that everyone else files:

```sh
naima plugin set roles 'roles={"website-manager":{"title":"Website manager","owns":"the site'"'"'s sources: it prepares every site change on its branch","refuses":["making a site change filed by someone else without its item"],"kinds":["site"],"types":[]}}'
naima new todos "Site: fix the install line" --set kind=site
```

## Two branches, one title

Two branches that open an item with the same title would create the same
folder, so `naima new` first looks at every other local branch and picks a
free name (`…-2`). It can't see a branch on another machine that hasn't been
fetched yet, so collisions are rarer but still possible. When one happens,
git reports it at the merge.

## Claims left behind

```sh
naima prune            # claims naming a branch git no longer has
naima prune --write    # remove them; commit the deletions
```

Only release someone else's claim by hand when nothing is being worked on
there and nothing on that branch is left unmerged.

## The full procedure

The procedure the agents follow, with the reason for every step, is in
[opening a worktree](../agents/opening-a-worktree.md),
[closing a worktree](../agents/closing-a-worktree.md) and
[worktree isolation](../agents/worktree-isolation.md).
