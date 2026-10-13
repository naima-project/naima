# Closing a worktree

Everything that has to be true before a branch lands, in the order that
makes each step possible. Several steps cannot be done from the [trunk](../guide/glossary.md#trunk)
afterwards, and the first is the one most often skipped.

The rules it applies are on [the rules page](../guide/rules.md#branches-and-worktrees);
this page is the procedure. Preparing the branch is the developer's work. Deciding that it may enter the
trunk is a separate call: whoever wrote the code does not also decide it
ships.

## 0. Say the branch is being prepared

```sh
naima claim --preparing
```

From then on `naima check` notes every commit the trunk takes that the
branch lacks — merge it in again (step 6) — and names each one the trunk's
reflog records as committed on the trunk directly, outside the flow
([worktree isolation](worktree-isolation.md#2-nobody-commits-on-the-trunk-while-branches-are-being-prepared)).
While the mark is set, releasing the last item (step 3) keeps the claim
file, empty, to hold it; `naima claim --not-preparing` drops the mark and
removes that file, just before the hand-over (step 7).

## 1. Every fix names the gesture that would prove it

The fix feels finished when the tests are green. It is not resolved until
something proves it, and that something must be visible to the board: a test
[item](../guide/glossary.md#item) linked `verifies`, not a checkbox inside the fixed item's own page.

```sh
naima new tests "Export keeps the alpha channel" --set runBy=agent
naima link export-keeps verifies export-drops
```

Write the gesture so someone who was not in this session can perform it:
where to be, what to do, what must appear — and the negative half whenever
the fix has one, because a rule that always fires is the same defect the
other way round. Set `runBy` by the instrument that settles it; a person's
gesture also says `humanBecause` ([asking the human](asking-the-human.md)).

Name the evidence the test carries in `evidenceKind`, by
[the ranking](../guide/prove-and-close.md#3-perform-it-keep-the-evidence):
the owner's gesture, then a screenshot, log line or number, then the live
state read by tooling, then a before-and-after comparison; "the code looks
right" proves nothing. Never report a number without the one it is compared
with. A test that verifies a bug is run red first, on the code before the fix:
record the day in `redSeen` and keep the failing run with the passing one.

A test nobody can find is a test nobody runs: [triage](../guide/glossary.md#triage) it like any item.

When the item follows a spec (`specified-by`), confirm the code matches the
spec's current version, and say so in the test's result; `naima check` notes an
open item that still follows a superseded version. When it satisfies a
requirement, link the same test `verifies` the requirement too, and set the
requirement `met` once that test has passed — `naima check` refuses a `met`
requirement with no passing proof.

The [proof](../guide/glossary.md#proof) is the gesture as it stands, not as it once stood: `naima close`
refuses an item that a verifying item refutes (a failed test, a violated
property), and one whose verifying item `naima check` reports — a property
that holds on a model, an included file or a tool version changed since its
run
([closing](reporting-and-triage.md#8-closing)).
A property run whose output begins `tool missing:` proves nothing: say in the
report that the tool was not installed and the property is unverified, and
do not install a model checker without the owner's go — it is a download.

## 2. Triage what is left open

You are the last person who looked at these items. Set what you know;
`effort` especially, which nobody else can:

```sh
naima triage missing
naima triage set <item> effort=M
```

## 3. Release the claims — from the worktree

```sh
naima release <item>...
```

`release` acts on the branch you are standing on. Run from the trunk after
the landing, it would release the trunk's claims and leave the branch's behind.
It deletes your own [claim file](../guide/glossary.md#claim-file) and commits nothing: commit the deletion on the
branch, so it lands with the work. `naima land` refuses a branch whose tip
still holds its claim file, and takes the items the branch closes from the
claims it committed and then released.

Claims outlive their work when someone forgets. Release another branch's claim
only when both hold: nothing is being worked on there, and nothing is
unlanded. Neither test alone is enough — a gone [worktree](../guide/glossary.md#worktree) can still have an
unmerged branch, and a merged branch can still have a live session working on
it. The one mechanical case is a claim naming a branch git no longer has:

```sh
naima prune            # list them
naima prune --write    # remove them, then commit the deletions
```

## 4. Write the session note

```sh
naima pass "what changed, what is proven, what is left"
```

One file of your own, on your own branch, committed with the work. A fresh
reader of only that note must know what landed, what is still unproven, and
what to pick up next. Say what was **not** verified — that sentence is worth
more than the list of what was. Never rewrite another session's note, and
never number yours.

## 5. Run the gates, and read what breaks

The project's full [gate](../guide/glossary.md#gate) set, including `naima check`; where the project
declares [metrics](../guide/metrics-and-budgets.md), `naima metrics run --record` too, and commit the
record with the work. Report each number with the one it is compared to, as the command prints it; a
bound loosened to make the work fit is refused unless an item says why (`--because`). A red result that
arrives with the trunk is not yours to absorb silently: prove where it comes
from (a detached worktree at the trunk settles it in one command), and if it
is the trunk's, open an item and say so in the [session note](../guide/glossary.md#session-note).

## 6. Merge the trunk into the branch

```sh
git merge --no-edit main
git merge-base --is-ancestor main HEAD && echo "ready to land"
```

This makes the trunk an ancestor of the branch, which is what landing
requires. Resolve conflicts here,
where the context is. Then run step 5 again: the merge brought code you have
not tested with yours.

## 7. Hand it over

Drop the mark and commit the removal: `naima claim --not-preparing`. Then say: the branch, the items it closes, what arrives red and from
where, and what is left open with its gesture. Every landing closes at
least one item: work only partly done is split, the done part closed, the
rest filed as a new item.

The [coordinator](coordinator-and-workers.md) lands it, from the main
checkout, on the trunk:

```sh
naima land <branch>                       # items from the branch's released claims
naima land <branch> --closes <item>       # or named; repeatable
```

It makes one [marker](../guide/glossary.md#marker) commit: the branch tip's tree, parents the
trunk and the branch tip, message `Land <branch>` with one `Closes: <item
id>` trailer per item. It moves the trunk only if the trunk has not moved
meanwhile, then updates the main checkout's files to the marker, and says
when a submodule moved (`git submodule update --init`). It refuses when:

- it is not run from the main checkout, on the trunk;
- the trunk is not an ancestor of the branch: merge the trunk into the
  branch and run its gates again (step 6);
- the branch has nothing the trunk lacks;
- the main checkout has uncommitted changes to tracked files;
- the branch tip still holds its claim file (step 3);
- it cannot name an item the branch closes;
- an item it closes is open and not fixed: its status is not done and
  `fixedOn` is not set;
- an untracked file in the main checkout would be overwritten; the trunk
  is put back.

By hand, the same commit:

```sh
git merge-base --is-ancestor main <branch> && \
  git merge --no-ff <branch> -m "Land <branch>" -m "Closes: <item id>"
```

A hosting platform's merge button, with branches required to be up to
date, makes the same shape. If either refuses, stop
([worktree isolation](worktree-isolation.md#3-a-branch-lands-up-to-date-as-a-marker)).
`naima land` then prints the next steps: `naima close` each item once its
proof is checked, then step 8.

## 8. Only then, remove the worktree and the branch

```sh
naima prune --branch <who>/<what>             # what would go
naima prune --branch <who>/<what> --write     # remove the worktree, delete the branch
```

From the main checkout. It refuses a branch with commits the trunk lacks
unless an `archive/<branch>` tag holds them; `--archive` makes the tag
first, so abandoned work stays recoverable (`git switch -c <branch>
archive/<branch>`). Never `git branch -D` a branch whose work is not on the
trunk. Before a bulk sweep of the tracker (many items closed, moved or
deleted in one go), tag where it starts: `git tag checkpoint/<date>-<what>`.

## Not part of closing

- **Closing the branch's own items.** An item is closed once it is fixed
  *and* proven by a gesture, and a branch that closes its own items on the
  strength of its own green tests is marking its own homework. `naima close`
  refuses anything that is not resolved, and refuses an item the branch you
  stand on claims: close it from the trunk, after the landing, once someone
  else has checked the proof. `naima close --force` is for the one who owns
  the [evidence](../guide/glossary.md#evidence) — a proof someone else performed, recorded here.
- **Deleting the scratchpad.** It was never tracked.

## Safety rules

- **Whoever fixes does not also close.** Enforced: `naima close` refuses an
  item the branch you stand on claims, and `naima close --force` is reserved
  for the evidence owner recording a proof someone else performed
  ([not part of closing](#not-part-of-closing)).
- **A branch not up to date is never forced in.** Enforced: `naima land`
  refuses a branch the trunk is not an ancestor of, and lands nothing if
  the trunk moved meanwhile. Convention by hand: `git merge-base
  --is-ancestor` comes first, and its refusal is read as information, not
  worked around
  ([worktree isolation](worktree-isolation.md#3-a-branch-lands-up-to-date-as-a-marker)).
- **Every landing is a marker naming the items it closes.** Enforced by
  `naima land`; a landing made by hand is checked by `landings-are-markers`,
  which notes, from the first marker on the trunk's first-parent line, every
  commit there that is not one
  ([the rule](../guide/rules.md#every-landing-is-a-marker-naming-the-items-it-closes)).
- **No branch is deleted while it still holds work the trunk lacks.**
  Enforced by `naima prune`, which refuses without an `archive/<branch>` tag.
- **A fix is not resolved until a gesture proves it.** Enforced by `naima
  close`, which refuses anything not [resolved](../guide/glossary.md#resolved).
