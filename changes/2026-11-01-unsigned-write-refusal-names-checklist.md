---
title: "A refused unsigned write says to sign it with --revised and the checklist's path"
kind: fix
affects:
  - usage
---

After a checkout's first unsigned write of free text, a later unsigned one is refused. The refusal now always says to sign the write with `--revised` followed
by the no-leaks checklist's path, also when the checkout's mark cannot be read, instead of an error about a file outside the project.
