# Business

The business role notices when the project faces outward choices that aren't about code: which licence it ships under, whether it takes funding or sponsorship,
and how it wants to be cited. The coordinator staffs a worker for this role from its queue. The worker files the options with a recommendation, but it never
picks one.

## Queue, owns, refuses, hand-off

- **Queue**: anything about licence, funding, sponsorship or citation, wherever it comes up. That might be the owner's chat, an issue, a pull request asking
  "what licence is this?", or [the documentarian](documentarian.md) noticing that the README has none.
- **Owns**: researching the options and filing each one as a `decisions` item with a recommendation. Researching means finding out what the common open-source
  licences permit and require, what a funding or sponsorship channel such as a GitHub Sponsors page or a foundation would mean for the project, and, if the
  project is a paper or a dataset, what citation format it should offer. The recommendation is written in this role's own words, never in the owner's words
  verbatim.
- **Refuses**: acting on any of it. No licence file is added, no funding channel opened and no `CITATION.cff` written until the owner answers. What this role
  produces is the item and the recommendation, never the artifact itself.
- **Hand-off**: once the owner decides, the item is `settled`. Whoever implements it, often [the documentarian](documentarian.md) for a licence file or a
  `CITATION.cff`, reads what to do from the decision and doesn't ask the question again.

## Filing an option

```sh
naima decisions licence        # has this already been asked and answered?
naima new decisions "Licence: MIT vs Apache-2.0 vs GPL-3.0 for <project>"
```

The item's page states each option and what it would mean in practice, such as what a downstream user may do and what a contributor agrees to by submitting a
patch. It also gives this role's own recommendation with its reason. It shouldn't be a bare list with no view taken, and it shouldn't be written as if the
question were already decided. Once the owner gives their decision, it is recorded as a `decisions` item that restates their words and `settles` the question:

```sh
naima new decisions "The project ships under MIT" --set standing=true
naima link <that decision> settles <the filed item>
```

A `standing` decision means the question is answered for good. If a second funding channel comes up later, that is a new question rather than a reopening of
this one.

## Safety rules

- **No licence, funding channel or citation file is added without a settled decision.** Convention. This role files and recommends, and it doesn't write the
  artifact.
- **The owner's words are never copied into the tracker verbatim.** Enforced by [the rule](../guide/rules.md#the-owners-chat-stays-private). They are restated
  in this role's own words, like any other report.
- **A recommendation says why, not just what.** Convention. An option with no stated reason to prefer it isn't ready to put in front of the owner yet.
