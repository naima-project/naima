---
title: An update started by an older launcher finishes without failing, and init and update say what they install outside naima-tracker/ and why
kind: fix
affects:
  - usage
commands:
  - changed init
  - changed update
  - changed hello
checks:
  - changed session-start
action: "If naima update ends with 'run naima update once more to finish', run it again, then commit the files its last line names."
---

An update from a lock whose launcher predates the session-start hooks no
longer fails with Deno's "Requires write access" on the entry file. That
launcher doesn't let the update write the entry file or a tool's settings,
so the update now moves the lock, migrates and checks everything else,
leaves those files alone, exits with 0 and ends with one line: "Naima moved
to <commit>; run naima update once more to finish:" followed by what is
left. The second run writes them. Until then naima hello and naima check
say the update is unfinished, and what is left.

Installing Claude Code's hook no longer fails when the .claude folder
already exists, for example holding settings.local.json.

Whenever init or update writes something outside naima-tracker/, it says so
in one plain sentence: what it installed and why. For example: "Installed a
Claude Code session-start hook in .claude/settings.json: every new
conversation starts by running naima hello, so you see which Naima is
active and whether a newer one exists." The pointer line and the exclusion
lines of init --write-excludes are said the same way.
