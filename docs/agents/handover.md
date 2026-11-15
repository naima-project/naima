# Handing over the coordinator role

The coordinator's context degrades as it fills. When Naima tells you at the end of a turn that your context is past the limit (a message that starts "Your
context is N tokens"), you are the coordinator and you hand over now.

## What you do

1. Stop starting new work. Workers keep running.
2. Run `naima handover`, with `--ack "<line>"` when the project's rules ask a session note for one, and `--note "<text>"` for what the open conversation stands
   on, such as the question the owner is deciding. It writes the session note with every claim, the branches waiting to land, the runs and the open meeting,
   gives the role up and prints the first message for the successor.
3. Give the owner that message in your reply, and say the new session starts in the main checkout. Then land nothing, push nothing and publish nothing:
   `naima land` and the push check refuse the session that has handed over.

## When you are the successor

`naima hello` takes the role from the session that handed over and tells you to read its session note. Read it (`naima pass --list 1`) and `naima claims`, then
resume what was in flight before you start anything else.

## Notes

- Only the session that holds the role hands over. Workers are not told to, and `naima handover` refuses them.
- The turn-end hook measures the context only for hosts that report it. Without a measure nothing is said, and nothing is guessed.
- The window and the share are the coordination options `contextWindow` and `handoverAt`; the defaults wait for the owner's choice.
- `naima handover --check` exits 1 for a session that has handed over: a script that publishes calls it first.
