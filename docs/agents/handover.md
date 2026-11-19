# Handing over the coordinator role

The coordinator's context degrades as it fills. When Naima tells you at the end of a turn that your context is past the point where a handover is suggested (a
message that starts "Your context is N tokens" and names the option `handoverAt`), you are the coordinator and you suggest a handover to the owner, in the steps
below. A message that names your bound and the option `workerAt` is for a worker: see [a worker's bound](#a-workers-bound).

The notice never outranks the project's rules. Recording in the tracker and Naima's complete, correct operation come first: skip, shorten or hurry nothing
because of it, answer the owner and file what is asked as always, and take every change through its item, its worktree and `naima land`.

The notice states the context's size against the window of the model in use: the window the project sets for it (`contextWindows.<model id>`), the window
published for it, or else 1,000,000 tokens, said to be assumed. It states no share of fullness, and you tell the owner none either.

## What you do

1. **Suggest it in your next reply.** Answer what the owner asked first. Then run `naima handover --propose` and give the owner the suggestion it prints: what a
   handover does, that the pending work is finished first and nothing is lost, and the choice. Go on with the conversation meanwhile.
2. **On a no**, run `naima handover --postpone` and carry on. You are told again once the context has grown by 5% of the window.
3. **On a yes**, run `naima handover --agreed`. It records the yes and lists what finalizing takes, which you then do, each step in full:
   - bring the work in flight to a stop: land what is ready (`naima land`); for what is not, have its worker write its state into the item's notes and end
     (`naima claim --at-bound`), or leave it as a queued item;
   - go through the conversation you hold: every request and decision the owner made since the last session note, one line each naming where it was recorded
     (item, decision, diary entry or note) or `missing`. File what is missing (`naima new`, a diary entry with `naima event <today> "<what, why>" --kind diary`,
     a decision record). Then record the review, signed against the no-leaks checklist (`docs/agents/NOLEAKS.md`; check the text against it first):
     `naima handover --decisions --reviewed "<list>" --revised <path of the checklist>`, or `--reviewed-file <file>` for a long one. A review with a line still
     `missing`, an empty one or an unsigned one is refused.
4. **Hand over** with `naima handover --done`, with `--ack "<line>"` when the project's rules ask a session note for one, and `--note "<text>"` for what the
   open conversation stands on. It is refused until a review is recorded after the owner's last message: if the owner said more, record it and review again. It
   keeps a private copy of this session's transcript, writes the session note with what is still in flight (claims, branches waiting to land, runs, the open
   meeting), gives the role up and prints the first message for the successor. Give the owner that message, and say the new session starts in the main checkout.
   Then land nothing, push nothing and publish nothing.

Without a readable transcript the time of the owner's last message is unknown: repeat `--done` with `--no-transcript`, having gone through the conversation as
above. The owner may also ask for a handover before the threshold; the same steps apply, from the suggestion on. If the owner changes their mind while you
finalize, `naima handover --postpone`.

## When you are the successor

`naima hello` takes the role from the session that handed over and tells you to read its session note. Read it (`naima pass --list 1`) and `naima claims`, then
resume what was in flight before you start anything else. The predecessor's full conversation is kept privately: `naima handover --read --find <words>` prints
the messages that contain them, `--last <n>` the end, `--from <n>` a stretch (`--width` sets how much of each message is shown). Look there before you ask the
owner to repeat something.

## A worker's bound

A worker fills its context as the coordinator does and has no handover, so it stays short. Past its bound, the share `workerAt` of its own model's window, any
session that does not hold the coordinator role is told so once at a turn end, and is never addressed as the coordinator. Then:

1. Finish the step in progress in full: its test, its record in the tracker, its commit. Begin no new step.
2. Write your state into each item you claim: `naima note <item> "<what is done and committed where, what is left, the next step>"`, and commit it.
3. Run `naima claim --at-bound`. It refuses while the worktree holds a change not committed or an item has no note from this branch today. Commit the claim
   file, end, and report that you stopped at your bound.

The coordinator sees the claim ended at its bound in `naima claims` and continues the item with a fresh worker in the same worktree and branch, briefed from the
item, its notes and `naima recover <branch>`; the fresh worker's first `naima claim --step` clears the mark. The coordinator plans work packages that fit well
inside a worker's bound, so that this is rare.

## Notes

- Only the session that holds the role hands over. Other sessions are told about their own bound, and `naima handover` refuses them.
- The turn-end hook measures the context only for hosts that report it. Without a measure nothing is said, and nothing is guessed.
- The window is read per model: the option `contextWindows` (by model id), then the window published for the model id the transcript names, then the option
  `contextWindow` for any other model, else 1,000,000 assumed and said to be. The shares are `handoverAt` and `workerAt`; the default of each is 0.6.
- `naima handover --check` exits 1 for a session that has handed over: a script that publishes calls it first.
