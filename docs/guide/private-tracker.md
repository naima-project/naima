# Keep the tracker private

Naima's tracker, `naima-tracker/naima-data/`, holds every item, claim, session note and decision of a project. By default it is committed in the project's own
repository, so anyone who can read the code can read the tracker too. For a private project that is what you want. For a project whose code is public, the
tracker can be kept apart, in one of two layouts.

- **Sibling mode.** The code repository stays the main checkout and stays public. The tracker is a git repository of its own, inside
  `naima-tracker/naima-data/`, which the code repository ignores. This is the layout `naima init` offers when a project looks public.
- **The workshop layout.** A private repository holds the tracker and holds the public code as a git submodule. This is how Naima develops itself. It needs no
  option from Naima, and it is described at the end of this page.

## How init chooses

When `naima init` (or the installer, which runs it) sets up a project that has no tracker yet, it looks at the code repository's `origin`:

| The repository                                      | What init does                                                        |
| --------------------------------------------------- | --------------------------------------------------------------------- |
| has no remote, or its remote is a path on this disk | keeps the tracker inside, as always                                   |
| has a remote that is private                        | keeps the tracker inside                                              |
| has a remote that is public                         | stops, and says the tracker has to be kept private beside it          |
| has a remote whose visibility can't be told         | stops, and asks you, through the agent, whether the remote is private |

Visibility is asked of GitHub's public API, without credentials: if it answers that the repository exists, the repository is public, and if it answers that it
doesn't, the repository is private (or doesn't exist, which is no more public). Any other host, or no answer within five seconds, counts as unknown, and init
asks rather than guessing that the tracker can be published.

The answer is given back to init as an option:

```sh
naima init --private-tracker      # a repository of its own, beside the code
naima init --tracker-inside       # the remote is private: committed with the code, and the answer recorded
```

With the installer, set `NAIMA_TRACKER` to `private` or `inside` (or to the URL of an existing tracker repository) before running the one line, for example
`curl -fsSL https://naima-project.github.io/naima/install.sh | NAIMA_TRACKER=private sh`.

If the project already has a tracker committed inside and is public, init leaves it as it is and says how to move it out: see
[moving an existing tracker out](#move-an-existing-tracker-out).

Once it has set up the tracker, init says in one sentence which layout it chose and what that layout risks. Kept inside, whoever can read the code can read the
tracker, so the repository must stay private while the tracker is in it. Kept beside the code, nobody who reads the code sees the tracker, but it is backed up
only once its own repository has a remote.

## A remote for every repository

A repository with no remote lives on one machine and is lost with it. The repositories Naima relies on are the project's and, in sibling mode, the tracker's
own. For each one that has no remote, `naima init` gives the agent a question to put to you once: should Naima create a private GitHub repository for it and
push to it, or do you keep working locally? A project installed before this question existed is asked at its next `naima update`. The answer goes back to Naima
as a command:

```sh
naima backup create --repo tracker --consent "<your yes, restated>" --by <you>   # yes
naima backup decline --repo tracker                                              # no, keep it on this machine
```

`--repo project` names the project's repository instead. When it is the project's repository that has no remote, you are also told that GitHub takes no file
over 100 MB, so larger files have to stay out of the repository before it can go there.

On a yes, Naima uses gh, GitHub's command-line tool. If gh is not on the machine, Naima installs it into its own [tools folder](tools.md#where-the-tools-go),
without administrator rights: the release archive for your platform (macOS, Linux or Windows, on arm64 or x64), downloaded from GitHub's releases and checked
against the checksum from the release's checksums file. Your yes is recorded with it. Then gh signs you in to GitHub through your browser. It shows a one-time
code: copy it, and paste it into the GitHub page that opens. Finally gh creates the private repository, named after the project folder (with `-tracker` for the
tracker's, or the name given with `--name`), and pushes to it.

Without a browser on the machine, `naima backup create --no-browser` says how to do it by hand: make an empty private repository at
[github.com/new](https://github.com/new), with no README, licence or `.gitignore`, and give its address to the agent, which adds it and pushes:

```sh
naima backup add https://github.com/<owner>/<project>-tracker.git --repo tracker
```

A no is recorded in that repository's own git configuration (`naima.backup`), so it is not asked again. From then on, every `naima hello` says in one line that
the repository is not backed up by a remote, and that you can ask the agent to set one up. `naima backup` on its own says, for each repository, whether it has a
remote. A remote added in any way, by Naima or by hand, ends the reminder.

## The tracker is never exposed

Choosing well at the start is not enough: a private repository can be made public later, and a tracker kept beside the code can be given a public remote. So
Naima checks before it writes. Every command that writes to the tracker (a new item, a note, a claim, an event, an attachment) is refused while the tracker is
exposed, which means one of two things:

- the tracker is committed in a repository whose `origin` is public;
- the tracker is a repository of its own and one of its remotes is public.

A repository with no remote, or whose remote is a path on this disk, is private. The refusal says what to tell you and the command that fixes it. For a tracker
committed in a public repository the fix is `naima init --private-tracker`, which moves it out (see below). For a public remote of the tracker's own repository,
it is to make that repository private or to remove the remote. Reading is never refused, and `naima check` reports the same problem as `tracker-private`, so a
project that updates Naima has it filed as a todo the first time.

Naima doesn't ask GitHub on every write. It remembers each remote's answer with its time, in the tracker repository's own git configuration, which is never
committed, and asks again at most once a day, waiting five seconds at most. When GitHub doesn't answer, the last answer known is kept and the write goes ahead.

When the visibility of a remote can't be told, because it isn't on GitHub or GitHub was never reached, writes go ahead, and Naima asks you once, through the
agent, whether that remote is private. If it is, the agent records your answer:

```sh
naima init --remote-private
```

The answer goes into `naima.json` as `privateRemotes`, by a hash of the remote's address rather than the address itself, and the question is not asked again. If
the remote is public, the fix is the one for an exposed tracker.

## Sibling mode

### What init sets up

`naima init --private-tracker` creates a git repository in `naima-tracker/naima-data/`, on this machine only, with no remote. It works offline and nothing of it
leaves the machine until it has a remote, which init asks you about ([a remote for every repository](#a-remote-for-every-repository)). Init also writes:

- `naima-tracker/tracker.json`, committed with the code. It says that the tracker is a repository of its own, so that a clone of the code knows it. It names the
  tracker's address only when you clone one with `--tracker <url>`, and not even then with `--private-url`, which keeps the address in the clone's own git
  configuration (`naima.tracker`).
- a line in `naima-tracker/.gitignore` that keeps `naima-data/` out of the code repository.
- a `commit-msg` hook in `naima-data/hooks/`, which both repositories run (their `core.hooksPath` points at it).

The first commits are two: Naima commits the data in the tracker repository itself, and you commit `naima-tracker/` in the code's.

Once the tracker has a remote, a colleague then clones the code as usual, and the tracker into place with `naima init --tracker <its address>`, or with
`git clone <its address> naima-tracker/naima-data`.

### Naima commits the tracker

In sibling mode nobody commits the tracker by hand. Every naima command that writes to it (a new item, a note, a claim, a field set, an update) ends with one
commit in the tracker's repository, on the branch it stands on. The subject names the command and the items it wrote, for example
`naima new: features/dark-mode`, and a `Naima-Command: new` trailer names the command. `naima open` commits the new claim on the tracker's branch of the
worktree in the same way, and `naima init` makes the tracker's first commit.

Item files are written through naima commands, never by hand. A file of the tracker changed by hand is left as it is: the next command commits only what it
wrote itself, and says which files it left. On the tracker's trunk, the [trunk guard](commit-hooks.md#the-trunk-guard) refuses a commit made by hand, and
`naima check` (`landings-are-markers`) notes one that got past it, counting from the first commit Naima made there.

A tracker committed with the code works as before: its writes stay uncommitted, and they are committed with the work.

### How the two repositories stay linked

There is no submodule. The link is kept commit by commit and branch by branch.

- Every commit of the code names the tracker commit it was made with, in a `Tracker: <full hash>` trailer, and every commit of the tracker names the code
  commit, in a `Code: <full hash>` trailer. The hook adds them to every commit, yours and the agents'; Naima's own commits carry them always.
- Branches pair by name. Work on code branch `agent/3fa9c1` writes to tracker branch `agent/3fa9c1`, and the code's trunk pairs with the tracker's. `naima open`
  makes both, each in its own worktree: the tracker's worktree sits inside the code's, at `naima-tracker/naima-data/`. Any other naima command moves the tracker
  to the branch of the code's name, creating it from the tracker's trunk when it is missing, as long as the tracker has nothing uncommitted. `naima check` says
  when they are out of pair (`branches-paired`), and notes a commit of the branch without its trailer.
- Claims, session notes and events are read across the tracker's branches, the same way they are read across the code's branches when the tracker is inside.

### Landing

`naima land <branch>` lands both sides from the main checkouts, each on its own trunk:

1. The tracker's trunk takes a marker that names the items it closes, in `Closes:` trailers, and the code's branch tip, in `Code:`.
2. The code's trunk takes a marker that names that tracker commit, in `Tracker:`, and nothing else of the tracker: no item, no title, no path.
3. The tracker records the code's marker in the `commits` of each item it closes, in a commit whose `Code:` names it, so that `naima close` finds a commit
   reachable from the code's trunk. `naima close` reads those hashes against the code repository.

Two repositories can't move at the same instant. If something stops a landing after the tracker moved and before the code did, `naima check` says so
(`landings-paired`), naming the command that finishes it:

```sh
naima land <branch> --repair
```

It makes the code's marker from the code commit the tracker's marker names, records it in the items, and does nothing to a landing that is already paired, so
running it twice is harmless. The same check reports a code marker whose tracker commit isn't on the tracker's trunk, and trailers that don't match.

### Updating Naima

An update changes both repositories: the lock, in the tracker's `naima.json`, and the files of the code it rewrites, such as the agents' settings and the
pointer line. It lands as one paired landing, like any other change. `naima update` and `naima rollback` run on the code's trunk while the trunk guard runs
there are refused before anything moves, since the tracker's trunk would take the lock and the code's would refuse the rest. Run them in an item's worktree
instead ([updating](update-naima.md#updating)): Naima commits the tracker's half on the paired branch, the last line names the code's files to commit on the
same branch, and `naima land` lands both. Anywhere else, the update first moves the tracker to the branch that pairs with the code's.

`naima prune --branch <branch>` removes both branches and both worktrees, by the same rules: a branch with commits that no trunk and no `archive/<branch>` tag
holds is refused.

### What a public reader can still learn

A clone of the code has `naima-tracker/README.md`, `.gitignore` and `tracker.json`, and no tracker. It builds and runs its own tests as before. Naima itself
doesn't run there: the lock, which says which Naima to run, is in the tracker, and `naima` says how to get the tracker instead.

In the code's history a reader sees the landings (`Land <branch>` and a `Tracker:` hash), how often work lands, and the branch names if they are pushed. Naima
keeps those neutral: in sibling mode `naima open` names a branch `<who>/<six random hex digits>` rather than after the item, unless you give `--name`. What
remains up to you:

- commit messages written by people and agents, which must not name items, titles or tracker paths
  ([the rule](rules.md#public-commits-name-nothing-of-a-private-tracker));
- the reason given to `land --no-change-note`, which is recorded in the code's marker (the reason given to `--stale-proofs` stays in the tracker);
- branch names given with `--name`.

### Move an existing tracker out

A tracker committed with the code moves into a repository of its own with one command, run in the main checkout, on the trunk, with the tracker's changes
committed:

```sh
naima init --private-tracker
```

It copies the tracker's history out of the code's repository: every commit that touched `naima-tracker/naima-data/` is kept, with its author, date and message,
and the copy is checked to end in exactly the files last committed. That copy becomes `naima-tracker/naima-data/.git`, a repository on this machine with no
remote. In the code's repository one commit stops tracking the folder, ignores it and adds `naima-tracker/tracker.json`; the files stay where they are, and
nothing is deleted. Other branches that still change the tracker should be landed or closed first.

The move doesn't remove the tracker from the code's history: every earlier commit still holds it, and anyone who cloned the repository has it. Removing it from
history means rewriting that history (with `git filter-repo` on a fresh copy, then a force-push that everyone must follow), which is your decision.

Because the tracker was readable by anyone, the move also files a todo, once, at the highest priority the project has: read every item, note and attachment of
the tracker, paraphrase or remove through the CLI anything private, strategic or confidential, and then consider the history. The same todo is filed when a
tracker stops being exposed in some other way, such as a public remote made private.

## The workshop layout

A private repository, the workshop, holds `naima-tracker/` and the public code as a git submodule. Everything Naima writes (markers, claims, notes, the lock) is
in the workshop's history, and the public repository receives ordinary commits only. Each change is two commits in order: the code in the submodule, on a
branch, then the new submodule pointer in the workshop. Each worktree of the workshop initialises its submodule from the main checkout, without the network:
`git submodule update --init --reference <main checkout>/<code>`. Naima develops itself this way.
