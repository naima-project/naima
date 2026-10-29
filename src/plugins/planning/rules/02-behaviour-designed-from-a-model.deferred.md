---
name: behaviour-designed-from-a-model
title: Behaviour with states or concurrency is modelled and verified before it is coded
audience: everyone
strength: should
ack: Model first mode on
enforcedBy: model-first
verifiedBy: model-first
when: modelFirst=deferred
---

This project has deferred model checking{{until}} (`naima model-first deferred`): until then the rule is advice, the todo for adopting it stands on that gate or
by that date, and `naima hello` says so until the owner chooses strict or advisory with `naima model-first`. When behaviour has states or concurrency (a
lifecycle, a protocol, a scheduler, a retry loop, two processes sharing data), it is modelled before any of its code is written, in proportion: each state
machine is modelled on its own and kept small, and only what is not obvious is modelled, never the whole system at once and never what a test shows plainly. The
model is in mCRL2, or a state machine encoded in mCRL2 (the guide gives a template), or another form a tool checks; a drawing or a description alone is not a
model. Each property it must have is a `properties` item, and `naima verify` shows every one holds before the first line of its code is written. Its state space
is minimised once and every property is checked on that, the LTS route (`verifierOptions` route lts) wherever the formula allows it, and a run already made on
the same model and formula is reused, never recomputed. Where naima-codegen supports the language, every such state machine is generated from its model and
checked against it, and the code around it is written to connect to the generated machine; elsewhere the code follows the model, and the model changes in the
same change as the code it describes. The rule applies only when the behaviour has states or concurrency: a trivial change needs no model, and skipping one on
behaviour that is not trivial is an exception, filed with its reason as a waiver of the model-first check (`naima waive model-first <item> --reason "<why>"`),
which naima check lists at any time. Whoever triages a feature or a bug records whether its behaviour has states or concurrency
(`naima set <item> stateful=true`, or `false`), and `naima check` notes a stateful change that landed with neither a model linked nor that waiver.

## Why

behaviour with states fails in the orders of events nobody thought to test, and a model checker explores every order; a model checked only after the code
describes the code, defects included, while one verified first is what the code is checked against. Small machines, each modelled alone and minimised once,
check in seconds, so the rule costs little where it applies and nothing where it does not. An experiment with ten fresh agents found that, under the softer
wording, four wrote a model before coding but none verified it first. A project that joins Naima with a large codebase cannot model it all at once, so it may
make the rule advice for what already exists, or plan when to adopt it.
