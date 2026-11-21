---
title: the Models tab studies a project's mCRL2 models step by step
kind: feature
affects:
  - usage
---

`naima ui` has a Models tab. A model whose mCRL2 file declares a study (a `%@ui` block naming a WebAssembly stepper built from its generated Rust code, and
optionally a view) can be taken step by step: fire the steps it accepts, go back, branch, undo, replay a recorded path or a counterexample, with each step
explained by the model's `%@say` lines. The bridge gains the commands `studies` and `study`, the UI's pages may compile WebAssembly, and a tab's module scripts
load in their sandbox. The tab is a bento of cards the person arranges, with the state machine explored so far (roads left faded, states pinned and bookmarked)
and a timeline; its widgets are a library beside the mCRL2 verifier that a study's view imports, and a view that draws a standard diagram declares it by name.
See docs/guide/study-a-model.md.
