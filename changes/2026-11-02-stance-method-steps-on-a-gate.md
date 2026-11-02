---
title: A stance can bring a method whose steps become sub-goals of a gate, closed one by one
kind: feature
affects:
  - usage
  - api
  - workflow
commands:
  - changed gate
  - changed gates
options:
  - added plugins.gates.options.gates.<name>.method
checks:
  - added method-steps
---

A stance can declare a method, an ordered list of steps each with an exit criterion, under `contributes.methods` in its manifest. A gate follows it with
`naima gate set <gate> --method <stance>/<method>`; `naima gates`, `naima gate show` and `naima hello` then show which steps are closed and which is next, and
the gate holds only once every step is closed. `naima gate step <gate> <step> --by <item>` closes the next step on a settled record, such as a decision, by
writing `closesStep: <gate>/<step>` on it; it refuses a step whose predecessor is open. The steps are derived from the records every time, so a step counts as
closed only while every step before it does.
