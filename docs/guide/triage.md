# Triage

[Triage](glossary.md#triage) ranks an [item](glossary.md#item) against everything else, so that a list sorted "most urgent first" actually means something. It
uses four fields, and three of them are set when the item is opened ([the rule](rules.md#triage-what-you-touch)). The agents triage what they file and run the
commands on this page, unless you want to run them yourself.

## Set the fields

```sh
naima triage set export-drops impact=high priority=now confidence=measured
```

| Field                                | Ask yourself                         | Values                                            |
| ------------------------------------ | ------------------------------------ | ------------------------------------------------- |
| [impact](glossary.md#impact)         | if nobody touches this, who notices? | `blocker` · `high` · `medium` · `low`             |
| [priority](glossary.md#priority)     | when?                                | `now` · `next` · `later` · `parked`               |
| [confidence](glossary.md#confidence) | do we understand it?                 | `measured` · `diagnosed` · `reported` · `unclear` |
| [effort](glossary.md#effort)         | what does the fix cost?              | `S` · `M` · `L` · `XL`                            |

Set **effort** only once someone has looked at the code. A report says nothing about what a fix will cost, so it's right for an item without a size to sink in
the ranking ([the rule](rules.md#effort-is-never-guessed)).

Every change to these fields stamps `triagedOn` with today's date.

For a feature or a bug, the agent also records whether the behaviour has states or concurrency, such as a lifecycle, a protocol or a retry loop:
`naima set export-drops stateful=true`, or `false`. A stateful change is modelled and verified before it is coded
([design with a model](design-with-a-model.md)), and once it has landed, `naima check` notes it when no model or property is linked to it and no note says why
it has none.

## Rewrite the description, note what you checked

Triage often rewrites a report so that the next reader can act on it, and records what was checked. Both are done with commands, so they are dated, attributed
and checked like every other write:

```sh
naima describe export-drops "Export to PNG loses the alpha channel on 16-bit images."
naima note export-drops "Reproduced with sample.png; 8-bit images keep alpha." --by "Ada"
```

`naima describe` replaces the description and keeps the title and the notes. `naima note` adds a dated entry, with its author and branch, at the end of the
item's **Notes** section, and earlier notes are never rewritten. Both can read a longer text from `--file`. Write in your own words, because a person's message
only goes in verbatim if they say yes ([the rule](rules.md#the-owners-chat-stays-private)).

## See what is missing

```console
$ naima triage
  type         open    priority     impact     effort confidence   derived
  bugs            1           0          0          0          0   0
  tests           1           0          0          0          0   0
$ naima triage missing
2 open items without effort — set once someone has looked at the work, never guessed:
  tests/looks-right-phone  Looks right on a phone
  bugs/second-bug  Second bug
```

The first command shows coverage, meaning how many open items of each type have each field set. The second lists the items that still lack effort.

## Let Naima guess the rest

For the items that no person has triaged yet, `naima triage derive` infers confidence from the wording of each item's page and reports what it would set. With
`--write` it saves the result, marked `triagedBy: derived`, so that everyone can tell an inference from a decision. If a person later changes any of the four
fields, the mark is dropped. It never sets effort.

## The order it produces

`naima list --open`, `naima view next` and the "next up" block of `naima summary` show open items most urgent first, taking into account impact, priority,
effort and the [gates](glossary.md#gate) an item is on. The order is worked out each time you ask and is never stored.

## Deferring

A [deferral](glossary.md#deferral) (`priority=parked`, a bug set to `wontfix` or a todo set to `dropped`) is recorded in full like any other item. Then say what
would make it worth discussing again:

```sh
naima triage set export-drops priority=parked reopensWhen="when the format gains an alpha channel in its spec"
```

```console
$ naima view parked
  [open] bugs/export-drops  Export to PNG loses the alpha channel — reopens when: when the format gains an alpha channel in its spec
```

`naima check` reports an item left without `reopensWhen` (`deferred-says-why`), so say why it was deferred and what would reopen it before moving on. Read
`naima view parked` before filing something that looks familiar, because it may already have been considered and set aside.

## Authoritative documents

A project may declare which documents are authoritative for a kind of status, and which are retired, in `naima-data/naima.json`:

```json
{
  "plugins": {
    "triage": {
      "options": {
        "documents": {
          "naima/docs/planned.md": { "says": "what Naima does not do yet" },
          "OLD-STATUS.md": { "says": "superseded by planned.md", "retired": true }
        }
      }
    }
  }
}
```

`naima guide` prints this list first, so that before anything else an agent learns which document to trust and which one it shouldn't start competing with.

## Next

- Where the ranking shows up: [read the board, the queue and the gates](read-the-board.md).
