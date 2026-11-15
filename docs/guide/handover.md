# When the coordinator's session gets long

An agent that has been talking with you for a long time slowly gets worse. Its early turns are compacted away, and rules and decisions from the start of the
day can be forgotten. Naima's coordinator, the agent you talk to, avoids this by handing over to a fresh session before that happens. You don't have to count
anything. The only thing you do is open the new session when the coordinator asks.

## How it works

At the end of each turn Naima checks how full the coordinator's context is, in tokens, against the size of the model's window. This works where the tool that
runs the agent reports the usage of its last answer, as Claude Code does. For a tool that doesn't, Naima says it has no measure and does nothing, because a
guessed number would hand over at the wrong time.

When the context passes the limit, the coordinator is told to hand over. It runs `naima handover`, which

1. writes a [session note](glossary.md#session-note) with what is in flight: every claim, the branches waiting to be landed, the runs that are still going and
   the meeting that is open;
2. records that this session has given up the coordinator role;
3. prints the first message for the new session.

You open a new session in the project's main checkout and paste that message. The new session runs `naima hello`, which takes the role, reads the note and
carries on. Meanwhile the old session no longer lands branches, pushes or publishes, because only one session at a time is the
[single writer](rules.md#no-locks-the-coordinator-is-the-single-writer). Workers keep running and are not affected, since they never held the role.

## Changing the limit

Two options of the `coordination` plugin in `naima.json` set it.

| Option          | Meaning                                                                | Default |
| --------------- | ---------------------------------------------------------------------- | ------- |
| `contextWindow` | the context window of the coordinator's model, in tokens               | 200000  |
| `handoverAt`    | the share of the window past which the coordinator hands over (0 to 1) | 0.6     |

Both defaults are provisional: they wait for the owner to choose them. With the defaults the hand-over happens at 120000 tokens. A coordinator running on a
model with a larger window needs a larger `contextWindow`, otherwise it hands over too early.

`naima handover --status` shows who holds the role, the limit and whether the tool gives a measure.

## Where the single writer is held

The session that handed over is refused by `naima land` and by `naima push-check`, which the push hook runs. A script that publishes can ask
`naima handover --check`, which fails for that session. In Claude Code, `naima hello` makes the session id part of the environment of every later command of that
session, so the old session is not mistaken for its successor, which starts in the same checkout. A tool that cannot do this has no way to tell the two apart
once the successor has started, and the refusal then rests on the old session ending.
