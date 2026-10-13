---
description: Keep going until only the owner's work is left · target, timer, ordered list
argument-hint: <target>
---
Flow: [the non-stop loop](../../../../docs/agents/the-non-stop-loop.md). Where
this checklist and the page disagree, the page wins.

1. **The target, written before starting:** a work list (an item listing
   `- [ ]` steps), an epic, or a gate. No target, no loop.
2. **A wake-up timer**, three minutes unless the `loop` plugin's `every`
   option says otherwise.
3. **Each tick:** `naima loop $1` — am I done, or did I stop? While NOT DONE:
   resume what stopped, merge finished unowned branches after the gates,
   remove merged worktrees, spawn workers on the next agent work. A line that
   cannot be done now gets `deferred: <why>`, never a silent skip.
4. **STOPPED:** hand the owner the ordered list it prints, each line saying
   why it is his — one question at a time.
5. **Owner still away:** run the gestures nobody has tried yet, attach each
   attempt, redacted first (`<host>`, `<ip>`, `<path>`, `<user>`:
   [the rule](../../../../docs/guide/rules.md#no-machine-names-or-private-infrastructure-in-a-repository)); keep the timer.
