# Keep the tracker private

Naima's tracker, `naima-tracker/naima-data/`, holds every item, claim,
session note and decision of a project. By default it is committed in the
project's own repository, so anyone who can read the code can read the
tracker too. For a private project that is what you want. For a project whose
code is public, the tracker can be kept apart, in one of two layouts.

- **Sibling mode.** The code repository stays the main checkout and stays
  public. The tracker is a git repository of its own, inside
  `naima-tracker/naima-data/`, which the code repository ignores. This is the
  layout `naima init` offers when a project looks public.
- **The workshop layout.** A private repository holds the tracker and holds
  the public code as a git submodule. This is how Naima develops itself. It
  needs no option from Naima, and it is described at the end of this page.

## How init chooses

When `naima init` (or the installer, which runs it) sets up a project that
has no tracker yet, it looks at the code repository's `origin`:

| The repository | What init does |
|---|---|
| has no remote, or its remote is a path on this disk | keeps the tracker inside, as always |
| has a remote that is private | keeps the tracker inside |
| has a remote that is public, or whose visibility can't be told | stops, and asks you, through the agent, whether to keep the tracker private beside it; the recommended answer is yes |

Visibility is asked of GitHub's public API, without credentials: if it
answers that the repository exists, the repository is public, and if it
answers that it doesn't, the repository is private (or doesn't exist, which
is no more public). Any other host, or no answer within five seconds, counts
as unknown, and init asks rather than guessing that the tracker can be
published.

The answer is given back to init as an option:

```sh
naima init --private-tracker      # yes: a repository of its own, beside the code
naima init --tracker-inside       # no: committed with the code, readable by anyone who can read it
```

With the installer, set `NAIMA_TRACKER` to `private` or `inside` (or to the
URL of an existing tracker repository) before running the one line, for
example `curl -fsSL https://naima-project.github.io/naima/install.sh | NAIMA_TRACKER=private sh`.

If the project already has a tracker committed inside and looks public,
init leaves it as it is and says it can be moved out: see
[moving an existing tracker out](#move-an-existing-tracker-out).

## Sibling mode

### What init sets up

`naima init --private-tracker` creates a git repository in
`naima-tracker/naima-data/`, on this machine only, with no remote. It works
offline and nothing of it leaves the machine until you push it somewhere
yourself. Init also writes:

- `naima-tracker/tracker.json`, committed with the code. It says that the
  tracker is a repository of its own, so that a clone of the code knows it.
  It names the tracker's address only when you clone one with
  `--tracker <url>`, and not even then with `--private-url`, which keeps the
  address in the clone's own git configuration (`naima.tracker`).
- a line in `naima-tracker/.gitignore` that keeps `naima-data/` out of the
  code repository.
- a `commit-msg` hook in `naima-data/hooks/`, which both repositories run
  (their `core.hooksPath` points at it).

The first commits are two: the data in the tracker repository, then
`naima-tracker/` in the code's.

To give the tracker a private remote later, one line is enough with GitHub's
command-line tool:

```sh
gh repo create <owner>/<project>-tracker --private --source naima-tracker/naima-data --push
```

A colleague then clones the code as usual, and the tracker into place with
`naima init --tracker <its address>`, or with
`git clone <its address> naima-tracker/naima-data`.

### How the two repositories stay linked

There is no submodule. The link is kept commit by commit and branch by branch.

- Every commit of the code names the tracker commit it was made with, in a
  `Tracker: <full hash>` trailer, and every commit of the tracker names the
  code commit, in a `Code: <full hash>` trailer. The hook adds them to every
  commit, yours and the agents'; Naima's own commits carry them always.
- Branches pair by name. Work on code branch `agent/3fa9c1` writes to tracker
  branch `agent/3fa9c1`, and the code's trunk pairs with the tracker's.
  `naima open` makes both, each in its own worktree: the tracker's worktree
  sits inside the code's, at `naima-tracker/naima-data/`. Any other naima
  command moves the tracker to the branch of the code's name, creating it
  from the tracker's trunk when it is missing, as long as the tracker has
  nothing uncommitted. `naima check` says when they are out of pair
  (`branches-paired`), and notes a commit of the branch without its trailer.
- Claims, session notes and events are read across the tracker's branches,
  the same way they are read across the code's branches when the tracker is
  inside.

### Landing

`naima land <branch>` lands both sides from the main checkouts, each on its
own trunk:

1. The tracker's trunk takes a marker that names the items it closes, in
   `Closes:` trailers, and the code's branch tip, in `Code:`.
2. The code's trunk takes a marker that names that tracker commit, in
   `Tracker:`, and nothing else of the tracker: no item, no title, no path.
3. The tracker records the code's marker in the `commits` of each item it
   closes, in a commit whose `Code:` names it, so that `naima close` finds a
   commit reachable from the code's trunk. `naima close` reads those hashes
   against the code repository.

Two repositories can't move at the same instant. If something stops a
landing after the tracker moved and before the code did, `naima check` says
so (`landings-paired`), naming the command that finishes it:

```sh
naima land <branch> --repair
```

It makes the code's marker from the code commit the tracker's marker names,
records it in the items, and does nothing to a landing that is already
paired, so running it twice is harmless. The same check reports a code marker
whose tracker commit isn't on the tracker's trunk, and trailers that don't
match.

`naima prune --branch <branch>` removes both branches and both worktrees, by
the same rules: a branch with commits that no trunk and no `archive/<branch>`
tag holds is refused.

### What a public reader can still learn

A clone of the code has `naima-tracker/README.md`, `.gitignore` and
`tracker.json`, and no tracker. It builds and runs its own tests as before.
Naima itself doesn't run there: the lock, which says which Naima to run, is
in the tracker, and `naima` says how to get the tracker instead.

In the code's history a reader sees the landings (`Land <branch>` and a
`Tracker:` hash), how often work lands, and the branch names if they are
pushed. Naima keeps those neutral: in sibling mode `naima open` names a
branch `<who>/<six random hex digits>` rather than after the item, unless you
give `--name`. What remains up to you:

- commit messages written by people and agents, which must not name items,
  titles or tracker paths ([the rule](rules.md#public-commits-name-nothing-of-a-private-tracker));
- the reason given to `land --no-change-note`, which is recorded in the
  code's marker (the reason given to `--stale-proofs` stays in the tracker);
- branch names given with `--name`.

### Move an existing tracker out

A tracker committed in a public repository can move into a repository of its
own. The steps are by hand, and they don't remove the tracker from the code's
history: every earlier commit still holds it, and anyone who cloned the
repository has it. Removing it from history means rewriting the history (with
`git filter-repo` on a fresh copy, then a force-push that everyone must
follow), which is the owner's decision.

1. Copy the data out with its history:
   `git clone <the code repository> /tmp/tracker && cd /tmp/tracker && git filter-repo --subdirectory-filter naima-tracker/naima-data`.
2. In the code repository, remove it from the index and ignore it:
   `git rm -r --cached naima-tracker/naima-data`, then add `/naima-data/` to
   `naima-tracker/.gitignore` and commit.
3. Put the new repository in place: move the folder away, then
   `naima init --tracker /tmp/tracker` (or the address of a private remote
   you pushed it to).
4. Commit `naima-tracker/tracker.json` in the code repository.

## The workshop layout

A private repository, the workshop, holds `naima-tracker/` and the public
code as a git submodule. Everything Naima writes (markers, claims, notes, the
lock) is in the workshop's history, and the public repository receives
ordinary commits only. Each change is two commits in order: the code in the
submodule, on a branch, then the new submodule pointer in the workshop. Each
worktree of the workshop initialises its submodule from the main checkout,
without the network: `git submodule update --init --reference <main checkout>/<code>`.
Naima develops itself this way.
