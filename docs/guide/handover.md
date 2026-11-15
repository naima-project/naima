# When the coordinator's session gets long

An agent that has been talking with you for a long time slowly gets worse. Its early turns are compacted away, and rules and decisions from the start of the
day can be forgotten. Naima's coordinator, the agent you talk to, avoids this by handing over to a fresh session before that happens. You don't have to count
anything. The only thing you do is open the new session when the coordinator asks.

## How it works

At the end of each turn Naima checks how full the coordinator's context is, in tokens, against the size of the model's window. This works where the tool that
runs the agent reports the usage of its last answer, as Claude Code does. For a tool that doesn't, Naima says it has no measure and does nothing, because a
guessed number would hand over at the wrong time.

When the context passes the limit, the coordinator does not stop at once. It goes through four steps, and you are part of the last one.

1. **It finishes the work in progress.** Nothing new is started; workers keep running.
2. **It checks that your decisions are recorded.** `naima handover --decisions` reads what you said in this session since the last
   [session note](glossary.md#session-note) and lists every request or decision that has no trace in the tracker: no item, diary entry, decision or note
   that shares its subject. The coordinator files what is missing, or says that a message needs no record (a thanks, thinking aloud), and runs the check again
   until it passes. The check finds requests with no trace at all. It cannot tell whether a record says the right thing.
3. **It proposes the handover to you** (`naima handover --propose`, which runs the check once more) in a short message: what is saved, that nothing is lost,
   and how the new chat continues. You answer yes, or ask to go on a while. If you go on (`naima handover --postpone`), the coordinator carries on and asks again
   once the context has grown by another 5% of the window.
4. **After your yes it hands over** (`naima handover --agreed`). That writes a session note with what is in flight (every claim, the branches waiting to be
   landed, the runs that are still going, the meeting that is open), keeps a private copy of the conversation's text for the new session, records that this
   session has given up the coordinator role and prints the first message for the new session.

You open a new session in the project's main checkout and paste that message. The new session runs `naima hello`, which takes the role, reads the note and
points to the predecessor's conversation. `naima handover --read --find <words>` prints excerpts of it (the last messages with `--last`), so the new
coordinator can look up what the note leaves open before asking you to repeat anything. Meanwhile the old session no longer lands branches, pushes or
publishes, because only one session at a time is the [single writer](rules.md#no-locks-the-coordinator-is-the-single-writer). Workers keep running and are not
affected, since they never held the role.

The conversation's copy is in the project's private state folder inside the git directory. It is never committed, and no tracker text names its path. It holds
everything you and the coordinator wrote, so delete it from there when you no longer want it kept.

## Changing the limit

Two options of the `coordination` plugin in `naima.json` set it.

| Option          | Meaning                                                                | Default |
| --------------- | ---------------------------------------------------------------------- | ------- |
| `contextWindow` | the context window of the coordinator's model, in tokens               | 200000  |
| `handoverAt`    | the share of the window past which the coordinator hands over (0 to 1) | 0.6     |

The default share, 0.6 of the window, is the usual choice. With the defaults the handing over starts at 120000 tokens. A coordinator running on a
model with a larger window needs a larger `contextWindow`, otherwise it hands over too early.

`naima handover --status` shows who holds the role, where it is in handing over, the limit and whether the tool gives a measure.

## Where the single writer is held

The session that handed over is refused by `naima land` and by `naima push-check`, which the push hook runs. A script that publishes can ask
`naima handover --check`, which fails for that session. In Claude Code, `naima hello` makes the session id part of the environment of every later command of that
session, so the old session is not mistaken for its successor, which starts in the same checkout. A tool that cannot do this has no way to tell the two apart
once the successor has started, and the refusal then rests on the old session ending.
