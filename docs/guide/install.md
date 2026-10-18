# Installing and updating Naima

This page explains how Naima gets into a project and how everyone working on
that project ends up running the same version. An agent does all of this for
you, and this page is what it follows, so you only need it if you want to
see the steps or carry them out by hand. [The primer](primer.md) gives the
overview of Naima itself. If you only want to update, see
[update Naima](update-naima.md). Terms are defined in the
[glossary](glossary.md).

Naima has no releases, no version numbers and no compiled binaries. A
project runs `naima-tracker/naima/`, which is a git clone of Naima's own
repository at one commit of its `main`. The project locks that commit, and
the commit is the version. So installing Naima simply means cloning it, and
Deno runs the TypeScript directly.

## Deno, once per machine

Apart from git, which an agent installs when it is missing
([git, handled for the owner](../agents/git-for-the-owner.md#1-have-git)),
Deno is the only thing installed on the machine. It is installed once, with
its official installer:

```sh
curl -fsSL https://deno.land/install.sh | sh     # macOS, Linux
irm https://deno.land/install.ps1 | iex          # Windows PowerShell
```

The step-by-step version for each system, and how to check that it worked,
is in [Deno by hand](../../README.md#deno-by-hand).

Nothing is installed globally for Naima itself. There is no
`deno install -g`, no package and no binary on the path. Each project carries
the Naima it runs, so two projects on the same machine never share one and
can't clash. The tools a plugin needs, such as a model checker, go into a
directory that belongs to Naima ([tools](tools.md)) rather than into the
system.

## Bootstrap a project

In the root of a git repository, run one line from
[the site](https://vincenzoml.github.io/naima/):

```sh
curl -fsSL https://vincenzoml.github.io/naima/install.sh | sh     # macOS, Linux
irm https://vincenzoml.github.io/naima/install.ps1 | iex          # Windows PowerShell
```

The installer (`site/install.sh`, `site/install.ps1`) works at the top of
the git repository it is run in, wherever inside it you happen to be. Outside
a repository it stops and asks whether this is the root of the project, and
if it is, to have the agent create a repository there and install Naima. It
needs git. If Deno is missing, it installs it with Deno's official installer
and says so, unless `NAIMA_NO_DENO_INSTALL` is set, in which case it prints
that command and stops. After that it runs
`git -c core.autocrlf=false clone --single-branch --branch $NAIMA_REF
$NAIMA_SOURCE naima-tracker/naima` (with no temporary clone), then that
clone's `naima init`, then `naima check`. If you run it again in a project
that already has a lock, it clones only when `naima-tracker/naima/` is
missing, and then runs `naima check`. It never moves the lock, because that
is the job of `naima update`. `NAIMA_SOURCE` and `NAIMA_REF` name a different
repository and branch (or tag) to install, such as a fork or a path on this
disk, which is how the installer's own tests use them. For agents, the site's
`llms.txt` says the same thing.

To do it by hand, in a git repository that doesn't use Naima yet:

```sh
git clone https://github.com/vincenzoml/naima.git naima-tracker/naima
deno run -A naima-tracker/naima/naima.ts init
git add naima-tracker && git commit -m "Track this project with Naima"
```

`init` writes `naima-tracker/README.md`, `naima-tracker/.gitignore` (which
ignores `naima/`) and `naima-tracker/naima-data/naima.json`, locked to the
source and commit of the clone that ran it ([data discovery and
self-init](#data-discovery-and-self-init)). Outside `naima-tracker/` it
writes only what makes an agent run `naima hello` at the start of every
session ([below](#the-agent-harness-entry-point)), and the lines that keep
the program out of the host's own tools [when asked](#the-hosts-own-tools). What goes in the folder is
described in [using Naima in your project](tracker-folder.md). If the project
already keeps a `TODO.md` or an issue list, `naima adopt` brings it in
([adopt an existing board](adopt-an-existing-board.md)).

`init` only locks something everyone else can fetch. It refuses a clone with
uncommitted changes, or one whose commit its origin doesn't have, and it
removes any credentials from the origin URL (`https://user:token@…` is
written as `https://…`) before the URL goes into `naima.json`, since that
file is committed.

### Migrating from a copy

Some hosts have a `naima-tracker/naima/` that isn't a git clone, either plain
files from an earlier version of Naima or a checkout that still has
`naima/src/cli.ts` at its top. In that case the old folder is moved aside to
`naima-tracker/.naima-legacy-<date>`, and a fresh clone is made at the lock's
commit (moved forward to the product's head if the lock still names the old
layout). The result is then run through `naima update` once, which gives one
commit. The installer does this when you run it again on such a host. By
hand, it takes the same two commands as restoring a missing program
([below](#fresh-clones-and-worktrees)).

## Data discovery and self-init

`naima` always finds its data directory the same way. It looks at
`--data <dir>` first, then `NAIMA_DATA`, and then the folder next to the
program directory, `dirname(program)/naima-data`, because the program knows
where its data is from where it is itself. If that `naima-data/` folder
doesn't exist, the program creates it on its first run, along with the
parent folder's `README.md` and `.gitignore` if those are missing too. It
only does this when the parent folder is inside a git work tree. Outside one
it refuses, with the same message the installer gives outside a repository.
This is exactly what `naima init` does, so a plain `git clone` of Naima into
`naima-tracker/naima/` followed by any `naima` command gives the same result
as the installer.

## The clone

```
<project>/naima-tracker/          versioned: README.md, .gitignore ("/naima/")
<project>/naima-tracker/naima/      a git clone of Naima, gitignored
<project>/naima-tracker/naima-data/ versioned: naima.json and the items
```

`main` is the branch Naima is developed on. Its tests, its site, the rules
for working on it and its own tracker live in the workshop, which is a
separate, private repository. Cloning `vincenzoml/naima` gets you none of
that, only what runs Naima: `naima.ts`, `src/`, `docs/`, `skills/`,
`README.md`, `LICENSE` and `NOTICE`, which is exactly what a project should
carry. Tests make sure the clone stays that way. No test runner,
type-checker or agent harness that walks the file system picks up anything
of Naima's own, and every import and relative link in the clone resolves
inside it.

## The lock is git

`naima.json` holds `source` (the clone's `origin`, with credentials removed)
and `commit` (a commit of Naima's `main`), and together these are the lock.
On every run, Naima compares `commit` with the clone's `HEAD`. If they
differ, it fetches the commit, first from a local seed (another worktree's
`naima-tracker/naima/` on this disk) and then from `origin`, checks it out
detached, and starts again. If the lock names a commit the source doesn't
have, it refuses with one line naming both. If the lock names a commit from
the old layout before the split (one that still has `naima/src/cli.ts`),
`naima update` moves it to Naima's product head, and that is how an older
version is migrated.

## The host's own tools

Git ignores the program directory, but some tools walk the file system
without reading `.gitignore`. Because the clone holds the same runtime `.ts`
files that a copy used to hold, those files reach `deno check`, `tsc` and
`prettier` in the project. None of these tools has a marker file a directory
could carry to keep them out, so the exclusion has to go in the project's own
configuration. `init` prints one line for each configuration it finds:

| Found | Line |
|---|---|
| `deno.json`, `deno.jsonc` | `"exclude": ["naima-tracker/naima/"]` |
| `tsconfig.json` | `"exclude": ["node_modules", "naima-tracker/naima"]` (tsc drops its default exclusion once `exclude` is given) |
| `.prettierignore`, or a prettier configuration | `naima-tracker/naima/` |

With `naima init --write-excludes`, it writes these lines itself, adding to
the list a JSON file already has or creating a new one. A file with comments
(JSONC) is left alone, and the line to add by hand is printed instead.
Together with the pointer line and the session-start hooks
([below](#the-agent-harness-entry-point)), which `init` and `update` write,
this is the only way Naima ever writes outside `naima-tracker/`, and the
launcher grants access to exactly these files, for those commands only. Test runners need nothing, because the
clone holds no tests.

The full command is long, so an alias helps:

```sh
alias naima='deno run -A "$(git rev-parse --show-toplevel)/naima-tracker/naima/naima.ts"'
```

The rest of the documentation writes `naima <command>` for it.

## The agent-harness entry point

Each agent tool reads its own always-on file: `AGENTS.md`, which many tools
read, and the one each tool's adapter names (such as `CLAUDE.md` or
`GEMINI.md`), which together make `DEFAULT_ENTRY_FILES`, or a project's own
`entryFiles` in `naima.json`. Mostly these files point at the project's own
rulebook. If the pointer names a file that has been moved or deleted,
nothing errors, and the agent is simply taught nothing. So `naima check`
reports it. It resolves every plain-text path and markdown link in each
configured entry file that exists, and reports one that names a missing file
as a problem.

`naima init` adds one line to the host's `AGENTS.md`, or to the first other
entry file the project has if there is no `AGENTS.md`, or creates `AGENTS.md`
if there is none. The line reads "Naima is in `naima-tracker/` (`naima/` the
program, `naima-data/` the data); at the start of every session, run `deno
run -A naima-tracker/naima/naima.ts hello` and pass on what it says; if you
find it elsewhere, update this line". It is appended only if no entry file
holds it already. The versioned `naima-tracker/README.md` holds the two
commands that restore a missing program
([below](#fresh-clones-and-worktrees)).

### Running naima hello at every session start

The line works with any agent that reads its entry file, but an agent may
still skip it. Some agent tools can run a command by themselves when a
session starts, and for those Naima has an adapter that installs a
session-start hook running `naima hello`, so its output is in front of the
agent before the first message. Naima itself works with any agent; an
adapter only knows how one tool is configured.

| Tool | Its id in `agents` | Hook | Where |
|---|---|---|---|
| Claude Code | `claude-code` | a `SessionStart` hook running `deno run -A "$CLAUDE_PROJECT_DIR/naima-tracker/naima/naima.ts" hello`, whose output Claude Code adds to the conversation | `.claude/settings.json`, merged into what the file holds: every other setting and hook stays |

`naima init` installs the hook of each tool the project uses: the tools
`naima.json`'s `agents` names, or, without it, the tools whose files the
project holds (Claude Code's `CLAUDE.md` or `.claude/`). `naima init
--no-session-hook` installs none and writes only the line. A settings file
that is not plain JSON is left alone, and the hook to add by hand is printed
instead.

`naima update` adds whatever is missing to a project set up before, as a
mechanical fix: the line, or a new wording of an older line, and each hook.
It says what it wrote, and the files go in the same commit as the update.
`naima check` notes a project where the line is missing or doesn't say to
run `naima hello`, and each tool in use whose hook is missing.

## Fresh clones and worktrees

A fresh clone of a project that uses Naima has `naima-data/` but no
`naima/`. To fix that, either run the installer again, which sees the lock
and clones Naima at the locked commit, or use the two commands in the
tracker's own `README.md`:

```sh
git clone <source> naima-tracker/naima
```

followed by any `naima` command, which then aligns the clone with the lock.
A new [worktree](glossary.md#worktree) of the project is the same case.
`naima open` makes its program a local clone of the current one
(`git clone --local`, then a checkout of the lock), so opening a worktree
never touches the network.

## Every run aligns the program

Before it does anything else, every run makes `naima-tracker/naima/` match
the `source` and `commit` in `naima.json` exactly. It clones the program if
it is missing, or checks out the locked commit if a different one is checked
out. That way a fresh clone of the project, a new worktree, a colleague and
CI all run the same Naima. If the project doesn't have the program yet,
there is no launcher in it either, so you run the launcher of any Naima you
have at hand from inside the project, for example the main worktree's, or a
clone's as the installer does. Either way, the run ends aligned. Alignment
behaves as follows:

- **It never overwrites work.** If the clone was changed in place, so that
  its working tree isn't clean at the locked commit, it refuses and tells you
  to publish the change as a fork and set `source`. Changing Naima is welcome
  ([below](#modifying-naima)), but losing the change without a word is not.
- **It refuses a commit it can't reach**, naming the source and the commit.
  This happens with a rewritten history or a deleted fork. Naima's own `main`
  is never rewritten.
- **It needs git and the network once per commit and machine**, to fetch the
  commit. If nothing is reachable and there is no network, it says so in one
  line. A commit already checked out somewhere on this disk needs no network
  at all ([below](#offline)).
- **It fetches from this disk when it can.** Every git worktree of a project
  has its own ignored program directory. A new one is cloned locally from
  another worktree's, and a commit missing there is first fetched from a
  repository on this disk that has it (the clone running the command, or the
  project itself when the project is Naima), so it isn't downloaded again.
- **It repairs the program, and says so.** If files were deleted from the
  clone and nothing else changed, it restores them from git. A clone that git
  can't read is moved aside next to it, never deleted, and cloned again, and
  a missing one is cloned. Each of these uses a copy on this disk when one
  holds the commit, and each is reported in one line
  ([update Naima](update-naima.md#when-the-program-is-damaged)).
- **It follows the lock, and says so.** If a pulled `naima.json` has a
  `commit` that moved, for instance because a teammate's `naima update` was
  merged, the run follows it and prints
  `naima: locked commit moved <a> → <b>` once.
- **It refuses a changed source.** If a pulled `naima.json` has a `source`
  different from the one the program was aligned from, the run refuses and
  names both sources and both commits. Naima runs whatever that source holds,
  so a new source is only trusted on purpose. Review why it changed, and then
  run

  ```sh
  naima update --accept-source     # align to the locked commit of the new source; nothing else moves
  ```

  In the meantime `naima update --check` still answers, because it only reads
  the source.
- **It checks signatures, if asked to.** With `"verify": "signed"` in
  `naima.json`, a commit is run, or updated to, only if `git verify-commit`
  verifies it with the keys git is configured to trust (gpg, or ssh with
  `gpg.ssh.allowedSignersFile`). Otherwise it is refused and the program
  stays where it was.
- **It never pulls.** Running whatever lands on a branch would be a supply
  chain risk, so only `naima update` asks the source for anything.

## Updating

```sh
naima update --check     # has the source's main moved past the lock? exit 1 when it has
naima update             # move the lock to it
```

`update` fetches the source's `main`, checks out its head in the clone,
migrates the data forward if its format has changed
([migrations](../reference/format.md#migrations)), and records the new
commit in `naima.json`. The new checkout is made next to the old one and
only swapped in once it is complete, so a failed update leaves the previous
program in place. The result is one change, which you review and commit like
any other:

```sh
git add naima-tracker && git commit -m "Update Naima to <commit>"
```

Updating is explicit, which means it takes a deliberate command, not that
only a person can do it. An agent starts a session with `naima hello`, which
checks for a newer Naima as the `updates` setting in `naima.json` says. Once
the owner has said yes, the agent runs `naima update`, the checks and the
commit ([update Naima](update-naima.md)). When several branches are open,
update on a branch of its own and merge that first. The other branches then
merge the [trunk](glossary.md#trunk) and run `naima update` again, which
either finishes migrating their new items or does nothing.

## The permissions

`naima.ts` is the launcher. It runs with every permission (`-A`), and all it
does is work out where the project and the program are, then run the program
under Deno with only these permissions:

| Permission | Granted | Why |
|---|---|---|
| read | the repository, the program wherever it is, the data directory of every other worktree of the project, and the [tools directory](tools.md#where-the-tools-go) | items, the project's markdown and source (the docs and beta-marker checks read them), git's view of branches, the commits the program is cloned from, and the uncommitted claims and notes of the other worktrees |
| write | `naima-tracker/`, and the data or program directory if moved out of it; for `init` and `update` only, the entry files and the session-start settings of the tools in use, and with `init --write-excludes` the host tools' configuration | items, claims, notes, the program's own alignment, the commits fetched for it; the pointer line, the session-start hooks and the exclusion lines; nothing else in the project |
| run | `git`, and the programs the loaded contributions declare, by name or by their absolute path in the [tools directory](tools.md#where-the-tools-go) | alignment, update, and reading claims and notes across branches; a [verifier](glossary.md#verifier)'s model checker (its `runs`, [the contract](../reference/plugin-contract.md#the-verifier-contract)); a declared [metric](metrics-and-budgets.md)'s program, the first word of its `run` |
| env | an allow-list: `HOME`, `PATH`, the user, shell, terminal, locale and temporary-directory variables, the proxy variables, Windows' system ones, and every `NAIMA_*`, `GIT_*`, `SSH_*`, `LC_*` and `DENO_*` | what git needs to reach a source, and Naima's own; nothing else of the environment reaches the program, nor the git it runs |
| net | none, but the loopback interface for `naima ui` | the network is git's, in alignment and update; `naima ui` serves its window from this machine only |

**`naima ui`, and no other command,** gets three more permissions. It may
listen on the loopback interface (`127.0.0.1`) for its server, read and run
the Deno that runs it so that it can open its window, and run the program
that opens the default browser (`open`, `xdg-open` or `rundll32`) as a
fallback. The window is a separate process, `src/plugins/ui/window.ts`, which
the program starts with only what the webview needs. The webview is the
embedded browser component that draws the window, and it needs native code
from the webview's cache (`plug/` in Deno's directory) and write access
there, read access to Deno's directory, network access to GitHub to fetch
the webview's library on its first run, and the environment. The program
itself never calls native code or loads code over the network. Being allowed
to run Deno is a wide grant, because Deno can be asked for any permission,
and that is why only `ui` has it. The grant is `uiGrant` in
`src/launcher.ts`.

**`naima tools`, and no other command,** may also write to the tools
directory, reach any host and run any program. An install downloads from
whatever host a redirect points to (a release's content server), and runs
the unpackers (`tar`, `hdiutil`, `ditto`, `unzip`), a Python and the tool it
verifies, and none of these exists yet when the launcher starts
([tools](tools.md)).

The allow-list of variables is `ENV` in `src/launcher.ts`. Deno can't grant a
named list of variables and still let the program pass its environment on to
git, so the launcher enforces the list by giving the program only those
variables. An unrelated secret, such as a cloud key, simply isn't there.
Deno also splits its permission lists on commas, so a project or program
whose path contains a comma is refused with one line naming it.

A command that tries to do anything else fails with Deno's own error, for
example `Requires write access to "…/escaped.txt"` or
`Requires run access to "ls"`. One consequence is that `naima docs --write`
can only write inside the tracker folder when it is run through the
launcher, so Naima's own repository regenerates its reference with the
development build (`deno task docs`).

**What this does not protect.** The permissions stop a bug, or a compromised
dependency, from reaching beyond `naima-tracker/` and `git`. They can't stop
a malicious commit that a project has chosen to update to, because the
launcher is part of that commit. The protection against that is the update
itself. It is an explicit commit in the project that can be reviewed, and
nothing moves the lock without one.

## Modifying Naima

Naima is meant to be changed, but on a full checkout of `main` and never
directly in `naima-tracker/naima/`, because alignment refuses a clone with
local changes rather than lose them without a word. Clone Naima, change it,
and publish it as a fork. Then set `source` in `naima.json` to the fork and
`commit` to your commit (or run `naima update` once the fork's `main` has
it), and the whole team will run that fork's `naima/` at that commit. A
plugin of your own lives in the fork's `naima/`, and `plugins` names it by
its path there. Without a fork, it can live in the project or in its own git
repository, pinned by its hash or commit
([third-party plugins](config.md#third-party-plugins)). Improvements go back
through pull requests. The data stays compatible as long as the fork keeps
[the format](../reference/format.md).

## Offline

Installing and `naima update` need the network once, to reach the source.
Aligning a new worktree or a second clone of a project tries a local seed
first (another worktree's program clone on this disk), so it needs no
network when one is available. A fresh clone of a project on another machine
needs the network once, to fetch the locked commit.

## Other runtimes

The code uses the standard APIs that Deno, Node and Bun share and has no
dependencies, and its tests run on all three, on macOS and Linux. Windows
isn't covered by the tests. Deno is the documented runtime because of its
permissions. If you run Naima directly with Node or Bun
(`node naima-tracker/naima/src/cli.ts <command>`), it works on the data, but
it doesn't align or update, and nothing restricts what it can do.
