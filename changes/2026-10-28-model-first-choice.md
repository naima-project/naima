---
title: "How strictly a project applies model first is its own choice: strict, advisory or deferred, set with naima model-first"
kind: feature
affects:
  - api
  - usage
  - workflow
commands:
  - added model-first
options:
  - added plugins.planning.options.modelFirst
  - added plugins.planning.options.modelFirstSince
  - added plugins.planning.options.modelFirstUntil
checks:
  - changed model-first
rules:
  - changed Behaviour with states is modelled and verified before it is coded
action: "Nothing to do to keep the rule a must: a project with no setting stays strict. To change it, ask the owner and run naima model-first advisory, or naima model-first deferred --until <gate|date>."
---

The model-first rule was a must for every project. A project now chooses how strictly it applies it, in the planning option `modelFirst`, shown and set with
`naima model-first`. Strict, the default, is the rule as it was. Advisory makes it a should: `naima check` notes a new protocol or concurrency
(`statefulKind=protocol`) as a must and other new behaviour as advice, and does not note a change to code that existed before the setting was adopted, either
triaged `statefulKind=existing` or, when not triaged, one whose files all existed at the adoption commit and none was mostly rewritten. Deferred adopts model
checking later: `naima model-first deferred --until <gate|date>` files at once a todo for adopting it, on that gate, the check notes the deferral instead of
each change, and `naima hello` says it until the owner chooses. The rule's wording follows the setting. `naima init` proposes strict for a new project and
advisory when Naima joins a repository with substantial code, and says the question to put to the owner.
