# What Naima is for

Read this page first. The other pages explain how each piece works, while
this one says what Naima is, what it manages for you, and what it doesn't do
yet. Once you have read it, [the primer](guide/primer.md) gives the overview
of every idea Naima uses, in the order you meet them. The first time a term
appears here, it links to its one definition in the
[glossary](guide/glossary.md). "[Planned](planned.md)" means Naima doesn't
have it yet.

## What Naima is

**Born for software.** Naima is a silent software house, a team of AI
[agents](guide/glossary.md#agent) that builds software for you the way a
good engineering company would. It turns vibe coding (asking an AI to build
software and hoping it worked) into an exact science. Vibe coding leaves work
unverified, unrecorded, unrepeatable, uncoordinated and roleless; Naima
replaces each with its opposite. Your request goes through the same practice
industry uses, with written requirements, tests, metrics, reviews, and
[gates](guide/glossary.md#gate) before anything ships. Naima is also built
for [formal methods](guide/glossary.md#formal-methods), which are tools that
check a design mathematically. A property of the design is tracked and
proven like a test. Using state-of-the-art model checkers (such as mCRL2) as
the tools that prove it is
[planned](planned.md#model-checkers-and-the-strength-of-evidence). You don't
need to know any of this, because the agents apply it for you and record
what they did, so that what gets built is robust, maintainable and solid.
[One example, start to finish](#one-example-start-to-finish) shows the
difference.

**An enabling technology for people who are not coders.** Software engineering and formal methods
are usually out of reach for anyone who isn't a specialist. Naima puts them
in the hands of experts in other fields who aren't programmers at all. A
domain expert who has never programmed can build serious software this way
and get excellent results from AI agents.

**A decision support system.** Used through an AI agent, Naima is a tool for
running long-lived work and making informed decisions about it. It is meant
for the [owner](guide/glossary.md#owner), the person whose work it is. You
say in plain words what you want or what is wrong, and the agents do the
machine work. They write it down, plan it, carry it out, check it and keep
the proof. When the agents can go ahead on their own, they do, and you don't
hear about it. When something is yours to decide, Naima helps you understand
it in your own terms and your own words rather than a technician's.
`naima queue --human` lists what is waiting for you, and gives the reason
each item needs you ([asking the human](agents/asking-the-human.md)).

**The company behind the conversation.** The agents have separate jobs:
engineering, testing, judging evidence, releasing, documenting, announcing,
and even the business side. The agents do the work, and you only decide. The
jobs are listed in [their own section](#the-company-and-its-roles) below.

**Other projects.** The same way of working can manage any long-lived work
kept in versions, such as a scientific data analysis or a paper written with
colleagues. It does so by replacing software's practices with that work's
own ways of testing and measuring, as described in
[beyond software](#beyond-software-any-project) below.

**What you need.** You don't need to know git, code, Deno or Node (the
programs Naima runs on), or professional project management. You need an AI
agent. The agent installs what is missing, which is git, and Deno through the
installer ([install](guide/install.md)). Naima lives inside the project's
[repository](guide/glossary.md#repository), the folder in which git keeps
every version of the work. It uses one folder there, `naima-tracker/`, and
changes nothing outside it. It needs no server, no account and no internet
connection. You never have to open one of its files or learn one of its
commands, because the agents do that, and they handle git too
([git, handled for you](agents/git-for-the-owner.md)). The commands on this
page are the ones the agents type. `naima` is short for
`deno run -A naima-tracker/naima/naima.ts`.

## What Naima manages

[How the project runs](guide/how-the-project-runs.md) walks through how each
of these works, step by step.

### Reporting and issue management

Whatever you notice reaches the project, and nothing you say gets lost. You
can report something in chat ("the save button does nothing"), correct a
report later, or, if you are comfortable with files, write the
[item](guide/glossary.md#item) yourself. The
[flow](guide/glossary.md#flow) is always the same: report → file → triage →
claim → work → prove → close.

- **Filed first.** The agent writes the report down before anyone works on
  it. `naima new bugs "Save button does nothing on a phone"` creates a folder
  for it under `naima-tracker/naima-data/bugs/`.
- **Routed by kind.** "This is broken" is a [bug](guide/glossary.md#bug),
  "this needs doing" is a [todo](guide/glossary.md#todo), and "I'd like it to
  do X" is a [feature](guide/glossary.md#feature)
  ([reporting and triage](agents/reporting-and-triage.md)).
- **Triaged by an agent.** The agent rewrites the report in its own words as
  a clear description (what happens, what should happen, how to see it) and
  notes what it checked. It links duplicates
  (`naima link <new> duplicate-of <old>`) and sets the fields
  (`naima triage set <item> impact=high priority=now
  confidence=measured`). How long the work will take (`effort`) is set only
  after someone has looked at the work, and is never guessed.

**Example.** A user says in chat "the app loses my settings after an
update". The agent files a bug and writes down which settings are lost and
after which update. It links the earlier report of the same problem and
ranks the bug before the release gate.

**Today:** filing, routing, fields, links, boards (`naima board bugs`),
`naima summary`, rewriting a description (`naima describe`) and adding a
dated comment (`naima note`).

### Planning

Above single fixes are the things that keep long work coherent.
[Epics](guide/glossary.md#epic) group features and todos,
[milestones](guide/glossary.md#milestone) are gates with a date,
[requirements](guide/glossary.md#requirement) say what must hold, and
[specifications](guide/glossary.md#specification) say exactly how. Each of
these is meant to be an item, so that a requirement is tracked and proven
like a test instead of just being implied by one.

**Example.** Epic: "Offline mode". Features: "save drafts without a
connection", "sync when back online". Requirement: "no edit made offline is
ever lost". Milestone: "beta by 15 November".

**Today:** features (`requested`, `planned`, `shipped`, `withdrawn`) and
todos are item types, and so are requirements, specifications and the
owner's decisions ([planning with them](guide/plan-with-requirements-specs-and-decisions.md)).
Epics group items, and a milestone is a gate with a date
([plan with epics, milestones and gates](guide/plan-with-epics-milestones-and-gates.md)).

### Gates and the queue

A [gate](guide/glossary.md#gate) is what a release waits on. The
[queue](guide/glossary.md#queue) is everything still blocking a gate, split
by who has to deal with it: an agent, you, or a build machine.

**Example.** Gate `v1` holds three items. `naima gates v1 --check` fails
while any of them is open, so a release can't slip through.
`naima queue v1 --human` shows the one that needs you: "looks right on a
phone (judgement)".

**Today:** gates declared in `naima-tracker/naima-data/naima.json`, which
wait on code or on proof, and `naima gates`, `naima queue` and
`naima queue --human`
([read the board, the queue and the gates](guide/read-the-board.md)). A gate
on the project's metrics is the `metrics` gate
([metrics and budgets](guide/metrics-and-budgets.md#as-a-gate)).

### Process management over the long run

The work goes on longer than any one session or any one agent. Each session
leaves a note, each agent says what it is working on, and each one works in
its own [worktree](guide/glossary.md#worktree). A new agent next month picks
up where the last one stopped, by reading files rather than relying on
memory.

- **Session notes:** `naima pass "what changed, what is proven, what is
  left"` writes `naima-data/passes/<date>-<id>.md`.
- **Claim files:** `naima claim <item> --note "why"` writes
  `naima-data/claims/<id>.json`, and `naima release <item>` removes it.
  `naima prune` finds [claim files](guide/glossary.md#claim-file) whose
  branch is gone.
- **Worktrees:** there is one per piece of work, on its own branch
  ([opening a worktree](agents/opening-a-worktree.md)).

**Example.** Two agents work at the same time, one on the sync code and one
on the settings screen. `naima claims` shows who holds what. Neither can
overwrite the other's work, because they write in separate copies and Naima
never has two sessions edit the same file.

**Today:** session notes, claim files, the worktree flows, and a check that
a claim file names items that exist. There is also one naming scheme for
worktrees and branches. `naima open` makes the worktree, the branch and the
claim in one step, and a check fails when a worktree doesn't follow the
scheme or holds work without a claim. A working method keeps the agents going
until only your items are left
([while you are away](guide/while-you-are-away.md)).

### Decisions

Anything only you can decide is asked once, one question at a time, with a
recommendation, and your answer is recorded. Once you have given a
permission, it stays given.

**Example.** You decide "the app works offline first; the web version can
wait". That decision is recorded with its reason, so no agent asks it again,
and a later agent reads it before planning.

**Today:** the rules for asking are written down
([asking the human](agents/asking-the-human.md)). An agent asks only for a
judgement, a decision, a credential such as a password, or a physical act,
and a permission already settled stays settled. Work handed to you must say
why (`humanBecause`, checked by `naima check`). Each answer is recorded as a
decision item, and agents search these with `naima decisions` before asking
anything, so not asking the same question twice is checked rather than left
to memory
([decisions](guide/plan-with-requirements-specs-and-decisions.md#decisions-asked-once-never-again)).

### Rules

The project's own [rules](guide/glossary.md#rule) are data. Each one is an
item holding the rule and its reason, who it binds (agents, people, or
everyone) and how strongly (`must` or `should`). When a program can enforce a
rule, the rule names that [check](guide/glossary.md#check).

**Example.** Your working style becomes a rule:
`naima new rules "Ask before deleting" --set audience=agents --set strength=must`,
with "what cannot be undone is the owner's decision" as its reason. Every
agent reads it when it starts, with `naima rules --audience agents`.

**Today:** rules as items, `naima rules`, `naima guide` printing them first,
`enforcedBy` naming the check, and `naima check` holding the tracker to its
rules like a test suite ([write a project rule](guide/write-a-project-rule.md),
[the rules every project holds to](guide/rules.md)).

### Evidence, proof and formal methods

Every [claim](guide/glossary.md#claim) carries
[evidence](guide/glossary.md#evidence), which is kept in the item's
`attachments/`. Being fixed isn't the same as being done. An item closes only
when something that proves it has passed, and a
[proof](guide/glossary.md#proof) only counts for what it was run on.

- **Red, then green.** A test must fail on the old work and pass on the new.
  A test that passes either way proves nothing.
- **Proofs expire.** If the thing a proof was about changes, the proof stops
  counting until it is run again.
- **Formal properties are tracked like tests.** A
  [model checker](guide/glossary.md#model-checker) is a tool that checks a
  design over every possible order of events and, when the design is wrong,
  prints the exact steps that break it. In Naima a
  [property](guide/glossary.md#property) is an item, and it can be proven
  only by running a [verifier](guide/glossary.md#verifier).
  `naima verify <property>` attaches the run, while
  `naima set <property> status=holds` is refused.

**Example.** Two agents claim work at the same moment on two branches. Could
one claim file wipe out the other when the branches merge? Naima's design
says no, because each claim is its own file. An mCRL2 model of this
coordination protocol (claim, release, merge) states the property "no claim
is ever lost". mCRL2 is a toolset for modelling and verifying systems in
which many things happen at once, and its tools check the property for every
order of steps. The property is an item, tracked like a test. If anyone edits
the model, `naima check` reports the property as no longer proven, and
`naima close` won't rely on it until it is run again.

**Today:** evidence in `attachments/`, `naima close` refusing without a
passed proof, properties, `naima verify`, `naima verifiers`, and expiry when
the model changes. A test also names its place in the evidence ranking in
`evidenceKind`, and a regression test's red run is recorded in `redSeen`,
each with a check that notes when it is missing
([prove and close](guide/prove-and-close.md)). The mCRL2
verifier ships, while the mCRL2 model of the claims above is
[planned](planned.md#model-checkers-and-the-strength-of-evidence).

### Metrics

Metrics are numbers measured on every commit (each saved change), such as
speed, quality or test coverage. Each one is a name and the command that
measures it. It is printed with the number it is compared to, shown as a
trend, and can be used as a gate.
**Example:** "the tests must still run in under ten minutes" becomes a budget
of 600 seconds, and a release waits if the tests get slower than that.

**Today:** `naima metrics run --record`, budgets, floors and baselines, and a
ratchet that only lets a number improve. Code-quality metrics are built in
(complexity, duplication, coverage and more) and shown beside the tests. Past
commits can be backfilled, and the trend can be shown as text, a table or a
chart over the commit timeline
([metrics and budgets](guide/metrics-and-budgets.md)).

### Structuring a project from the start (planned)

This would be an epic of its own for the first decisions, the ones that
decide whether the work can still grow in two years: which language or
languages to use, how to split everything into small independent parts, and
how to keep logic separate from data.
**Example:** before the first line of an app is written, the agent proposes
one language, small parts that can each be tested alone, and settings kept
as data rather than in the code. You decide, and the choices become rules
([planned](planned.md#structuring-a-project-from-the-start)).

### Design, skills and a dashboard (planned)

This covers support for planning and checking what users see, items and
flows that point to a [skill](guide/glossary.md#skill) published on GitHub
instead of copying it, and a visual page of the project's state
([planned](planned.md#design-skills-and-a-dashboard)).

### Commands for every action

Every action an agent takes on an item has a command, so each one is
recorded the same way and can be checked. The commands are `new`, `set`,
`move`, `link`, `describe`, `note`, `attach`, `triage set`, `claim`,
`release`, `pass`, `verify`, `close` and `check`. `naima help` lists them
all, and the [reference](reference/reference.md) documents each one.

## The company and its roles

Each job has things it refuses to do, so that nobody ends up checking their
own work. Sorting, building, testing and judging are done by different
agents ([the coordinator and the workers](agents/coordinator-and-workers.md)).

| Job | Who | Refuses | Today |
|---|---|---|---|
| **Owner** | you | any machine work; is asked only for judgement, a decision, a credential or a physical act | exists |
| **Coordinator** — talks to you, starts workers, merges | agent | doing a worker's job; more than one question at a time | written practice |
| **Filer** — turns what was said into the right item | agent | inventing scope; deciding if something is proven | written practice |
| **Implementer** — does the work for one item (code, analysis, text) | agent | widening the task; touching the main branch | written practice |
| **Lead developer** — ranks the queue, runs the gates, merges | agent | merging without the gates; closing its own items | exists; "never close your own" is a check |
| **Tester** — performs the tests, writes down what happened | agent, or a person with a reason | fixing what it finds; testing what it wrote | written practice |
| **Evidence owner** — judges whether evidence proves the claim | agent | performing the test it judges | written practice |
| **Release manager** — proposes a release when the gates hold | agent | releasing on an open gate; deciding to release | written practice; a release marked done with a stage unrecorded is refused |
| **Documentarian** — writes the docs with the feature | agent | marking a feature shipped without its pages | written practice; the rule is a check |
| **Announcer** — release notes, changelog, site, announcements | agent | announcing anything not shipped and checked | exists: `naima announce` computes what may be announced; the README naming anything else is a check |
| **Business** — options for licence, funding, sponsorship, adoption | agent proposes, you decide | committing the project to anything | written practice |

"Written practice" means that the job and what it refuses are written down in
[the pages for agents](agents/README.md) and the agents follow them, but no
program stops a breach. Every role is also data. `naima roles` lists each
role with what it owns and refuses, and `naima queue --role <role>` shows its
queue.

## Principles

- **Privacy.** Your chat with an agent is private. Nothing from it is copied
  into the repository unless you explicitly say so. A screenshot or file you
  shared becomes an attachment only after you have explicitly said yes
  ([the rule](guide/rules.md#the-owners-chat-stays-private)).
- **Extensible by data.** Everything beyond a small core is a
  [plugin](guide/glossary.md#plugin), including item types, fields, checks,
  gates and verifiers ([add a plugin someone gave you](guide/add-a-plugin.md)).
  Extensions are plain data, not class hierarchies. The core stays fixed, and
  everything else is free to change, so Naima can keep being extended.
- **Iterate, don't overthink.** Use the simplest design that works now, and
  improve it version by version (the design principles are kept with Naima's
  requirements in its workshop).
- **Any agent, any model.** Naima is a command-line program over files and
  git, so any agent that can run a command can use it, on any model. Nothing
  in it assumes one tool: what is particular to a tool is in that tool's
  adapter, and a project names the tools it uses in its own configuration
  ([the rule](guide/rules.md#naima-is-tied-to-no-agent-tool-or-model)).
- **Plain language.** Every term is defined once, in the
  [glossary](guide/glossary.md). Reports to you say what changed and what is
  needed from you, and nothing else.

## One example, start to finish

You type in chat **"the export loses transparency"**, meaning that saved
pictures get a solid background. [The tutorial](guide/tutorial.md) shows the
real commands for the same path, with their output.

1. **Filed.** `naima new bugs "Export drops the alpha channel"` creates the
   item folder with `README.md`, `meta.json` and `attachments/`.
2. **Triaged by an agent.** The agent writes the description in its own
   words, checks for duplicates, and runs `naima triage set export-drops
   impact=high priority=now confidence=measured`.
3. **Claimed, in a worktree.** A worker agent runs `naima open export-drops
   --as worker --name export-alpha`, which makes a worktree on the branch
   `worker/export-alpha` with the claim written in it.
4. **Fixed, with a proof.** The worker fixes the exporter and writes the test
   as its own item, with `naima new tests "Export keeps the alpha channel"
   --set runBy=agent` and `naima link export-keeps verifies export-drops`.
   The test fails on the old code and passes on the new.
5. **Evidence attached.** `naima attach export-keeps run.txt --own` puts the
   test's output in its `attachments/`, and then
   `naima set export-keeps status=passed`.
6. **Gate and handover.** The gates run, and `naima release export-drops`
   and `naima pass "..."` record the end of the session. The coordinator then
   lands the branch with `naima land`, which makes one merge commit naming
   the item it closes. It refuses a branch that isn't up to date rather than
   overwrite anything.
7. **Closed by someone else.** From the main branch, `naima close
   export-drops` moves the item to `naima-data/closed/` with its proof. It
   refuses to run from the fixer's own branch, and refuses without a passed
   proof.

**The same, vibe-coded.** The AI edits the exporter and says "Fixed!".
Nothing is written down or run. The edit broke PDF export and no test
noticed. The next session has no memory of any of this and brings the bug
back, and a parallel session overwrites the same file. Weeks later you
describe the bug again from scratch, and nobody can say what happened.

## Beyond software: any project

Naima was born for software, and the item types built in today (bugs, todos,
features, tests) are shaped for it. `naima types` lists them. The same way of
working fits any long-lived work kept in versions, or several kinds of work in
one project. That means writing the work down, having evidence for every
claim, recording decisions, and passing gates before anything goes out. What
changes is the practice that produces the evidence. Software's tests and
formal verification are replaced by that work's own ways of testing and
measuring, and Naima can be developed further, alone or together with the
project, to hold them.

- **A scientific data analysis** is checked by reproducible runs. "Figure 3
  uses last year's data" is a bug, "every number in table 2 comes from the
  raw data by a script" is a requirement, and "the analysis must still run in
  under ten minutes" is a metric.
- **A paper written with colleagues** is checked by reviews. A co-author's
  "section 4 contradicts the abstract" is a bug, ranked before the
  submission gate, and "the paper targets the journal, not the conference"
  is a decision, asked once.
- **A plan** is checked by the decisions and gates it has to pass.

**Today:** the built-in types already fit most of this, and a project can
add its own types, checks and gates with a [plugin](guide/add-a-plugin.md)
([extending Naima](guide/extending-naima.md)). One pack of item types for
other work ships as a worked example. It is `pack-analyses`, with an
`analyses` type proven by a reproducible run rather than by code
([a worked example](guide/extending-naima.md#a-worked-example-adopting-naima-for-a-data-analysis)).
A pack for a paper's sections and reviews is
[planned](planned.md#item-types-for-other-work).

## What exists today

This list has been checked against the commands of this version
(`naima help`, `naima types`).

- Items as folders (`README.md`, `meta.json`, `attachments/`) under
  `naima-tracker/naima-data/`, with the types bugs, todos, features, tests,
  properties and rules (`naima types`).
- Reporting and triage: `naima new`, `link`, `triage set`, `board`, `summary`.
- Fixed, proven and closed as three separate states, with `naima close`
  refusing without proof or from the fixer's branch.
- Gates and the queue: `naima gates`, `naima gates <name> --check`,
  `naima queue --human`.
- Long-running work: claim files, session notes, worktree flows, `naima prune`.
- Rules as items: `naima rules`, `naima guide`, `naima check`.
- Properties and verifiers with expiring proofs; only an example verifier.
- The roles from Owner to Business, written in
  [the pages for agents](agents/README.md) and also kept as data:
  `naima roles`, `naima queue --role <role>`.
- Announcing only what is true: `naima announce`, and a check on the README.
- Plugins for everything beyond the core, and an installer that installs Deno.
- Naima tracks its own development the same way.

Everything that doesn't exist yet is listed on one page, [planned](planned.md).
