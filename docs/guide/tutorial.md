# Tutorial: from an empty repository to a closed bug

This tutorial takes about twenty minutes from start to finish. You will
install Naima in a small project, file a bug, rank it, look at where the
project stands, fix the bug, prove the fix, and close it. You type every
command yourself, and the only code you touch is one word in a one-line
script. If you'd like the overview of the ideas first, read
[the primer](primer.md).

In everyday use an agent types these commands for you
([how the project runs](how-the-project-runs.md)). Doing them once by hand
shows you what it does. The project here is a tiny script, but the same steps
work for any software, and for other kinds of project such as a data analysis
or a paper.

Every output below is what the commands printed when this tutorial was run.
Yours will differ only in the item ids, the dates, the commit and the folder.

What you need: a terminal, and git. Naima installs the rest.

## 1. A project to track

Naima tracks a git repository, so start by making a tiny one with a script
that has a typo in it:

```console
$ mkdir demo && cd demo
$ git init -q
$ printf '#!/bin/sh\necho "Helo, $1"\n' > greet.sh
$ git add greet.sh && git commit -qm "A greeting"
$ sh greet.sh Ada
Helo, Ada
```

The "Helo" is the bug you will track.

## 2. Install Naima

Run this one line from the root of the repository (on Windows, use
PowerShell and run
`irm https://naima-project.github.io/naima/install.ps1 | iex` instead):

```console
$ curl -fsSL https://naima-project.github.io/naima/install.sh | sh
naima: cloning https://github.com/naima-project/naima.git (dist) into naima-tracker/naima
wrote naima-tracker/: README.md, .gitignore, naima-data/naima.json — locked to https://github.com/naima-project/naima.git at 89530499e809
next: naima new bugs "<the first thing to do>"
0 items, 31 checks

all invariants hold

Naima is installed in ~/demo.

Next:
  git add naima-tracker && git commit -m "Track this project with Naima"
  alias naima='deno run -A "$(git rev-parse --show-toplevel)/naima-tracker/naima/naima.ts"'

Agents: read naima-tracker/naima/skills/naima/SKILL.md
```

The installer put a copy of Naima in `naima-tracker/naima/` (the
[program directory](glossary.md#program-directory), which git ignores), and
`naima init` wrote the [data directory](glossary.md#data-directory),
`naima-tracker/naima-data/`, [locked](glossary.md#lock) to that exact copy.
Then `naima check` ran every [check](glossary.md#check), and since there are
no items yet, they all hold. If Deno was missing, the installer installed it
first and told you so.

Now do the two things it suggests. The alias lets you type `naima` instead of
the long command, and if you add it to your shell's startup file it will
stay.

```console
$ git add naima-tracker && git commit -qm "Track this project with Naima"
$ alias naima='deno run -A "$(git rev-parse --show-toplevel)/naima-tracker/naima/naima.ts"'
```

## 3. File the bug

Write the bug down before you fix it. Its title says what happened, not
what to do about it:

```console
$ naima new bugs "greet.sh says Helo instead of Hello"
naima-tracker/naima-data/bugs/greet-sh-says-helo-instead-hello/  f7c43c69-d654-49e5-9c1f-c9c30488afff
```

The bug is now an [item](glossary.md#item), which is a folder holding a
page (`README.md`), its fields (`meta.json`) and a place for evidence
(`attachments/`). The long string is its permanent [id](glossary.md#id), and
the folder name is its [slug](glossary.md#slug). From now on you can refer to
it by any part of the slug that is unique, such as `greet-sh-says`.

Open `README.md` in that folder in your editor and write down what you saw,
in your own words:

```markdown
# greet.sh says Helo instead of Hello

`sh greet.sh Ada` prints `Helo, Ada`. Anyone who runs the greeting sees the typo.
```

## 4. Triage it

[Triage](glossary.md#triage) ranks the bug against everything else. You say
how bad it is ([impact](glossary.md#impact)), when it should be done
([priority](glossary.md#priority)) and how well you understand it
([confidence](glossary.md#confidence)):

```console
$ naima triage set greet-sh-says impact=high priority=now confidence=measured
bugs/greet-sh-says-helo-instead-hello: impact=high priority=now confidence=measured
```

The fourth field, [effort](glossary.md#effort), is left until someone has
looked at the code, because it is never guessed.

## 5. See where the project stands

The [board](glossary.md#board) shows the items of one type, most urgent
first:

```console
$ naima board bugs
# Bugs

1 open, 0 done

## (no section)
  open      greet.sh says Helo instead of Hello  — bugs/greet-sh-says-helo-instead-hello
```

`naima bugs` shows how many bugs are left, as three numbers that are never
added together:

```console
$ naima bugs
bugs: 1 open
  unfixed (no code)     1
  fixed, not proven     0
  resolved, not closed  0
    bugs/greet-sh-says-helo-instead-hello  greet.sh says Helo instead of Hello
```

The [queue](glossary.md#queue) lists the open items on the project's
[gates](glossary.md#gate), which are the conditions a release waits on. This
project hasn't declared any yet, so the queue is empty
([read the board, the queue and the gates](read-the-board.md) shows how to
add one):

```console
$ naima queue
all gates: 0 open — agent 0, human 0, build 0, unclassified 0
  with no code yet: 0; owing only proof: 0
```

`naima summary` puts everything on one screen:

```console
$ naima summary
── items
  bugs            1 open     0 done

── bugs
  1 unfixed · 0 fixed, unproven · 0 resolved, not closed

── next up
  high    now     ·       bugs/greet-sh-says-helo-instead-hello  greet.sh says Helo instead of Hello
  (0 untriaged, 1 without effort — naima triage missing)

── gates
  properties       holds
```

(`properties` is a gate every project has, and it holds when every formal
[property](glossary.md#property) holds. Since there are none, it holds.)

## 6. Fix it

Change `Helo` to `Hello` in `greet.sh`, with your editor or with this line:

```console
$ printf '#!/bin/sh\necho "Hello, $1"\n' > greet.sh
$ sh greet.sh Ada
Hello, Ada
```

Record that the code exists, which makes the bug [fixed](glossary.md#fixed).
Now that you have seen the code, also record its effort (`S`, under an hour):

```console
$ naima set greet-sh-says fixedOn=2026-10-01
bugs/greet-sh-says-helo-instead-hello: fixedOn=2026-10-01
$ naima triage set greet-sh-says effort=S
bugs/greet-sh-says-helo-instead-hello: effort=S
```

Naima notices that nothing proves the fix yet. It reports this as a note,
not a failure:

```console
$ naima check
1 items, 31 checks

notes (not failures):
  · bugs/greet-sh-says-helo-instead-hello is fixed, and nothing verifies it

all invariants hold
```

## 7. Say how to prove it

A fix on its own is only a claim. The [proof](glossary.md#proof) is a
[gesture](glossary.md#gesture) that someone can perform, written as a
[test item](glossary.md#test-item) and linked to the bug it
[verifies](glossary.md#verifies). `runBy=agent` says that running a command
settles it, so no person is needed ([run by](glossary.md#run-by)):

```console
$ naima new tests "greet.sh greets with Hello" --set runBy=agent
naima-tracker/naima-data/tests/greet-sh-greets-hello/  3194a839-43bd-4e1d-8e51-861cb0cb04a5
$ naima link greet-sh-greets verifies greet-sh-says
tests/greet-sh-greets-hello verifies bugs/greet-sh-says-helo-instead-hello
$ naima triage set greet-sh-greets impact=high priority=now confidence=measured effort=S
tests/greet-sh-greets-hello: impact=high priority=now confidence=measured effort=S
```

Write the gesture on the test's page, `README.md` in its folder, so that
someone who wasn't here can perform it:

```markdown
# greet.sh greets with Hello

Run `sh greet.sh Ada`. It must print exactly `Hello, Ada`.
```

The test now shows as open on its own board, and the note from step 6 is
gone:

```console
$ naima board tests
# Tests

1 open, 0 done

## (no section)
  open      greet.sh greets with Hello  — tests/greet-sh-greets-hello
$ naima check
2 items, 31 checks

all invariants hold
```

If you try to close the bug now, Naima refuses, because a fixed bug isn't
yet a proven one.

```console
$ naima close greet-sh-says
naima: bugs/greet-sh-says-helo-instead-hello is fixed: closing takes fixedOn and a verified-by item that has passed
```

## 8. Perform the gesture, keep the evidence

Run the test and keep what it printed in the test's `attachments/` folder,
so the [evidence](glossary.md#evidence) stays with the claim. `naima attach`
copies the file there and records that it is your own (`--own`). A file
someone else gave you goes in with their permission instead
(`--consent "…"`).

```console
$ sh greet.sh Ada | tee run.txt
Hello, Ada
$ naima attach greet-sh-greets run.txt --own
tests/greet-sh-greets-hello: attached run.txt (your own)
$ naima set greet-sh-greets status=passed
tests/greet-sh-greets-hello: status=passed
```

## 9. Name the commit, then close it

Commit the fix and the tracker's record of it together, as one change, and
then name that commit on the bug. That way the fix is tied to the code that
made it, not only to a date.

```console
$ git add -A && git commit -qm "Fix the greeting"
$ naima set greet-sh-says commits=$(git rev-parse HEAD)
bugs/greet-sh-says-helo-instead-hello: commits=802f1664a18a5bce71f6d46245feafd297fd056d
```

Without the commit, `naima close` refuses, because a fix with no commit
reachable from the trunk hasn't actually landed:

```console
$ naima close greet-sh-says
naima: bugs/greet-sh-says-helo-instead-hello cannot be closed: none of its commits is a real commit reachable from the trunk — set commits, or close --force
```

The bug is now [resolved](glossary.md#resolved). It is fixed, proven by a
test that passed, and tied to the commit that fixed it. Closing it moves it to
the archive along with its proof:

```console
$ naima close greet-sh-says
closed → closed/greet-sh-says-helo-instead-hello
$ naima bugs
bugs: 0 open
  unfixed (no code)     0
  fixed, not proven     0
  resolved, not closed  0
$ naima check
2 items, 31 checks

all invariants hold
```

The closed item keeps everything, including what proves it and which commit
fixed it:

```console
$ naima show greet-sh-says
greet.sh says Helo instead of Hello
closed/greet-sh-says-helo-instead-hello  f7c43c69-d654-49e5-9c1f-c9c30488afff  [closed]
  created: 2026-10-01
  impact: high
  priority: now
  confidence: measured
  triagedOn: 2026-10-01
  fixedOn: 2026-10-01
  effort: S
  commits: ["802f1664a18a5bce71f6d46245feafd297fd056d"]
  closedFrom: bugs
  closedOn: 2026-10-01
  is proven by tests/greet-sh-greets-hello [passed]  (inverse)

# greet.sh says Helo instead of Hello

`sh greet.sh Ada` prints `Helo, Ada`. Anyone who runs the greeting sees the typo.
```

Bugs closed before the `commits` field existed aren't given one after the
fact by guessing which commit it was. `naima check` only asks for it from the
date set in
[`plugins.trackers.options.commitsRequiredFrom`](prove-and-close.md#4-name-the-commit).

```console
$ git add -A && git commit -qm "Close the bug, with its proof"
$ git status --short
```

## What you did

- You installed Naima, which added one folder, `naima-tracker/`, and
  changed nothing else in the project.
- You filed a bug before fixing it, and triaged it.
- You read the board, the bug count, the queue and the summary, all of which
  are worked out when you ask for them rather than stored.
- You fixed the bug, proved the fix with a test item that passed, kept the
  evidence, named the commit, and closed the bug. Naima refused to close it
  until the proof existed, and refused again until a real commit, reachable
  from the trunk, was named.

## Next

- [The guide](README.md) has one page for each everyday task.
- [Concepts](concepts.md) explains the ideas behind what you just did.
- [Rules](rules.md) lists the rules every project holds to.
- [Working with AI agents](working-with-agents.md) shows how to let agents do
  all this for you.
- `naima guide`, run from inside the project, tells you where the
  documentation of the copy you run is:

```console
$ naima guide
Naima 89530499e809, data format 2, at naima-tracker/naima
Read these as files; they are the documentation of the Naima that runs:
  skill    naima-tracker/naima/skills/naima/SKILL.md
  index    naima-tracker/naima/docs/README.md
  guide    naima-tracker/naima/docs/guide/README.md
  rulebook naima-tracker/naima/docs/guide/rules.md
  agents   naima-tracker/naima/docs/agents/README.md
  format   naima-tracker/naima/docs/reference/format.md
  install  naima-tracker/naima/docs/guide/install.md
```
