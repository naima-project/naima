---
title: Every agent session starts with naima hello, through the pointer line and a session-start hook for each tool that has one
kind: behaviour-change
affects:
  - api
  - usage
  - workflow
commands:
  - changed init
  - changed update
options:
  - added agents
checks:
  - added session-start
rules:
  - added Every session starts with naima hello
  - added Naima is tied to no agent tool or model
action: "Run naima update once, then commit the files it says it wrote (the pointer line in an entry file, and a hook such as .claude/settings.json) together with the update."
---

The pointer line in the project's entry file now also says to run naima hello at the start of every session. naima init writes it without being asked, into
AGENTS.md, else the first entry file the project has, else a new AGENTS.md, and installs a session-start hook that runs naima hello for each agent tool the
project uses that has one. The first adapter is Claude Code's: a SessionStart hook in .claude/settings.json, added to whatever the file holds. The tools in use
are those naima.json's new agents option names, or, without it, those whose files the project holds. naima init --no-session-hook installs no hook;
--write-agent-pointer is still accepted and changes nothing.

naima update writes what an older project lacks, or rewrites an older pointer line, and says which files to commit with the update. The new check session-start
notes a project where the line or a hook is missing.

Command examples now use a neutral agent name: --as agent, branches agent/<what>.
