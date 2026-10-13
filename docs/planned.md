# Planned

Everything the documentation describes that Naima does not do yet, in one
place. Every other page says "planned" in one phrase and links here. Nothing
on this page exists in this version: `naima help` and `naima types` list
what does, and [what Naima is for](purpose.md#what-exists-today) sums it up.

Each entry says what it is, what you can do today instead, and an example.
The order is the order of the work: the first entries come first.

## Metrics

- **Code-quality metrics side by side with tests**: measures of the code
  itself, read next to the test results, so a change that passes its tests
  but makes the code harder to maintain is seen.
- **Metrics measured on every commit without anyone asking**: a commit hook
  that runs them and records the numbers, and a trend drawn as a chart on a
  dashboard.
- **Today:** `naima metrics run --record` runs the project's metrics when
  asked, records them per commit, holds each to a budget, a floor or a
  baseline, and `naima metrics trend` draws the trend as text
  ([metrics and budgets](guide/metrics-and-budgets.md)).

## Model checkers and the strength of evidence

- **VoxLogicA 2 as a verifier**: the shipped VoxLogicA adapter runs the 1.x
  releases.
- **The mCRL2 model of Naima's own claims** ("no claim is ever lost") as a
  property in Naima's own tracker.
- **Red-then-green shown by the run itself**: the failing run on the old work
  attached and checked, not only its day recorded in `redSeen`.
- **A Storm verifier**: Storm is installed by `naima tools install storm`
  ([tools](guide/tools.md)), but no verifier runs it yet; on Windows, reaching
  it through a Linux environment is not built.
- **Today:** properties, `naima verify` and expiring proofs work, with the
  mCRL2 and VoxLogicA verifiers and an example one
  ([prove and close](guide/prove-and-close.md#two-model-checkers-mcrl2-and-voxlogica)).
  The evidence ranking (`evidenceKind`) and the red-then-green record
  (`redSeen`) are tracker fields, with checks that note their absence
  ([prove and close](guide/prove-and-close.md#3-perform-it-keep-the-evidence)).

## Structuring a project from the start

An [epic](guide/glossary.md#epic) of its own for the first decisions: which
language or languages, splitting the work into small independent parts,
keeping logic separate from data. Example: data in plain files, one script per
table, no number typed by hand into the paper. **Today:** the checklist is
written down and the commands to run it exist — epics to group the choices,
decisions to record each answer once
([structuring a project from the start](guide/structuring-a-project.md)) —
and the agent proposes these choices in chat; what is missing is an agent
running the checklist on its own, unprompted, at a project's first commit.

## Design, skills and a dashboard

- **Designing what users see**: support for planning and checking a user
  interface.
- **Skills from GitHub**: a project points its agent instructions at a skill
  published in someone else's repository instead of copying its file in,
  consistent with how Naima itself is pinned — `source` (a git repository)
  and `commit` (a full commit of it) in `naima.json`, with `naima update`
  moving the pin forward on request, never silently. A skill pinned this way
  would carry the same two fields, under a `skills` key of its own, and the
  agent would read it from a checkout of that pin the same way it reads
  [the Naima skill](agents/skill.md) from the clone in `naima-tracker/naima/`,
  rather than from a second copy kept in the project.
- **A dashboard**: a visual page of the project's state — boards, gates, the
  ranked queue, claims and notes across branches, the evidence attached to
  each item, in a look of its own. **Today:** `naima ui` opens a window whose
  first screen shows the summary, the gates, what is next and the claims
  across branches, with the boards, the metrics, the timeline, the coverage,
  the session notes across branches and each item with its evidence as tabs,
  and plugins can add panels and tabs beside them; the look is plain; and
  `naima summary --markdown` prints the state as text you can paste anywhere.

## A pointer in the agent's instruction file

`naima init` offering, when asked, to add one line to the project's agent
instruction file (such as `AGENTS.md` or `CLAUDE.md`) pointing at the
[skill](agents/skill.md). **Today:** the installer's instructions tell the
agent to do it ([working with AI agents](guide/working-with-agents.md#get-an-agent-going)).

## Blocking a landing that is not a marker

An opt-in git hook (`reference-transaction`) that refuses any move of the
trunk not made by `naima land`, for a project that wants a landing blocked
rather than noted. Never the default: landing by hand or with a hosting
platform's merge button stays allowed. **Today:** the check
`landings-are-markers` notes, from the first marker on the trunk's
first-parent line, every commit there that is not a
[marker](guide/glossary.md#marker)
([the rule](guide/rules.md#every-landing-is-a-marker-naming-the-items-it-closes)).

## Item types for other work

Naima is born for software; these are packs of item types for other work
([beyond software](purpose.md#beyond-software-any-project)): sections and
reviews of a paper, next.
**Today:** bugs, todos, features and tests fit most of this already ("figure
3 uses last year's data" is a bug), and a project can add its own types with
a [plugin](guide/add-a-plugin.md). Experiments and analyses whose evidence is
a reproducible run ship as a worked example, `pack-analyses`
([extending Naima](guide/extending-naima.md#a-worked-example-adopting-naima-for-a-data-analysis)).
