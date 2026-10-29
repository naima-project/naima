---
name: commands-without-prompts
title: Write commands the agent tool runs without asking the owner
audience: agents
strength: must
ack: Clean commands mode on
verifiedBy: agent
---

Write every shell command so the agent tool can see it is safe and never stops the owner to ask. Never rm a path built from a variable that could be empty: name
it literally, or write ${DIR:?}/${name:?}; prefer git rm, naima run clean and naima prune. Don't chain cd with other commands: pass paths (git -C, --cwd). Keep
a command to one job, never eval or pipe a download into a shell. A script longer than a line or two goes in a file in the scratch directory and runs with its
interpreter. Read and edit files with the tool's own tools, and write only inside the project and the scratch directory. The agents page
commands-without-prompts gives the details.

## Why

each permission prompt stops the owner, mostly for a harmless command written in a way the tool could not judge, and an owner asked too often starts to allow
everything.
