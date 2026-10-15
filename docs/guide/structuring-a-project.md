# Structuring a project from the start

Before the first line of a new project is written, a few choices decide
whether it will still be able to grow two years from now. They are which
language or languages to use, how to split the work into small independent
parts, and how to keep settings and data out of the code. Each of them is
cheap to change today and expensive to change later, so it's worth making
them on purpose. This page is the checklist a new project goes through at its
first commit. Each choice is recorded once as a
[decision](glossary.md#decision), so that nobody has to argue it again. The
agents run the commands below for you, unless you want to run them yourself.

## The checklist

Group the choices in an [epic](glossary.md#epic), so that you can follow
their progress in one place:

```sh
naima new epics "Structuring the project"
```

Then take each choice below in turn. The agent raises it, the owner
answers, and the answer is recorded as a decision before any code follows
from it.

1. **Which language or languages.** A single language is the simplest to
   review and test. Sometimes more than one is right, for example a scripting
   language for data and a systems language for performance, but that should
   be a deliberate choice rather than something the project drifts into.
2. **Small, independently testable parts.** Split the work so that each part
   can be built, tested and understood on its own before anything is wired
   together. If a part can't be tested alone, the split is probably in the
   wrong place.
3. **Settings and data out of the code.** Configuration and data live in
   plain files that the code reads, and are never typed into the source by
   hand. A number in a paper, a threshold in an analysis or a price in a
   product can then each be traced to the file it came from, rather than to a
   line someone once edited.

## Recording each choice

```sh
naima new decisions "One language: TypeScript, for the whole project"
naima epic add structuring-the-project decisions/one-language-typescript-for-whole-project
```

Agents search the decisions recorded this way before they ask the same
question again
([decisions](plan-with-requirements-specs-and-decisions.md#decisions-asked-once-never-again)).
Once every choice has a decision, the epic is done:

```sh
naima epic structuring-the-project
```

```text
epics/structuring-the-project  Structuring the project  [done]  3 of 3 closed
```

## Today, and what is planned

At the moment, an agent proposes these choices in chat at the start of a new
project and records each one as a decision once the owner has answered. This
page is the checklist that the agent, or a person working directly, follows
by hand. Having the agent run the checklist on its own initiative at a
project's first commit is
[planned](../planned.md#structuring-a-project-from-the-start).
