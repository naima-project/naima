---
title: "The trunk guard is announced as how Naima works, not as a choice"
kind: fix
affects:
  - usage
---

When `naima init` or `naima update` installs the trunk guard, its message said how to turn it off in the same breath, and agents relayed it to the owner as a
question, with turning it off as the first answer. The message now says the guard stays on, and tells the agent to give the owner `naima guard off`, for committing by hand or a
mixed flow, as information rather than as a question. The skill says the same.
