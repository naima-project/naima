# What Naima is for

Read this first. Every other page explains how a piece works; this one says
what Naima is, what it manages for you, and what it does not do yet. Each
term links, the first time it appears, to its one definition in the
[glossary](guide/glossary.md). "[Planned](planned.md)" means Naima does not
have it yet.

## What Naima is

**Born for software.** Naima is a silent software house: a team of AI
[agents](guide/glossary.md#agent) that builds software for you the way a
good engineering company would. It turns vibe coding, asking an AI to build
software and hoping it worked, into an exact science. Vibe coding leaves work
unverified, unrecorded, unrepeatable, uncoordinated and roleless; Naima
replaces each with its opposite. The same request goes
through industry-grade practice: written requirements, tests, metrics,
reviews, and [gates](guide/glossary.md#gate) before anything ships. And it
is built for [formal methods](guide/glossary.md#formal-methods), tools that
check a design mathematically: a property of the design is tracked and
proven like a test, and state-of-the-art model checkers (such as mCRL2) as
the tools that prove it are [planned](planned.md#model-checkers-and-the-strength-of-evidence).
You do not need to know any of this: the agents apply it for you, and record
what they did, so that what gets built is robust, maintainable and solid.
[One example, start to finish](#one-example-start-to-finish) shows the
difference.

**An enabling technology for people who are not coders.** Software
engineering and formal methods are usually out of reach for anyone who is
not a specialist. Naima puts them in the hands of experts in their own
field, who are not remotely programmers: a domain expert who has never
programmed can build serious software this way, and get excellent results
from AI agents.

**A decision support system.** Used through an AI agent, Naima is a tool for
running long-lived work and making informed decisions about it. It is for
the [owner](guide/glossary.md#owner), the person whose work it is. You say in
plain words what you want or what is wrong. Agents do the machine work: they
write it down, plan it, carry it out, check it and keep the proof. When the
agents can go ahead on their own, they do, and you hear nothing. When
something is yours to decide, Naima helps you understand it in your own
terms and your own words, not a technician's. `naima queue --human` lists
what is waiting for you, each item with the reason it is yours
([asking the human](agents/asking-the-human.md)).

**The company behind the conversation.** The agents have separate jobs:
engineering, testing, judging evidence, releasing, documenting, announcing,
even the business side. The agents do the work; you only decide. The jobs
are listed in [their own section](#the-company-and-its-roles) below.

**Then, any project.** The same discipline manages any long-lived work kept
in versions, such as a scientific data analysis or a paper written with
colleagues, by swapping software's practices for that work's own forms of
testing and measurement: [beyond software](#beyond-software-any-project)
below.

**What you need, and how it stays out of your way.** You need no knowledge
of git, code, Deno or Node (the programs Naima runs on), or professional
project management. You need an AI agent. The agent installs what is missing:
git, and Deno (the installer does it: [install](guide/install.md)). Naima
lives inside the project's [repository](guide/glossary.md#repository), the
folder in which git keeps every version of the work. It uses one folder
there, `naima-tracker/`, and changes nothing outside it. It needs no server,
no account and no internet connection. You never have to open one of its
files or learn one of its commands; the agents do that, and git too
([git, handled for you](agents/git-for-the-owner.md)). The commands below are
what they type; `naima` is short for `deno run -A naima-tracker/naima/naima.ts`.

## What Naima manages

How each of these runs, step by step, is on
[how the project runs](guide/how-the-project-runs.md).

### Reporting and issue management

Whatever you notice reaches the project, and nothing said is lost. You can
report in chat ("the save button does nothing"), correct a report later, or, if you
are comfortable with files, write the [item](guide/glossary.md#item)
yourself. The [flow](guide/glossary.md#flow) is always the same: report →
file → triage → claim → work → prove → close.

- **Filed first.** The agent writes the report down before anyone works on
  it: `naima new bugs "Save button does nothing on a phone"` creates a folder for
  it under `naima-tracker/naima-data/bugs/`.
- **Routed by kind.** "This is broken" is a [bug](guide/glossary.md#bug),
  "this needs doing" is a [todo](guide/glossary.md#todo), "I'd like it to do
  X" is a [feature](guide/glossary.md#feature)
  ([reporting and triage](agents/reporting-and-triage.md)).
- **Triaged by an agent.** It rewrites the report in its own words as a clear
  description (what happens, what should happen, how to see it), notes what
  it checked, links duplicates (`naima link <new> duplicate-of <old>`) and
  sets the fields (`naima triage set <item> impact=high priority=now
  confidence=measured`). How long it will take (`effort`) is set only after
  someone has looked at the work, never guessed.

**Example.** A user says in chat "the app loses my settings after an
update". The agent files a bug, writes which settings are lost and on which
update, links the earlier report of the same problem, and ranks it before
the release gate.

**Today:** filing, routing, fields, links, boards (`naima board bugs`),
`naima summary`, rewriting a description (`naima describe`) and adding a
dated comment (`naima note`).

### Planning

Above single fixes sit the things that keep long work coherent:
[epics](guide/glossary.md#epic) that group features and todos,
[milestones](guide/glossary.md#milestone) (a gate with a date),
[requirements](guide/glossary.md#requirement) that say what must hold, and
[specifications](guide/glossary.md#specification) that say exactly how. Each
is meant to be an item, so a requirement is tracked and proven like a test,
not just implied by one.

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
by whose hands it needs: an agent's, yours, or a build machine's.

**Example.** Gate `v1` holds three items. `naima gates v1 --check` fails
while any is open, so a release cannot slip through. `naima queue v1
--human` shows the one that needs you: "looks right on a phone (judgement)".

**Today:** gates declared in `naima-tracker/naima-data/naima.json`, waiting
on code or on proof; `naima gates`, `naima queue`, `naima queue --human`
([read the board, the queue and the gates](guide/read-the-board.md)). A gate
on the project's metrics is the `metrics` gate
([metrics and budgets](guide/metrics-and-budgets.md#as-a-gate)).

### Process management over the long run

The work outlives any one session and any one agent. Each session leaves a
note; each agent says what it is working on; each works in its own
[worktree](guide/glossary.md#worktree). A new agent next month picks up where
the last one stopped, from files, not from memory.

- **Session notes:** `naima pass "what changed, what is proven, what is
  left"` writes `naima-data/passes/<date>-<id>.md`.
- **Claim files:** `naima claim <item> --note "why"` writes
  `naima-data/claims/<id>.json`; `naima release <item>` removes it; `naima
  prune` finds [claim files](guide/glossary.md#claim-file) whose branch is gone.
- **Worktrees:** one per piece of work, on its own branch
  ([opening a worktree](agents/opening-a-worktree.md)).

**Example.** Two agents work at once, one on the sync code, one on the
settings screen. `naima claims` shows who holds what. Neither can overwrite
the other: they write in separate copies, and Naima never has two sessions
edit the same file.

**Today:** session notes, claim files, the worktree flows, a check that a
claim file names items that exist, and one naming scheme for worktrees and
branches — `naima open` makes the worktree, the branch and the claim in one
step, and a check fails a worktree off the scheme or holding work without a
claim. A working method keeps going until only your items are left
([while you are away](guide/while-you-are-away.md)).

### Decisions

What only you can decide is asked once, with a recommendation, one question
at a time, and recorded. A permission you gave stays given.

**Example.** You decide "the app works offline first; the web version can wait".
That is recorded with its reason; no agent asks it again, and a later agent
reads it before planning.

**Today:** the rules for asking are written
([asking the human](agents/asking-the-human.md): only for judgement, a
decision, a credential such as a password, or a physical act; a settled
permission stays settled), and work handed to you must say why
(`humanBecause`, checked by `naima check`). Each answer is recorded as a
decision item, searched with `naima decisions` before any question, so "never
asked twice" is checked rather than remembered
([decisions](guide/plan-with-requirements-specs-and-decisions.md#decisions-asked-once-never-again)).

### Rules

The project's own [rules](guide/glossary.md#rule) are data: each is an item
with the rule and its reason, who it binds (agents, people, everyone) and how
strongly (`must` or `should`). Where a program can enforce one, it names the
[check](guide/glossary.md#check).

**Example.** Your working style becomes a rule: `naima new rules "Ask before
deleting" --set audience=agents --set strength=must`, with "what cannot be
undone is the owner's decision" as its reason. Every agent reads it at the
start: `naima rules --audience agents`.

**Today:** rules as items, `naima rules`, `naima guide` printing them first,
`enforcedBy` naming the check, `naima check` holding the tracker to its
rules like a test suite ([write a project rule](guide/write-a-project-rule.md),
[the rules every project holds to](guide/rules.md)).

### Evidence, proof and formal methods

Every [claim](guide/glossary.md#claim) carries
[evidence](guide/glossary.md#evidence), kept in the item's `attachments/`.
"Fixed" is not "done": an item closes only when something that proves it has
passed, and a [proof](guide/glossary.md#proof) counts only for what it was
run on.

- **Red, then green.** A test must fail on the old work and pass on the new;
  one that passes either way proves nothing.
- **Proofs expire.** If what a proof was about changes, the proof stops
  counting until it is run again.
- **Formal properties are tracked like tests.** A
  [model checker](guide/glossary.md#model-checker) is a tool that checks a
  design over every possible order of events and, when the design is wrong,
  prints the exact steps that break it. In Naima a
  [property](guide/glossary.md#property) is an item, proven only by running a
  [verifier](guide/glossary.md#verifier): `naima verify <property>` attaches
  the run; `naima set <property> status=holds` is refused.

**Example.** Two agents claim work at the same moment on two branches. Can
one claim file wipe out the other when they merge? Naima's design says no:
each claim is its own file. An mCRL2 model of this coordination protocol
(claim, release, merge) states the property "no claim is ever lost". mCRL2
is a toolset for modelling and verifying systems in which many things happen
at once; its tools check the property for every order of steps. The property
is an item, tracked like a test. If anyone edits the model, `naima check`
reports the property as no longer proven and `naima close` will not rely on
it until it is run again.

**Today:** evidence in `attachments/`, `naima close` refusing without a
passed proof, properties, `naima verify`, `naima verifiers`, expiry when the
model changes, the evidence ranking a test names in `evidenceKind`, and a
regression test's red run recorded in `redSeen`, each with a check that notes
its absence ([prove and close](guide/prove-and-close.md)). The mCRL2 and
VoxLogicA verifiers ship; the mCRL2 model of the claims above is
[planned](planned.md#model-checkers-and-the-strength-of-evidence).

### Metrics

Numbers measured per commit (each saved change): speed, quality, test
coverage, each a name and the command that measures it, printed with the
number it is compared to, shown as a trend, and usable as a gate.
**Example:** "the tests must still run in under ten minutes": a budget of
600 seconds, and a release waits if they get slower.

**Today:** `naima metrics run --record`, budgets, floors and baselines, a
ratchet that only lets a number improve, code-quality metrics built in
(complexity, duplication, coverage and more) shown beside the tests, a
backfill of past commits, and the trend as text, a table or a chart over the
commit timeline ([metrics and budgets](guide/metrics-and-budgets.md)).

### Structuring a project from the start (planned)

An epic of its own for the first decisions that decide whether work can
still grow in two years: which language or languages to use, splitting
everything into small independent parts, keeping logic separate from data.
**Example:** before the first line of an app, the agent proposes one
language, small parts that can each be tested alone, and settings kept as
data rather than in the code; you decide, and the choices become rules
([planned](planned.md#structuring-a-project-from-the-start)).

### Design, skills and a dashboard (planned)

Support for planning and checking what users see; items and flows that point
to a [skill](guide/glossary.md#skill) published on GitHub instead of copying
it; a visual page of the project's state
([planned](planned.md#design-skills-and-a-dashboard)).

### Commands for every action

Every action an agent takes on an item has a command, so each is recorded
the same way and can be checked. `new`, `set`, `move`, `link`, `describe`,
`note`, `attach`, `triage set`, `claim`, `release`, `pass`, `verify`,
`close`, `check` (`naima help` lists them all; the
[reference](reference/reference.md) documents each).

## The company and its roles

Each job refuses something, so no one marks their own homework. Who sorts,
who builds, who tests and who judges are different agents
([the coordinator and the workers](agents/coordinator-and-workers.md)).

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

"Written practice" means the job and its refusals are written in
[the pages for agents](agents/README.md) and agents follow them, but no
program stops a breach. Every role is also data — `naima roles` lists each with what it owns and
refuses, and `naima queue --role <role>` is its queue.

## Principles

- **Privacy.** Your chat with an agent is private. Nothing from it is copied
  into the repository unless you say so explicitly. A screenshot or file you
  shared becomes an attachment only after your explicit yes
  ([the rule](guide/rules.md#the-owners-chat-stays-private)).
- **Extensible forever, by data.** Everything beyond a small core is a
  [plugin](guide/glossary.md#plugin): item types, fields, checks, gates,
  verifiers ([add a plugin someone gave you](guide/add-a-plugin.md)).
  Extension is plain data, not class hierarchies. The core does not move; the
  rest is free to change.
- **Iterate, don't overthink.** The simplest design that works now, improved
  version by version (the design principles, kept with Naima's
  requirements in its workshop).
- **Plain language.** Every term is defined once, in the
  [glossary](guide/glossary.md), and reports to you say what changed and what
  is needed from you, nothing else.

## One example, start to finish

You type in chat: **"the export loses transparency"** (saved pictures get a
solid background). The real commands for the same path, with their output,
are in [the tutorial](guide/tutorial.md).

1. **Filed.** `naima new bugs "Export drops the alpha channel"` creates the
   item folder with `README.md`, `meta.json` and `attachments/`.
2. **Triaged by an agent.** It writes the description in its own words,
   checks for duplicates, and runs `naima triage set export-drops
   impact=high priority=now confidence=measured`.
3. **Claimed, in a worktree.** A worker agent runs `naima open export-drops
   --as worker --name export-alpha`: a worktree on the branch
   `worker/export-alpha`, with the claim written in it.
4. **Fixed, with a proof.** It fixes the exporter and writes the test as its
   own item: `naima new tests "Export keeps the alpha channel" --set
   runBy=agent` and `naima link export-keeps verifies export-drops`. The test
   fails on the old code and passes on the new.
5. **Evidence attached.** `naima attach export-keeps run.txt --own` puts the
   test's output in its `attachments/`; `naima set export-keeps status=passed`.
6. **Gate and handover.** The gates run; `naima release export-drops` and
   `naima pass "..."` record the end of the session; the branch is merged
   with `git merge --ff-only`, which refuses rather than overwrite anything.
7. **Closed by someone else.** From the main branch, `naima close
   export-drops` moves it to `naima-data/closed/` with its proof. It refuses
   from the fixer's own branch, and refuses without a passed proof.

**The same, vibe-coded.** The AI edits the exporter and says "Fixed!".
Nothing is written down or run. The edit broke PDF export and no test
noticed. The next session, with no memory, brings the bug back. A parallel
session overwrites the same file. Weeks later you describe the bug again
from scratch, and nobody can say what happened.

## Beyond software: any project

Naima was born for software, and today's built-in item types (bugs, todos,
features, tests) are shaped for it; `naima types` lists them. The same
discipline, work written down, evidence for every claim, decisions recorded,
gates before anything goes out, fits any long-lived work kept in versions,
or several kinds in one project. What changes is the practice that produces
the evidence: software's tests and formal verification are swapped for the
work's own forms of testing and measurement, and Naima can be evolved, or
co-evolved with the project, to hold them.

- **A scientific data analysis**, checked by reproducible runs. "Figure 3
  uses last year's data" is a bug; "every number in table 2 comes from the
  raw data by a script" is a requirement; "the analysis must still run in
  under ten minutes" is a metric.
- **A paper written with colleagues**, checked by reviews. A co-author's
  "section 4 contradicts the abstract" is a bug, ranked before the
  submission gate; "the paper targets the journal, not the conference" is a
  decision, asked once.
- **A plan**, checked by the decisions and gates it has to pass.

**Today:** the built-in types fit most of this already, and a project can
add its own types, checks and gates with a [plugin](guide/add-a-plugin.md)
([extending Naima](guide/extending-naima.md)). One pack of item types for
other work ships as a worked example: `pack-analyses`, an `analyses` type
proven by a reproducible run rather than code
([a worked example](guide/extending-naima.md#a-worked-example-adopting-naima-for-a-data-analysis)).
A pack for a paper's sections and reviews is
[planned](planned.md#item-types-for-other-work).

## What exists today

Checked against the commands of this version (`naima help`, `naima types`).

- Items as folders (`README.md`, `meta.json`, `attachments/`) under
  `naima-tracker/naima-data/`; types bugs, todos, features, tests,
  properties, rules (`naima types`).
- Reporting and triage: `naima new`, `link`, `triage set`, `board`, `summary`.
- Fixed, proven and closed as three separate states; `naima close` refusing
  without proof or from the fixer's branch.
- Gates and the queue: `naima gates`, `naima gates <name> --check`, `naima
  queue --human`.
- Long-running work: claim files, session notes, worktree flows, `naima prune`.
- Rules as items: `naima rules`, `naima guide`, `naima check`.
- Properties and verifiers with expiring proofs; only an example verifier.
- The roles from Owner to Business, written in
  [the pages for agents](agents/README.md), and as data: `naima roles`,
  `naima queue --role <role>`.
- Announcing only what is true: `naima announce`, and a check on the README.
- Plugins for everything beyond the core; an installer that installs Deno.
- Naima tracks its own development the same way.

What does not exist yet is on one page: [planned](planned.md).
