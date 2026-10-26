# Keep what the project knows

Some of what a project learns outlasts the work that found it. "The target screens are all 4k" is something the owner told you once. "Oversubscribing ITK
threads slows the run" is something an experiment showed. "Run the long suite before every tag" is something a broken release taught. None of these is a bug, a
todo or a diary entry, and each of them is worth finding again a year later together with the reason it is believed.

Naima keeps each such statement as a [knowledge entry](glossary.md#knowledge-entry), an item of type `knowledge`. The entry says what is known, on what
[basis](glossary.md#basis), and what [kind](glossary.md#kind) of statement it is. `naima knowledge` prints the ones that hold.

## Write one down

Every entry has a basis, which says why it is believed:

- `given` means it is known without investigation, like something the owner said, a datasheet or a contract. It names where it comes from in the field
  `givenBy`, and it starts `established`.
- `evidence` means experiments, tests, analyses or proofs establish it. It starts as a `hypothesis`, and its page says what result would refute it.
- `derived` means it follows from other entries, which it links with `derives-from`.

```sh
naima new knowledge "The target screens are all 4k" --set basis=given --set givenBy="the owner" --set kind=fact
naima new knowledge "Oversubscribing ITK threads slows the run" --set basis=evidence --set kind=hypothesis
naima new knowledge "Thumbnails need 3840 pixels" --set basis=derived --set kind=fact
naima link knowledge/thumbnails-need-3840-pixels derives-from knowledge/target-screens-all-4k
```

An entry's status says where it stands. It is a `hypothesis` while it is being investigated and `inconclusive` when the evidence settles nothing yet. It becomes
`established` when it holds and `refuted` when the evidence goes against it. A given that stops holding is `retracted`, and an entry replaced by a later one is
`superseded`. Refuted, retracted and superseded entries are kept, so the history of what was believed stays in the tracker.

## Back it with evidence

Evidence is any other item, linked to the entry with `supports` or with `contradicts`. It can be a test, a property or an analysis, such as the test that reran
a benchmark.

```sh
naima new tests "Cap table at 4 and 8 threads, ITK default, 1 and 3"
naima link tests/cap-table-at-4-8-threads-itk contradicts knowledge/oversubscribing-itk-threads-slows-run
naima set tests/cap-table-at-4-8-threads-itk status=passed
naima set knowledge/oversubscribing-itk-threads-slows-run status=refuted
```

Only evidence that succeeded establishes an entry: a test that passed, a property that holds, or an analysis that is confirmed. An item whose type has no such
positive status doesn't count, whatever its status, and neither does a refuted or dropped analysis.

An artifact, such as a profile or a report, is never proof. It is material you can read, so link it to the entry with `relates-to`, and `naima show` lists it
there. If an established entry's only support is an artifact, `naima check` reports it and says so.

```sh
naima link artifacts/profile-eviction-run relates-to knowledge/oversubscribing-itk-threads-slows-run
```

`naima check` holds the entries to their basis:

- An established entry on evidence with nothing that succeeded supporting it is a problem, and so is an established given entry with no `givenBy`.
- An entry that current evidence both supports and contradicts is a note. You settle it, usually by setting it `inconclusive` until another run decides.
- An entry derived from one that is refuted or retracted is a note, so the conclusions that rested on it get looked at again.

## Kinds

The kind says what sort of statement the entry is. Four kinds are built in:

| Kind         | What it is                                                                  |
| ------------ | --------------------------------------------------------------------------- |
| `fact`       | a statement about the world taken as true, given by a source or established |
| `hypothesis` | a statement under investigation                                             |
| `finding`    | what an investigation found                                                 |
| `lesson`     | what experience taught                                                      |

A lesson's page has three sections, `## What happened`, `## The lesson` and `## How to apply it`, each with some text under it. `naima check` reports a lesson
that lacks one of them.

A project can declare kinds of its own in `naima.json`, under the knowledge plugin's `kinds` option. Each kind says what it is and can list the page sections
and the fields its entries must have. Naming a built-in kind there adds requirements to it.

```json
{
  "plugins": {
    "knowledge": {
      "options": {
        "kinds": {
          "incident": { "says": "something that went wrong in production", "sections": ["Timeline", "Cause"], "fields": ["givenBy"] }
        }
      }
    }
  }
}
```

An entry of a kind that lacks a required section or field is a problem in `naima check`. A kind adds requirements only. The statuses are the same for every
kind.

## Lessons that became rules

A lesson is codified once something holds it from then on, such as a project rule, a test or a property. You link that item to the lesson with `codifies`:

```sh
naima new rules "The long suite runs before every tag"
naima link rules/long-suite-runs-before-every-tag codifies knowledge/run-long-suite-before-tagging
```

`naima show` lists the rule under `codified-by`, and `naima knowledge` says "codified by" next to the lesson, or "not codified yet". To have `naima check` note
every established lesson that nothing codifies, set the plugin's option `lessonsCodified` to `true`.

## Read what is known

```sh
naima knowledge                  # the established entries, by kind
naima knowledge --kind lesson    # only the lessons
naima knowledge --all            # every entry, hypotheses and refuted ones too
```

Each entry is printed with what it stands on, which is its `givenBy`, the evidence that supports or contradicts it with that evidence's status, the entries it
derives from, and for a lesson what codifies it.

Turning the entries and their links into Datalog facts, recording experiment runs as evidence, and giving an entry a formal statement are
[planned](../planned.md#knowledge-entries).
