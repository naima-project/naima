# For agents

These pages are for an AI agent working on a project that Naima tracks. A
person using Naima reads [the guide](../guide/README.md) instead, and what a
person should know about working with agents is
[there too](../guide/working-with-agents.md). For an overview of the ideas
Naima uses, from items and statuses to proofs, gates and landings, read
[the primer](../guide/primer.md) first.

**What you are here.** You are part of a small team of agents that does the
machine work for an [owner](../guide/glossary.md#owner), who only decides
([what Naima is for](../purpose.md)). The owner may be a researcher, a writer
or a domain expert who has never programmed, and doesn't need to know git,
code or project management. You apply the practice for them without asking
them to learn it: [items](../guide/glossary.md#item), tests,
[proofs](../guide/glossary.md#proof), [gates](../guide/glossary.md#gate),
small commits, and a formal check where a
[verifier](../guide/glossary.md#verifier) exists. You bring them only the
things that really are theirs to decide.

## How an agent learns a project

1. **Load the skill**, [`skills/naima/SKILL.md`](../../skills/naima/SKILL.md)
   in the program directory. It says how to install or align Naima, how to
   start a session with `naima hello`, and where everything else is
   ([the Naima skill](skill.md)).
2. **Read [the rules](../guide/rules.md)** that every project holds to. Each
   one is marked as checked by Naima or kept by convention. The rules are
   written on that page and nowhere else, and the
   [flows](../guide/glossary.md#flow) below apply them.
3. **Read the project's own rules** with `naima rules --audience agents`.
   They are data in the project's `naima-tracker/naima-data/`
   ([read the project's rules](read-the-project-rules.md)).
4. **See where the project stands** with `naima summary`, `naima queue` and
   `naima claims` ([read the board](../guide/read-the-board.md)).
5. **Before acting, read the flow that applies**, from the list below.

Everything is plain markdown in the program directory, which holds the
documentation of the exact Naima the project runs, and `naima guide` prints
where that is. `naima help` lists the commands of that Naima, and the
[reference](../reference/reference.md) documents each one. If a term isn't
defined on a page, it is in the [glossary](../guide/glossary.md).

## The flows

The flows are the written procedures for working on a project when agents do
some or all of the work. They are general, so any project that adopts Naima
can follow them, and Naima's own repository does.

| Flow | When |
|---|---|
| [Asking the human](asking-the-human.md) | before any question to the owner, and whenever work is handed to a person |
| [Git, handled for the owner](git-for-the-owner.md) | always: installing git, starting a repository, the `.gitignore`, committing without ever losing work |
| [Worktree isolation](worktree-isolation.md) | always: the requirement every other flow obeys |
| [The coordinator and the workers](coordinator-and-workers.md) | how a session is staffed |
| [Worker protocol](worker-protocol.md) | the report shape every worker owes the coordinator, and how finished workers are merged together |
| [Opening a worktree](opening-a-worktree.md) | starting a piece of work |
| [Closing a worktree](closing-a-worktree.md) | before a branch is merged |
| [Commit messages](commit-messages.md) | writing the message for any commit, and the records a change must carry in it |
| [Reporting and triage](reporting-and-triage.md) | when something is said, seen or found, and at every prompt of the owner, for the requirements it carries |
| [Adopting an existing board](adopting-an-existing-board.md) | when a project that starts using Naima already keeps a TODO.md, a notes file or an issue list |
| [Planning: epics, milestones and gates](plan-with-epics-and-gates.md) | when the owner names a body of work, a release or a date |
| [Long work](long-work.md) | before starting any command expected to outlast a few minutes, or to run on another machine |
| [Messages to the owner](messages.md) | when a naima command prints a NAIMA-MESSAGE line, or a turn-end hook stops you with what to tell the owner |
| [Tools](tools.md) | when a verifier says `tool missing:`, or work needs mCRL2 or Storm on a machine |
| [The non-stop loop](the-non-stop-loop.md) | when work should go on while the owner is away, until only the owner's is left |
| [Code-quality metrics over time](code-quality-metrics.md) | when the owner asks how the code's quality moves, or for a chart of a metric over the commits |
| [Release](release.md) | the runbook from a gate holding to a release being announced |
| [Announcer](announcer.md) | release notes, changelog entries, README and site copy: only features that are announceable |
| [Documentarian](documentarian.md) | writing the changelog, the announcement page, and keeping docs current once a release hands off |
| [Community](community.md) | an outside issue or pull request, before it is triaged like any other report |
| [Business](business.md) | a licence, funding, sponsorship or citation question, filed as a decision, never acted on here |

Whichever flow applies, the owner's chat is private. Nothing from it goes
into the repository word for word, and a file the owner shared becomes an
attachment only if they explicitly say yes
([the rule](../guide/rules.md#the-owners-chat-stays-private)).
Before any write of free text or a file to the tracker, read the text
against [the no-leaks checklist](NOLEAKS.md) and sign the write with
`--revised` and the checklist's path, or the CLI refuses it. Only the agent
talking to the owner writes text taken from what the owner said
([the rule](../guide/rules.md#free-text-and-files-are-signed-against-the-no-leaks-checklist)).

The tracker itself is never readable by people outside the project, and the
CLI refuses every write while it is
([the rule](../guide/rules.md#the-tracker-is-never-exposed)). When a write is
refused because the tracker is exposed, tell the owner what the refusal says,
and run the fix it names: for a tracker committed in a public repository
that is `naima init --private-tracker`, which moves it into a repository of
its own with its history. When Naima says it cannot tell whether a remote is
public, ask the owner once, as it says; if the owner says the remote is
private, record it with `naima init --remote-private`. After a move, a todo
at the highest priority asks for a sweep of the tracker: read every item,
note and attachment, paraphrase or remove through the CLI whatever is
private, strategic or confidential, and bring the question of rewriting the
public history to the owner
([keep the tracker private](../guide/private-tracker.md#the-tracker-is-never-exposed)).

Two words are used throughout these pages. The
[owner](../guide/glossary.md#owner) is the person the project answers to, and
the [trunk](../guide/glossary.md#trunk) is the branch releases come from.

## As agent commands

[`skills/naima/commands/flow/`](../../skills/naima/commands/flow/) holds one
command per flow, for agent harnesses that read commands from the repository
(Claude Code reads `.claude/commands/flow/` as `/flow:<name>`). The commands
ship with the skill, outside any `.claude/` directory, so that a harness
doesn't load them from a project's `naima-tracker/naima/` without being
asked to. Naima's own repository links its `.claude/commands/flow` to them.
Each command is a checklist that points at its page here, and if the two
disagree, the page wins. To adopt the commands in another project, copy the
directory into its `.claude/commands/flow/`, and copy the pages too if the
project doesn't depend on Naima's docs.

In the commands, `naima` is the CLI, `deno run -A
naima-tracker/naima/naima.ts` ([installing](../guide/install.md)). In Naima's
own repository it is `deno task naima`.
