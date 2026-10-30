---
title: Writes of free text and files are signed against the no-leaks checklist
kind: breaking
affects:
  - api
  - usage
  - workflow
  - data
commands:
  - changed new
  - changed describe
  - changed note
  - changed set
  - changed pass
  - changed event
  - changed attach
options:
  - added plugins.privacy.options.signed
rules:
  - added Free text and files are signed against the no-leaks checklist
action: "Agents read docs/agents/NOLEAKS.md in the program directory and add --revised naima-tracker/naima/docs/agents/NOLEAKS.md to every new, describe, note, pass, event, attach and set of a title or text field; a project that does not want this sets naima plugin set privacy signed=false."
---

Naima now ships a short no-leaks checklist, `docs/agents/NOLEAKS.md`. Every write of free text or a file to the tracker, by any agent, has to be signed against
it: the agent reads the text against the checklist and passes the checklist's path with `--revised`. Without it, or with a file that differs from the one the
program ships, the write is refused and the refusal names the checklist's path. A signed write records the checklist's hash, who signed and the day, in the
item's field `revised`, in the front matter of a session note or an event, and in an attachment's record. Statuses, links, claims and the records Naima
generates need no signature. Write hooks gain `beforeText`, which sees the writes of session notes, events and attachments. A project turns the requirement off
with the `privacy` plugin's option `signed: false`.
