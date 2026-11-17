---
title: The coordinator suggests a handover first and finalizes on the owner's yes; context is measured per model, an unknown window assumed 1M; workers are bounded
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
action: "A coordinator in the middle of a handover finishes it with the new steps: naima handover --agreed on the owner's yes, then naima handover --done; the old --agreed that handed over at once is now --done."
---

Past the threshold the coordinator suggests a handover in its next reply, after answering what the owner asked (`naima handover --propose`). On the owner's
yes, `naima handover --agreed` records it and lists what finalizing takes: land or hand off what is in flight, record every request and decision of the owner
(`--decisions --reviewed`); then `naima handover --done` keeps the transcript, writes the session note and gives the role up, refused until a review is
recorded after the owner's last message. On a no, `--postpone`. The turn-end notice reads the model id from the transcript and measures the context against
that model's window: `contextWindows.<model id>`, else the window published for the model, else `contextWindow`, else 1,000,000 assumed and said to be. It
states the size, never a share of fullness, says it never outranks the project's rules and asks nobody to hurry. Only the session that holds the coordinator
role is told about handing over; any other session, past its own bound (`workerAt`, 0.6 of its model's window by default), is told once to finish its step
in full, write its state into its items' notes and run `naima claim --at-bound`, which refuses while work is not committed or an item has no note from the
branch that day; `naima claims` then tells the coordinator to continue with a fresh worker. `naima plugin set` sets one key of an object option, keeps every
other key of `naima.json` in its place, refuses to turn an opt-in plugin on, and on the trunk commits its own change, which the trunk guard takes for a change
of plugin options alone.
