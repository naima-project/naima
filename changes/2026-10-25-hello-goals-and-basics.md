---
title: naima hello says where the project is going and offers to explain the basics
kind: feature
affects:
  - api
  - usage
  - workflow
---

After the banner and the update line, `naima hello` now names the next goal,
the nearest gate with a due date, and the next release, a gate with a version,
each in one line with its date, the days left and its verdict as `naima gates`
gives it: it holds, it is blocked by a number of items, or, when one or two are
left, the next one by name. It says nothing of goals when the project has no
such gate. When nothing waits on the owner it says so, and its last line offers
to explain what Naima can do, starting from the basics. The session-start hook
tells the agent to open its first reply with "**I'm Naima**", the name in bold
followed by what it stands for, and how to explain the basics: set a goal,
reach it in steps, publish. A new guide page, [the basics](../docs/guide/the-basics.md),
says the same for people, and `naima guide` lists it. For plugins, a summary
section may now give `goals(ctx)`, the lines `naima hello` says of where the
project is going.
