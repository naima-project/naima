---
title: the Models tab studies a project's mCRL2 models step by step
kind: feature
affects:
  - usage
---

`naima ui` has a Models tab. A model whose mCRL2 file declares a study (a `%@ui` block naming a WebAssembly stepper built
from its generated Rust code, and optionally a view) can be taken step by step: fire the steps it accepts, go back,
branch, undo, replay a recorded path or a counterexample, with each step explained by the model's `%@say` lines. The
bridge gains the commands `studies` and `study`, the UI's pages may compile WebAssembly, and a tab's module scripts load
in their sandbox. See docs/guide/study-a-model.md.
