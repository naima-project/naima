# When the coordinator's session gets long

An agent that has been talking with you for a long time slowly gets worse. Its early turns are compacted away, and rules and decisions from the start of the
day can be forgotten. Naima's coordinator, the agent you talk to, avoids this by handing over to a fresh session before that happens. You don't have to count
anything. The only thing you do is open the new session when the coordinator asks.

## How it works

At the end of each turn Naima checks how full the coordinator's context is, in tokens, against the window of the model it runs on. This works where the tool
that runs the agent reports the usage of its last answer, as Claude Code does, whose transcript also names the model. For a tool that doesn't, Naima says it
has no measure and does nothing, because a guessed number would hand over at the wrong time.

The window comes from the project when you set it for that model, or from the window published for the model (the current Claude models have a
1,000,000-token window). When neither says, Naima assumes 200,000 tokens and says so: the notice gives the tokens and that the window is not known, never a
percentage, and the coordinator asks you once what the window is.

The notice never outranks the project's rules. Recording everything in the tracker and Naima working completely and correctly come first, so the coordinator
skips, shortens and hurries nothing because its context is getting full.

When the context passes the handover point, the coordinator does not stop at once. It goes through four steps, and you are part of the last one.

1. **It carries on with the work in hand** until it reaches a natural stop, each step done in full; workers keep running.
2. **It reviews that your decisions are recorded.** `naima handover --decisions` asks the coordinator itself, which holds the whole conversation, to go
   through every request and decision you made since the last [session note](glossary.md#session-note). For each it writes where it was recorded (an item,
   a decision, a diary entry or a note) or "missing", files what is missing, and then records the review, signed against the checklist that keeps private
   details out of the tracker. Naima does not guess which of your messages are requests. It only refuses to go on without a review recorded after the last
   thing you said, so a request made after the review sends the coordinator back to review again.
3. **It proposes the handover to you** (`naima handover --propose`, which is refused until such a review exists) in a short message: what is saved, that nothing is lost,
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

## Workers stay short

A worker fills its context too, and it has no handover of its own. So the coordinator gives each worker a piece of work that fits well inside its bound, a
share of the window of the worker's own model. A worker that still goes past it is told so at the end of a turn: it finishes the step it is in, writes what
it did and what is left into the item's notes, and ends. The coordinator then continues the item with a fresh worker that starts from the item and its notes,
so nothing is lost. Other sessions, such as a side session doing one task, are told about their own bound in the same way and are never addressed as the
coordinator.

The conversation's copy is in the project's private state folder inside the git directory. It is never committed, and no tracker text names its path. It holds
everything you and the coordinator wrote, so delete it from there when you no longer want it kept.

## Changing the windows and the limits

Options of the `coordination` plugin in `naima.json` set them, each with one command, `naima plugin set coordination <option>=<value>`. On the main branch that
command commits its own change, so setting an option needs no item.

| Option           | Meaning                                                                                            | Default        |
| ---------------- | -------------------------------------------------------------------------------------------------- | -------------- |
| `contextWindows` | the window of each model, in tokens, by model id: `contextWindows.claude-opus-5-5=1000000`           | none           |
| `contextWindow`  | the window of any model neither named there nor published                                          | 200000 assumed |
| `handoverAt`     | the share of the window past which the coordinator prepares a handover (0 to 1)                    | 0.6            |
| `workerAt`       | the share of its own model's window past which a worker ends and a fresh one continues (0 to 1)    | 0.6            |

The coordinator and the workers may run on different models: each is measured against its own model's window.

`naima handover --status` shows who holds the role, where it is in handing over, the windows and where each comes from, the two shares and whether the tool
gives a measure.

## Where the single writer is held

The session that handed over is refused by `naima land` and by `naima push-check`, which the push hook runs. A script that publishes can ask
`naima handover --check`, which fails for that session. In Claude Code, `naima hello` makes the session id part of the environment of every later command of that
session, so the old session is not mistaken for its successor, which starts in the same checkout. A tool that cannot do this has no way to tell the two apart
once the successor has started, and the refusal then rests on the old session ending.
