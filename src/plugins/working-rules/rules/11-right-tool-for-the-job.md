---
name: right-tool-for-the-job
title: Use the state-of-the-art method for the job
audience: everyone
strength: must
---

Every action is done with the method made for it: a real parser for a language, a library built for the format, the tool built for the job. An ad-hoc script, a
hack or a regular expression is used only where it really is the right tool, a flat, regular pattern with nothing nested, and never in place of parsing a
structured language such as markdown, HTML, JSON, YAML or source code.

## Why

a check that read markdown with regular expressions reported working links as broken because it could not see anchors declared in HTML; a check that raises
false alarms gets ignored, and then the real defects it exists to find go unseen too.
