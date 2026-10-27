---
title: "Skipping the model on stateful work is an exception filed as a waiver, listed by naima check"
kind: behaviour-change
affects:
  - usage
action: "For a stateful change that has a note \"No model: <reason>\" instead of a model, file the exception: naima waive model-first <item> --reason \"<the reason>\"."
---

A change triaged stateful that landed without a model used to be settled by a note on the item. It is now an exception filed as a waiver of the model-first
check, `naima waive model-first <item> --reason "<why>"`, so every exception is a record of its own, with who granted it and why, and `naima check` lists them
at any time. A note alone no longer settles the check.
