# Working with AI agents

Naima is built for projects where [agents](glossary.md#agent) do the machine
work and you, the [owner](glossary.md#owner), make the decisions. This page
is for you. It covers how to get an agent going, what to ask of it, and what
it will ask of you. You don't need to know git, code or project management.
[The primer](primer.md) gives the overview of the ideas involved, and
[how the project runs](how-the-project-runs.md) describes how the work moves.
What the agent itself reads is in [the pages for agents](../agents/README.md).

## Get an agent going

**On a project without Naima**, give the agent the site's instructions
("install Naima in this repository, following
https://vincenzoml.github.io/naima/llms.txt") and it runs the installer
itself. It installs git and Deno if they are missing, starts a repository if
the folder doesn't have one yet ([git, handled for you](../agents/git-for-the-owner.md)),
and adds one line to the project's agent instruction file (`AGENTS.md`,
`CLAUDE.md` or whichever one your agent reads), so that every later agent
finds Naima.

**On a project with Naima**, point the agent's tool at the
[skill](glossary.md#skill), which ships inside the program directory. For
Claude Code you do this once, from the project's root:

```sh
mkdir -p .claude/skills && ln -s ../../naima-tracker/naima/skills/naima .claude/skills/naima
```

With other tools, tell the agent to read
`naima-tracker/naima/skills/naima/SKILL.md` first. The skill teaches it to
announce Naima at the start of a session with `naima hello` and to update it
only once you've said yes, to change the tracker only through the commands, and to follow the [flows](glossary.md#flow) and
[the rules](rules.md).

## What to ask of an agent

Ask in plain words, and the agent turns what you say into
[items](glossary.md#item) and commands.

| You say | The agent does |
|---|---|
| "This is broken: …" | files a bug in its own words, then [triages](glossary.md#triage) it ([file a bug](file-a-bug.md)) |
| "I'd like it to …" | files a feature as `requested`, and writes down what done means for you to confirm ([file a feature](file-a-feature.md)) |
| "Where are we?" | runs `naima summary` and tells you the one thing you need to decide |
| "Fix the next thing" | takes the most urgent open item, claims it in its own [worktree](glossary.md#worktree), fixes it, and writes the test that proves it |
| "What do you need from me?" | runs `naima queue --human`, which lists the items only you can do, each with the reason |
| "Close what is proven" | closes, from the [trunk](glossary.md#trunk), the items that someone other than the fixer has checked |

Two things are worth knowing:

- **Say what "done" is before work starts.** A request isn't an order to
  start work. The agent writes the definition on the item and waits for your
  go.
- **A fix isn't proven by the tests of the agent that made it.** Someone else
  checks the [proof](glossary.md#proof) before the item closes
  ([the rule](rules.md#whoever-fixes-does-not-also-close)).

## What an agent will ask you

An agent asks you only about things that really are yours to decide, and one
question at a time ([the rule](rules.md#dont-ask-the-human-if-you-know-the-answer)).
Each question says which of four reasons it falls under:

| Reason | Example |
|---|---|
| `judgement` | "Which of these two colours reads better on the dark theme?" |
| `decision` | "Ship the export change in this release, or the next?" |
| `credential` | "Sign in to the store account so I can upload the build." |
| `physical` | "Plug the device in and press the button." |

A good question comes with the answer the agent would give, so you can reply
in one word. If an agent asks you something it could have found out for
itself, such as what a command prints or whether a test passes, tell it so,
because that's a defect in how it works.

## Work handed to you

Items whose proof needs a person carry `runBy: human` and say why. You can
list them with:

```sh
naima queue --human
```

For each one, read its page and do what it says. Then put what you saw in its
`attachments/` folder (`naima attach <item> <file> --own`) and set the result
(`naima set <item> status=passed`, or `failed`). You can also tell the agent
what you saw and ask it to record it for you.

## Your chat stays private

What you say to an agent stays between the two of you. The agent writes
reports, descriptions and notes in its own words, and it copies your words,
or attaches a file or screenshot you shared, only after you say yes
([the rule](rules.md#the-owners-chat-stays-private)).

## Several agents at once

Usually one agent talks to you (the [coordinator](glossary.md#coordinator))
and hands the work to others (the [workers](glossary.md#worker)), each in its
own worktree. You only talk to the coordinator. How the work is shared out is
described in [the coordinator and the workers](../agents/coordinator-and-workers.md).

## Reading what agents did

- `naima summary` shows where things stand, including the latest
  [session notes](glossary.md#session-note).
- `naima pass --list` shows the newest session notes in full.
- `git log` shows every change, with its reason in the commit message.
