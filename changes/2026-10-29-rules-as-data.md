---
title: Rules a plugin ships are Markdown files, one per rule, in a folder the plugin names
kind: feature
affects:
  - api
---

Every rule Naima's own plugins ship is now a Markdown file in the plugin's `rules/` folder: a short header with its name, title, audience, strength,
acknowledgement and the check that enforces it, then the rule and a `## Why` section with its reason. A plugin ships its rules by naming the folder,
`contributes: { rules: "rules/" }`, with `home: import.meta.url` so the folder is found beside its module; a plugin loaded from a source gets its module's
location without saying so. A rule that depends on the plugin's options has one file per setting, chosen by `when`, and takes values with `{{setting}}`. The
plugin contract is now 3. The rules themselves, and what `naima rules` prints, are unchanged. A plugin that lists its rules as objects in its manifest keeps
working.
