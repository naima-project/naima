# Closing a worktree

This page lists everything that has to be true before a branch lands, in the
order that makes each step possible. Several of the steps can't be done from
the [trunk](../guide/glossary.md#trunk) afterwards, and the first one is the
step most often skipped.

The rules it applies are on [the rules page](../guide/rules.md#branches-and-worktrees),
and this page is the procedure. Preparing the branch is the developer's work,
done by a worker in the branch's own worktree, through step 7. Deciding that
the branch may enter the trunk is a separate call, because whoever wrote the
code doesn't also decide that it ships. The coordinator lands it (step 7).

## 0. Say the branch is being prepared

```sh
naima claim --preparing
```

From then on, `naima check` notes every commit the trunk takes that the
branch lacks, so you can merge it in again (step 6). It also names each
commit that the trunk's reflog records as made on the trunk directly, outside
the flow ([worktree isolation](worktree-isolation.md#2-nobody-commits-on-the-trunk-while-branches-are-being-prepared)).
While the mark is set, releasing the last item (step 3) keeps the claim file,
empty, to hold the mark. `naima claim --not-preparing` drops the mark and
removes that file, just before the hand-over (step 7).

## 1. Every fix names the gesture that would prove it

A fix feels finished once the tests are green, but it isn't resolved until
something proves it, and that proof must be visible on the board. It has to
be a test [item](../guide/glossary.md#item) linked `verifies`, not a checkbox
inside the fixed item's own page.

```sh
naima new tests "Export keeps the alpha channel" --set runBy=agent
naima link export-keeps verifies export-drops
```

Write the gesture so that someone who wasn't in this session can perform it:
where to be, what to do, and what must appear. Include the negative half
whenever the fix has one, because a rule that always fires is the same defect
the other way round. Set `runBy` according to the instrument that settles it,
and a gesture for a person also says `humanBecause`
([asking the human](asking-the-human.md)).

Name the evidence the test carries in `evidenceKind`, following
[the ranking](../guide/prove-and-close.md#3-perform-it-keep-the-evidence).
The owner's gesture ranks highest, then a screenshot, log line or number,
then the live state read by tooling, then a before-and-after comparison. "The
code looks right" proves nothing. Never report a number without the one it is
compared with. A test that verifies a bug is run red first, on the code
before the fix, so record that day in `redSeen` and keep the failing run
alongside the passing one.

If nobody can find a test, nobody will run it, so
[triage](../guide/glossary.md#triage) it like any other item.

When the item follows a spec (`specified-by`), confirm that the code matches
the spec's current version and say so in the test's result. `naima check`
notes an open item that still follows a superseded version. When the item
satisfies a requirement, link the same test as `verifies` the requirement
too, and set the requirement to `met` once that test has passed.
`naima check` refuses a `met` requirement that has no passing proof.

The [proof](../guide/glossary.md#proof) is the gesture as it stands now, not
as it once stood. `naima close` refuses an item that a verifying item refutes
(a failed test, a violated property). It also refuses one whose verifying
item `naima check` reports, for example a property where the model, an
included file or the tool version has changed since its run
([closing](reporting-and-triage.md#8-closing)).
A property run whose output begins with `tool missing:` proves nothing. Say
in the report that the tool wasn't installed and the property is unverified.
Don't install a model checker without the owner's go-ahead, because it is a
download.

## 2. Triage what is left open

You are the last one who looked at these items, so set what you know. That
goes especially for `effort`, which nobody else can judge:

```sh
naima triage missing
naima triage set <item> effort=M
```

## 3. Release the claims — from the worktree

```sh
naima release <item>...
```

`release` acts on the branch you are on. If you ran it from the trunk after
the landing, it would release the trunk's claims and leave the branch's
behind. It deletes your own [claim file](../guide/glossary.md#claim-file) but
commits nothing, so commit the deletion on the branch and it lands with the
work. `naima land` refuses a branch whose tip still holds its claim file, and
it takes the items the branch closes from the claims the branch committed and
then released.

Claims outlive their work when someone forgets to release them. Release
another branch's claim only when both of these hold: nothing is being worked
on there, and nothing there is unlanded. Neither test is enough on its own,
because a [worktree](../guide/glossary.md#worktree) that is gone can still
have an unmerged branch, and a merged branch can still have a live session
working on it. The cases you can handle mechanically are the stale claims:
one naming a branch that git no longer has, one whose branch is merged into
the trunk and whose file the merge brought to the trunk, and one whose items
are all closed. `naima claims` lists them apart and `naima check` notes each
one:

```sh
naima prune            # list them, with why each is stale
naima prune --write    # remove the ones on this disk, then commit the deletions
```

A stale file another branch carries is listed with that branch, and is
removed by running `naima prune --write` there. A worker still busy on a
merged branch makes its claim live again with its next commit.

## 4. Write the session note

```sh
naima pass "what changed, what is proven, what is left"
```

The note is one file of your own, on your own branch, committed with the
work. Someone who reads only that note must be able to tell what landed, what
is still unproven, and what to pick up next. Say what was **not** verified,
because that is worth more to the next reader than the list of what was.
Don't rewrite another session's note, and don't number yours.

If the branch changes how the software behaves, it also carries a change
note. That applies in any repository with a `changes/config.json`, which
lists the paths that count: the project itself, or a product it holds as a
submodule. Behaviour includes commands and options, how the software is used,
and the workflows and rules agents follow. Write one Markdown file in that
repository's `changes/` folder, in the format its
[`changes/README.md`](../../changes/README.md) describes, and commit it with
the change. `naima check` notes a branch that changes those paths without
one. If nothing anyone can see changes, such as a refactor or a new test,
say so in the hand-over instead (step 7), so the coordinator can give the
reason when landing
([the rule](../guide/rules.md#every-change-of-behaviour-carries-a-change-note)).

## 5. Run the gates, and read what breaks

Run the project's full [gate](../guide/glossary.md#gate) set, including
`naima check`. Where the project declares
[metrics](../guide/metrics-and-budgets.md), also run
`naima metrics run --record` and commit the record with the work. Report each
number together with the one it is compared to, as the command prints it. A
bound loosened to make the work fit is refused unless an item says why
(`--because`). If a red result arrives with the trunk, don't absorb it
quietly. Find out where it comes from (a detached worktree at the trunk
settles it in one command), and if it is the trunk's, open an item and say so
in the [session note](../guide/glossary.md#session-note).

## 6. Merge the trunk into the branch

```sh
git merge --no-edit main
git merge-base --is-ancestor main HEAD && echo "ready to land"
```

This makes the trunk an ancestor of the branch, which landing requires.
Resolve any conflicts here, where you still have the context. Then run step 5
again, because the merge brought in code you haven't tested together with
yours.

## 7. Hand it over

Drop the mark and commit the removal with `naima claim --not-preparing`. Then
tell the coordinator the branch, the items it closes, anything that arrives
red and where it comes from, and what is left open along with its gesture.
Every landing closes at least one item, so work that is only partly done is
split: the done part is closed and the rest is filed as a new item.

The [coordinator](coordinator-and-workers.md) lands the branch on the trunk,
from the main checkout:

```sh
naima land <branch>                       # items from the branch's released claims
naima land <branch> --closes <item>       # or named; repeatable
```

This makes one [marker](../guide/glossary.md#marker) commit, whose tree is
the branch tip's tree, whose parents are the trunk and the branch tip, and
whose message is `Land <branch>` with one `Closes: <item id>` trailer per
item. It first brings the main checkout's files to the branch tip's and
checks the proofs of what the branch changed there. Then it moves the trunk,
only if the trunk hasn't moved in the meantime, and says when a submodule
moved (`git submodule update --init`). When it refuses after that first
step, the files go back and nothing has moved. It refuses when:

- it isn't run from the main checkout, on the trunk;
- the trunk isn't an ancestor of the branch, in which case merge the trunk
  into the branch and run its gates again (step 6);
- the branch has nothing the trunk lacks;
- the main checkout has uncommitted changes to tracked files;
- the branch tip still holds its claim file (step 3);
- it can't name an item the branch closes;
- an item it closes is open and not fixed, meaning its status isn't done and
  `fixedOn` isn't set;
- the branch changes a path that a `changes/config.json` lists, in the
  project or in a submodule, and adds no change note there. If nothing
  anyone can see changes, land it with `--no-change-note "<reason>"`, and
  the marker keeps the reason in a `No-change-note:` trailer;
- a proof of what the branch changed isn't current: a property verified on a
  file it changed that doesn't hold on a current run, or a test suite that
  reads such a file with no passing recorded run on the branch's files,
  models in development left out. The worker runs `naima verify` or
  `naima metrics run --record` on the branch and commits the runs. A proof
  that can't be made current before landing, such as a suite that runs for
  days, is landed with `--stale-proofs "<reason>"`, and the marker keeps the
  reason in a `Stale-proofs:` trailer;
- an untracked file in the main checkout would be overwritten, in which case
  nothing moves.

The same commit, made by hand:

```sh
git merge-base --is-ancestor main <branch> && \
  git merge --no-ff <branch> -m "Land <branch>" -m "Closes: <item id>"
```

A hosting platform's merge button, with branches required to be up to date,
produces the same shape. If either of them refuses, stop
([worktree isolation](worktree-isolation.md#3-a-branch-lands-up-to-date-as-a-marker)).
`naima land` then prints the next steps, which are to `naima close` each item
once its proof has been checked, and then step 8.

### When the work is in a product held as a submodule

Some projects keep the product they ship in a git submodule and track it from
the repository around it, as Naima's own workshop holds Naima in `naima/`.
The work is then two branches: one in the submodule with the code and its
change note, and one in the project with the tracker changes and the new
pointer. The product's own history lands the same way, as markers, so each
change note arrives together with the items its landing closes. The
coordinator lands the product first, then the project:

```sh
# 1. In the main checkout's submodule: the product branch, up to date with the product's main, as a marker.
git -C naima fetch <the worker's worktree>/naima <branch>
git -C naima switch main
git -C naima merge-base --is-ancestor main FETCH_HEAD && \
  git -C naima merge --no-ff FETCH_HEAD -m "Land <branch>" -m "Closes: <item id>"
git -C naima push origin main

# 2. On the project branch: the pointer moves to that marker.
git -C <the worker's worktree>/naima fetch origin main && git -C <the worker's worktree>/naima switch --detach origin/main
git -C <the worker's worktree> add naima && git -C <the worker's worktree> commit -m "Naima at its landing of <branch>"

# 3. The project branch lands as usual.
naima land <branch>
```

A product branch that changes behaviour with no change note gets the same
`No-change-note: <reason>` trailer in step 1 that `naima land` writes in step
3. `naima land` reads the product's commits between the trunk's pointer and
the branch's, so the submodule in the main checkout has to hold them: step 1
puts them there.

## 8. Only then, remove the worktree and the branch

```sh
naima prune --branch <who>/<what>             # what would go
naima prune --branch <who>/<what> --write     # remove the worktree, delete the branch
```

Run this from the main checkout. It refuses a branch that has commits the
trunk lacks, unless an `archive/<branch>` tag holds them. `--archive` makes
that tag first, so abandoned work can still be recovered
(`git switch -c <branch> archive/<branch>`). Never `git branch -D` a branch
whose work isn't on the trunk. Before a bulk sweep of the tracker, where many
items are closed, moved or deleted in one go, tag the point where it starts
with `git tag checkpoint/<date>-<what>`.

## Not part of closing

- **Closing the branch's own items.** An item is closed once it is fixed
  *and* proven by a gesture. A branch that closes its own items because its
  own tests are green is marking its own homework. `naima close` refuses
  anything that isn't resolved, and it refuses an item claimed by the branch
  you are on. Close it from the trunk after the landing, once someone else
  has checked the proof. `naima close --force` is for whoever owns the
  [evidence](../guide/glossary.md#evidence), to record a proof that someone
  else performed.
- **Deleting the scratchpad.** It was never tracked.

## Safety rules

- **Whoever fixes does not also close.** Enforced: `naima close` refuses an
  item claimed by the branch you are on, and `naima close --force` is
  reserved for the evidence owner recording a proof someone else performed
  ([not part of closing](#not-part-of-closing)).
- **A branch not up to date is never forced in.** Enforced: `naima land`
  refuses a branch the trunk isn't an ancestor of, and lands nothing if the
  trunk moved in the meantime. When landing by hand the convention is that
  `git merge-base --is-ancestor` comes first, and its refusal is read as
  information rather than worked around
  ([worktree isolation](worktree-isolation.md#3-a-branch-lands-up-to-date-as-a-marker)).
- **Every landing is a marker naming the items it closes.** Enforced by
  `naima land`. A landing made by hand is checked by `landings-are-markers`,
  which notes every commit on the trunk's first-parent line, from the first
  marker onwards, that isn't a marker. The exception is a commit made on the
  trunk that only adds to the tracker data: new files in the data directory
  outside `rules/`, `waivers/` and `naima.json`, and lines added to an
  item's `README.md`. The coordinator may file an item, append a note, write
  a diary entry or a session note that way, without a branch. A noted commit
  the project accepts is waived once, `naima waive landings-are-markers
  <commit> --reason "<why>"`
  ([the rule](../guide/rules.md#every-landing-is-a-marker-naming-the-items-it-closes)).
- **No branch is deleted while it still holds work the trunk lacks.**
  Enforced by `naima prune`, which refuses without an `archive/<branch>` tag.
- **A fix is not resolved until a gesture proves it.** Enforced by
  `naima close`, which refuses anything that isn't
  [resolved](../guide/glossary.md#resolved).
