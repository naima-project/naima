# Working with AI agents

Naima is built for projects where [agents](glossary.md#agent) do the machine work and you, the [owner](glossary.md#owner), make the decisions. This page is for
you. It covers how to get an agent going, what to ask of it, and what it will ask of you. You don't need to know git, code or project management.
[The primer](primer.md) gives the overview of the ideas involved, and [how the project runs](how-the-project-runs.md) describes how the work moves. What the
agent itself reads is in [the pages for agents](../agents/README.md).

## Get an agent going

**On a project without Naima**, give the agent the site's instructions ("install Naima in this repository, following
https://naima-project.github.io/naima/llms.txt") and it runs the installer itself. It installs git and Deno if they are missing, starts a repository if the
folder doesn't have one yet ([git, handled for you](../agents/git-for-the-owner.md)), and adds one line to the project's agent instruction file (`AGENTS.md`, or
whichever one your agent reads), so that every later agent finds Naima and runs `naima hello` when a session starts. For an agent tool that can run a command by
itself at the start of a session, it also installs a hook that runs `naima hello` for the agent
([running naima hello at every session start](install.md#running-naima-hello-at-every-session-start)).

**On a project with Naima**, point the agent's tool at the [skill](glossary.md#skill), which ships inside the program directory. How depends on the tool. With
Claude Code, for example, you do this once, from the project's root:

```sh
mkdir -p .claude/skills && ln -s ../../naima-tracker/naima/skills/naima .claude/skills/naima
```

With a tool that doesn't load skills, tell the agent to read `naima-tracker/naima/skills/naima/SKILL.md` first. The skill teaches it to announce Naima at the
start of a session with `naima hello` and to update it only once you've said yes, to change the tracker only through the commands, and to follow the
[flows](glossary.md#flow) and [the rules](rules.md).

## What to ask of an agent

Ask in plain words, and the agent turns what you say into [items](glossary.md#item) and commands.

| You say                     | The agent does                                                                                                                       |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| "This is broken: …"         | files a bug in its own words, then [triages](glossary.md#triage) it ([file a bug](file-a-bug.md))                                    |
| "I'd like it to …"          | files a feature as `requested`, and writes down what done means for you to confirm ([file a feature](file-a-feature.md))             |
| "Where are we?"             | runs `naima summary` and tells you the one thing you need to decide                                                                  |
| "Fix the next thing"        | takes the most urgent open item, claims it in its own [worktree](glossary.md#worktree), fixes it, and writes the test that proves it |
| "What do you need from me?" | runs `naima queue --human`, which lists the items only you can do, each with the reason                                              |
| "Close what is proven"      | closes, from the [trunk](glossary.md#trunk), the items that someone other than the fixer has checked                                 |

Two things are worth knowing:

- **Say what "done" is before work starts.** A request isn't an order to start work. The agent writes the definition on the item and waits for your go.
- **A fix isn't proven by the tests of the agent that made it.** Someone else checks the [proof](glossary.md#proof) before the item closes
  ([the rule](rules.md#whoever-fixes-does-not-also-close)).

## What an agent will ask you

An agent asks you only about things that really are yours to decide, and one question at a time
([the rule](rules.md#dont-ask-the-human-if-you-know-the-answer)). Each question says which of four reasons it falls under:

| Reason       | Example                                                      |
| ------------ | ------------------------------------------------------------ |
| `judgement`  | "Which of these two colours reads better on the dark theme?" |
| `decision`   | "Ship the export change in this release, or the next?"       |
| `credential` | "Sign in to the store account so I can upload the build."    |
| `physical`   | "Plug the device in and press the button."                   |

A good question comes with the answer the agent would give, so you can reply in one word. If an agent asks you something it could have found out for itself,
such as what a command prints or whether a test passes, tell it so, because that's a defect in how it works.

## Work handed to you

Items whose proof needs a person carry `runBy: human` and say why. You can list them with:

```sh
naima queue --human
```

For each one, read its page and do what it says. Then put what you saw in its `attachments/` folder (`naima attach <item> <file> --own`) and set the result
(`naima set <item> status=passed`, or `failed`). You can also tell the agent what you saw and ask it to record it for you.

## Your chat stays private

What you say to an agent stays between the two of you. The agent writes reports, descriptions and notes in its own words, and it copies your words, or attaches
a file or screenshot you shared, only after you say yes ([the rule](rules.md#the-owners-chat-stays-private)).

## Several agents at once

Usually one agent talks to you (the [coordinator](glossary.md#coordinator)) and hands the work to others (the [workers](glossary.md#worker)), each in its own
worktree. You only talk to the coordinator. How the work is shared out is described in [the coordinator and the workers](../agents/coordinator-and-workers.md).

## Reading what agents did

- `naima summary` shows where things stand, including the latest [session notes](glossary.md#session-note).
- `naima pass --list` shows the newest session notes in full.
- `git log` shows every change, with its reason in the commit message.

## Where each item comes from

Every item records its origin when it is filed, in the field `origin` of its `meta.json`, and nothing changes it afterwards. It says who asked for the item
(`askedBy`: you, the `owner`; the `coordinator` or a `worker`; an `agent` that found it on its own; a `person` other than you, by name; or `unknown`), who filed
it and in what role (`filedBy`), the session it was filed in, the moment, the branch, and the item it was derived from (`from`), when there is one. Agents say
`--asked-by owner` only for what you said; everything else they file is theirs.

A requirement an agent filed on its own is _proposed_. No gate counts it, and `naima check` reminds you of it, until you say yes and the agent records your
words with `naima confirm <requirement> --words "<your yes, restated>"`; then it is stated like any other.

### Reviewing a session

`naima hello`, which runs when a session starts, gives the session an id; when the agent tool has its own session id, that one is used. Every item filed until
the next `naima hello` records it, and every change made in the session is logged beside the tick's state, outside the repository. A worktree with no session of
its own counts in the main worktree's, so a worker's filings land in the session of the coordinator that started it.

```sh
naima origin                           # the session this worktree is in
naima origin 2026-10-27-1a2b3c4d       # what that session filed, who asked for each, and what else it changed
naima list requirements --origin agent # requirements nobody but an agent asked for
naima list --origin 2026-10-20..2026-10-27
```

A session that drifted is reviewed item by item from that list, and undone the same way: drop what should not have been filed, and revert the changes with git.
Items filed before origins existed get one from git with `naima origin --backfill` (try `--dry-run` first): the commit that added each item, its author and
date, and the branch of the landing that brought it in, marked `inferred`, with `askedBy` left `unknown` for you to settle.

To settle who asked, or to correct it when it was recorded wrong, use `naima origin --set`. Who asked is the only part of an origin that can change. The rest
stays as it was filed, and the origin keeps a record of each change: what it said before, who changed it and when.

```sh
naima origin --set bugs/export-crashes --asked-by owner
naima origin --set bugs/export-crashes --asked-by "person:Ada"
```
