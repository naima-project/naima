# Make and keep artifacts

Some work ends in something you keep: an analysis, a profile, a report, a
dataset, a figure for a paper. Naima tracks each one as an
[artifact](glossary.md#artifact), an item that says when it is due, which
files it consists of, and, once it is delivered, exactly what it was made
from. That last part lets you make it again later, and lets `naima check`
tell you when it no longer matches its data.

## Plan one

An artifact starts as `planned`, usually with a date. The todo that will make
it is linked to it with `produces`.

```sh
naima new artifacts "Profile of the new engine against the old one" --set due=2026-11-01
naima new todos "Profile both engines on the benchmark suite"
naima link todos/profile-both-engines-benchmark-suite produces artifacts/profile-new-engine-against-old-one
```

While you work on it, set it `in-progress`. Before delivering, say what it
consists of and what it is made from. Both are paths from the project root.

```sh
naima set artifacts/profile-new-engine-against-old-one files=reports/profile.md,reports/profile.csv inputs=bench/results
```

`files` are the files you keep. A file attached to the item counts too.
`inputs` are the files or folders the artifact is made from. If it is made
from the result of a test, a property or another artifact, link it with
`uses` instead of naming its files:

```sh
naima link artifacts/profile-new-engine-against-old-one uses tests/sequential-reference-timings
```

## Deliver it

```sh
naima set artifacts/profile-new-engine-against-old-one status=delivered
```

Naima refuses if a file named in `files` is missing, or if the artifact has no
files at all. Otherwise it records two fields. `madeFrom` holds the commit
the work was at, one digest over the inputs and the items it uses, and the
moment. `deliveredOn` holds the day. Nobody sets these two by hand. The
delivery appears in `naima diary` on that day, without anyone writing an
entry for it.

There is no separate `deliver` command. Delivering is a change of status, like
a test that passes, and the record is made by Naima whichever command sets
it.

## When it goes out of date

`naima check` adds a note when:

- an artifact is past its due date and not delivered,
- a delivered artifact's inputs have changed since it was made, or the items
  it uses have a new result,
- a planned artifact has nothing that produces it.

When the data changes, you can make the artifact again: set it back to
`in-progress`, regenerate it, and deliver it again, which records the new
inputs. If you want to keep the old version, create a new artifact instead
and link it with `supersedes`, then set the old one to `superseded`.

```sh
naima new artifacts "Profile of the new engine against the old one, v2"
naima link artifacts/profile-new-engine-against-old-one-v2 supersedes artifacts/profile-new-engine-against-old-one
naima set artifacts/profile-new-engine-against-old-one status=superseded
```

The fields, statuses and the check are listed in the
[reference](../reference/reference.md), under the planning plugin.
