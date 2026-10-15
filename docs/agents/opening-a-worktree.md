# Opening a worktree

This is how a piece of work starts. There are four steps, and the second and
third are done by a single command. The requirement they follow is
[worktree isolation](worktree-isolation.md), and the rules they apply are on
[the rules page](../guide/rules.md).

## 1. The work has an item

If the work has no item yet, open one first
([reporting and triage](reporting-and-triage.md)). A fix that leaves no trace
gets forgotten, and the next time the problem comes up it has to be
diagnosed from scratch.

If the item is linked `specified-by` a spec, read the spec's current version
(`naima spec`) before writing any code. If the work changes what the spec
says, change the spec first: `naima spec revise <spec>` opens the next
version as a draft, and you build once that version is `current`. If the item
`satisfies` a requirement, the proof you file for the item also `verifies`
the requirement.

## 2. Its own worktree, its own branch

```sh
naima open <item> [<item>...] --as <who> [--name <what>] --note "why"
cd <worktrees-dir>/<what>
```

The branch is called `<who>/<what>`, meaning who is working (an agent's role
or name) and on what, in a few words. Each part uses lowercase letters,
digits, dots and dashes. `<what>` defaults to the first item's slug, and
`<who>` defaults to the coordination plugin's `who` option. The worktree is
the folder `<what>` inside the worktrees directory, which is
`<main checkout>-worktrees` next to the main checkout unless the plugin's
`worktrees` option says otherwise. The branch starts from the
[trunk](../guide/glossary.md#trunk). Before it touches anything, `open`
refuses a name that doesn't follow the scheme, a branch that already exists
and a folder that already exists. The check `worktree-policy` fails any
worktree or branch that doesn't follow this scheme
([the rule](../guide/rules.md#worktrees-and-branches-are-named-by-one-scheme-and-every-worktree-carries-a-claim)).

A fresh checkout has no dependencies installed, so install them before you
run anything.

## 3. Claim what you work on, before you start

`open` has already claimed its items in the new worktree. To claim more, run
this from inside the [worktree](../guide/glossary.md#worktree), never from
the trunk:

```sh
naima claim <item> [<item>...] --note "why"
```

It writes one [claim file](../guide/glossary.md#claim-file),
`naima-tracker/naima-data/claims/<uuid>.json`, in this worktree and does
nothing else. It stages nothing, commits nothing and touches no other branch,
so commit the claim along with the work. Several branches may claim the same
[item](../guide/glossary.md#item), and one branch may claim several, and
`claim` tells you who else holds the item. A worktree made by hand with
`git worktree add` still needs a claim, because the check fails a worktree
that holds none and has commits the trunk doesn't have.

## 4. A scratchpad is not a tracker

It's fine to keep a scratch file for what you are doing right now, for
example an untracked `WIP.md`, and it goes away with the worktree. Anything
written there that is a defect, a task, a verification or a rule goes away
with it too, which is why those belong in items.

## Safety rules

- **Every worktree carries a claim.** Enforced by the check `worktree-policy`.
  A worktree made by hand with `git worktree add` still fails it if it holds
  no claim file.
- **A worktree and its branch are named by one scheme.** Enforced by the same
  check, which fails a name that doesn't follow the `<who>/<what>` scheme.
- **`open` never reuses a name or a branch already in use.** Enforced:
  `naima open` refuses a branch that exists and a folder that exists before
  it touches either.
