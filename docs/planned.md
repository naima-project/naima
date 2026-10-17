# Planned

This page collects everything the documentation describes that Naima doesn't
do yet. The other pages mention a planned feature in one phrase and link
here. Nothing on this page exists in this version. To see what does exist,
`naima help` and `naima types` list it, and
[what Naima is for](purpose.md#what-exists-today) sums it up.

Each entry says what the feature is, what you can do today instead, and gives
an example. The entries are in the order the work will be done, so the first
ones come first.

## Metrics

- **Code-quality metrics side by side with tests**: measures of the code
  itself, read next to the test results, so that you can see when a change
  passes its tests but makes the code harder to maintain.
- **Metrics measured on every commit without anyone asking**: a commit hook
  that runs them and records the numbers, and a trend drawn as a chart on a
  dashboard.
- **Today:** `naima metrics run --record` runs the project's metrics when
  asked and records them per commit. It holds each one to a budget, a floor or
  a baseline, and `naima metrics trend` draws the trend as text
  ([metrics and budgets](guide/metrics-and-budgets.md)).

## Model checkers and the strength of evidence

- **VoxLogicA 2 as a verifier**: the VoxLogicA adapter that ships today runs
  the 1.x releases.
- **The mCRL2 model of Naima's own claims** ("no claim is ever lost") as a
  property in Naima's own tracker.
- **Red-then-green shown by the run itself**: the failing run on the old work
  would be attached and checked, instead of only its day being recorded in
  `redSeen`. Properties already work this way
  ([proving a change to a model](guide/prove-and-close.md#proving-a-change-to-a-model)).
- **Tiers for proofs beyond the landing**: a landing that waits for, or is
  refused on, properties that are not current, where today `naima land` only
  lists them; long suites run nightly or weekly on a declared host, a failure
  filed as a bug; and a release gate that runs the full suite, reusing every
  unchanged result.
- **A refactoring of a model proved by equivalence**: the old and new state
  spaces compared, so every earlier result carries over without a run.
- **A Storm verifier**: `naima tools install storm` installs Storm
  ([tools](guide/tools.md)), but no verifier runs it yet. On Windows, reaching
  it through a Linux environment isn't built either.
- **Today:** properties, `naima verify` and expiring proofs work, with the
  mCRL2 and VoxLogicA verifiers and an example one
  ([prove and close](guide/prove-and-close.md#two-model-checkers-mcrl2-and-voxlogica)).
  The evidence ranking (`evidenceKind`) and the red-then-green record
  (`redSeen`) are tracker fields, and there are checks that note when they
  are missing
  ([prove and close](guide/prove-and-close.md#3-perform-it-keep-the-evidence)).

## Structuring a project from the start

This would be an [epic](guide/glossary.md#epic) of its own for the first
decisions on a project: which language or languages to use, how to split the
work into small independent parts, and how to keep logic separate from data.
For example, the data would live in plain files, there would be one script
per table, and no number would be typed by hand into the paper.

**Today:** the checklist is written down, and the commands to work through it
exist. Epics group the choices, and decisions record each answer once
([structuring a project from the start](guide/structuring-a-project.md)).
The agent proposes these choices in chat. What is missing is an agent that
runs the checklist on its own, without being prompted, at a project's first
commit.

## Design, skills and a dashboard

- **Designing what users see**: support for planning and checking a user
  interface.
- **Skills from GitHub**: a project would point its agent instructions at a
  skill published in someone else's repository, instead of copying the
  skill's file in. This would work the same way Naima itself is pinned, which
  is by `source` (a git repository) and `commit` (a full commit of it) in
  `naima.json`, with `naima update` moving the pin forward when asked and
  never silently. A skill pinned this way would carry the same two fields,
  under a `skills` key of its own. The agent would read it from a checkout of
  that pin, just as it reads [the Naima skill](agents/skill.md) from the
  clone in `naima-tracker/naima/`, rather than from a second copy kept in the
  project.
- **A dashboard**: a visual page of the project's state, with a look of its
  own, showing the boards, the gates, the ranked queue, claims and notes
  across branches, and the evidence attached to each item. **Today:**
  `naima ui` opens a window. Its first screen shows the summary, the gates,
  what is next and the claims across branches. The boards, the metrics, the
  timeline, the coverage, the session notes across branches, and each item
  with its evidence are tabs, and plugins can add panels and tabs beside them.
  The look is plain. `naima summary --markdown` also prints the state as text
  you can paste anywhere.

## A pointer in the agent's instruction file

`naima init` would offer, when asked, to add one line to the project's agent
instruction file (such as `AGENTS.md` or `CLAUDE.md`) pointing at the
[skill](agents/skill.md). **Today:** the installer's instructions tell the
agent to add that line ([working with AI agents](guide/working-with-agents.md#get-an-agent-going)).

## Blocking a landing that is not a marker

This would be an opt-in git hook (`reference-transaction`) that refuses any
move of the trunk not made by `naima land`, for a project that wants such a
landing blocked rather than just noted. It would never be the default, so
landing by hand or with a hosting platform's merge button stays allowed.
**Today:** the check `landings-are-markers` looks at the trunk's
first-parent line, starting from the first marker on it, and notes every
commit there that is not a [marker](guide/glossary.md#marker)
([the rule](guide/rules.md#every-landing-is-a-marker-naming-the-items-it-closes)).

## Item types for other work

Naima was born for software. These would be packs of item types for other
kinds of work ([beyond software](purpose.md#beyond-software-any-project)),
and the next one is for the sections and reviews of a paper.
**Today:** bugs, todos, features and tests already fit most of this ("figure
3 uses last year's data" is a bug), and a project can add its own types with
a [plugin](guide/add-a-plugin.md). Experiments and analyses whose evidence is
a reproducible run ship as a worked example, `pack-analyses`
([extending Naima](guide/extending-naima.md#a-worked-example-adopting-naima-for-a-data-analysis)).
