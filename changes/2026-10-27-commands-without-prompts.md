---
title: "A working rule ships: commands written so the agent tool runs them without asking the owner"
kind: feature
affects:
  - usage
---

Agents wrote shell commands that their tool flagged, such as `rm -r "$R/$d"` on variables that could be empty, and each one stopped the owner with a
permission prompt. A working rule now says how to write commands the tool can judge safe, acknowledged as "Clean commands mode on", and a page for agents,
`docs/agents/commands-without-prompts.md`, gives the details: deleting, one command in one place, scripts, writing, git.
