---
title: The turn-end hook reminds the agent to file what the owner settled
kind: feature
affects:
  - workflow
---

Claude Code's turn-end hook now checks capture, with git alone. When a turn
changed the project's files while nothing in the tracker changed, it stops
the turn once and asks the agent to judge what the owner said: what is
settled is filed now, what the owner is still thinking aloud about gets one
question at the end, and if nothing was settled the turn ends as it would
have. It compares the files' content through a scratch index, so committing
alone never triggers it, and it reads a private tracker in its own
repository. Existing projects get the new script with the next
`naima update`, since the hook runs it from the program folder.
