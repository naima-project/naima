# Prove and close

Saying that something is fixed is only a claim, so an [item](glossary.md#item)
is closed only once something proves the fix
([three states](rules.md#fixed-resolved-and-closed-are-three-states)). This
page goes through the steps one by one, and [the tutorial](tutorial.md#6-fix-it)
shows the whole path run for real. The agents run these commands for you,
unless you want to run them yourself.

## 1. Mark it fixed

Once the change has been made, the item is marked fixed.

```sh
naima set export-drops fixedOn=2026-10-01
```

The item is now [fixed](glossary.md#fixed), and `naima check` notes that
nothing verifies it yet.

## 2. Write the gesture as a test item

```sh
naima new tests "Export keeps the alpha channel" --set runBy=agent
naima link export-keeps verifies export-drops
```

On the test's page, the [gesture](glossary.md#gesture) is written so that
someone who wasn't there can perform it. It says where to be, what to do and
what must appear, and also what must **not** appear when the fix has that
side to it.

[`runBy`](glossary.md#run-by) is set according to what would settle the
test.

| If it is settled by… | `runBy` |
|---|---|
| a command: a unit test, a script, a search | `agent` |
| driving the running software: clicking, a screenshot | `agent-hands` |
| only a person: how it looks or feels, a decision, a credential, a physical act | `human`, and `humanBecause` (`judgement`, `decision`, `credential`, `physical`) |
| an artefact nobody here can make: a signed build, a second machine | `build` |

```sh
naima new tests "Export looks right on a phone" --set runBy=human --set humanBecause=judgement
```

`naima check` fails when `runBy=human` is set without `humanBecause`
([the rule](rules.md#work-handed-to-a-person-says-why)).

## 3. Perform it, keep the evidence

Whoever runs the test does what the page says. What they saw (the output, a
screenshot, a number) goes into the test's `attachments/` folder through
`naima attach`, which also records that the file is theirs (`--own`). Then
the result is set.

```sh
naima attach export-keeps run.txt --own
naima set export-keeps status=passed      # or failed, or partial
```

| Status | Means |
|---|---|
| `passed` | it holds, and the page carries the measurement, so this [proves](glossary.md#proves) the item |
| `failed` | it does not hold, so this [refutes](glossary.md#refutes) the item and blocks closing |
| `partial` | performed in part; the page lists what is left as `- [ ]` lines |

The test also records what kind of evidence was kept, using this ranking,
which goes from strongest to weakest.

| Rank | `evidenceKind` | The evidence |
|---|---|---|
| 1 | `owner-gesture` | the owner performed the gesture and saw the result |
| 2 | `observation` | a screenshot, a log line or a number, kept with the item |
| 3 | `live-read` | the live state, read by tooling: a query, an API call, the running program's own answer |
| 4 | `diff` | a before-and-after comparison: counts, sizes, outputs |
| 5 | `inspection` | "the code looks right", which proves nothing |

```sh
naima set export-keeps evidenceKind=observation
```

A number only counts as evidence next to what it is compared with, such as
before and after, or expected and seen. "The code looks right" isn't evidence
at all, so `naima check` notes any passed test whose `evidenceKind` is
`inspection`.

**Red, then green.** A test that verifies a bug is a regression test. It is
run on the code from before the fix, where it should fail, and then on the
fixed code, where it should pass. The day it failed is written down, and the
failing run is kept together with the passing one.

```sh
naima set export-keeps redSeen=2026-01-13
```

`naima check` notes a passed regression test with no `redSeen`
(`regression-test-saw-red`).

The pages need to stay current. `naima check` notes an open item with an
unticked `- [ ]` clause that names a test which has already passed, whether
it names it as `tests/<slug>` or as "the linked test"
(`unticked-clause-names-passed-test`). The fix is to tick the clause, or to
reopen the test. It also notes an open test marked `runBy: agent` whose page
says it couldn't run because something was held up (`test-excuses-itself`).
A gesture that an agent performs doesn't depend on anyone else, so the agent
should run it now, or say who has to. The phrases this check looks for are
set in the `excusePhrases` option of the `trackers` plugin. Any of these
notes can be raised to a problem, or switched off, under
`plugins.trackers.checks` in `naima.json`.

### Tests a suite runs

When the gesture is an automated test in one of the project's
[test suites](metrics-and-budgets.md#record-the-test-suites-test-by-test),
nobody has to attach its output or set its status by hand. The test item
names the tests it stands for.

```sh
naima set export-keeps testNames="export > keeps the alpha channel"
```

Each time `naima metrics run --record` records a run of the suite, the item
gets the result. Its status becomes `passed` or `failed`, the results of its
tests are attached with the commit, a digest of what the run read and each
failure's message, `evidenceKind` becomes `observation`, and `redSeen` is set
when it passes after a recorded run in which it failed. For a regression
test, that means recording a run on the code before the fix, where the test
fails, and another on the fix, where it passes. Both runs stay in
`naima-data/test-runs/`, so the red run is kept together with the green one.

## Optional: a session for the sitting itself

Most of the time the test's own page and status say enough, namely what it
proved and what the result was. Sometimes a sitting is worth keeping as a
record of its own, for instance when several tests were run together or
something was noticed that goes beyond any one test's result. For that, the
`sessions` type (in the `planning` plugin) gives a dated record that is only
ever added to.

```sh
naima new sessions "2026-11-03 export sitting"
naima link sessions/2026-11-03-export-sitting records export-drops-test
naima set sessions/2026-11-03-export-sitting sittingRun=export-sitting-1
```

`sittingRun` groups several sessions that belonged to one sitting of
several tests. A session is never edited to change what happened, and a
later sitting gets a new session. Sessions are optional. They aren't meant as
a daily habit, only as a place to keep a sitting's own record when the test
item on its own wouldn't hold it.

## 4. Name the commit

```sh
naima set export-drops commits=3f2c1a9
```

`commits` is a list of git commit hashes for the code on the trunk that
fixed the item. Hashes are never filled in afterwards by guessing. If the fix
is older than this field, the item is grandfathered (see below) instead of
being given a guessed hash.

## 5. Close it

```sh
naima close export-drops
```

The item moves to `closed/`, taking its [proof](glossary.md#proof) with it.
Naima refuses to close it in these cases.

- It isn't fixed, or nothing that verifies it has passed.
- Something that verifies it refutes it, such as a failed test.
- Its proof is no longer current, because the model of a property, a file it
  includes or the tool's version has changed since the run. In that case
  `naima verify` has to be run again.
- None of its `commits` is a real commit that can be reached from the trunk.
- The branch you are on [claims](glossary.md#claim-file) it. The item is
  closed from the [trunk](glossary.md#trunk), after the merge, once someone
  other than whoever made the fix has checked the proof
  ([the rule](rules.md#whoever-fixes-does-not-also-close)).

`naima close --force` overrides the last two. It is meant for the person who
owns the [evidence](glossary.md#evidence), for instance when someone else
performed a proof that is recorded here.

An item closed before `commits` existed isn't checked for one, because the
rule applies from a set date (`plugins.trackers.options.commitsRequiredFrom`
in `naima-tracker/naima-data/naima.json`, by default 2026-10-01). An item
closed on the same day the rule shipped was grandfathered instead by a
one-time migration, which set `commits=legacy`. That marker is never a
guessed hash, and it is never enough to satisfy `naima close` itself.
`naima check` reports a closed item from that date onwards that has neither a
commit nor the `legacy` marker, and any item whose `commits` names a hash git
doesn't have.

## Properties, proven by a tool

A [property](glossary.md#property) is proven by a
[verifier](glossary.md#verifier), which is a model checker, instead of by
hand. `naima verifiers` lists the verifiers available, and
`naima verify <property>` runs one and attaches the run. That is the only way
a property becomes `holds`, and `naima set` can't do it. While a long
verification runs, it reports how far along it is: how many of the requested
properties are done, and each step of the tool. For mCRL2 that means the
states explored and the equations generated, with their rate.

The run records every file the tool read, meaning the model and each file it
includes as the adapter declares them, together with a single digest over all
of them and the tool's version. If any of those files changes, or the model
starts reading other files, `naima check` reports that the property is no
longer current, and `naima verify` has to be run again. The example adapter
reads `#include <path>` lines, so you can see this with a model split across
several files.

A run that has already been made isn't made again. A run is identified by
what it read and how: the digest over its files and the tool's version,
together with the property, the verifier, the model and `verifierOptions`.
When `naima verify` finds a run with the same identity among the property's
earlier runs, and that run reached a verdict (`holds` or `violated`), it
takes that verdict instead of starting the tool, says `reused` and names the
run it took it from. So a model you changed and then changed back gets its
old verdict at once. A run that ended in an error is always made again,
because an error says more about the run than about the model. To run a
property again anyway, for instance because you doubt the machine it ran on,
you give the reason, which is kept in the new run's record.

```sh
naima verify <property> --force "the first run was cut short by a reboot"
```

Every run stays in the property's `attachments/`, two runs made in the same
instant included, so the earlier verdicts can always be read again.

### Two model checkers: mCRL2 and VoxLogicA

Two verifiers come with Naima. Each is a separate plugin and needs its tool
installed on the machine, and Naima doesn't fetch the tool for you, so it has
to be installed first. Because a verifier starts a program, each one stays
off until `naima.json` names it, so you switch on the one you use, with its
options.

```json
"plugins": {
  "verifier-mcrl2": {},
  "verifier-voxlogica": { "options": { "program": "/opt/VoxLogicA/VoxLogicA", "version": "1.3.3" } }
}
```

**mCRL2** (`mcrl2`) is for the behaviour of a protocol or a process. The
model is an mCRL2 specification. The property is a modal mu-calculus formula,
either written in `property` itself or kept in an `.mcf` file, in which case
`property` holds that file's path from the project root.

```sh
naima new properties "the switch never deadlocks"
naima set <property> verifier=mcrl2 model=models/switch.mcrl2 property=models/no-deadlock.mcf
naima verify <property>
```

The property holds when mCRL2 says `true`. When it says `false`, the
evidence mCRL2 found, which is the sequence of steps that breaks the formula,
is attached as the counterexample. The tools (`mcrl22lps`, `lps2pbes`,
`pbessolve`, `lps2lts`, and for the LTS route `ltsinfo`, `ltsconvert` and
`lts2pbes`) are taken from the directory given as
`plugins.verifier-mcrl2.options.bin`. If that isn't set, they come from the
mCRL2 202607.0 that `naima tools install mcrl2` installed on this machine
([tools](tools.md)), and failing that from `PATH`.

Some models have few states but heavy data, and mCRL2's standard route can
spend hours rewriting that data. For such models, a property can take the
**LTS route** instead. The model's state space is generated once, and each
formula is checked on it after hiding the actions the formula doesn't mention
and shrinking what is left in a way that doesn't change the answer. That
takes seconds per property, where the standard route took hours. You choose
it in `verifierOptions`.

```sh
naima set <property> 'verifierOptions={"route":"lts","threads":8}'
```

- The shrinking is exact only for formulas that never count internal steps,
  so Naima checks each formula before using the route. Every action named in
  a box or a diamond must come right after a `true*`-like star (`[true* .
  ready(n)]`, not `[ready(n)]`), and a fixpoint must have one of the usual
  "eventually" shapes, such as `mu X . ([!done]X && <true>true)`. A formula
  that doesn't pass is recorded as an error beginning `LTS route refused:`,
  which says which part failed, and the standard route can still decide it.
- The state space is generated once for each version of the model, kept in
  Naima's work folder and shared by every property on that model. Changing
  the model produces a new one.
- The run record says how the verdict was reached. It gives the route, the
  size of the state space before and after shrinking, the hidden actions and
  the version of every tool. On `false`, the counterexample comes from the
  shrunk state space, so each hidden action shows up in it as `tau`.
- `"route":"cross-check"` runs both routes and holds only when they agree, and
  if they disagree the run is an error. It's worth running once on a model
  small enough for the standard route, to see that the two give the same
  answers, before relying on the LTS route alone for the large models.
- `threads` speeds up generating the state space. On macOS, more than one
  thread can crash on some models, as mCRL2 itself warns.

**VoxLogicA** (`voxlogica`) is for properties of images, for example that
one region lies inside another, that a lesion is found or that a structure is
connected. The model is a VoxLogicA session (an `.imgql` file) that loads its
images and prints a true-or-false value under a name, and the property is
that name.

```
load img = "scan.png"
let lesion = between(128, 255, intensity(img))
print "lesion_found" volume(lesion) .>. 0
```

```sh
naima set <property> verifier=voxlogica model=analysis/scan.imgql property=lesion_found
```

The property holds when the session prints `true`. When it prints `false`,
every value the session printed becomes the counterexample. The images the
session loads count as inputs of the run, so if one of them changes, the
property is no longer current. The `program` option tells Naima where
VoxLogicA is, and `version` records its release with each run, because Naima
can't read it from outside the project.

For both verifiers, a `verifierOptions` of `{ "timeoutSeconds": 600 }` stops
a run that takes longer than that and records it as `error` (undecided). If
the tool isn't installed, the run is recorded as an error whose output begins
with `tool missing:` and explains how to install it, and the property is
never reported as holding.

## Proving a change to a model

When a model changes because of an item, such as a bug in a protocol or a
feature that adds a buffer pool, the property linked to that item has to show
that the change made a difference. A property that holds both before and
after the change says nothing about it, because it may hold for a reason
that has nothing to do with the change. So the property is run twice: on the
model before the change, where it should be violated, and on the changed
model, where it should hold. It's the same red-then-green order a regression
test follows.

```sh
naima new properties "a pooled unit can be reused"
naima set <property> verifier=mcrl2 model=models/pool.mcrl2 property=models/reuse.mcf
naima link <property> verifies <bug>
naima verify <property>     # on the model before the change: violated
# the model is changed
naima verify <property>     # on the changed model: holds
```

Both runs stay in the property's `attachments/`, and the violated one keeps
its counterexample, which is the evidence that the property could fail.
`naima check` notes a property that holds and verifies or satisfies a bug, a
todo or a feature when none of its runs is a violated run of the same
property, with a counterexample, on other inputs than the ones it holds on
(`property-failed-first`). Sometimes there's no earlier model to run it on,
for instance when the model was written with the change already in it. In
that case the agent waives the note with the reason, and the waiver stays
visible in every `naima check`.

```sh
naima waive property-failed-first properties/<slug> --reason "the model was written with the pool in it"
```

A property can also hold only because the situation it talks about never
arises. "Every pooled unit is reused correctly" holds on a model where
nothing is ever pooled. A [witness](glossary.md#witness) rules that out. It's
a second property that shows the new behaviour can actually happen, such as
"the pool can be non-empty" or "a pooled unit can be taken again", and it is
linked to the property it backs.

```sh
naima new properties "the pool can be non-empty"
naima set <witness> verifier=mcrl2 model=models/pool.mcrl2 property=models/pool-non-empty.mcf
naima link <witness> witnesses <property>
naima verify <witness>
```

`naima check` notes a property that holds and proves a change when no witness
that holds is linked to it (`property-witnessed`). When a witness makes no
sense, for instance because the property is itself about reaching the new
behaviour, the agent waives the note with the reason, as above.

### A refactoring, proved by equivalence

A refactoring changes how a model is written without changing what it does:
a process split in two, data reorganised, names changed. There is no bug to
see violated first, and running every property again would only repeat what
is known. Instead the two versions are compared, and when they behave the
same, every earlier result still holds.

```sh
# the model is rewritten
naima equivalent models/pool.mcrl2
```

`naima equivalent` looks in git for the version of the model that each
property's last run read, in the index or in the commits that changed the
file (`--from <revision>` names the revision instead). The verifier then
compares that version with the model as it is now. For mCRL2 this means the
state space of each version, then `ltscompare`. When the two are equivalent,
each property gets a new run with the earlier verdict, marked `carried`: it
names the run it came from, the earlier version, the equivalence and what
the comparison printed. From then on `naima verify` reuses that run, so
nothing is run again.

The comparison is made modulo an equivalence, given with `--modulo`. mCRL2
offers two. `bisim`, strong bisimilarity, is the default, and every property
carries over under it. `dpbranching-bisim`, divergence-preserving branching
bisimilarity, also accepts a model that takes different internal steps, and
carries over only the properties the [LTS route](#two-model-checkers-mcrl2-and-voxlogica)
accepts. A property it doesn't preserve is named, to verify again.

Nothing carries over when the two versions are not equivalent: the command
names the properties to verify again and prints what tells the versions
apart, for mCRL2 a formula that one satisfies and the other doesn't. A
result also stays where it is when anything besides the model changed since
its run, such as the property, its options, an included formula file or the
tool's version, because then the comparison wouldn't cover the change.

### A model in development

Some changes to a model take several landings, and in between the model is
half done. Its properties may be violated or out of date for a while, and
that's expected. For such a model you file an item of type `models` that
names it, which starts in the status `development`.

```sh
naima new models "Buffer pool" --set model=models/pool.mcrl2
```

While the model is in development, a property verified on it whose run is
out of date is a note in `naima check` instead of a problem, and the two
checks above ask nothing of its properties. This also means `naima close`
doesn't stop on such a run, so an item proved by one of these properties is
best closed after the model leaves development. To leave development, every
property whose `model` is that path has to hold on a run of the model as it
is now. Setting the status to `stable` is refused otherwise, and the refusal
names each property that isn't current.

```sh
naima verify --all
naima set buffer-pool status=stable
```

A model with no property can't leave development, because nothing would
show that it works. `naima check` reports a `models` item that names no
model or the same model as another one, and notes a stable model when one
of its properties no longer holds on a current run
(`model-development`). Once that happens, the property is verified again,
or the model goes back to `development` while it changes.

### When the rules apply

Work on a branch is in development by nature. While a branch is being
prepared, nothing above is asked of it, and the agent runs what it needs,
normally the item's own property before and after the change. The rules
apply when the branch lands, because that's when the change becomes part of
the project. This table shows what is asked at each moment.

| When | What is asked | What it blocks |
|---|---|---|
| While a branch is being prepared | nothing; the agent runs what it needs | nothing |
| Landing | `naima land` lists, after the landing, every property verified on a file the branch changed that doesn't hold on a current run | nothing yet: the coordinator verifies the listed properties on the trunk |
| A model in development | nothing; what its properties say is information | nothing |
| Leaving development | every property of the model holds on a current run | setting the model `stable` |
| Periodic, such as nightly | a run declared in the `periodic` option, such as `naima verify --all`, started by `naima run periodic` ([long work](long-work.md#run-it-on-a-schedule)) | nothing: a failure is filed as a bug |
| Release | a gate declared with `--full-suite` waits for every property to hold on a current run and every test suite to pass ([a release gate](read-the-board.md#a-release-gate-waits-for-the-full-suite)) | the release |
| A refactoring | `naima equivalent` compares the model with the version its properties were verified on, and carries their results over when the two are equivalent | nothing: what doesn't carry over is verified again |
| Any `naima check` | the notes `property-failed-first` and `property-witnessed`; a property that claims to hold on a run that is out of date is a problem, outside development | `naima check` and `naima close`, for the problem |

Because `naima verify` reuses every run whose inputs haven't changed, a
property of a model nobody touched costs nothing at any of these moments.
Suites that take hours or days belong to the periodic and release moments,
never to a landing.
