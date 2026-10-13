# The non-stop loop

How the coordinator keeps work going while the owner is away, and stops only
when what is left is the owner's. It runs inside
[the coordinator and the workers](coordinator-and-workers.md): the
coordinator holds the loop; workers do the work.

## 1. Choose the target before starting

No target, no loop: `naima loop` refuses to run without one. The target is
one of three, written down before the first worker is spawned:

| Target | What it is | It is done when |
|---|---|---|
| a work list | an item whose `README.md` lists steps as `- [ ] step` and `- [x] step` lines | every line is ticked, or carries `deferred: <why>` |
| an epic | an item of a type that groups others (`naima epic`) | every item it groups is closed, or needs only the owner |
| a gate | a gate or milestone (`naima gates`) | it holds only the owner's work, as `naima queue <gate> --human` counts it |

An item "needs only the owner" when it is a reserved decision
(`humanBecause: decision`), or when its proof can only come from a person or
a build (`runBy: human`, `runBy: build`) and its code has landed (`fixedOn`).
An item with no code yet, or whose proof an agent can run, is agent work.

## 2. Set the wake-up timer

Three minutes by default. The cadence is the `loop` plugin's `every` option
in `naima.json`, or `--every <minutes>` for one run; the timer itself is the
agent harness's (a scheduled wake-up, a recurring prompt). The owner is never
the reason work resumes.

## 3. On every tick: am I done, or did I stop?

```sh
naima loop <target>            # or --json; --check exits 1 while not stopped
```

It prints how much is done, the next agent work, the stop verdict and, once
stopped, the owner's actions. Then, while it says NOT DONE:

- **resume what stopped**: a worker that ended, a branch waiting for its merge
  — salvage a dead worker's worktree before respawning;
- **merge** finished branches nobody holds (`naima claims`), after the gates
  over the combined result; remove merged worktrees
  ([closing a worktree](closing-a-worktree.md));
- **spawn workers** on the next agent work, each preparing on its own branch — landing,
  publishing and releasing stay with the coordinator;
- **a line that cannot be done now gets a written deferral**, never a silent
  skip: `- [ ] step — deferred: <why>` in a work list, a triage field or a
  comment on an item.

## 4. When it stops: the owner's ordered list

STOPPED means only the owner's work is left. The deliverable is the list
`naima loop` prints, in order — decisions first (they unblock the rest), then
credentials, physical acts, judgements and builds — each line saying why it
is his. Hand it over as it is, one question at a time
([asking the human](asking-the-human.md)).

## 5. If the owner does not come back

Do not idle. `naima loop` lists, under the owner's work, the proving gestures
nobody has run yet: run each one you can, attach what happened to its item,
and leave the judgement to the owner. Then wait on the timer: a tick that
finds new agent work resumes the loop.

What each option prints: [the reference](../reference/reference.md#naima-loop);
for people, [what happens while you are away](../guide/while-you-are-away.md).

## Safety rules

- **No target, no loop.** Enforced: `naima loop` refuses to run without one.
- **The owner is never the reason work resumes.** Convention: the wake-up
  timer, not a reply, brings the coordinator back.
- **STOPPED means only the owner's work is left.** Convention, kept by
  `naima loop`'s own stop verdict, read from the target's definition in step
  1; nothing yet re-checks a STOPPED loop against a tracker changed after it
  stopped — candidate property for a later model.
