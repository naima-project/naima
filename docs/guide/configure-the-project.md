# Configure the project

Most projects don't need to configure anything, because every first-party
[plugin](glossary.md#plugin) is on, with defaults worked out from the
repository. When you do need something, it goes in one file,
`naima-tracker/naima-data/naima.json`, under `plugins`. The agents make these
changes for you, but you can also edit the file in your editor, run
`naima check`, and commit it.

Every key and its default are listed in [configuration](config.md).

## Add a release gate

```json
{
  "plugins": {
    "gates": { "options": { "gates": {
      "v1": { "title": "First release", "says": "what the first release waits on", "holdsOn": "code" }
    } } }
  }
}
```

Then put [items](glossary.md#item) on it with `naima set <item> gate=v1`,
and see where it stands with `naima gates v1`. What `holdsOn` means is
explained in [gates](read-the-board.md#gates). Add `"fullSuite": true` to
make it wait for every property and test suite of the project as well
([a release gate](read-the-board.md#a-release-gate-waits-for-the-full-suite)).

## Define the values a field takes

`area` and `kind` are free text until the project lists their values. Once
there is a list, each value has a title and says what it means, so a value
someone guessed isn't sorted and grouped as if it were an agreed one.

```json
{
  "extends": [
    { "field": "area", "values": {
      "cli": { "title": "Command line", "says": "the naima command and its output" },
      "docs": "the guide and the reference"
    } },
    { "field": "kind", "values": { "code": "a change to the program", "tester": "a gesture the tester role performs" } }
  ]
}
```

Each value is either a string saying what it means, or
`{ "title", "says" }`. A plugin can add values to the same list in the same
way. The list is open, so `naima check` reports a value that isn't on it as
a note, naming the items that hold it, and doesn't change any of them. It's
then up to you (or an agent) to define the value, or to set those items to
one that is on the list. To make an off-list value fail the check, weigh the
core's `values` check as `problem` (see below). `naima types` prints every
list, with each value, how many items hold it, and a mark on the values that
are off the list.

`gate` and `epic` already have fixed lists. The values of `gate` are the
gates that have been contributed, the values of `epic` are the epics that
have been filed, and anything else fails the check.

Add a new value, with its meaning, in the commit that first uses it.

## Make a check stricter, or quieter

Each [check](glossary.md#check) can be weighed as `problem` (it fails
`naima check`), `note` (it is only reported) or `off`. The setting goes under
the plugin that declares the check:

```json
{ "plugins": { "core": { "checks": { "duplicates": "problem" } } } }
```

The [reference](../reference/reference.md) says which plugin declares which
check.

## Switch a plugin off

```sh
naima plugin disable beta-markers
```

This does the same as editing the file by hand to say
`{ "plugins": { "beta-markers": { "enabled": false } } }`. While the plugin
is off, everything it declares (its types, fields, checks and commands) is
gone, and `naima plugin enable beta-markers` turns it back on. An opt-in
plugin that starts a program, such as `verifier-mcrl2`, stays off until it is enabled in the same way.

## Give a plugin its options

```sh
naima plugin set beta-markers 'paths=["src"]'
```

This does the same as editing the file by hand to say
`{ "plugins": { "beta-markers": { "options": { "paths": ["src"] } } } }`.
The value is read as JSON when it parses as JSON (a list, a number, `true`),
and as a plain string otherwise. The command is refused if `beta-markers`
declares no option named `paths`. An empty value (`paths=`) removes the
option. `naima plugin show <name>` prints what a plugin's options are and
what the project has set, and every plugin's options, with their defaults,
are also in the [reference](../reference/reference.md).

One option changes what every agent must do. By default each write of free
text or a file to the tracker has to be signed against the no-leaks
checklist with `--revised`
([the rule](rules.md#free-text-and-files-are-signed-against-the-no-leaks-checklist)).
A project that doesn't want this, for example one whose tracker never leaves
a single machine, turns it off with `naima plugin set privacy signed=false`,
and turns it back on by removing the option with `naima plugin set privacy signed=`.

## Keep Naima out of your own tools

Some tools, such as `deno check`, `tsc` and `prettier`, read every file in
the project, so they would also read Naima's program files. `naima init`
prints the line that excludes `naima-tracker/naima/` from each configuration
it finds, and `naima init --write-excludes` writes those lines for you
([the host's own tools](install.md#the-hosts-own-tools)).

## Move the data

The data directory can live anywhere in the repository. To move it, use
`git mv`, then run Naima with `naima --data <dir>` or `NAIMA_DATA=<dir>`, and
mention the new place in the tracker's README
([moving things](tracker-folder.md#moving-things)).

## Add a plugin someone gave you

This has [its own page](add-a-plugin.md).
