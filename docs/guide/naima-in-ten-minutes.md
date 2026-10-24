# Naima in ten minutes

This page explains what Naima does and how, from the everyday parts to the
advanced ones, without asking you to learn any commands. If you have only a
minute, read [Naima in one minute](naima-in-one-minute.md) instead. If you
want every detail, the [full documentation](../README.md) has it.

## The problem it solves

Asking an AI to build software works well for an afternoon. Over weeks, the
same things go wrong in almost every project. The AI reports a fix that
isn't one, or a fix that quietly breaks something else. Nothing records what
was asked, what was decided or why, so each new session starts from zero and
you end up explaining the same thing again. When two sessions work at once,
one overwrites the other. After a while nobody, you included, can say what
state the project is in.

Professional software teams avoid this with habits that have nothing to do
with talent: they write requests down, test every change, review each other's
work, record decisions, and release only when a checklist is met. Naima gives
those habits to your AI agents, so you get the results without having to know
or run the practice yourself.

## What you do, and what the agents do

You talk to your agent the way you already do. "The export loses
transparency" or "I'd like a dark mode" is enough. From there the agents
follow a fixed path, and you only see the parts that need you.

1. The request becomes an **item**, a small folder with a description in the
   agent's own words. Duplicates are found first, so the same problem isn't
   filed twice.
2. The item is **triaged**: how much it matters, how urgent it is, and how
   sure we are about it. This is what decides the order of the work.
3. A worker agent **claims** it and works in a separate copy of the project,
   so parallel work never collides.
4. The fix comes with a **proof**, usually a test that fails on the old
   version and passes on the new one.
5. Another agent **checks and closes** it. Naima refuses to close an item
   without a passing proof, and refuses to let the agent that did the work
   close it.

When something needs your judgement, such as a design choice, a priority or
a password only you have, it goes into a short list of questions for you,
each with the reason it needs you. [Working with AI agents](working-with-agents.md)
describes this from your side.

## What you get

### A project that remembers

Every request, decision and session is kept as plain files in your
repository. Each session ends with a short note of what changed, what is
proven and what is left, and the next one starts by reading it. Decisions
are recorded once and searched before anyone asks again, so you don't have
to repeat yourself. This is also what lets work continue safely over days,
or while you are away ([while you are away](while-you-are-away.md)).

### Done means shown to work

An item has three separate states. It can be fixed (the change is made),
proven (a test or other evidence shows it works), and closed (someone other
than the fixer has accepted the proof). Because the proof is a test that
stays in the project, a later change that breaks the fix makes the test fail
again, and the problem shows up instead of coming back unnoticed
([prove and close](prove-and-close.md)).

### A team with separate roles

The agents work as a small company. One coordinates and talks to you, others
file reports, build, test, judge evidence, write the documentation and
prepare releases. Each role has things it refuses to do, chiefly checking its
own work. Some of these refusals are enforced by Naima itself, the rest are
written practice that the agents follow ([the roles](../purpose.md)).

### Plans, milestones and release gates

Larger work is grouped into epics, and milestones are marked with **gates**,
which are checklists that hold only when everything on them is done and
proven. A release goes out only when its gate holds. The order of work
follows what each item waits on, so nothing starts before what it depends on
is finished ([plan with epics, milestones and gates](plan-with-epics-milestones-and-gates.md)).

### Several agents at once

Each worker has its own branch and copy of the project, with a claim that
says who is working on what. A single coordinator brings the finished work
back one piece at a time and refuses anything that would overwrite newer
work ([several branches](several-branches.md)).

### Rules every agent follows

Your project's rules, such as "never commit a password" or "the docs change
with the feature", are kept as data that every agent reads at the start of
its work. Those that can be checked automatically are enforced before every
commit ([rules](rules.md)).

### Code quality you can watch

Measures such as complexity, duplication and test coverage are recorded on
every commit, so you can see whether the code is getting better or worse.
A measure can have a budget, and going over it shows up as a problem to fix
([metrics and budgets](metrics-and-budgets.md)).

### Formal methods, applied for you

For the parts of a design where testing a few cases isn't enough, Naima can
state a property ("no request is ever lost", say) and have a model checker
verify it over every possible order of events. The result is kept as
evidence like a test, and it expires when the model changes. You don't need
to know how model checking works to benefit from it
([design with a model](design-with-a-model.md)).

### Honest announcements

Naima only lets the project announce features that have shipped, are
documented and have been checked end to end. Release notes and the README
are held to the same rule, so the project never promises something that
isn't there ([announce](announce.md)).

### Knowledge with its evidence

Facts, findings, hypotheses and lessons learned can be recorded with what
they rest on, so a project's understanding grows along with its code and an
unproven hunch is never mistaken for a fact ([knowledge](knowledge.md)).

### A private tracker beside a public project

If your code is public, the record of the work doesn't have to be. Naima can
keep its tracker in a private folder beside the public repository, linked to
it commit by commit ([a private tracker](private-tracker.md)).

### Not only software

The same way of working fits other long-lived projects, with that work's own
checks in place of tests. A data analysis is checked by reproducible runs,
and a paper by reviews from co-authors. A pack for data analyses ships today
as a worked example, and a project can add its own item types, checks and
gates with a plugin ([extending Naima](extending-naima.md)).

## What it costs, and what it doesn't do yet

Naima is free and open source, and it needs no account, no server and no
internet connection beyond what git and your agent use. The careful way of
working does take more steps than a quick "fixed", so it uses more of your
agent's allowance. You need an agent that can run commands in a folder
([which agents](faq.md#which-ai-agent-do-i-need)).

Some things are still to come, including a visual dashboard and more packs
for work beyond software. They are listed on one page, [planned](../planned.md),
and nothing in these pages describes them as if they already existed.

## Where to go next

- [Install](install.md), or simply ask your agent to install Naima in your
  project.
- [The primer](primer.md) introduces every concept with an example.
- [The tutorial](tutorial.md) follows one bug from report to closing, with
  the real commands and their output.
- [The glossary](glossary.md) defines every term used in these pages.
- [The full documentation](../README.md) covers everything else.
