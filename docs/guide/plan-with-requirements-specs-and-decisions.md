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

## Requirements come from every conversation

Requirements aren't written once, at the start of the work. Whenever you say
something about what you want, the agent checks whether it adds a
requirement or changes one, and files it straight away, in the background,
while the work underway carries on
([the rule](rules.md#requirements-are-elicited-at-every-prompt)).

- A new need becomes a new requirement.
- A need that refines an existing requirement, such as a tighter number, is
  written on that requirement's page, with a note saying what changed and
  why. One that replaces it altogether is filed as a new requirement, and the
  old one is set to `dropped` with its reason, so nothing is overwritten.
- A change to exactly how something behaves becomes the next version of its
  specification (below).

A wish is often vague when it is first said, like "the shop should feel
fast". The agent restates it as something a test can decide, such as "a
product page loads in under one second", and then works out how it will be
checked. There are three ways.

| How | When | Example |
|---|---|---|
| a test | the result can be tried and seen | the exported file opens in the spreadsheet |
| a [property](glossary.md#property) of a model | the behaviour has states or runs in parallel | a job is never retried more than twice ([design with a model](design-with-a-model.md)) |
| a [metric](glossary.md#metric) with a budget | it can be measured: a time, a size, a count, a rate | page load time, at most 1 second ([metrics and budgets](metrics-and-budgets.md)) |

The agent proposes the check, and asks you only for what is yours to give,
which is usually the number a budget holds to. The answer is written on the
requirement's page, and the test or property that checks it is linked to it
once it exists. For a metric, that is a test whose gesture is running the
metric (`naima metrics run page-load`) and seeing it within its budget.

```sh
naima new requirements "A product page loads in under one second"
naima note requirements/product-page-loads-under-one-second "Checked by the metric page-load, with a budget of 1 s, run on every commit."
naima link tests/page-load-within-budget verifies requirements/product-page-loads-under-one-second
```

`naima check` notes a requirement that nothing delivers or proves yet, so a
requirement filed without a way to check it doesn't go unnoticed.

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
A later revision always starts from the current version, whichever version
you name: `naima spec revise specs/export-format` after version 2 is current
opens version 3 from the page of version 2. A specification still in development, at version 0.3 (`naima set specs/export-format version=0.3`), is revised to 0.4: the last component is raised, and the new item's title and directory are named after the new version, `Export format v0.4`. The work is then built to the new
version and checked against it before it closes. `naima spec` lists every specification with its current version and
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
