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
  full state space, in terms of the model's own actions.
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
