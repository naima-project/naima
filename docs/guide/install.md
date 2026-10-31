# Installing and updating Naima

This page explains how Naima gets into a project and how everyone working on that project ends up running the same version. An agent does all of this for you,
and this page is what it follows, so you only need it if you want to see the steps or carry them out by hand. [The primer](primer.md) gives the overview of
Naima itself. If you only want to update, see [update Naima](update-naima.md). Terms are defined in the [glossary](glossary.md).

Naima has no releases, no version numbers and no compiled binaries. A project runs `naima-tracker/naima/`, which is a git clone of Naima's own repository at one
commit of its `main`. The project locks that commit, and the commit is the version. So installing Naima simply means cloning it, and Deno runs the TypeScript
directly.

## Deno, once per machine

Apart from git, which an agent installs when it is missing ([git, handled for the owner](../agents/git-for-the-owner.md#1-have-git)), Deno is the only thing
installed on the machine. It is installed once, with its official installer:

```sh
curl -fsSL https://deno.land/install.sh | sh     # macOS, Linux
irm https://deno.land/install.ps1 | iex          # Windows PowerShell
```

The step-by-step version for each system, and how to check that it worked, is in [Deno by hand](../../README.md#deno-by-hand).

Nothing is installed globally for Naima itself. There is no `deno install -g`, no package and no binary on the path. Each project carries the Naima it runs, so
two projects on the same machine never share one and can't clash. The tools a plugin needs, such as a model checker, go into a directory that belongs to Naima
([tools](tools.md)) rather than into the system.

## Bootstrap a project

In the root of a git repository, run one line from [the site](https://naima-project.github.io/naima/):

```sh
curl -fsSL https://naima-project.github.io/naima/install.sh | sh     # macOS, Linux
irm https://naima-project.github.io/naima/install.ps1 | iex          # Windows PowerShell
```

The installer (`site/install.sh`, `site/install.ps1`) works at the top of the git repository it is run in, wherever inside it you happen to be. Outside a
repository it stops and asks whether this is the root of the project, and if it is, to have the agent create a repository there and install Naima. It needs git.
If Deno is missing, it installs it with Deno's official installer and says so, unless `NAIMA_NO_DENO_INSTALL` is set, in which case it prints that command and
stops. After that it downloads the newest release's archive, `naima-<version>.tar.gz`, and its checksum from the release on GitHub, checks the one against the
other and against the commit the release's tag names, unpacks the archive into `naima-tracker/naima/`, and makes that folder a git clone of the source at that
commit, with a branch `main` at the source's `main` as a clone has, so that updates and worktrees work as they do for any clone. Then it runs that program's
`naima init`, which records the version and the checksum in the lock, and `naima check`. The download is what counts the install
([Naima updates to releases](update-naima.md#naima-updates-to-releases)). If you run it again in a project that already has a lock, it clones only when
`naima-tracker/naima/` is missing, and then runs `naima check`. It never moves the lock, because that is the job of `naima update`.

`NAIMA_VERSION` names the release to install, a pre-release included. Without it the installer takes the newest release it can install from an archive. That
means a release from `1.1.0-beta.4` on, the first one built for archive installs; older releases are never picked, because their files are laid out the way
Naima was before. Among those releases it takes the newest stable one. It skips pre-releases only when such a stable release exists, so while none does it
installs the newest pre-release. The installer reads which releases exist from the source's tags with `git ls-remote`, a version with a suffix such as `-beta.4`
being a pre-release, and downloads the archive from its plain address on the releases page, so it works wherever git does, behind a proxy that refuses GitHub's
API too. `NAIMA_SOURCE` names a different repository, such as a fork or a path on this disk, and `NAIMA_RELEASES` where its releases' files are downloaded from.
`NAIMA_REF` installs a branch or tag with `git clone` instead of a release, as for developing Naima, and so does a source that has no releases. The installer's
own tests use these. For agents, the site's `llms.txt` says the same thing.

To do it by hand, in a git repository that doesn't use Naima yet:

```sh
git clone https://github.com/naima-project/naima.git naima-tracker/naima
deno run -A naima-tracker/naima/naima.ts init
git add naima-tracker && git commit -m "Track this project with Naima"
```

In a repository with no commit yet, that commit comes first: no branch or worktree can start before the trunk has one. `init` then prints it as its next step,
`git add` with the tracker folder and the agent files it wrote, and the `Naima-Setup: install` trailer the trunk guard takes; `naima open` refuses with the same
line until it is made. The project's own files are left out of it, for an item of their own.

`init` writes `naima-tracker/README.md`, `naima-tracker/.gitignore` (which ignores `naima/`) and `naima-tracker/naima-data/naima.json`, locked to the source and
commit of the clone that ran it ([data discovery and self-init](#data-discovery-and-self-init)). Outside `naima-tracker/` it writes only what makes an agent run
`naima hello` at the start of every session ([below](#the-agent-harness-entry-point)), and the lines that keep the program out of the host's own tools
[when asked](#the-hosts-own-tools). What goes in the folder is described in [using Naima in your project](tracker-folder.md). If the project already keeps a
`TODO.md` or an issue list, `naima adopt` brings it in ([adopt an existing board](adopt-an-existing-board.md)).

When the project's repository is public on GitHub, `init` ends with an offer for the agent to pass on: adding the topic `naima` to the repository, so that
people looking for projects that use Naima can find it. The agent asks you first, and adds it with `gh repo edit <owner>/<repo> --add-topic naima` only after
your yes. A private repository, or one whose visibility Naima cannot tell, gets no such offer.

### Where the tracker lives

Before it writes the data, `init` decides whether the tracker is committed with the code. A repository with no remote, a remote that is a path on this disk, or
a private remote keeps it inside, as above. A repository whose remote is public, or whose visibility can't be told, gets a question instead. When the remote is
public, `init` stops, writing nothing, and says the tracker has to be kept private beside the code, with `naima init --private-tracker` (a git repository of its
own in `naima-tracker/naima-data/`, created on this machine with no remote, which the code repository ignores). When its visibility can't be told, `init` asks
the owner once whether the remote is private: yes is `naima init --tracker-inside`, which records the answer, and no is `naima init --private-tracker`. With the
installer, set `NAIMA_TRACKER` to `private`, `inside`, or the URL of an existing tracker repository, which `init --tracker <url>` clones. Whether a remote is
public is asked of GitHub's public API without credentials, which is why the launcher lets every command reach `api.github.com`: after `init`, Naima asks again
at most once a day, so that a repository made public later is noticed before the next write. A project that already has a tracker committed inside a public
repository is left as it is by `init`, which says how to move it out. How the two repositories are kept in step, and how to move an existing tracker out, is in
[keep the tracker private](private-tracker.md).

Having chosen, `init` says in one sentence which layout it took and that layout's risk. Then, for each repository Naima relies on that has no remote (the
project's, and the tracker's own when it is kept beside the code), it gives the agent one question for you: whether to create a private GitHub repository for it
with `naima backup create`, or keep working locally with `naima backup decline`, which `naima hello` then recalls in one line at every session. For the
project's repository it also says how to do it by hand, and that GitHub takes no file over 100 MB
([a remote for every repository](private-tracker.md#a-remote-for-every-repository)).

`init` only locks something everyone else can fetch. It refuses a clone with uncommitted changes, or one whose commit its origin doesn't have, and it removes
any credentials from the origin URL (`https://user:token@…` is written as `https://…`) before the URL goes into `naima.json`, since that file is committed.

### Migrating from a copy

Some hosts have a `naima-tracker/naima/` that isn't a git clone, either plain files from an earlier version of Naima or a checkout that still has
`naima/src/cli.ts` at its top. In that case the old folder is moved aside to `naima-tracker/.naima-legacy-<date>`, and a fresh clone is made at the lock's
commit (moved forward to the product's head if the lock still names the old layout). The result is then run through `naima update` once, which gives one commit.
The installer does this when you run it again on such a host. By hand, it takes the same two commands as restoring a missing program
([below](#fresh-clones-and-worktrees)).

## Data discovery and self-init

`naima` always finds its data directory the same way. It looks at `--data <dir>` first, then `NAIMA_DATA`, and then the folder next to the program directory,
`dirname(program)/naima-data`, because the program knows where its data is from where it is itself. If that `naima-data/` folder doesn't exist, the program
creates it on its first run, along with the parent folder's `README.md` and `.gitignore` if those are missing too. It only does this when the parent folder is
inside a git work tree. Outside one it refuses, with the same message the installer gives outside a repository. This is exactly what `naima init` does, so a
plain `git clone` of Naima into `naima-tracker/naima/` followed by any `naima` command gives the same result as the installer.

## The clone

```
<project>/naima-tracker/          versioned: README.md, .gitignore ("/naima/")
<project>/naima-tracker/naima/      a git clone of Naima, gitignored
<project>/naima-tracker/naima-data/ versioned: naima.json and the items
```

`main` is the branch Naima is developed on. Its tests, its site, the rules for working on it and its own tracker live in the workshop, a separate repository
that is private for now. Cloning `naima-project/naima` gets you none of that, only what runs Naima: `naima.ts`, `src/`, `docs/`, `skills/`, `bin/` (the release
step's script), `README.md` and `LICENSE`, which is exactly what a project should carry. Tests make sure the clone stays that way. No test runner, type-checker
or agent harness that walks the file system picks up anything of Naima's own, and every import and relative link in the clone resolves inside it.

## The lock is git

`naima.json` holds `source` (the clone's `origin`, with credentials removed) and `commit` (a commit of Naima's `main`), and together these are the lock. When
the project runs a release, the lock also holds `version` and `sha256`, the checksum of the release's archive: a fresh copy that has to come from the network
downloads that archive too, and refuses it when its checksum differs. On every run, Naima compares `commit` with the clone's `HEAD`. If they differ, it fetches
the commit, first from a local seed (another worktree's `naima-tracker/naima/` on this disk) and then from `origin`, checks it out detached, and starts again. A
worktree's clone takes the seed's view of the source's branches with it. A clone whose `HEAD` is a commit it holds but no ref of `origin` reaches, as a
worktree's clone of a program installed from an archive could be left, would read as holding commits of its own: when a seed knows that commit as the source's,
or the source's `main` reaches it, Naima records it so and says it in one line; a commit only the clone has is still refused. If the lock names a commit the
source doesn't have, it refuses with one line naming both. If the lock names a commit from the old layout before the split (one that still has
`naima/src/cli.ts`), `naima update` moves it to Naima's product head, and that is how an older version is migrated.

## The host's own tools

Git ignores the program directory, but some tools walk the file system without reading `.gitignore`. Because the clone holds the same runtime `.ts` files that a
copy used to hold, those files reach `deno check`, `tsc` and `prettier` in the project. None of these tools has a marker file a directory could carry to keep
them out, so the exclusion has to go in the project's own configuration. `init` prints one line for each configuration it finds:

| Found                                          | Line                                                                                                           |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `deno.json`, `deno.jsonc`                      | `"exclude": ["naima-tracker/naima/"]`                                                                          |
| `tsconfig.json`                                | `"exclude": ["node_modules", "naima-tracker/naima"]` (tsc drops its default exclusion once `exclude` is given) |
| `.prettierignore`, or a prettier configuration | `naima-tracker/naima/`                                                                                         |

With `naima init --write-excludes`, it writes these lines itself, adding to the list a JSON file already has or creating a new one. A file with comments (JSONC)
is left alone, and the line to add by hand is printed instead. Together with the pointer line and the session-start hooks
([below](#the-agent-harness-entry-point)), which `init` and `update` write, this is the only way Naima ever writes outside `naima-tracker/`, and the launcher
grants access to exactly these files, for those commands only. Test runners need nothing, because the clone holds no tests.

The full command is long, so an alias helps:

```sh
alias naima='deno run -A "$(git rev-parse --show-toplevel)/naima-tracker/naima/naima.ts"'
```

The rest of the documentation writes `naima <command>` for it.

## The agent-harness entry point

Each agent tool reads its own always-on file: `AGENTS.md`, which many tools read, and the one each tool's adapter names (such as `CLAUDE.md` or `GEMINI.md`),
which together make `DEFAULT_ENTRY_FILES`, or a project's own `entryFiles` in `naima.json`. Mostly these files point at the project's own rulebook. If the
pointer names a file that has been moved or deleted, nothing errors, and the agent is simply taught nothing. So `naima check` reports it. It resolves every
plain-text path and markdown link in each configured entry file that exists, and reports one that names a missing file as a problem.

`naima init` adds one line to the host's `AGENTS.md`, or to the first other entry file the project has if there is no `AGENTS.md`, or creates `AGENTS.md` if
there is none. The line reads "Naima is in `naima-tracker/` (`naima/` the program, `naima-data/` the data); at the start of every session, run
`sh naima-tracker/naima.sh hello` (on Windows `naima-tracker\naima.cmd hello`), which installs Deno and the program first when either is missing, and pass on
what it says, unless its output is already in the conversation because a session-start hook ran it: then pass that on and do not run it again; when a naima
command prints a NAIMA-MESSAGE line, tell the owner what it says at once, and never acknowledge a message for them; if you find Naima elsewhere, update this
line". It is appended only if no entry file holds it already. The versioned `naima-tracker/README.md` holds the two commands that restore a missing program
([below](#fresh-clones-and-worktrees)).

### Running naima hello at every session start

The line works with any agent that reads its entry file, but an agent may still skip it. Some agent tools can run a command by themselves when a session starts,
and for those Naima has an adapter that installs a session-start hook running `naima hello`, so its greeting is in front of you and the agent before the first
message. A tool that can also run a command when the agent ends its turn gets a turn-end hook too: it runs Naima's tick, so what Naima has for you during a long
session (a newer Naima, a long run that is due, an urgent message) is said even when the agent runs no naima command for hours
([what Naima tells you while you work](messages.md)). Naima itself works with any agent; an adapter only knows how one tool is configured.

| Tool        | Its id in `agents` | Hooks                                                                                                                                                                                                                                                                                                                                                         | Where                                                                                        |
| ----------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Claude Code | `claude-code`      | a `SessionStart` hook running `sh "$CLAUDE_PROJECT_DIR/naima-tracker/naima.sh" hello --hook claude-code`, whose greeting Claude Code shows you directly, with what the agent is to say first; and a `Stop` hook running a small shell script shipped with Naima, which starts Naima only when something can be due and then has the agent tell you what it is | `.claude/settings.json`, merged into what the file holds: every other setting and hook stays |

Claude Code also gets three hooks on sub-agents, so that every sub-agent has the project's rules before it acts
([sub-agents get the rules too](../agents/read-the-project-rules.md#sub-agents-get-the-rules-too)). A `SubagentStart` hook runs
`naima subagent --hook
claude-code`, which puts the rules in the sub-agent's context. A `PreToolUse` hook on Bash, Write, Edit, MultiEdit and NotebookEdit runs
a small shell script shipped with Naima, which holds a sub-agent's call until it has the rules. A `SubagentStop` hook runs the same script and sends back, once,
a sub-agent that never had them. These are the only hooks for sub-agents that Naima knows of. Cursor, GitHub Copilot and Gemini CLI have none, so there a
worker's brief has to tell it to read the rules.

`naima init` installs the hooks of each tool the project uses: the tools `naima.json`'s `agents` names, or, without it, the tools whose files the project holds
(Claude Code's `CLAUDE.md` or `.claude/`) and the tool Naima is running inside, so an agent installing Naima in an empty folder gets its own hooks. The `Stop`
hook also reminds the agent, once, to file what you settled when a turn changed the project and nothing in the tracker. `naima init
--no-session-hook` installs
none and writes only the line. A settings file that is not plain JSON is left alone, and the hook to add by hand is printed instead.

`naima update` adds whatever is missing to a project set up before, as a mechanical fix: the line, or a new wording of an older line, and each hook, or a new
form of an older one, rewritten where it stands. `init` and `update` say each thing they write outside `naima-tracker/` in one sentence, what it is and why, and
the files go in the same commit as the update. An update started by a version whose launcher doesn't allow these files asks to be run once more
([update](update-naima.md#when-the-update-asks-to-be-run-once-more)). `naima check` notes a project where the line is missing or doesn't say to run
`naima hello`, and each tool in use whose hooks are missing or out of date.

### The committed launchers

Every hook Naima installs, and the line in the entry file, run Naima through a launcher that is committed with the project in `naima-tracker/`: `naima.sh` on
macOS and Linux (and under Git Bash on Windows, where it hands over to `naima.ps1`), and `naima.cmd`, which runs `naima.ps1`, from cmd or PowerShell on Windows.
Git's hooks run it too (the trunk guard and the pre-commit checks). `naima init` writes the three files, `naima update` rewrites them when the program holds a
newer copy, and `naima check` notes one that is missing or has been changed by hand.

When Deno and the program are both there, the launcher only runs Naima with the same arguments, and says nothing. A fresh clone in a new cloud session, or any
machine set up from scratch, has neither: the program is gitignored, and Deno lived in the old machine's home folder. The launcher then repairs both before
running Naima, and says each repair in one line on standard error:

```text
naima: Deno was missing: installed Deno 2.9.7 into naima-tracker/.bin/, SHA-256 checked
naima: the program was missing: restored version 1.2.0 from its release, SHA-256 checked, at 5be972fd2dc5
```

Deno is pinned in the launcher by version and by the SHA-256 of each platform's archive, and goes into `naima-tracker/.bin/`, which is gitignored; nothing is
installed outside the project and no administrator rights are needed. Deno found on the `PATH` or where its own installer puts it is used instead. The program
comes from the lock: the locked release's archive, checked against the checksum in `naima.json` and against the commit its tag names, as the installer does; a
lock with no release clones the lock's source, and Naima then aligns it to the locked commit. On Windows, `naima.cmd` starts PowerShell with
`-ExecutionPolicy Bypass`, so the machine's script policy doesn't stop it, and every path is quoted, so a project in a folder whose name has spaces works.

## Fresh clones and worktrees

A fresh clone of a project that uses Naima has `naima-data/` but no `naima/`. Any command through the committed launcher, `sh naima-tracker/naima.sh check` for
instance, restores it ([above](#the-committed-launchers)). Otherwise run the installer again, which sees the lock and clones Naima at the locked commit, or use
the two commands in the tracker's own `README.md`:

```sh
git clone <source> naima-tracker/naima
```

followed by any `naima` command, which then aligns the clone with the lock. A new [worktree](glossary.md#worktree) of the project is the same case. `naima open`
makes its program a local clone of the current one (`git clone --local`, then a checkout of the lock), so opening a worktree never touches the network.

## Every run aligns the program

Before it does anything else, every run makes `naima-tracker/naima/` match the `source` and `commit` in `naima.json` exactly. It clones the program if it is
missing, or checks out the locked commit if a different one is checked out. That way a fresh clone of the project, a new worktree, a colleague and CI all run
the same Naima. If the project doesn't have the program yet, there is no launcher in it either, so you run the launcher of any Naima you have at hand from
inside the project, for example the main worktree's, or a clone's as the installer does. Either way, the run ends aligned. Alignment behaves as follows:

- **It never overwrites work.** If the clone was changed in place, so that its working tree isn't clean at the locked commit, it refuses and tells you to
  publish the change as a fork and set `source`. Changing Naima is welcome ([below](#modifying-naima)), but losing the change without a word is not.
- **It refuses a commit it can't reach**, naming the source and the commit. This happens with a rewritten history or a deleted fork. Naima's own `main` is never
  rewritten.
- **It needs git and the network once per commit and machine**, to fetch the commit. If nothing is reachable and there is no network, it says so in one line. A
  commit already checked out somewhere on this disk needs no network at all ([below](#offline)).
- **It fetches from this disk when it can.** Every git worktree of a project has its own ignored program directory. A new one is cloned locally from another
  worktree's, and a commit missing there is first fetched from a repository on this disk that has it (the clone running the command, or the project itself when
  the project is Naima), so it isn't downloaded again.
- **It repairs the program, and says so.** If files were deleted from the clone and nothing else changed, it restores them from git. A clone that git can't read
  is moved aside next to it, never deleted, and cloned again, and a missing one is cloned. Each of these uses a copy on this disk when one holds the commit, and
  each is reported in one line ([update Naima](update-naima.md#when-the-program-is-damaged)).
- **It follows the lock, and says so.** If a pulled `naima.json` has a `commit` that moved, for instance because a teammate's `naima update` was merged, the run
  follows it and prints `naima: locked commit moved <a> → <b>` once.
- **It refuses a changed source.** If a pulled `naima.json` has a `source` different from the one the program was aligned from, the run refuses and names both
  sources and both commits. Naima runs whatever that source holds, so a new source is only trusted on purpose. Review why it changed, and then run

  ```sh
  naima update --accept-source     # align to the locked commit of the new source; nothing else moves
  ```

  In the meantime `naima update --check` still answers, because it only reads the source.
- **It checks signatures, if asked to.** With `"verify": "signed"` in `naima.json`, a commit is run, or updated to, only if `git verify-commit` verifies it with
  the keys git is configured to trust (gpg, or ssh with `gpg.ssh.allowedSignersFile`). Otherwise it is refused and the program stays where it was.
- **It leaves a worktree that differs from the trunk alone.** In a worktree whose lock names another commit than the trunk's lock, or whose program is a
  symbolic link rather than a clone of its own, nothing is moved ([below](#worktrees-and-the-lock)). In the main checkout, a program that is a link is never
  moved either, and every run says when it is not at the lock.
- **It never pulls.** Running whatever lands on a branch would be a supply chain risk, so only `naima update` asks the source for anything.

## Worktrees and the lock

Each worktree runs the Naima its own lock names, in its own clone. A worktree whose branch was made before the trunk's last `naima update` still locks the older
commit, so it runs the older Naima until the trunk is merged into it. A worktree whose `naima-tracker/naima` is a symbolic link to another checkout's program
shares that clone, and aligning it there would move the shared clone to the worktree's own lock, putting the trunk's program back at an older commit.

In both cases Naima moves nothing. `naima hello`, `naima verify` and `naima run` print a prompt instead, ready to paste into a conversation on the main
checkout. It names the worktree, its branch, the Naima it runs and the trunk's, and says what to do:

- **The worktree's lock is older than the trunk's:** merge the trunk into the worktree's branch, then run `naima hello` there, which moves the worktree's own
  clone to the new lock; a finished branch is then landed with `naima land`.
- **The worktree's lock is newer than the trunk's:** the branch carries an update of Naima. Merge the trunk into it and land it if the update is meant to land,
  or merge the trunk and keep the trunk's lock if not.
- **The worktree's program is a link:** remove the link (only the link, never what it points to) and run the worktree's launcher,
  `sh
  naima-tracker/naima.sh hello`, which clones the program at the worktree's lock from a copy on this disk.

A worktree made with `naima open` has a clone of its own at the trunk's lock, so none of this applies until the trunk's lock moves on.

## Updating

```sh
naima update --check     # is there a newer release? exit 1 when there is
naima update             # move the lock to it
```

`update` reads the source's releases, downloads the newest one's archive and checks its checksum, fetches the commit its tag names and checks that the archive
holds exactly that commit's files, checks it out in the clone, migrates the data forward if its format has changed
([migrations](../reference/format.md#migrations)), and records the new commit, version and checksum in `naima.json`. A source that publishes no releases, or
`naima update --main`, moves the lock to the head of the source's `main` instead ([update Naima](update-naima.md#naima-updates-to-releases)). The new checkout
is made next to the old one and only swapped in once it is complete, so a failed update leaves the previous program in place. The result is one change, which
you review and commit like any other:

```sh
git add naima-tracker && git commit -m "Update Naima to version <version>"
```

Updating is explicit, which means it takes a deliberate command, not that only a person can do it. An agent starts a session with `naima hello`, which checks
for a newer Naima as the `updates` setting in `naima.json` says. Once the owner has said yes, the agent runs `naima update`, the checks and the commit
([update Naima](update-naima.md)). When several branches are open, update on a branch of its own and merge that first. The other branches then merge the
[trunk](glossary.md#trunk) and run `naima update` again, which either finishes migrating their new items or does nothing.

## The permissions

`naima.ts` is the launcher. It runs with every permission (`-A`), and all it does is work out where the project and the program are, then run the program under
Deno with only these permissions:

| Permission | Granted                                                                                                                                                                                                                                                                                           | Why                                                                                                                                                                                                                                                                                                                                                        |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| read       | the repository, the program wherever it is, the data directory of every other worktree of the project, and the [tools directory](tools.md#where-the-tools-go)                                                                                                                                     | items, the project's markdown and source (the docs and beta-marker checks read them), git's view of branches, the commits the program is cloned from, and the uncommitted claims and notes of the other worktrees                                                                                                                                          |
| write      | `naima-tracker/`, and the data or program directory if moved out of it; the tick's state, `naima/` in the clone's git directory; for `init` and `update` only, the entry files and the session-start settings of the tools in use, and with `init --write-excludes` the host tools' configuration | items, claims, notes, the program's own alignment, the commits fetched for it; when each job of the tick last ran, and which messages were shown; the pointer line, the session-start hooks and the exclusion lines; nothing else in the project                                                                                                           |
| run        | `git`, `tar`, and the programs the loaded contributions declare, by name or by their absolute path in the [tools directory](tools.md#where-the-tools-go)                                                                                                                                          | alignment, update, and reading claims and notes across branches; unpacking a release's archive to check it; a [verifier](glossary.md#verifier)'s model checker (its `runs`, [the contract](../reference/plugin-contract.md#the-verifier-contract)); a declared [metric](metrics-and-budgets.md)'s program, the first word of its `run`                     |
| env        | an allow-list: `HOME`, `PATH`, the user, shell, terminal, locale and temporary-directory variables, the proxy variables, Windows' system ones, and every `NAIMA_*`, `GIT_*`, `SSH_*`, `LC_*` and `DENO_*`                                                                                         | what git needs to reach a source, and Naima's own; nothing else of the environment reaches the program, nor the git it runs                                                                                                                                                                                                                                |
| net        | none, but `api.github.com`, and the hosts a release's archive is downloaded from (`github.com` and the two GitHub redirects it to), or the servers `NAIMA_RELEASES` and `NAIMA_RELEASES_API` name                                                                                                 | the network is git's, in alignment and update; GitHub is asked whether the tracker's remotes are public, by `init` and then at most once a day ([where the tracker lives](#where-the-tracker-lives)), and for the source's releases, whose archive an install or update downloads ([Naima updates to releases](update-naima.md#naima-updates-to-releases)) |

**`naima tools`, and `naima backup create`, which installs gh through it, and no other command,** may also write to the tools directory, reach any host and run
any program. An install downloads from whatever host a redirect points to (a release's content server), and runs the unpackers (`tar`, `hdiutil`, `ditto`,
`unzip`), a Python and the tool it verifies, and none of these exists yet when the launcher starts ([tools](tools.md)).

**`naima verify`, and no other command,** may also run `naima-codegen`, found on `PATH`, the program of the `naima-codegen` verifier that comes with Naima
([the checks of naima-codegen](prove-and-close.md#the-checks-of-naima-codegen)), and read that script, to find the commit it runs from. With `--host` it may run
`ssh`, to run the verifier on another machine.

The allow-list of variables is `ENV` in `src/launcher.ts`. Deno can't grant a named list of variables and still let the program pass its environment on to git,
so the launcher enforces the list by giving the program only those variables. An unrelated secret, such as a cloud key, simply isn't there. Deno also splits its
permission lists on commas, so a project or program whose path contains a comma is refused with one line naming it.

Only the programs the launcher finds are named in the run permission: a name it finds in a directory of `PATH`, or a path that exists. A tool that is not
installed, such as one of mCRL2's when the project has switched its verifier on, is left out, so Deno has nothing to warn about when it starts. The program that
would start it still sees it as missing, and says how to install it.

A command that tries to do anything else fails with Deno's own error, for example `Requires write access to "…/escaped.txt"` or `Requires run access to "ls"`.
One consequence is that `naima docs --write` can only write inside the tracker folder when it is run through the launcher, so Naima's own repository regenerates
its reference with the development build (`deno task docs`).

**What this does not protect.** The permissions stop a bug, or a compromised dependency, from reaching beyond `naima-tracker/` and `git`. They can't stop a
malicious commit that a project has chosen to update to, because the launcher is part of that commit. The protection against that is the update itself. It is an
explicit commit in the project that can be reviewed, and nothing moves the lock without one.

## Modifying Naima

Naima is meant to be changed, but on a full checkout of `main` and never directly in `naima-tracker/naima/`, because alignment refuses a clone with local
changes rather than lose them without a word. Clone Naima, change it, and publish it as a fork. Then set `source` in `naima.json` to the fork and `commit` to
your commit (or run `naima update` once the fork's `main` has it), and the whole team will run that fork's `naima/` at that commit. A plugin of your own lives
in the fork's `naima/`, and `plugins` names it by its path there. Without a fork, it can live in the project or in its own git repository, pinned by its hash or
commit ([third-party plugins](config.md#third-party-plugins)). Improvements go back through pull requests. The data stays compatible as long as the fork keeps
[the format](../reference/format.md).

## Offline

Installing and `naima update` need the network once, to read the releases, download the archive and reach the source. Without it, `naima update` says why and
leaves the lock where it is. Aligning a new worktree or a second clone of a project tries a local seed first (another worktree's program clone on this disk), so
it needs no network when one is available. A fresh clone of a project on another machine needs the network once, to fetch the locked commit.

## Other runtimes

The code uses the standard APIs that Deno, Node and Bun share and has no dependencies, and its tests run on all three, on macOS and Linux. Windows isn't covered
by the tests. Deno is the documented runtime because of its permissions. If you run Naima directly with Node or Bun
(`node naima-tracker/naima/src/cli.ts <command>`), it works on the data, but it doesn't align or update, and nothing restricts what it can do.
