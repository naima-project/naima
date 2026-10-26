# File a feature

A feature is something someone wants the work to do that it doesn't do yet, whether the work is a program, an analysis or a document. Usually you describe what
you'd like and an agent files it and runs the commands below. You can also run them yourself.

## Ask for it

```sh
naima new features "Export keeps the alpha channel of layered files"
```

A new feature starts as `requested`, which means it has been asked for and no code exists yet. Before anyone starts on it, its page (`README.md` in the folder
the command printed) should say what "done" means:

- **the behaviour**: what it does, as seen from outside;
- **the boundaries**: what it doesn't do;
- **how it is documented**: which page a person reads, and what an agent needs.

Then [triage](triage.md) it like any other [item](glossary.md#item).

## Its life

| Status      | Means                                                     |
| ----------- | --------------------------------------------------------- |
| `requested` | asked for; no code exists                                 |
| `planned`   | agreed and scheduled                                      |
| `shipped`   | on the [trunk](glossary.md#trunk), with its documentation |
| `withdrawn` | decided against                                           |

```sh
naima set export-keeps-alpha status=planned
```

If a request is reversed later, it isn't overwritten. It is set to `withdrawn`, and the reason goes on its page.

## When it ships

A feature is documented as part of implementing it, both for people and for agents
([the rule](rules.md#features-are-documented-as-part-of-their-implementation)). Once it reaches the trunk, it is marked `shipped` together with the pages that
document it. Each page is given as a path from the project root, optionally followed by `#heading`:

```sh
naima set export-keeps-alpha status=shipped docs=docs/export.md#alpha
```

`naima check` fails if a shipped feature names no page, or names a page or heading that doesn't exist. This is the check called `features-documented`.

## Proving it

A shipped feature can be proven the same way as a fix, with a test item that `verifies` it ([prove and close](prove-and-close.md)).
