# The guide

This guide is for the people whose project Naima runs. Nothing here assumes
you read or write code, know git, or have managed a project professionally.
An AI agent does the machine work, and every step is either a `naima` command
or plain text on an [item](glossary.md#item)'s page. The agents run the
commands for you, although you can run them yourself if you want to. If a
word is new to you, it's in the [glossary](glossary.md), and if you're
starting out, [the primer](primer.md) gives the overview.

[The purpose](../purpose.md) explains what Naima is for. It was born for
software, where the agents build it for you with tests, reviews, gates and
formal methods, and it works for any other project too, with that project's
own checks taking the place of tests.

## First, how the project runs

| Page | What it gives you |
|---|---|
| [The primer](primer.md) | every concept (item, bug, todo, feature, epic, gate, milestone, evidence, the diary, claims) in the order you meet it, each with one example; read it first |
| [How the project runs](how-the-project-runs.md) | the [flow](glossary.md#flow) every piece of work follows (report, file, [triage](glossary.md#triage), claim, work, prove, close), then planning, [gates](glossary.md#gate), long work across sessions, and decisions |
| [Working with AI agents](working-with-agents.md) | how to get an agent going, what to ask of it, and what it will ask of you |
| [Rules](rules.md) | the rules every project holds to, each marked as checked by Naima or kept by convention |
| [Concepts](concepts.md) | the ideas underneath: items, links, fixed / resolved / closed, [evidence](glossary.md#evidence), gates, working across branches |

## Start

| Page | What it gives you |
|---|---|
| [Tutorial](tutorial.md) | from an empty repository to a closed bug, every command with its real output |
| [A second tutorial](tutorial-2.md) | the project running itself: a feature, the owner's go, a coordinator and a worker, a property proven by a verifier, a release gate that holds |
| [Install](install.md) | installing, the copy of Naima a project runs, keeping it aligned, the permissions |

## Everyday tasks

| I want to… | Page |
|---|---|
| bring in the TODO.md or issue list the project already keeps | [Adopt an existing board](adopt-an-existing-board.md) |
| say something is broken | [File a bug](file-a-bug.md) |
| ask for something new | [File a feature](file-a-feature.md) |
| set a rule only this project has | [Write a project rule](write-a-project-rule.md) |
| rank what is open | [Triage](triage.md) |
| see where things stand | [Read the board, the queue and the gates](read-the-board.md) |
| group work, declare a release, give it a date | [Plan with epics, milestones and gates](plan-with-epics-milestones-and-gates.md) |
| run the first-commit checklist on a new project (language, modularity, data out of code) | [Structuring a project from the start](structuring-a-project.md) |
| say what must hold, how it must behave, and what I decided | [Plan with requirements, specifications and decisions](plan-with-requirements-specs-and-decisions.md) |
| plan an analysis, a report or a figure, deliver it, and know when it is out of date | [Make and keep artifacts](artifacts.md) |
| keep what the project knows (facts, findings, hypotheses, lessons) with what each one rests on | [Keep what the project knows](knowledge.md) |
| have behaviour with states (a lifecycle, a protocol, a retry loop) designed from a model and checked over every order of events | [Design with a model](design-with-a-model.md) |
| leave agents working and come back to only my part | [What happens while you are away](while-you-are-away.md) |
| run a benchmark or a batch that takes hours, here or on another machine, and clean up after it | [Long work: run it, wait for it, clean up after it](long-work.md) |
| prove a fix and close it | [Prove and close](prove-and-close.md) |
| install the model checkers a plugin needs (mCRL2, Storm), here or on another machine | [Tools: what a plugin needs, installed by Naima](tools.md) |
| know what may be announced, and keep the README true | [Announce only what is true](announce.md) |
| measure the work (test time, coverage, warnings, complexity), hold it to a budget, and see how the code's quality changes over time | [Metrics and budgets](metrics-and-budgets.md) |
| work on several things at once | [Work on several branches at once](several-branches.md) |
| make sure a fix doesn't land without its test, or a change without its note | [Commit hooks and companion records](commit-hooks.md) |
| move to a newer Naima | [Update Naima](update-naima.md) |
| add a gate, weigh a check, switch a plugin off | [Configure the project](configure-the-project.md) |
| use a plugin a colleague gave me | [Add a plugin someone gave you](add-a-plugin.md) |
| write a plugin, or adopt Naima outside software | [Extending Naima](extending-naima.md) |
| track a paper's sections and a co-author's reviews | [Writing a paper: sections and reviews](paper-sections-and-reviews.md) |

## Look up

| Page | What it holds |
|---|---|
| [The tracker folder](tracker-folder.md) | what is in `naima-tracker/`, the lock, migrations, moving things |
| [Configuration](config.md) | every key of `naima.json`: plugins, options, check weights, third-party plugins |
| [Questions](faq.md) | the questions people ask first |
| [Glossary](glossary.md) | every term, defined once |
| [Planned](../planned.md) | everything not in Naima yet, in one place |
| [Reference](../reference/reference.md) | every command, type, status, field, check and gate, generated from the code |
