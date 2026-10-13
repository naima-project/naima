# Installing and updating Naima

How Naima reaches a project and stays the same for everyone on it. An agent
does all of this for you; this page is what it follows, for anyone who wants
to see or do it by hand. Just updating: [update Naima](update-naima.md).
Terms: [glossary](glossary.md).

Naima has no releases, no version numbers and no compiled binaries. A
project runs `naima-tracker/naima/`, a git clone of Naima's own repository, at
one commit of its `main`, which the project locks; that commit is the
version. Cloning Naima is installing it. Deno runs the TypeScript directly.

## Deno, once per machine

Besides git, which an agent installs when it is missing
([git, handled for the owner](../agents/git-for-the-owner.md#1-have-git)),
Deno is the only thing installed on the machine, once, by its official
installer:

```sh
curl -fsSL https://deno.land/install.sh | sh     # macOS, Linux
irm https://deno.land/install.ps1 | iex          # Windows PowerShell
```

The same by hand, step by step for each system, and how to check it:
[Deno by hand](../../README.md#deno-by-hand).

Nothing is installed globally for Naima itself: no `deno install -g`, no
package, no binary on the path. Each project carries the Naima it runs, so
two projects on one machine never share one, and never clash. The tools a
plugin needs, such as a model checker, go into one directory of Naima's own
([tools](tools.md)), never into the system.

## Bootstrap a project

In the root of a git repository, one line, from [the site](https://vincenzoml.github.io/naima/):

```sh
curl -fsSL https://vincenzoml.github.io/naima/install.sh | sh     # macOS, Linux
irm https://vincenzoml.github.io/naima/install.ps1 | iex          # Windows PowerShell
```

The installer (`site/install.sh`, `site/install.ps1`) runs at the top of the
git repository it is run in, wherever in it that is; outside one it stops,
asking whether this is the root of the project and, if so, to have the agent
create a repository there and install Naima. It needs git. When Deno is
missing it installs it with Deno's official installer, saying so; with
`NAIMA_NO_DENO_INSTALL` set it prints that command instead, and stops. Then:
`git -c core.autocrlf=false clone --single-branch --branch $NAIMA_REF
$NAIMA_SOURCE naima-tracker/naima` (no temporary clone), runs that clone's
`naima init`, then `naima check`. Run again in a project that already has a
lock, it clones only when `naima-tracker/naima/` is missing, then runs
`naima check`: it never moves the lock, which is `naima update`'s job.
`NAIMA_SOURCE` and `NAIMA_REF` name another repository and branch (or a tag)
to install — a fork, or a path on this disk, as the installer's own tests do.
For an agent, the site's `llms.txt` says the same.

By hand, in a git repository that does not use Naima yet:

```sh
git clone https://github.com/vincenzoml/naima.git naima-tracker/naima
deno run -A naima-tracker/naima/naima.ts init
git add naima-tracker && git commit -m "Track this project with Naima"
```

`init` writes `naima-tracker/README.md`, `naima-tracker/.gitignore` (which
ignores `naima/`) and `naima-tracker/naima-data/naima.json`, locked to the
source and commit of the clone that ran it ([data discovery and
self-init](#data-discovery-and-self-init)). Nothing else in the project is
touched ([unless asked](#the-hosts-own-tools)). What goes in the folder:
[using Naima in your project](tracker-folder.md). A project that already
keeps a `TODO.md` or an issue list brings it in with `naima adopt` ([adopt an
existing board](adopt-an-existing-board.md)).

`init` locks only what everyone else can fetch: it refuses a clone with
uncommitted changes, or with a commit its origin does not have, and it drops
any credentials from the origin URL (`https://user:token@…` is written as
`https://…`) before the URL reaches `naima.json`, which is committed.

### Migrating from a copy

A host whose `naima-tracker/naima/` is not a git clone — plain files from an
earlier version of Naima, or a checkout that still holds `naima/src/cli.ts`
at its top — is moved aside to `naima-tracker/.naima-legacy-<date>`, cloned
fresh at the lock's commit (moved forward to the product's head when the lock
still names the old layout), and the result run through `naima update` once:
one commit. The installer does this when run again on such a host; by hand,
it is the same two commands as a missing program
([below](#fresh-clones-and-worktrees)).

## Data discovery and self-init

`naima` finds its data directory one way, always: `--data <dir>`, then
`NAIMA_DATA`, then the sibling of the program directory,
`dirname(program)/naima-data` — the program knows where its data is from
where it is. Where the sibling `naima-data/` is absent, the program creates
it, and the parent folder's `README.md` and `.gitignore` when they are
absent too, on its first run — only when the parent folder is inside a git
work tree; outside one it refuses with the installer's outside-repository
message. This is what `naima init` does: a plain `git clone` of Naima into
`naima-tracker/naima/`, followed by any `naima` command, gives the same
result as the installer.

## The clone

```
<project>/naima-tracker/          versioned: README.md, .gitignore ("/naima/")
<project>/naima-tracker/naima/      a git clone of Naima, gitignored
<project>/naima-tracker/naima-data/ versioned: naima.json and the items
```

`main` is where Naima is developed: its tests, its site, the rules for
working on it, and its own tracker live in the workshop, a separate, private
repository; cloning `vincenzoml/naima` gets none of that, only what runs it —
`naima.ts`, `src/`, `docs/`, `skills/`, `README.md`, `LICENSE` and `NOTICE`,
exactly what a project should carry. Tests hold the clone to that: no test
runner, type-checker or agent harness that walks the file system picks up
anything of Naima's own, and every import and relative link of the clone
resolves inside it.

## The lock is git

`naima.json` keeps `source` (the clone's `origin`, credentials stripped) and
`commit` (a commit of Naima's `main`): the lock. Every run compares `commit`
with the clone's `HEAD` and, on a mismatch, fetches it — from a local seed
first (another worktree's `naima-tracker/naima/` on this disk), then
`origin` — checks it out detached, and relaunches. A lock naming a commit the
source lacks is refused with one line, naming both. A lock naming a commit of
the old, pre-split layout (one that still holds `naima/src/cli.ts`) is moved
by `naima update` to Naima's product head: that is the migration from an
older version.

## The host's own tools

Git ignores the program directory, but some tools walk the file system
without reading `.gitignore`: even the runtime files of the clone reach
`deno check`, `tsc` and `prettier` in the project — the clone holds the same
runtime `.ts` files a copy held. None of them has a marker a directory could
carry, so the exclusion goes in the project's own configuration. `init`
prints one line for each configuration it finds:

| Found | Line |
|---|---|
| `deno.json`, `deno.jsonc` | `"exclude": ["naima-tracker/naima/"]` |
| `tsconfig.json` | `"exclude": ["node_modules", "naima-tracker/naima"]` (tsc drops its default exclusion once `exclude` is given) |
| `.prettierignore`, or a prettier configuration | `naima-tracker/naima/` |

With `naima init --write-excludes` it writes them: into the list a JSON file
already has, or a new one; a file with comments (JSONC) is left as it is, and
the line printed to add by hand. Along with `--write-agent-pointer`
([below](#the-agent-harness-entry-point)), it is the only way Naima writes
outside `naima-tracker/`, and the launcher grants exactly these files, for
that command only. Test runners need nothing: the clone holds no tests.

A long command is worth an alias:

```sh
alias naima='deno run -A "$(git rev-parse --show-toplevel)/naima-tracker/naima/naima.ts"'
```

The rest of the documentation writes `naima <command>` for it.

## The agent-harness entry point

Each agent tool reads its own always-on file — `CLAUDE.md`, `AGENTS.md`, and
the other sensible defaults `DEFAULT_ENTRY_FILES` names, or a project's own
`entryFiles` in `naima.json` — mostly to point at the project's own rulebook.
If the pointer names a file that was moved or deleted, nothing errors: the
agent is simply taught nothing. `naima check` reports it: every plain-text
path and markdown link a configured entry file holds, that exists, is
resolved against disk, and one naming a missing file is a problem.

The installer, and `naima init --write-agent-pointer`, add one line to the
host's `AGENTS.md`, else `CLAUDE.md`, else create `AGENTS.md`: "Naima is in
`naima-tracker/` (`naima/` the program, `naima-data/` the data); if you find
it elsewhere, update this line" — appended when the file does not already
hold it; without the flag the line is only printed, the same way
`--write-excludes` prints its lines. The versioned `naima-tracker/README.md`
holds the two commands that restore a missing program
([below](#fresh-clones-and-worktrees)).

## Fresh clones and worktrees

A fresh clone of a project that uses Naima has `naima-data/` but no `naima/`:
rerun the installer, which sees the lock and clones Naima at the locked
commit, or the two commands the tracker's own `README.md` carries:

```sh
git clone <source> naima-tracker/naima
```

followed by any `naima` command, which then aligns the clone to the lock. A
new [worktree](glossary.md#worktree) of the project is the same case: `naima
open` makes it a local clone of the current one (`git clone --local`, then a
checkout of the lock), so opening a worktree never touches the network.

## Every run aligns the program

Before it does anything else, every run makes `naima-tracker/naima/` exactly
the `source` and `commit` in `naima.json`, cloning it when it is absent or
checking out the locked commit when it is not. So a fresh clone of the
project, a new worktree, a colleague and CI all run the same Naima. Where the
project has no program yet, there is no launcher in it either: run the
launcher of any Naima at hand from inside the project — the main worktree's,
say, or a clone's as the installer does. Either way, the run ends aligned.
Alignment:

- **never overwrites work.** When the clone was changed in place — its
  working tree is not clean at the locked commit — it refuses and says:
  publish the change as a fork and set `source`. Modifying Naima is welcome
  ([below](#modifying-naima)); losing the modification silently is not.
- **refuses a commit it cannot reach**, naming the source and the commit:
  a rewritten history, or a deleted fork. Naima's own `main` is never
  rewritten.
- **needs git and the network once per commit and machine**, to fetch it.
  With nothing reachable and no network it says so in one line. A commit
  already checked out somewhere on this disk needs no network at all
  ([below](#offline)).
- **fetches from this disk when it can.** Every git worktree of a project has
  its own ignored program directory; a new one is cloned locally from
  another worktree's, and a commit missing there is fetched first from a
  repository on this disk that has it — the clone running the command, or
  the project itself when the project is Naima — so it is not downloaded
  again.
- **follows the lock, and says so.** A pulled `naima.json` whose `commit`
  moved — a teammate's `naima update`, merged — is followed, and the run
  prints `naima: locked commit moved <a> → <b>` once.
- **refuses a changed source.** A pulled `naima.json` whose `source` is not
  the one the program was aligned from is refused, naming both sources and
  both commits: Naima runs whatever that source holds, so a new one is
  trusted only on purpose. Review why it changed, then

  ```sh
  naima update --accept-source     # align to the locked commit of the new source; nothing else moves
  ```

  `naima update --check` still answers meanwhile: it only reads the source.
- **checks signatures, when asked.** With `"verify": "signed"` in
  `naima.json`, a commit is run, or updated to, only when `git verify-commit`
  verifies it, with the keys git is configured to trust (gpg, or ssh with
  `gpg.ssh.allowedSignersFile`). Otherwise it is refused, and the program
  stays where it was.
- **never pulls.** Running whatever lands on a branch would be a supply
  chain risk. Only `naima update` asks the source anything.

## Updating

```sh
naima update --check     # has the source's main moved past the lock? exit 1 when it has
naima update             # move the lock to it
```

`update` fetches the source's `main`, checks out its head in the clone,
migrates the data forward if its format moved
([migrations](../reference/format.md#migrations)), and records the new
commit in `naima.json`. The checkout happens beside the old one and is
swapped in only once it is whole, so a failed update leaves the program that
ran before. The result is one change to review and commit like any other:

```sh
git add naima-tracker && git commit -m "Update Naima to <commit>"
```

"Explicit" means a deliberate command, not a human-only one: an agent runs
`naima update --check` at the start of a session and, when main has moved,
`naima update`, the checks, and the commit ([the skill](../agents/skill.md)). With
several branches open, update on a branch of its own and merge it first; the
others merge the [trunk](glossary.md#trunk) and run `naima update` again, which finishes the
migration of their new items or does nothing.

## The permissions

`naima.ts` is the launcher. It runs with every permission (`-A`), and all it
does is work out where the project and the program are and run the program
under Deno with only these:

| Permission | Granted | Why |
|---|---|---|
| read | the repository, the program wherever it is, the data directory of every other worktree of the project, and the [tools directory](tools.md#where-the-tools-go) | items, the project's markdown and source (the docs and beta-marker checks read them), git's view of branches, the commits the program is cloned from, and the uncommitted claims and notes of the other worktrees |
| write | `naima-tracker/` only, and the data or program directory if moved out of it | items, claims, notes, the program's own alignment, the commits fetched for it; nothing else in the project |
| run | `git`, and the programs the loaded contributions declare, by name or by their absolute path in the [tools directory](tools.md#where-the-tools-go) | alignment, update, and reading claims and notes across branches; a [verifier](glossary.md#verifier)'s model checker (its `runs`, [the contract](../reference/plugin-contract.md#the-verifier-contract)); a declared [metric](metrics-and-budgets.md)'s program, the first word of its `run` |
| env | an allow-list: `HOME`, `PATH`, the user, shell, terminal, locale and temporary-directory variables, the proxy variables, Windows' system ones, and every `NAIMA_*`, `GIT_*`, `SSH_*`, `LC_*` and `DENO_*` | what git needs to reach a source, and Naima's own; nothing else of the environment reaches the program, nor the git it runs |
| net | none, but the loopback interface for `naima ui` | the network is git's, in alignment and update; `naima ui` serves its window from this machine only |

**`naima ui`, and no other command,** is granted three things more: listening
on the loopback interface (`127.0.0.1`), for its server; reading and running
the Deno that runs it, to open its window; and running the program that opens
the default browser (`open`, `xdg-open` or `rundll32`), for its fallback.
The window is a process of its own, `src/plugins/ui/window.ts`, which the
program starts with only what the webview needs — the embedded browser
component that draws the window: native code from, and
writing in, the webview's cache (`plug/` in Deno's directory), reading Deno's
directory, the network to GitHub to fetch the webview's library on its first
run, and the environment. The program itself never calls native code nor
loads code over the network. Running Deno is a wide grant — Deno can be
asked for any permission — and is why only `ui` has it. The grant is
`uiGrant` in `src/launcher.ts`.

**`naima tools`, and no other command,** may also write the tools
directory, reach any host, and run any program: an install downloads from a
host a redirect chooses (a release's content server), and runs the unpackers
(`tar`, `hdiutil`, `ditto`, `unzip`), a Python and the tool it verifies, none
of which exists when the launcher starts ([tools](tools.md)).

The list is `ENV` in `src/launcher.ts`. Deno cannot grant a named list of
variables and still let the program hand git its environment, so the
launcher enforces it by giving the program only those variables: an
unrelated secret, a cloud key say, is simply not there. Deno also splits its
permission lists on commas, so a project, or a program, whose path holds a
comma is refused in one line naming it.

A command that tries anything else fails with Deno's own error, for example
`Requires write access to "…/escaped.txt"` or `Requires run access to "ls"`.
One consequence: `naima docs --write` can write only inside the tracker
folder when launched; Naima's own repository regenerates its reference with
the development build (`deno task docs`).

**What this does not protect.** The permissions stop a bug, or a compromised
dependency, from reaching beyond `naima-tracker/` and `git`. They cannot stop a
malicious commit that a project has chosen to update to, because the launcher
is part of that commit. The protection against that is the update itself: it
is an explicit, reviewable commit in the project, and nothing moves the lock
without one.

## Modifying Naima

Naima is meant to be changed, on a full checkout of `main`, never in
`naima-tracker/naima/` directly: alignment refuses a clone with local
changes rather than lose them silently. Clone Naima, change it, and publish
it as a fork; then set `source` in `naima.json` to the fork and `commit` to
your commit (or run `naima update` once the fork's `main` has it). The whole
team then runs that fork's `naima/` at that commit. A plugin of your own
lives in the fork's `naima/`, and `plugins` names it by its path there — or,
without a fork, in the project or its own git repository, pinned by its hash
or commit ([third-party plugins](config.md#third-party-plugins)). Improvements
go back through pull requests. The data stays compatible as long as the fork
keeps [the format](../reference/format.md).

## Offline

Install and `naima update` need the network, once, to reach the source.
Alignment of a new worktree or a second clone of a project uses a local seed
first — another worktree's program clone on this disk — so it needs no
network when one is at hand; a fresh clone of a project on another machine
needs the network once, to fetch the locked commit.

## Other runtimes

The code uses the standard APIs that Deno, Node and Bun share, and has no
dependencies; its tests run on all three, on macOS and Linux. Windows is not
exercised by the tests. Deno is the documented runtime
because of its permissions. Run directly with Node or Bun (`node
naima-tracker/naima/src/cli.ts <command>`), Naima works on the data, but it
does not align or update, and nothing fences it in.
