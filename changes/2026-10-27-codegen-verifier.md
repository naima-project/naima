---
title: "naima verify runs naima-codegen's checks, with the run recorded"
kind: feature
affects:
  - api
  - usage
  - workflow
---

A new verifier, `naima-codegen`, ships with the verifier plugin. A property whose `model` is a codegen project's `codegen.toml` and whose `property` is
`refines` runs `naima-codegen check-refinement`; `properties`, or the `.mcf` file of one of the codegen project's properties, runs
`naima-codegen check-refinement --properties`. Each run is recorded as evidence over every file of the codegen project, generated code included, and reused
while none of them changes. naima-codegen is found on `PATH` and is not installed by `naima tools`; the launcher lets `naima verify`, and no other command,
start it. Agents check generated code with `naima verify` rather than by running the tool by hand.
