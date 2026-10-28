# Work on several branches at once

Several people or agents can work on one project at the same time without getting in each other's way, using nothing but git. Each piece of work has its own
[worktree](glossary.md#worktree) and its own [branch](glossary.md#branch) ([the rule](rules.md#one-worktree-per-piece-of-work)). The agents run the commands on
this page for you, unless you want to run them yourself.

## Start a piece of work

```sh
naima open export-drops --as ada --name export-alpha --note "fixing the alpha channel"
cd ../project-worktrees/export-alpha
git add naima-tracker && git commit -m "Claim export-drops"
```

- `naima open` makes a second checkout in its own folder, on a new branch from the [trunk](glossary.md#trunk), and claims the item there. The branch is named
  `<who>/<what>` (here `ada/export-alpha`), and the folder is `<what>` in the worktrees directory, which is `<project>-worktrees` beside the main checkout.
  `naima check` fails on a worktree or branch that doesn't follow this scheme, and on a worktree that has work but no claim. A worktree elsewhere that carries
  no claim, such as one made before Naima was installed, is left alone with a note
  ([the rule](rules.md#worktrees-and-branches-are-named-by-one-scheme-and-every-worktree-carries-a-claim)). Install the project's dependencies there before
  running anything.
- `naima open` refuses a new worktree once as many worker worktrees are open as the coordination option `maxWorkers` allows (3 by default), because every worker
  is paid for while it runs. The refusal lists the open ones; remove one that has landed with `naima prune --branch <branch> --write`, give related items to one
  worker, or raise the bound in `naima.json`: `"plugins": { "coordination": { "options": { "maxWorkers": 4 } } }`.
- The first `naima` command run in the new worktree fetches its own copy of Naima from the main checkout's copy, at the same locked commit.
- The claim is a single file belonging to this branch, saying what it works on, and `naima claim` adds items to it. Others see it straight away, but nobody is
  locked out. Several branches may claim the same [item](glossary.md#item), and `claim` tells you who else holds it.

## See who is doing what

```sh
naima claims        # every claim, from every local branch
naima summary       # the same, with the last session notes
naima claim --step "running the gates"    # say what this branch is doing now
```

These views read every local branch and every worktree's folder, including uncommitted files. A branch that exists only on someone else's machine shows up once
it has been fetched and checked out.

`naima claim --step` writes what the branch is doing now into its claim, with the time, replacing the previous step. `naima claims` and `naima summary` show the
step and how many minutes ago it was posted. When neither a step nor a commit on the branch is newer than the coordination option `silentAfter` (15 minutes by
default), the claim is marked "silent for N min — possibly stuck".

## Finish a piece of work

From inside the worktree:

```sh
naima claim --preparing     # told when the trunk moves under the branch
naima release export-drops
naima pass "Fixed export of the alpha channel; proven by tests/export-keeps-alpha; layered PSD files not tried" --ack "<line>"
naima check
git add -A && git commit -m "Release the claim; session note"
git merge --no-edit main
```

- `naima release` drops this branch's claim. Run it here, not on the [trunk](glossary.md#trunk).
- `naima claim` refuses to run on the trunk: a claim there would be copied to every branch that merges the trunk. A claim naming the trunk that an older
  program wrote is stale, refuses no `naima close`, and `naima prune --write` removes it.
- `naima pass` writes a [session note](glossary.md#session-note) saying what changed, what is proven, and what was **not** verified.
- Merging the trunk into the branch first makes the trunk its ancestor, which landing requires. Resolve any conflicts here and run the checks again.

Then, from the main checkout, on the trunk:

```sh
naima land ada/export-alpha                     # one marker commit, Closes: export-drops
naima prune --branch ada/export-alpha --write   # the worktree and the branch
```

`naima land` makes a [marker](glossary.md#marker), which is a merge commit with the branch tip's tree that names each item it closes in a `Closes:` trailer. To
do the same by hand, run this:
`git merge-base --is-ancestor main ada/export-alpha && git
merge --no-ff ada/export-alpha -m "Land ada/export-alpha" -m "Closes: <item
id>"`.

Right after the marker, `naima land` makes one more commit on the trunk. It adds the marker's hash to the `commits` field of each item the marker closes,
keeping the hashes already there, so `naima close` finds a commit reachable from the trunk with no hand step. The check that reads the trunk accepts that commit
as part of the landing. A landing made by hand needs `naima set <item> commits=<marker>` instead.

Before the trunk moves, `naima land` checks the proofs of what the branch changed. A property verified on a file the branch changed has to hold on a current
run, and a test suite that reads one has to have a passing recorded run on the branch's files. Models in development are left out. If something isn't current,
nothing lands: the worker runs `naima verify` or `naima metrics run --record` on the branch and commits the runs. When a proof can't be made current before
landing, for instance because it takes days, `--stale-proofs "<reason>"` lands the branch anyway, and the marker keeps the reason in a `Stale-proofs:` trailer
([when the rules apply](prove-and-close.md#when-the-rules-apply)).

A branch that changes only tracker data, such as the notes and decisions of a review, may close no item. `naima land <branch> --tracker-only "<reason>"`
lands it anyway, and the marker keeps the reason in a `Tracker-only:` trailer in place of `Closes:`. It still closes the items the branch claimed or that
`--closes` names, once they are done or fixed. It is refused when the branch changes any file outside the tracker data, and the check that reads the trunk
notes a `Tracker-only:` marker made by hand that does.

`prune --branch` deletes a branch only when its commits are held by the trunk or by an `archive/<branch>` tag. `--archive` makes that tag, for work that is set
aside rather than merged. It removes the worktree only when nothing in it is uncommitted, inside its submodules too; a clean worktree that holds a submodule,
which git removes only when forced, is then removed with `git worktree remove --force`.

If `naima land` refuses because the trunk is not an ancestor of the branch, stop, because the trunk has moved. Merge it into the branch again, on the branch
([the rule](rules.md#every-landing-is-a-marker-naming-the-items-it-closes)).

## One writer: no locks

Naima has no locks. A claim says who is working on what, and it never excludes anyone. The things that only one session at a time should touch, which are the
trunk, the published site and the release tags, have a single writer, the coordinator. Only the coordinator lands branches on the trunk, pushes it, publishes
the site and makes releases, always from the trunk, and when it matters the owner decides what lands and when. Every worker prepares its part on its own branch
(the code, the site's sources, a draft of the release notes) and hands the branch over to be landed
([the rule](rules.md#no-locks-the-coordinator-is-the-single-writer)).

A role can own a kind of work without writing to the trunk. A project declares its own roles in the roles plugin's `roles` option. For example, a website
manager could prepare the site's changes, and its queue (`naima queue --role website-manager`) would list the items of kind `site` that everyone else files:

```sh
naima plugin set roles 'roles={"website-manager":{"title":"Website manager","owns":"the site'"'"'s sources: it prepares every site change on its branch","refuses":["making a site change filed by someone else without its item"],"kinds":["site"],"types":[]}}'
naima new todos "Site: fix the install line" --set kind=site
```

## Two branches, one title

Two branches that open an item with the same title would create the same folder, so `naima new` first looks at every other local branch and picks a free name
(`…-2`). It can't see a branch on another machine that hasn't been fetched yet, so collisions are rarer but still possible. When one happens, git reports it at
the merge.

## Claims left behind

```sh
naima prune            # stale claims, and why each is stale
naima prune --write    # remove them; commit the deletions
```

A claim is stale when its branch is gone, when it names the trunk, when its branch is merged into the trunk and the merge brought its file there, or when every item it claims is done or
closed. `naima claims` lists stale claims apart, at the end, and `naima
check` adds a note for each one. A claim that still names an item already closed, next
to items that are still open, gets a note of its own with the `naima release` that drops the closed item.

## Work left behind

```sh
naima stale            # every branch, worktree and claim left behind, with the next step
naima stale --json     # the same, as data
```

Workers stop without warning: a session ends, an agent crashes. `naima stale` lists what they leave behind. A branch counts as stale when its claim is stale, or
when nothing has happened on it for `staleAfter` hours (24 unless the project sets another number in the coordination plugin's options). Something happening
means a commit, a step posted with `naima claim --step`, a session note written on the branch, or a file changed in its worktree and not yet committed.

For each one it shows the worktree, the last commit, the files not committed, how many commits the trunk lacks and whether the branch is up to date with the
trunk, and the items its claim holds with their status. Then it suggests what to do next, and the command for it:

- **resume** when anything is not committed, or the branch is behind the trunk with open items: hand the worktree to a new worker, who looks at `git status`
  first and never throws away what is there;
- **land** when the branch is ahead of the trunk, up to date with it and holds open items: run its gates, then `naima land <branch>`;
- **archive** when it has commits the trunk lacks but no open item claimed: `naima prune --branch <branch> --archive --write` keeps them under an
  `archive/<branch>` tag;
- **drop** when the trunk already has everything, or the branch is gone: `naima prune --branch <branch> --write`, then `naima prune --write` for the claim.

`naima summary` has a "stale work" section with one line per entry, so the leftovers show up at the start of a session without asking.

Only release someone else's claim by hand when nothing is being worked on there and nothing on that branch is left unmerged.

## The full procedure

The procedure the agents follow, with the reason for every step, is in [opening a worktree](../agents/opening-a-worktree.md),
[closing a worktree](../agents/closing-a-worktree.md) and [worktree isolation](../agents/worktree-isolation.md).
