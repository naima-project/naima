# Plan with requirements, specifications and decisions

Three kinds of [item](glossary.md#item) keep the reasons behind the work
written down, so that nothing important exists only in somebody's memory or
in the title of a test.

| Kind | What it says | Everyday example |
|---|---|---|
| a [requirement](glossary.md#requirement) | something the result must satisfy | "the counter holds 50 kg" |
| a [specification](glossary.md#specification) | exactly how something must behave | the plumber's drawing, every pipe size on it |
| a [decision](glossary.md#decision) | a choice, or a permission, that is yours | "white tiles, not grey" |

You say them in plain words and an agent files them. The commands below are
the ones the agent runs, so you can check what it did, and you can run them
yourself if you want to.

## Requirements: what must hold

A requirement is worded so that it can be checked. It counts as **met** only
once a test (or a [property](glossary.md#property)) that checks it has
passed, and until then it is *stated*.

```sh
naima new requirements "Every number in table 2 comes from the raw data by a script"
naima link features/redo-table-2 satisfies requirements/every-number-table-2-comes-from-raw
naima link tests/table-2-rebuilt-matches verifies requirements/every-number-table-2-comes-from-raw
```

The first link says which piece of work delivers the requirement, and the
second says which test proves it. This command shows every requirement, what
delivers it and what proves it.

```sh
naima view requirements
```

```
✓ requirements/every-number-table-2-comes-from-raw  Every number in table 2 comes from the raw data by a script  [met] proven
    satisfied by: features/redo-table-2
    proven by:    tests/table-2-rebuilt-matches
```

`naima check` refuses a requirement that is marked met when no test for it
has passed, or when one has failed. It also reminds you of a requirement that
is proven but not yet marked met, and of one that nothing delivers or
proves.

## Specifications: how it must behave, version by version

A specification is the precise description of a behaviour. It is kept in
numbered versions, such as `export-format-v1` and `export-format-v2`, and
only one version is **current**, meaning it's the one the work follows.

```sh
naima new specs "Export format"                 # export-format-v1, a draft
naima set specs/export-format status=current    # agreed: work follows it
naima link features/csv-export specified-by specs/export-format
```

When the behaviour has to change, the specification is changed **first**.

```sh
naima spec revise specs/export-format
```

This opens `export-format-v2` as a draft, starting from the page of version
1 for editing, with a link saying that it replaces version 1. Once the new
version is agreed, it becomes current and the old one is marked superseded.
The work is then built to the new version and checked against it before it
closes. `naima spec` lists every specification with its current version and
the open work that follows it. `naima check` refuses two current versions of
the same specification, and reminds you of work that still follows an old
version.

## Decisions: asked once, never again

When something really is yours to decide, an agent asks you once. Your
answer is recorded as a decision, with the date, your words restated, the
reason, and what would make the question worth asking again.

```sh
naima new decisions "The paper targets the journal, not the conference"
naima link decisions/paper-targets-journal-not-conference settles todos/choose-venue
```

Before asking you anything, an agent searches what you have already
decided.

```sh
naima decisions journal
```

```
decisions/paper-targets-journal-not-conference  The paper targets the journal, not the conference  (2026-10-01)
  settles todos/choose-venue
```

A permission you want to keep giving, such as "you may always rerun the
analysis without asking", is recorded as a decision with `standing=true`, and
the search marks it as a *standing permission*. If you change your mind, your
new answer becomes a new decision that supersedes the old one. The old one is
kept as history, so nothing is overwritten. `naima check` points out an item
that is still waiting for your decision when a decision already answers it,
so that the agent acts on it instead of asking you again.

How agents decide what to ask you in the first place is described in
[asking the human](../agents/asking-the-human.md).
