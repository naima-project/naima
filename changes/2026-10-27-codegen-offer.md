---
title: "When the project has a model, Naima offers generating the code from it with naima-codegen"
kind: feature
affects:
  - usage
  - api
---

When the project has a `models` item, `naima hello` says once, among its offers, that the code of a state machine can be generated from the model with
naima-codegen, a public tool of the Naima project that writes it in Rust, Python or TypeScript with Svelte and checks it against the model; `naima summary` and
`naima guide` say the same line. The guide's page on designing with a model and the skill say how an agent uses it. A summary section may now offer something in
`naima hello` (its `offers`), apart from what waits on the owner.
