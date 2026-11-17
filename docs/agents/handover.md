# Handing over the coordinator role

The coordinator's context degrades as it fills. When Naima tells you at the end of a turn that your context is past the limit (a message that starts "Your
context is N tokens"), you are the coordinator and you start handing over, in the steps below.

## What you do

You do not hand over at once. Past the limit:

1. Finish the work in progress; start nothing new. Workers keep running.
2. Run `naima handover --decisions`. It prints the task and judges nothing: you hold the whole conversation, so you go through every request and decision
   the owner made since the last session note and write one line for each, naming where it was recorded (item, decision, diary entry or note) or `missing`.
   File what is missing (`naima new`, a diary entry with `naima event <today> "<what, why>" --kind diary`, a decision record). Then record the review, one
   line per request each naming its record, signed against the no-leaks checklist (`docs/agents/NOLEAKS.md`; check the text against it first):
   `naima handover --decisions --reviewed "<list>" --revised <path of the checklist>`, or `--reviewed-file <file>` for a long one. A review with a line still
   `missing`, an empty one or an unsigned one is refused. Without a readable transcript the time of the owner's last message is unknown: repeat with
   `--no-transcript`, having gone through the conversation as above.
3. Run `naima handover --propose`. It is refused (exit 1) until a review is recorded after the owner's last message; if the owner spoke since, review again.
   Then it prints a short reassuring message for the owner: what is saved, that nothing is lost, how the
   new chat continues. Give the owner that message and wait for the answer.
4. If the owner agrees, run `naima handover --agreed`, with `--ack "<line>"` when the project's rules ask a session note for one, and `--note "<text>"` for what the
   open conversation stands on. It needs the review still to hold (the owner's reply to the proposal is the only message after it; anything more means a new review and a new proposal), writes the session note with every claim, the branches
   waiting to land, the runs and the open meeting, keeps a private copy of this session's transcript, gives the role up and prints the first message for the
   successor. Give the owner that message, and say the new session starts in the main checkout. Then land nothing, push nothing and publish nothing.
5. If the owner wants to go on, run `naima handover --postpone`. You are told again once the context has grown by 5% of the window.

`naima handover` without `--agreed` refuses, and so does `--agreed` before a proposal, and after more from the owner than a reply since the proposal: the review
and the proposal come again. The owner may also ask for a handover before the limit; the same steps apply.

## When you are the successor

`naima hello` takes the role from the session that handed over and tells you to read its session note. Read it (`naima pass --list 1`) and `naima claims`, then
resume what was in flight before you start anything else. The predecessor's full conversation is kept privately: `naima handover --read --find <words>` prints
the messages that contain them, `--last <n>` the end, `--from <n>` a stretch (`--width` sets how much of each message is shown). Look there before you ask
the owner to repeat something.

## Notes

- Only the session that holds the role hands over. Workers are not told to, and `naima handover` refuses them.
- The turn-end hook measures the context only for hosts that report it. Without a measure nothing is said, and nothing is guessed.
- The window and the share are the coordination options `contextWindow` and `handoverAt`; the default share is 0.6.
- `naima handover --check` exits 1 for a session that has handed over: a script that publishes calls it first.
