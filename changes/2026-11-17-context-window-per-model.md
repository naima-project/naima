---
title: Context notices measure each session against its own model's window, state no share of an assumed one, put the rules first, and bound workers
kind: behaviour-change
affects:
  - usage
  - workflow
  - api
commands:
  - changed handover
  - changed claim
  - changed plugin
options:
  - added plugins.coordination.options.contextWindows
  - added plugins.coordination.options.workerAt
  - changed plugins.coordination.options.contextWindow
rules:
  - added Workers stay short; past its bound a worker ends and a fresh one continues
  - added Recording and Naima's correct operation come first; a context notice never outranks the rules
  - changed The agent talking to the owner coordinates; workers do the work
---

The turn-end notice reads the model id from the session's transcript and measures the context against that model's window: the project's
`contextWindows.<model id>`, else the window published for the model (1,000,000 tokens for the current Claude models), else `contextWindow`, else 200000
assumed. Of an assumed window it states no percentage: it gives the tokens, says the window is not known, and asks the coordinator to ask the owner once.
Every notice says it never outranks the project's rules and asks nobody to skip, shorten or hurry anything; "start nothing new" is gone. Only the session
that holds the coordinator role is told about handing over. Any other session, past its own bound (`workerAt`, 0.6 of its model's window by default), is
told once to finish its step in full, write its state into its items' notes and run `naima claim --at-bound`, which refuses while work is not committed or
an item has no note from the branch that day; `naima claims` then tells the coordinator to continue with a fresh worker. `naima plugin set` sets one key of
an object option (`contextWindows.claude-opus-5-5=1000000`), keeps every other key of `naima.json` in its place, refuses to turn an opt-in plugin on, and on
the trunk commits its own change with a `Naima-Command: plugin` trailer, which the trunk guard takes for a change of plugin options alone.
