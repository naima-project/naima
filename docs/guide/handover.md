# When the coordinator's session gets long

An agent that has been talking with you for a long time slowly gets worse. Its early turns are compacted away, and rules and decisions from the start of the
day can be forgotten. Naima's coordinator, the agent you talk to, avoids this by handing over to a fresh session before that happens. You don't have to count
anything. When the coordinator suggests it, you say yes or not now, and after a yes you open the new session it gives you.

## How it works

At the end of each turn Naima checks how large the coordinator's context is, in tokens, against the window of the model it runs on. This works where the tool
that runs the agent reports the usage of its last answer, as a tool whose adapter reads its transcript does, which also names the model. For a tool that doesn't, Naima says it
has no measure and does nothing, because a guessed number would suggest a handover at the wrong time.

The window comes from the project when you set it for that model, or from the window published for the model (the models of the tools Naima knows, listed by their adapters, mostly have a
1,000,000-token window). When neither says, Naima assumes 1,000,000 tokens and says it is assumed. It only states the size, for example "the context is
420,000 tokens of an assumed 1,000,000-token window", never a share of fullness.

The notice never outranks the project's rules. Recording everything in the tracker and Naima working completely and correctly come first, so the coordinator
skips, shortens and hurries nothing because its context is getting large.

When the context passes the threshold, the coordinator does not stop. You decide, and it finalizes only after your yes.

1. **It suggests the handover in its next reply**, after answering what you asked (`naima handover --propose` gives it the words): what a handover does, that
   the pending work is finished first and that nothing is lost.
2. **If you say no**, it carries on (`naima handover --postpone`) and suggests it again once the context has grown by another 5% of the window.
3. **If you say yes** (`naima handover --agreed`), it finalizes the pending work: it lands what is ready and hands off the rest with its state written in the
   items, and it goes through every request and decision you made since the last [session note](glossary.md#session-note), writing down where each is
   recorded, filing what is missing, and recording that review, signed against the checklist that keeps private details out of the tracker. Naima does not
   guess which of your messages are requests. It only refuses to hand over without a review recorded after the last thing you said.
4. **Then it hands over** (`naima handover --done`). That keeps a private copy of the conversation's text for the new session, writes a session note with what
   is still in flight, records that this session has given up the coordinator role and prints the first message for the new session.

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

## Changing the windows and the threshold

Options of the `coordination` plugin in `naima.json` set them, each with one command, `naima plugin set coordination <option>=<value>`. On the main branch that
command commits its own change, so setting an option needs no item.

| Option           | Meaning                                                                                         | Default          |
| ---------------- | ----------------------------------------------------------------------------------------------- | ---------------- |
| `contextWindows` | the window of each model, in tokens, by model id: `contextWindows.my-model=1000000`              | none             |
| `contextWindow`  | the window of any model neither named there nor published                                       | 1000000 assumed  |
| `handoverAt`     | the share of the window past which the coordinator suggests a handover (0 to 1)                 | 0.6              |
| `workerAt`       | the share of its own model's window past which a worker ends and a fresh one continues (0 to 1) | 0.6              |

The coordinator and the workers may run on different models: each is measured against its own model's window.

`naima handover --status` shows who holds the role, where it is in handing over, the windows and where each comes from, the two shares and whether the tool
gives a measure.

## Where the single writer is held

The session that handed over is refused by `naima land` and by `naima push-check`, which the push hook runs. A script that publishes can ask
`naima handover --check`, which fails for that session. In a tool that lets its session-start hook set the environment, `naima hello` makes the session id part of the environment of every later command of that
session, so the old session is not mistaken for its successor, which starts in the same checkout. A tool that cannot do this has no way to tell the two apart
once the successor has started, and the refusal then rests on the old session ending.
