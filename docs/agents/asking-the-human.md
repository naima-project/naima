# Asking the human

This page is how to keep [the rule](../guide/rules.md#dont-ask-the-human-if-you-know-the-answer)
that says don't ask the human if you know the answer. Decide, act, and then
report. The [owner](../guide/glossary.md#owner)'s attention is the most
expensive resource in the project. Every question uses some of it, and a
question an agent could have answered uses it for nothing. The coordinator is
the only agent that talks to the owner
([the coordinator and the workers](coordinator-and-workers.md)), so a worker
that needs the owner says so in its report and the coordinator asks.

## What is genuinely the owner's

Only four kinds of thing belong to the owner. Each has a name, because
saying "this needs a human" without one is almost always wrong:

| Reason | What it is |
|---|---|
| `judgement` | how something looks, sounds or feels, which no instrument can settle |
| `decision` | a choice reserved to the owner: scope, pricing, licence, what ships, reversing an earlier decision |
| `credential` | a secret, an account, a signature only a person holds |
| `physical` | a physical act, or a machine only a person has at hand |

Everything else is an agent's. In particular:

- **Needing the running software is not a reason.** An agent that can drive
  the software, through a command, an API, a browser or a screenshot, can
  settle it, and that is `runBy: agent-hands`, not `human`. If the software
  is busy, that's a question of scheduling, not of classification.
- **A choice between two reasonable options is not a decision reserved to the
  owner.** Pick one, say which in one line, and move on. If it turns out to be
  the wrong one, it is cheap to change.
- **A settled permission stays settled.** Something the owner has already
  allowed isn't asked again. It is a
  [decision](../guide/glossary.md#decision), and the decisions are searched
  before any question is asked.

## Before you ask: search the decisions

```sh
naima decisions <words of the question>
```

This prints the settled decisions whose title or page contain every word,
newest first. If one of them is a `standing permission`, the action may be
taken again without asking. If a decision answers the question, act on it and
say which one in the report. Ask only when none does, or when you want to
reopen one, and in that case say which. `naima check` also notes any item
handed to the owner for a decision (`humanBecause: decision`) that a settled
decision already answers.

## After the owner answers: record it, once

```sh
naima new decisions "Ship under the MIT licence"
naima link decisions/ship-under-mit-licence settles todos/choose-licence
```

The decision's page restates what the owner said, the reason they gave, and
what would make the question worth asking again. A permission meant to stand
carries `--set standing=true`. If a later answer reverses a decision, it is
recorded as a new decision linked `supersedes` to the old one, and the old one
is set to `superseded`, so nothing is overwritten. What the owner said in a
private chat is restated in your own words, not pasted.

## When you do ask

- **One question at a time.** Don't bring a list of pending questions. Answer
  the ones you can, and bring the one that is theirs.
- **Say which of the four reasons it is.** For example, "Which colour reads
  better on the dark theme (judgement)?" The reason tells the owner why the
  question reached them.
- **Bring the answer you would give.** With a recommendation attached, the
  owner can often reply in one word.

## When you hand work to a person

An [item](../guide/glossary.md#item) whose [proof](../guide/glossary.md#proof)
only a person can perform carries both `runBy: human` and
`humanBecause: <reason>` ([the rule](../guide/rules.md#work-handed-to-a-person-says-why)).
`naima queue --human` prints each such item with its reason, so a list
handed to the owner says, line by line, why each one is theirs.

Getting this wrong costs something either way:

- a gesture filed as `human` that an agent could run ends up waiting behind
  everything else a person has to do;
- a gesture filed as `agent-hands` that really needs someone to look produces
  a false pass, for example a reading of the page structure that says a
  control exists although nobody saw it on screen.

**The test** is to name the instrument that would settle it. If you can name
one, the work is an agent's. If you can't, it is a person's, and
`humanBecause` says which kind of reason applies.

## Reporting

Report when you have finished or when you are blocked, not between items. A
report says what changed and what is needed from the owner. It leaves out
anything already written in a commit message, an item or a
[session note](../guide/glossary.md#session-note).

## Safety rules

- **One question at a time.** Convention. No command bundles several
  questions into one prompt, but this is only read, not yet checked.
- **A decision already settled is never asked again.** Convention, kept by
  searching `naima decisions` before asking. `naima check` notes an item
  handed to the owner that a settled decision already answers.
- **`humanBecause` is never empty on `runBy: human`.** Enforced by the check
  `human-says-why`.
