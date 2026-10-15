# The Naima format

The public specification of every file Naima reads and writes in a project:
its files, their fields and the invariants `naima check` holds. It is the
compatibility boundary between forks. Change Naima however you like
([modifying Naima](../guide/install.md#modifying-naima)); a fork that reads and writes
this format works on the same data as every other.

This page specifies **format 3**, the one this Naima reads. The format is a
number, `format` in `naima.json`; it moves only with a migration (below).
Each plugin with migrations of its own has a format of its own too, in
`formats`.

## The folder

A project carries one folder, `naima-tracker/` (any name works), at its root:

```
naima-tracker/
  README.md                 what Naima is, and the two commands that restore the program
  .gitignore                /naima/
  naima/                    the program: a git clone of Naima, at the locked commit
  naima-data/               the data
    naima.json              the anchor: the format, the lock, the project's facts
    <type>/<slug>/          one directory per item
    claims/<uuid>.json      coordination: one file per branch that claims work
    passes/<date>-<uuid>.md coordination: one file per session note
    adopted/<file>.json     naima adopt: one record per board brought in
```

Naima writes nothing in the project outside this folder, with one
exception: the marker lines `naima adopt propose --write` inserts into the
board being adopted, which only add lines
([adopt an existing board](../guide/adopt-an-existing-board.md)) — and the
host files `naima init --write-excludes` and `--write-agent-pointer` name.
Nothing is written outside the project.

The program finds its data beside itself: `naima-data/`, the sibling of the
program directory, whatever the current directory; `naima --data <dir>` or the
`NAIMA_DATA` environment variable names another. When the sibling is absent,
the first run makes it, as `naima init` does — only inside a git repository.
The program directory of data named elsewhere is `program` in `naima.json`.
The anchor never moves: the data directory is the one whose `naima.json`
carries `format`.

## `naima.json`

```json
{
  "format": 3,
  "formats": { "gates": 2 },
  "source": "https://github.com/vincenzoml/naima.git",
  "commit": "0123456789abcdef0123456789abcdef01234567",
  "plugins": {
    "gates": { "options": { "gates": { "v1": { "title": "First release", "says": "What v1 needs.", "holdsOn": "code" } } } }
  }
}
```

| Key | Required | What it is |
|---|---|---|
| `format` | yes | the data format, an integer: this page is format 3 |
| `formats` | no, `{}` | each plugin's own data format, by plugin name: only the plugins whose format has moved past 1 appear; one absent is at format 1 ([migrations](#migrations)) |
| `source` | yes | the git URL, or absolute path, of the Naima the project runs: Naima's own repository, or a fork; never starting with `-`, and a path on this disk is absolute |
| `commit` | yes | the full hash of the `source` commit the project runs: **the lock**; a commit of its `main` ([the program](#the-program)) |
| `verify` | no | `"signed"`: run a locked commit only when git verifies its signature ([install](../guide/install.md#every-run-aligns-the-program)) |
| `program` | no, `../naima` | the program directory, relative to the data directory |
| `plugins` | no, `{}` | plugin name → `{ "options", "enabled", "replacedBy", "source", "checks" }`, first-party plugins included: their options (the project's gates are the `gates` plugin's), switched off, replaced, added from a pinned source — a path inside the program, `{ "path", "sha256" }` or `{ "git", "commit", "path" }` — their checks weighed ([configuration](../guide/config.md#the-plugins-table)) |
| `rename` | no, `{}` | kind → `{ "<plugin>/<name>": "<short name>" }`: the name a third-party plugin's contribution goes by, when two plugins would store the same one ([names](plugin-contract.md#names)) |
| `extends` | no, `[]` | the project's own additive changes to the loaded plugins' types and fields: `{ "type", "statuses", "traits", "transitions" }` or `{ "field", "values", "appliesTo", "traits" }` ([extending](plugin-contract.md#extending-another-plugins-types-and-fields)) |
| `updates` | no, `check` | what a session start, `naima hello`, does about a newer Naima: `off`, `check` or `update`; set with `naima update --mode` ([update Naima](../guide/update-naima.md#what-happens-when-a-session-starts)) |
| `entryFiles` | no, sensible defaults | the agent-harness entry files (`CLAUDE.md`, `AGENTS.md`, …) `naima check` and `naima init --write-agent-pointer` act on, project-root relative ([the agent-harness entry point](../guide/install.md#the-agent-harness-entry-point)) |

Any other key is an error. `source`, `commit`, `verify` and `program` are the
lock: they keep these names and meanings in every format, so that any Naima
can align itself and update whatever the format of the data.

## The lock

`source` and `commit` say which Naima runs the project, the way a lockfile
says which version of a dependency does. Every run aligns the program
directory — a git clone of `source`, checked out at `commit`, ignored by
`naima-tracker/.gitignore` — to exactly that source and commit first:
everyone on the project, and CI, runs the same Naima. No run pulls on its
own; `naima update` is the only command that asks the source anything, and
it moves the lock in one reviewable change. How alignment behaves, and when
it refuses: [installing and updating](../guide/install.md#every-run-aligns-the-program).

Code runs only from the program, never from the data: a plugin is a path
inside the program, and a project that wants one carries it in its fork.

### The program

The program is a git clone of `source`, ignored by the tracker folder's
`.gitignore`, its `HEAD` the locked `commit`, detached; its `origin` is
`source`. Alignment fetches the commit from a repository on this disk that
holds it — the main worktree's program — before `origin`, and refuses a clone
with uncommitted changes or commits its source lacks. A commit of the old
layout, its runtime in `naima/` rather than at the top, is refused by every
command but `naima update`, which moves the lock to the head of the source's
`main`.


## Items

An item is a directory, `<type>/<slug>/`, under the data directory, where
`<type>` is a directory a loaded type declares ([reference](reference.md)):

| File | What it holds |
|---|---|
| `README.md` | the prose, in markdown |
| `meta.json` | the fields: a JSON object |
| `attachments/` | the evidence: any files |

`meta.json` always holds:

| Field | What it is |
|---|---|
| `id` | a uuid, permanent: links hold ids, never slugs |
| `title` | a non-empty string |
| `status` | one of the statuses the item's type declares |
| `links` | optional: a list of `{ "rel", "id" }`, one direction of each link |

Every other field is declared by a plugin with a kind — `string`, `strings`,
`date` (`YYYY`, `YYYY-MM` or `YYYY-MM-DD`), `enum`, `boolean`, `number` — and
is checked against it; a `string` or `strings` field with a list of values
has a value off it reported as a note, never refused. An `enum` that takes several values holds one as a
string and several as a list: `"gate": "v1"`, `"gate": ["v1", "v2"]`. A field no loaded plugin declares is kept and not
checked. The slug is the directory's name and may change; the id may not.
Only one direction of a link is stored; its inverse is derived when read.
Boards, queues and gate states are derived and never stored.

## Coordination files

State that belongs to no branch is one file per writer, on the writer's own
branch, recombined when read ([concepts](../guide/concepts.md)):

- `claims/<uuid>.json`: `{ "branch", "claimedAt", "note"?, "items": [{ "id", "ref", "title" }] }`;
- `passes/<date>-<uuid>.md`: front matter `date`, `at` (an ISO instant), `branch`, then the note.

## Adoption records

`adopted/<file>.json`, one per board `naima adopt split` brought in, the
name the slug of the board's path: `{ "source", "at", "sha256", "items",
"pieces" }`. `source` is the path from the project root; `at` the commit the
board was last read at (12 characters), or `working-tree`; `sha256` the
board's digest without its marker lines; `items` maps each marker's `key` to
`{ "id", "sha256" }`, the item opened and its segment's digest as adopted;
`pieces`, in order, is either `{ "prose" }`, the board's own text between
segments, or `{ "key", "item", "text" }`, a segment as adopted. Joined, the
pieces are the board without its markers, byte for byte. Each adopted item
has `adoptedFrom`: `<source>#L<from>-L<to>@<at>`.

## Invariants

`naima check` fails when any of these does not hold, and the
[reference](reference.md) lists every check a loaded plugin adds:

- every item directory has a `README.md` and a `meta.json` that is a JSON object;
- every item has a uuid no other item has, a title, and a status its type declares;
- every declared field holds a value of its kind;
- every link uses a declared relation and names an existing item other than its own;
- no item is still in a shape a format migration, the core's or a plugin's own, replaced (`one-format`).

## Migrations

A format moves by one migration at a time, and only forward. `naima update`
runs them after it moves the lock to a Naima that reads a newer format:
deterministically — the same input gives byte-identical output — and
idempotently, so running it again changes nothing. Data newer than the Naima
at the lock is refused in one line; it can only come from a hand edit.

A migration rewrites `naima.json` and every item's `meta.json`, and declares
which items still have the shape it replaces, so that `check` fails on a
tracker that mixes formats.

A plugin may carry migrations of its own data — a field it renames, a setting
it moves — without moving the core's format or any other plugin's. Its format
is 1 + the number of its migrations, recorded in `formats` under its name
(absent means 1), and `naima update` runs its migrations after the core's, in
load order, under the same rules: deterministic, forward only, idempotent, and
held by the same `one-format` check. `init` records the format every
first-party plugin starts at. Data a newer plugin wrote is refused in one
line, as the core's is.

The launched program, which is the project's authority, refuses data that
still owes a migration until `naima update` runs it. The development build
(`src/cli.ts` run directly, which never writes the tracker) reads such data as
migrated, in memory, and says so on stderr — but only when the migrations owed
change `naima.json` alone; one that rewrites items is refused there too. Parallel branches: update on its own branch and
merge it first; every other branch then merges the trunk and runs `naima
update`, which finishes the migration of its own new items or does nothing.

This Naima carries two migrations of the core's format, and one of the
`gates` plugin's:

- **format 1 → 2**: `plugins`, a list of third-party paths, becomes a table
  keyed by plugin name; each path becomes the `source` of an entry named
  after its file (`plugins/mine.ts` → `mine`, `plugins/other/index.ts` →
  `other`, a second `mine` → `mine-2`), its options kept;
- **format 2 → 3**: `carry` leaves `naima.json`: the program is a gitignored
  git clone, and nothing else. A project whose `carry` is `vendored` or
  `submodule`, a program committed in it, is refused by `naima update` with
  the commands that remove it by hand;
- **gates format 1 → 2**: the top-level `gates` key moves to
  `plugins.gates.options.gates`.

Format 1 is the first format: data in no format cannot be migrated, and is
refused.
