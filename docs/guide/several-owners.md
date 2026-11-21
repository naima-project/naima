# Several people own a project

A project can have more than one owner. Each of them works on their own machine with their own agents, and Naima keeps track
of who asked for what, whose turn it is to decide, and how their landings meet on one trunk.

## Who you are to Naima

Naima takes the person at the keyboard from git: your `user.name` and `user.email`. You can set `NAIMA_PERSON` to another name
for a session, and give `--by <name>` on any command to say that someone else ordered it. An agent that changes something on its
own, with nobody behind it, says `--by agent`.

## What records who

Every item records who asked for it and who filed it. When you ask for something, the agent files it with `--asked-by owner`,
and the item keeps your name with it. `--asked-by "owner:<name>"` names another owner. `naima show <item>` prints both.

Every change to an item adds one line to the item's history, in `history.jsonl` beside its `meta.json`: when it happened, the
person who ordered it, the agent that made it when an agent did, and what changed (filed, a status, a field, a note, a move).
`naima show <item>` lists them under "changes, and who ordered them". Two branches that both add to a history merge without a
conflict, because the tracker's `.gitattributes` merges that file line by line. A tracker commit Naima makes itself, and every
landing marker, carries an `Ordered-by:` trailer with the same name.

An item's notes are its comments. Each one is headed by its day and its author: your name, or your name with the agent that
wrote it for you, such as `Ada (through the worker)`. In the UI the item page shows the comments with their authors and days,
and you can add one there. The UI runs `naima note` for you, with your name.

## Whom something waits on

An item can name the one person it waits on:

```sh
naima set export-drops waitsOn=Ada
```

A question on a meeting's agenda is an item too, so it can name its person the same way.

`naima waiting` lists what waits on you: the owner gate's questions and decisions, what is fixed and waits for a proof by your
hands, what is open and needs your hands, and a test you run that fails. Each item appears once. What waits on another owner is
left out, and what waits on nobody in particular stays in. `naima waiting --for Bob` shows Bob's list and `--everyone` shows
all of them. `naima hello` counts this same list, `naima queue` says its size, and the UI reads it from the bridge's `waiting`
view, so every place gives the same number. The item page says whom an item waits on.

## One trunk, several coordinators

On one machine there is still one coordinator, the only one that lands. When several owners each run a coordinator, their
landings meet on the remote they share. Name that remote once:

```sh
naima plugin set coordination sharedRemote=origin
```

From then on `naima land` fetches the remote first. It brings the trunk up to the remote's, merges the trunk into the branch when
the branch lacks the other person's work, lands, and pushes at once. If someone else pushed in between, the remote refuses the
push. The landing is then undone on your machine and made again on the new trunk, up to three times. After that Naima says the
remote kept moving, and the branch is still there to land. When merging the trunk into the branch conflicts, Naima stops and
names the files to settle.

`naima claim` and `naima open` commit and push the claim as soon as they make it, so the other owners' agents see it. They read
the remote's claims again after the push and tell you when someone else claims the same item. Claims never lock anything: two
people may work on one item, and now they know it.

This protocol was modelled in mCRL2 and checked before it was written: no landing is lost, no item is claimed twice without
one of the two people being told, and a refused push always ends in a new attempt or a message.

A tracker kept in a repository of its own (`naima init --private-tracker`) is not shared this way yet.
