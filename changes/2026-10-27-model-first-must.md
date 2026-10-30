---
title: "The model-first rule is a must where it applies: small models, verified before the code, minimised once, the code generated from them"
kind: behaviour-change
affects:
  - usage
action: "Read the rule again with naima rules --audience agents and give back its acknowledgement; triage stateful work with stateful=true so the rule applies only where it should."
---

The rule that behaviour with states or concurrency starts from a model was a should, accepted a drawing, and never said when the model is checked. Ten fresh
agents asked to build a traffic-light controller wrote a model before coding four times and verified it first never. It is now a must, but only where it
applies: each state machine is modelled on its own and kept small, only what is not obvious; the model is in a form a tool checks; `naima verify` shows every
property holds before the first line of the code; the state space is minimised once and each property checked on it (the LTS route), with runs on the same model
and formula reused; and where naima-codegen supports the language, every such machine is generated from its model, with the code around it connected to the
generated machine.
