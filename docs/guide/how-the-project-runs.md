# How the project runs

This page follows work through a project that uses Naima, from the moment
you say something to the moment it is done and proven. If you want the ideas
behind it first, [the primer](primer.md) gives the overview. You don't run
any of this yourself, because the [agents](glossary.md#agent) do. The
commands are shown so you can see what happens and check it, and each step
links to the page with the details.

## From a report to a close

Every piece of work follows the same [flow](glossary.md#flow):

```
report → file → triage → claim → work → prove → close
```

| Step | Who | What happens | Command |
|---|---|---|---|
| **Report** | you, or anyone | you say what you noticed, in chat and in your own words, or you write the item yourself | — |
| **File** | an agent | the report becomes an [item](glossary.md#item) straight away, before anyone works on it | `naima new bugs "Save button does nothing on a phone"` |
| **Triage** | an agent | it rewrites the report as a clear description in its own words, checks for duplicates and links them, and ranks it | `naima triage set <item> impact=high priority=now confidence=reported` |
| **Claim** | the agent that takes the work | it opens its own [worktree](glossary.md#worktree) and records that it holds the item, so nobody else starts on it without knowing | `naima claim <item> --note "why"` |
| **Work** | that agent | it does the work (code, an analysis script, a paragraph) in its own copy, in small [commits](glossary.md#commit) | git, handled by the agent |
| **Prove** | that agent, then another | the [proof](glossary.md#proof) is written as an item of its own and carried out, and what it showed is saved as [evidence](glossary.md#evidence) | `naima new tests "…"`, `naima link <test> verifies <item>`, `naima set <test> status=passed` |
| **Close** | someone other than the one who did the work | after the merge, from the main branch, the item moves to the archive with its proof | `naima close <item>` |

Naima checks three things along the way instead of taking them on trust:

- **Fixed, resolved and closed are different.** An item is
  [fixed](glossary.md#fixed) when the work exists,
  [resolved](glossary.md#resolved) when something proves it, and
  [closed](glossary.md#closed) when it has been archived. `naima close`
  refuses anything that hasn't been proven.
- **Whoever did the work doesn't close it.** `naima close` refuses on the
  branch that [claims](glossary.md#claim-file) the item
  ([the rule](rules.md#whoever-fixes-does-not-also-close)).
- **A proof counts only for what it was run on.** If the thing it proved
  changes, the proof stops counting until it is run again
  ([prove and close](prove-and-close.md)).

**Example (a paper with colleagues).** A co-author writes that section 4
contradicts the abstract. The agent files a bug and notes which sentence
contradicts which. [Triage](glossary.md#triage) finds an older report of the
same problem and links the two with `duplicate-of`. A worker claims the item,
rewrites the paragraph on its own branch, and files a test item saying
"every claim in the abstract appears in the body". Another agent carries out
that test and marks it `passed`, and then the item is closed from the main
branch.

For the details, see [file a bug](file-a-bug.md),
[file a feature](file-a-feature.md), [triage](triage.md),
[prove and close](prove-and-close.md), and, for agents,
[reporting and triage](../agents/reporting-and-triage.md).

## Planning

Anything you would like is filed as a [feature](glossary.md#feature) with
status `requested`. Before any work starts, the agent writes on it what
"done" means (the behaviour, its limits, and how it will be documented) and
then waits for you to say go
([the rule](rules.md#dont-start-implementing-until-the-owner-says-so)).
Smaller pieces of work are [todos](glossary.md#todo).

```sh
naima new features "Export to PDF with the figures in colour"
naima board features
```

Grouping work into an [epic](glossary.md#epic), giving a release a date with
a [milestone](glossary.md#milestone), and stating what must hold and exactly
how ([requirements, specifications and decisions](plan-with-requirements-specs-and-decisions.md))
are all done with items as well. See
[plan with epics, milestones and gates](plan-with-epics-milestones-and-gates.md).

## Gates

A [gate](glossary.md#gate) is what a release waits on. An item joins a gate
by carrying `gate=<name>`, and the gate holds once nothing on it is in the
way.

```sh
naima set export-drops gate=v1
naima gates v1 --check         # fails while anything on v1 is open
naima queue v1 --human         # what on v1 needs you, each with why
```

The [queue](glossary.md#queue) splits the remaining work by whose hands it
needs: an agent's, a person's, or a build machine's. A release is never made
while its gate is still open. For more, see
[read the board, the queue and the gates](read-the-board.md), and for adding
a gate, [configure the project](configure-the-project.md).

## Work that lasts longer than one session

Agents forget everything between [sessions](glossary.md#session), but the
project doesn't, because everything is written down in files:

- **A session note** is written at the end of every session with
  `naima pass "what changed, what is proven, what is left"`. The next agent
  reads it in `naima summary`.
- **A claim file** exists for every piece of work in progress. It is made
  with `naima claim` and removed with `naima release` when the work is done.
  `naima claims` shows who holds what, across every branch.
- **One worktree per piece of work** means two agents working at the same
  time never write into each other's files
  ([work on several branches at once](several-branches.md)).
- **One coordinator** talks to you, while the workers do the work in the
  background and report back to it
  ([the coordinator and the workers](../agents/coordinator-and-workers.md)).

Worktrees and branches follow one naming scheme, and each worktree carries a
claim file. `naima open` creates both, and `naima check` fails when either is
broken
([the enforced rule](rules.md#worktrees-and-branches-are-named-by-one-scheme-and-every-worktree-carries-a-claim)).
[The tutorial](tutorial.md) walks through the whole life of a piece of work
in a single worktree, naming the command for each step. Opening a worktree
and finishing one each have their own page for agents:
[opening a worktree](../agents/opening-a-worktree.md) and
[closing a worktree](../agents/closing-a-worktree.md). There is also a way
of working in which the agents keep going until only your work is left
([while you are away](while-you-are-away.md)).

## Decisions

An agent asks you only about things that really are yours: a judgement, a
decision, a credential such as a password, or something physical that has to
be done. It asks one question at a time and tells you the answer it would
give. Anything it can find out by itself, it finds out. Once you have given a
permission, it stays given
([what an agent will ask you](working-with-agents.md#what-an-agent-will-ask-you)).

Your standing choices become [rules](glossary.md#rule) of the project, which
every agent reads before it starts work:

```sh
naima new rules "Ask before deleting" --set audience=agents --set strength=must
naima rules --audience agents
```

For more, see [write a project rule](write-a-project-rule.md). Each answer
you give is recorded once as a [decision](glossary.md#decision), and an agent
searches the decisions (`naima decisions <words>`) before asking you
anything, so a question that has been settled isn't asked again. What must
hold and how things must behave are recorded as items too, as
[requirements and specifications](plan-with-requirements-specs-and-decisions.md).

## What agents do with git

Git keeps every version of the work, and you never have to type a git
command. The agents install git if it is missing, create a repository if
there isn't one, keep secrets and private data out of it, and save the work
in small commits that they never rewrite
([git, handled for you](../agents/git-for-the-owner.md)).

## Then the commands

Each step above is a command. The [guide](README.md#everyday-tasks) has a
page for each task, and the [reference](../reference/reference.md), which is
generated from the code, documents every command.
