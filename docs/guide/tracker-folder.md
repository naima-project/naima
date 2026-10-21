# The tracker folder

A project that uses Naima has one folder, `naima-tracker/`, at its root, and
runs the copy of Naima kept inside it. How to install Deno and bootstrap the
folder is explained in [installing and updating](install.md). The agents run
the commands on this page for you, unless you want to run them yourself.

## Just add naima

In any git repository, once Naima is installed ([installing](install.md#bootstrap-a-project)):

```sh
naima init
```

This creates the rest of `naima-tracker/`, locked to the Naima that ran it,
and prints the next command to run. It asks no questions and touches no file
outside `naima-tracker/`, and running it again changes nothing. If the
project configures a tool that would read the program's `.ts` files, such as
`deno.json`, `tsconfig.json` or prettier, it also prints the line that
excludes `naima-tracker/naima/` from that tool. It only writes those lines
when asked to, with `naima init --write-excludes`
([the host's own tools](install.md#the-hosts-own-tools)). After that:

```sh
naima new bugs "Export drops the alpha channel"
naima check
git add naima-tracker && git commit -m "Track this project with Naima"
```

Every first-party plugin is already on, with defaults inferred from the
repository ([the automatic principle](config.md#the-automatic-principle)).

## The naima-tracker folder

```
naima-tracker/
  README.md            one line: what Naima is, and a link to it
  .gitignore           ignores naima/
  naima/               the program: a git clone of Naima, at the locked commit, never committed
  naima-data/
    naima.json         the format, the lock, and the few facts that cannot be inferred
    bugs/<slug>/       one directory per item: README.md, meta.json, attachments/
    todos/  features/  tests/  properties/  rules/  closed/
    claims/  passes/   coordination across branches: one file per session
    metrics/           the numbers naima metrics run --record measured, one file per run
    test-runs/         each test suite's recorded runs, test by test, with their logs
    adopted/           what naima adopt kept of a board it brought in, one file per board
```

`git status` shows `naima-data/`, `README.md` and `.gitignore`, never
`naima/`.

Your material lives in `naima-data/`, never in `naima/`. The program
directory holds only what runs Naima. It has no tests, no fixtures, no CI, no
agent rules, and none of Naima's own [items](glossary.md#item), which live in
the workshop, a separate repository whose public copy,
[naima-lab](https://github.com/naima-project/naima-lab), leaves them out. Everything the project tracks,
such as its bugs, todos, features, tests and rules, is an item in its own
`naima-data/`, in the directory for its type. (A milestone is a
[gate](glossary.md#gate) with a date, so it is kept with the other gates in
`naima.json` rather than in a directory of its own.) `naima/` is replaced as
a whole on every update. Only the item directories that hold something
exist. Commands work from any subdirectory, because Naima walks up from the
current directory to the first `naima-tracker/naima-data/naima.json`. Every
file and field is specified in [the format](../reference/format.md).

## The lock

`naima.json` records which Naima runs the project, by its `source` and its
`commit`. Every run aligns `naima-tracker/naima/` to exactly that, so two
people, or a person and an agent, never manage the same tracker with two
different versions of Naima. The lock moves only with `naima update`, as one
reviewable commit ([updating](install.md#updating)).

## Migration

The data has a format, recorded as a number in `naima.json`. When an update
brings a Naima that reads a newer format, `naima update` migrates the data
forward in the same change, deterministically. Naima never acts on data in a
format other than its own. It refuses newer data with a one-line message and
leaves older data to `naima update`, and `naima check` fails on a tracker
whose items mix formats. That happens on a branch that hasn't yet merged the
[trunk](glossary.md#trunk)'s update. What to do in that case is described in
[migrations](../reference/format.md#migrations).

## Moving things

- **The data directory** can live anywhere in the repository. Move it with
  `git mv`, and run Naima with `naima --data <dir>` or `NAIMA_DATA=<dir>`.
  Mention this in the tracker's README so that the next person can find it.
- **The program directory** is `program` in `naima.json`, relative to the data
  directory.
