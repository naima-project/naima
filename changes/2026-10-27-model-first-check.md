---
title: "A change triaged stateful that lands with no model is noted by naima check"
kind: feature
affects:
  - usage
  - workflow
checks:
  - added model-first
rules:
  - changed Behaviour with states is designed from a model first
action: "When triaging a feature or a bug, record whether its behaviour has states or concurrency: naima set <item> stateful=true, or false."
---

Features and bugs have a new field, `stateful`, set at triage: true when the behaviour the change adds or fixes has states or concurrency, false otherwise. It is
decided from what the item asks for, never guessed from the code. The new check `model-first` notes a change recorded `stateful=true` that landed (its `fixedOn`
is set) with no `models` or `properties` item linked to it and no note "No model: <reason>". It is a note, not a problem, since the rule it holds is a should,
and the rule now names the check that enforces it.
