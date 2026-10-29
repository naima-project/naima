---
title: Discussions and meetings
kind: feature
affects:
  - api
  - usage
  - data
commands:
  - added meeting
  - added decide
checks:
  - added discussions
options:
  - added plugins.discussions.options.meetings
---

A question that needs time with a person is now a discussion, an item type of its own with the question, the options and, once decided, the decision. It links
the items it is about with `concerns`. A meeting, declared with `naima meeting new`, is a gate whose agenda is the discussions on it: it names who it needs,
takes place whenever they are present unless it has a date, and holds once every discussion on it is decided. `naima hello` names each meeting with open
discussions, so the agent opens with its agenda. `naima decide` records a decision, and files follow-up work only with the owner's yes (`--consent`).
