# What happens while you are away

You can give the agents a piece of work, leave, and come back to one short
list of the things only you can do. Nothing else is left waiting for you.

## Before you leave: name the target

Tell the agent what "finished" means. The target can be one of three things:

- **a list**, such as "tonight: merge the docs, rerun the checks, pick a
  licence", which the agent writes down as an [item](glossary.md#item) with
  one line per step;
- **an [epic](glossary.md#epic)**, such as "the onboarding work";
- **a [gate](glossary.md#gate)**, such as "everything the beta waits for".

The agent won't start the loop without a target, and "keep going" doesn't
count as one.

## While you are away

Every three minutes (you can ask for a different interval) the agent wakes up
and checks whether it is done or has stopped. If there is work left that an
agent can do, it picks it up again: it restarts a worker that stopped, merges
finished work once the checks pass, or starts the next piece. When it can't
do a step yet, it doesn't skip it silently. It marks the step as deferred and
writes the reason next to it.

It stops only once everything left on the target is yours to do.

## When you come back

You get one ordered list. Each line says what to do and why it's yours:

```
the owner's actions, in order:
  1. bugs/pick-name  Pick a name — decision: a decision reserved to the owner
  2. tests/looks-right  Looks right — judgement: how it looks
```

Decisions come first, because they unblock the rest. After them come the
things that need your password or your hands, then judgements such as whether
something looks right, and last the builds that no agent can make.

If you're away for longer, the agents keep busy. They try the checks nobody
has run yet and attach what happened, so the evidence is already there when
you come to judge.

You can see the same list yourself at any time with `naima loop <target>`
([the reference](../reference/reference.md#naima-loop)). The agents' side of
it is described in [the non-stop loop](../agents/the-non-stop-loop.md).
