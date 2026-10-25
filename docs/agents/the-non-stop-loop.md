# The non-stop loop

This is how the coordinator keeps work going while the owner is away, and stops only when everything that is left belongs to the owner. It is part of
[the coordinator and the workers](coordinator-and-workers.md): the coordinator runs the loop, and the workers do the work.

## 1. Choose the target before starting

`naima loop` won't run without a target. The coordinator writes the target down before it spawns the first worker, and it is one of these:

| Target      | What it is                                                                   | It is done when                                                           |
| ----------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| a work list | an item whose `README.md` lists steps as `- [ ] step` and `- [x] step` lines | every line is ticked, or carries `deferred: <why>`                        |
| an epic     | an item of a type that groups others (`naima epic`)                          | every item it groups is closed, or needs only the owner                   |
| a gate      | a gate or milestone (`naima gates`)                                          | it holds only the owner's work, as `naima queue <gate> --human` counts it |

An item "needs only the owner" when it is a decision reserved for the owner (`humanBecause: decision`), or when its proof can only come from a person or a build
(`runBy: human`, `runBy: build`) and its code has already landed (`fixedOn`). An item that has no code yet, or whose proof an agent can run, is agent work.

## 2. Set the wake-up timer

The default is three minutes. The interval is set by the `loop` plugin's `every` option in `naima.json`, or by `--every <minutes>` for a single run. The timer
itself comes from the agent harness, as a scheduled wake-up or a recurring prompt. The coordinator never waits for the owner to come back before carrying on.

## 3. On every tick: am I done, or did I stop?

```sh
naima loop <target>            # or --json; --check exits 1 while not stopped
```

It prints how much is done, the next piece of agent work and whether the loop has stopped, and once it has stopped it also prints the owner's actions. While it
says NOT DONE, the coordinator does the following.

- It resumes whatever stopped, such as a worker that ended or a branch waiting to be merged. If a worker died, it salvages that worker's worktree before
  spawning a new one.
- It merges finished branches that nobody holds (`naima claims`), after running the gates over the combined result, and removes the merged worktrees
  ([closing a worktree](closing-a-worktree.md)).
- It spawns workers on the next agent work. Each worker prepares its work on its own branch, while landing, publishing and releasing stay with the coordinator.
- When a line can't be done now, it writes down a deferral rather than skipping it silently, as `- [ ] step — deferred: <why>` in a work list, a triage field,
  or a comment on an item.

## 4. When it stops: the owner's ordered list

STOPPED means only the owner's work is left. What the coordinator hands over is the list `naima loop` prints, in its order. Decisions come first, because they
unblock the rest, followed by credentials, physical acts, judgements and builds, and each line says why it is the owner's. The coordinator passes it on as it
is, one question at a time ([asking the human](asking-the-human.md)).

## 5. If the owner does not come back

The coordinator doesn't sit idle. Under the owner's work, `naima loop` lists the proving gestures that nobody has run yet. The coordinator runs each one it can
and attaches what happened to the item, after redacting it with `<host>`, `<ip>`, `<path>` and `<user>` in place of anything that names the machine or the user
([the rule](../guide/rules.md#no-machine-names-or-private-infrastructure-in-a-repository)). It leaves the judgement to the owner. Then it waits for the timer,
and if a tick finds new agent work, the loop starts again.

What each option prints is in [the reference](../reference/reference.md#naima-loop), and the page for people is
[what happens while you are away](../guide/while-you-are-away.md).

## Safety rules

- **No target, no loop.** Enforced: `naima loop` refuses to run without one.
- **The owner is never the reason work resumes.** Convention: the wake-up timer brings the coordinator back, not a reply from the owner.
- **STOPPED means only the owner's work is left.** Convention, upheld by the stop verdict of `naima loop`, which is read from the target's definition in step 1.
  Nothing yet re-checks a STOPPED loop against a tracker that changed after it stopped, which makes this a candidate property for a later model.
