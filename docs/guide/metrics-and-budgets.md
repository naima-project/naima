# Metrics and budgets

A [metric](glossary.md#metric) is a name together with the command that
measures it. It might be how long the tests take, the test coverage, how many
lint warnings there are, the size of a build, or how long an analysis runs.
Nothing about it is specific to software, so any command that prints a
number, or that succeeds or fails, can be a metric. So can a file that a
benchmark writes, and the results of a test suite, which Naima also records
test by test.

Naima runs the project's metrics and prints every number next to the number
it is compared to. It records the numbers for each
[commit](glossary.md#commit) as evidence, holds each one to a bound, and
draws them as a trend, a table or a chart along the commit timeline. A set of
code-quality metrics comes built in (lines of code, complexity, duplication,
coverage and more), so you can
[see how your code's quality moves over time](#see-how-your-codes-quality-moves-over-time)
without installing anything. The agents run the commands on this page for
you, unless you want to run them yourself.

For example, say the analysis must still run in under ten minutes. That
becomes a metric called `analysis-time`, with the command that runs the
analysis and a budget of 600 seconds. A run that takes longer fails, and a
release waits until it passes.

## Declare a metric

Metrics are declared as data in the project's
`naima-tracker/naima-data/naima.json`, under the `metrics` plugin's options.
The agent writes this once, and you decide the bounds.

```json
"plugins": {
  "metrics": {
    "options": {
      "metrics": {
        "tests": { "says": "tests that pass", "run": ["deno", "task", "test"], "kind": "number", "pattern": "(\\d+) passed", "atLeast": 197, "ratchet": true },
        "test-time": { "run": ["deno", "task", "test"], "kind": "duration", "unit": "s", "atMost": 120, "tolerance": 15 },
        "lint": { "run": ["deno", "lint"] }
      }
    }
  }
}
```

| Key | What it is |
|---|---|
| `preset` | a ready metric to start from (below): `"code.complexity"`, `"deno.coverage"`. Any other key overrides the preset's. |
| `run` | the command, as a list: the program first, then its arguments. No shell. `{tmp}` in an argument is a fresh temporary path. |
| `prepare` | a command run first, which must succeed: the test run a coverage report reads. |
| `measure` | instead of `run`: a code measure Naima takes itself from the files (below). |
| `suite`, `field` | instead of `run`: a number from a [test suite](#record-the-test-suites-test-by-test)'s run, where `field` is `passed`, `failed`, `skipped`, `total` or `seconds`. |
| `file` | instead of `run`: a file, from the project root, that the number is read from as if a command had printed it. It's for [benchmarks and profiles](#benchmarks-and-profiles-that-write-files). |
| `satisfies` | the [requirements](#performance-requirements-are-metrics-with-budgets) the metric measures, by their names. |
| `language`, `include`, `exclude` | for a `measure`: the languages it reads (every programming language by default) and the paths it reads or leaves out — `"src"`, or a pattern such as `"**/*.test.ts"`. |
| `statistic` | for function size and complexity: `mean` (default), `median`, `p90`, `max` or `sum`. |
| `better` | `higher`, `lower` or `neither`: which way is an improvement. Without it, a budget means lower and a floor higher. |
| `kind` | how the number is read from the run (below). Default `exit`. |
| `pattern` | for `number`: a regular expression whose first group is the number; for `count`: the lines to count. |
| `unit`, `says` | how the number is printed, and what it measures. |
| `atMost` | a **budget**: the number may not exceed it. |
| `atLeast` | a **floor**: the number may not fall below it. |
| `equals` | a **baseline**: the number must equal it. |
| `ratchet` | a gain fails until the bound follows it: a budget only goes down, a floor only up. |
| `tolerance` | the slack around the bound, for a noisy number such as a duration. |
| `because` | the [item](glossary.md#item) that says why the bound was last loosened; written by `naima metrics bound`. |

A metric has at most one bound. A metric without a bound is recorded but
not held to anything, except for kind `exit`, which must then equal 0. A
metric that reads a file uses kind `number` unless it says otherwise.

### Kinds

| Kind | The number |
|---|---|
| `exit` | the command's exit code: 0 is a pass |
| `number` | the first group of `pattern` in the output; without a pattern, the first number |
| `count` | how many lines of the output match `pattern` (every non-blank line without one): warnings, findings |
| `duration` | how many seconds the command took |
| `json` | the number at `field`, a dotted path, in the JSON the command prints; a list there counts its entries |

A plugin can add a kind, for instance one that reads a coverage report's
format, through the `metric-kinds` extension point
([reference](../reference/reference.md)).

### What the program may start

Naima runs with only the permissions it needs
([install](install.md#the-permissions)). Declaring a metric allows it to
start that metric's program, which is the first word of `run`, and nothing
more. `naima runs` lists every program Naima may start, and why.

## Run them

```sh
naima metrics run              # every metric
naima metrics run tests lint   # some
naima metrics run --record     # and write the numbers as evidence
```

Every number is shown with what it is compared to, which is the last number
recorded on an earlier commit of this line of history, and the bound.

```
  ✓ tests: 201 (was 197, +4; floor 197) — a gain the floor 197 has not followed: raise it — naima metrics bound tests 201
  ✓ test-time: 96.2 s (was 101.5 s, -5.3; budget 120 s) — within the budget
```

The command exits 1 when any metric fails. A metric fails when it is past
its bound, when no number could be read, or, for a ratchet, when it has
improved and its bound hasn't been moved to follow. `--record` writes one
file per run in `naima-data/metrics/`, named after the commit it measures,
and that file is committed along with the work. If the run measured
uncommitted changes, it says so, both in the output and in the record.

## Move a bound

```sh
naima metrics bound tests 201                                  # tighten: a floor up
naima metrics bound test-time 140 --because bugs/slow-ci       # loosen: needs an item
```

Tightening a bound needs no justification. Loosening it (raising a budget,
lowering a floor or moving a baseline) is refused unless `--because` names an
item that explains why, and that item is written into the metric.
`naima check` reports any `because` that doesn't name an existing item.

## Record the test suites, test by test

A test suite is a test command whose results Naima reads one test at a time,
such as `deno test`, `node --test`, `bun test`, `pytest` or `cargo test`. The
runner writes a report in a machine-readable format, and Naima reads which
tests passed, which failed, how long each one took and what each failure
said. Suites are declared next to the metrics, under `suites`.

```json
"plugins": {
  "metrics": {
    "options": {
      "suites": {
        "unit": { "preset": "deno", "inputs": ["src", "test", "deno.json"] },
        "engine": { "preset": "cargo", "inputs": ["src", "tests", "Cargo.toml", "Cargo.lock"] }
      }
    }
  }
}
```

| Key | What it is |
|---|---|
| `preset` | a ready suite (below). Any other key overrides the preset's. |
| `run` | the command, as a list: the program first, then its arguments. No shell. `{tmp}` in an argument is a fresh temporary directory, removed after the run. |
| `prepare` | a command run first, which must succeed. |
| `format` | how the report is read: `junit`, `tap` or `libtest-json`. |
| `report` | the file the runner writes its report to, either from the project root or under `{tmp}`. Without it, Naima reads the command's output. |
| `inputs` | the paths or patterns of the files the tests read, such as `"src"` or `"**/*.py"`. Without it, every file of the working tree outside the tracker counts. |
| `says` | what the suite covers. |

| Format | Written by |
|---|---|
| `junit` | JUnit XML: `pytest --junit-xml`, `deno test --reporter=junit`, `node --test-reporter=junit`, `bun test --reporter=junit`, and most CI tools |
| `tap` | TAP 13 or 14, with indented subtests: `deno test --reporter=tap`, `node --test-reporter=tap` |
| `libtest-json` | Rust's test harness with `-- -Z unstable-options --format json`, which needs the nightly toolchain |

| Preset | The command |
|---|---|
| `deno` | `deno test -A --reporter=junit --junit-path={tmp}/report.xml` |
| `node` | `node --test --test-reporter=junit --test-reporter-destination={tmp}/report.xml` |
| `bun` | `bun test --reporter=junit --reporter-outfile={tmp}/report.xml` |
| `pytest` | `pytest -q --junit-xml={tmp}/report.xml` |
| `cargo` | `cargo +nightly test -- -Z unstable-options --format json --report-time` |

A plugin can add a format through the `test-formats` extension point
([reference](../reference/reference.md)).

Each suite gives three metrics of its own. For a suite called `unit` they are
`unit.passed`, `unit.failed`, which must be 0, and `unit.seconds`. They are
compared, recorded, plotted and shown in the summary like any other metric.
To hold one of them to a bound, declare it under `metrics` with its suite and
field, for instance
`"unit.seconds": { "suite": "unit", "field": "seconds", "atMost": 120 }`.

### Run and record them

`naima metrics run` runs every suite its metrics read, once each, and prints
the counts and every failing test before the numbers. `naima metrics run
unit` runs one suite and its metrics.

```
  ✗ suite unit: 211 passed, 1 failed, 3 skipped, in 48.2 s — run
      ✗ export > keeps the alpha channel (./test/export.test.ts): AssertionError: expected 255, got 0
  ✓ unit.passed: 211 tests (was 209, +2; no bound) — recorded, no bound
  ✗ unit.failed: 1 tests (was 0, +1; baseline 0 tests) — differs from the baseline 0
```

With `--record`, each suite's run is also written to
`naima-data/test-runs/<suite>/`, in a file named after the commit, with the
run's log beside it. The record keeps every test's name, result, duration and
failure message, the commit, and a digest of the files the run read. The
project's own path is written as `<root>`, and machine names, home paths and
user names are replaced by placeholders, as in any
[evidence](rules.md#no-machine-names-or-private-infrastructure-in-a-repository).
The record of the metrics names the run its numbers came from.

### A run is not repeated when nothing it reads has changed

The digest covers the command, the format, where the report is written, and
every input file with its contents. When a recorded run has the same digest,
Naima uses that run instead of running the suite again, and says which run
it used.

```
  ✓ suite unit: 212 passed, 0 failed, 3 skipped, in 47.9 s — reused: its inputs are those of the run of 3f2a91c04d1e on 2026-10-16, naima-tracker/naima-data/test-runs/unit/3f2a….json
```

This is why `inputs` is worth declaring. A suite that names the files its
tests read is reused across commits that only change other files, such as the
documentation. `--rerun "<reason>"` runs the suites again anyway, for
instance to confirm a failure that comes and goes, and the reason is kept in
the record. A run whose report couldn't be read is never reused.

### Results land on the test items

A [test item](prove-and-close.md#tests-a-suite-runs) names the tests it
covers in `testNames`, separated by commas.

```sh
naima set export-keeps testNames="export > keeps the alpha channel,export > keeps the profile"
naima set export-keeps testSuite=unit     # only if the names should match one suite
```

A name matches a test's whole name, its file and name together
(`./test/export.test.ts > export > keeps the alpha channel`), or the end of
its name after any ` > ` or `::`, so `keeps the alpha channel` and
`tests::keeps_alpha` work too. A `*` stands for any text. Groups are part of a
test's name: a step inside a Deno test, a `describe` block, or a Rust module.

When `naima metrics run --record` records a run, every test item whose names
match one of its tests gets the result:

- its status becomes `passed` when every matched test that ran passed, and
  `failed` when one of them failed;
- the matched results are attached to the item, in a file named in
  `lastTestRun`;
- `evidenceKind` becomes `observation`, unless it was already stronger;
- `redSeen` is set to the day of the failing run when the item passes after a
  recorded run in which it failed, which is
  [red, then green](rules.md#a-regression-test-is-seen-red-before-it-is-green).

Skipped tests don't count, and an item whose matched tests were all skipped
is left as it was. An item that the run already speaks for, because it was
reused, is left as it was too. `naima check` notes a name that matches no
test of the suite's last run, which usually means the test was renamed
(`test-suites`).

### When to record

Recording happens at the end of a phase of work, when a branch lands, and in
the periodic and release runs of the full suite, never after every edit.
While working, `naima metrics run` without `--record` is enough, and an
unchanged suite costs nothing because its last recorded run is reused.

### A gate that says the tests pass

The `suites` gate holds when the latest record of the current commit names a
passing run for every suite, either made on that commit or reused because its
inputs are unchanged. It names each run it stands on.

```
suites — Every test suite passes: HOLDS
  ✓ backed by naima-tracker/naima-data/test-runs/unit/3f2a….json: 212 passed, 3 skipped, on 3f2a91c04d1e
```

A release or a milestone that needs the tests to pass checks this gate
(`naima gates suites --check`), so its claim rests on the recorded run rather
than on a commit message.

## Performance requirements are metrics with budgets

A requirement about performance, such as how long something takes, how much
memory it uses, how much it handles per second, or how big something is,
gets a metric that measures it, with a budget. The metric names the
requirement in `satisfies`.

```json
"startup-time": {
  "run": ["deno", "run", "-A", "bench/startup.ts"], "kind": "duration", "unit": "s",
  "atMost": 2, "tolerance": 0.2, "satisfies": ["startup-under-two-seconds"]
}
```

The requirement is then measured on every recorded run and shown over time
like any other metric. `naima check` notes a requirement whose title or page
names a time, a memory, a throughput or a size ("under 2 seconds", "peak
memory", "requests per second", "64 MB") when no metric satisfies it
(`performance-requirement-has-metric`). It also notes a metric that
satisfies a requirement without a bound, and fails on a `satisfies` that
names no item (`metric-satisfies`).

### Benchmarks and profiles that write files

Benchmarks and profilers usually write their results to a file. A metric
with `file` reads the number from that file, and its `prepare` runs the
benchmark that writes it.

```json
"parse-time": {
  "prepare": ["cargo", "bench", "--bench", "parse"],
  "file": "target/criterion/parse/new/estimates.json", "kind": "json", "field": "mean.point_estimate",
  "unit": "ns", "atMost": 50000, "satisfies": ["parsing-stays-fast"]
}
```

## Code-quality metrics, built in

`naima metrics presets` lists the ready-made metrics. You declare one by
naming its preset, and you can add a bound or narrow down the files if you
like.

```json
"metrics": {
  "loc": { "preset": "code.loc", "include": ["src"] },
  "complexity": { "preset": "code.complexity" },
  "complexity-max": { "preset": "code.complexity-max", "atMost": 40 },
  "duplication": { "preset": "code.duplication", "atMost": 3 },
  "lint": { "preset": "deno.lint", "atMost": 0 },
  "coverage": { "preset": "deno.coverage", "atLeast": 80, "ratchet": true }
}
```

| Preset | What it measures | Better |
|---|---|---|
| `code.loc` | lines of code, comments and blank lines left out; `"language": "typescript"` for one language | — |
| `code.files` | source files | — |
| `code.functions` | functions, methods and arrow functions | — |
| `code.function-size`, `code.function-size-max` | lines per function: the mean, the longest | lower |
| `code.complexity`, `code.complexity-max` | cyclomatic complexity per function, estimated: the mean, the worst | lower |
| `code.duplication` | the share of code lines in a block of six or more repeated elsewhere | lower |
| `code.todos` | TODO, FIXME, XXX and HACK markers | lower |
| `code.dependencies` | dependencies the manifests declare: package.json, deno.json, requirements.txt, go.mod, Cargo.toml | lower |
| `deno.lint`, `deno.type-errors` | lint warnings, type errors | lower |
| `deno.tests`, `deno.test-time` | tests that pass, how long they take | higher, lower |
| `deno.coverage` | line coverage of the tests | higher |
| `node.tests`, `node.test-time` | the same for Node's test runner | higher, lower |

Naima measures the `code.*` metrics itself by reading the files, so there
is no program to install and nothing to configure. Lines and files work for
every language Naima knows (TypeScript, JavaScript, Python, Rust, Go, Java,
C, C++, shell and more). Functions and complexity are found only in
TypeScript and JavaScript, by a small estimator that counts each function's
decisions (`if`, loops, `case`, `catch`, `&&`, `||`, `??` and `? :`) and adds
one. It's an estimate rather than a parser, and it's good for watching a
trend. A plugin can add a function finder for another language
(`code-languages`) or a new measure (`code-measures`), as described in the
[reference](../reference/reference.md).

The `deno.*` and `node.*` metrics run the tool itself. If your project runs
its tests differently, for instance with `["deno", "task", "test"]`, change
`run` to match. Metrics that run the same command share a single run.

## See how your code's quality moves over time

To see your project's metrics, run `naima ui`. It opens a window titled
Naima, and its **Metrics** tab holds the chart and the table of every metric.
Tick the metrics you want, pick the first and the last commit, then press
**Show**. The window reads the records each time it shows them, so a metric
recorded while the window is open appears the next time you press **Show**.
Closing the window ends it.

```sh
naima ui              # a window
naima ui --browser    # the same page in your browser; Ctrl-C ends it
```

The window needs Deno. The first time it runs, it fetches the small library
that draws it, so it needs the network once. If the window can't open,
because Naima is run by Node or Bun or there is no network on that first run,
your browser opens instead and `naima ui` says why in one line. The page is
served from your machine only, and only to the window or browser it opened,
so anyone else who tries the address is refused.

Every recorded run is a point on the commit timeline. You can also read them
in the terminal, in four ways.

```sh
naima metrics trend complexity            # one metric, as a line of text
naima metrics history                     # every metric, one row per commit
naima metrics history --csv > quality.csv # for a spreadsheet; --json for a program
naima metrics plot coverage complexity --out quality.svg   # a chart
naima metrics plot --html --out quality.html               # a chart and a table, for a browser
```

```
complexity (no bound): ▃▄▄▅▃▂  3.12 → 2.98
  3f2a…  2026-09-28  3.12
  9c1b…  2026-09-29  3.2, +0.08
  ...
```

The chart has one panel per metric, with commit dates along the bottom, the
value up the side, and the metric's bound as a dashed line. Hovering over a
point shows its commit. `--last 50` keeps only the last fifty recorded
commits. Without `--out` the chart is printed, so `> quality.svg` works too.

**Starting with a full timeline.** A project that has only just declared its
metrics has no records yet. `naima metrics backfill` measures past commits
and records each one.

```sh
naima metrics backfill                    # the last 30 commits of the main line
naima metrics backfill --last 50 --every 5
naima metrics backfill --since v1.0 complexity duplication
```

Backfilling never touches your files. The `code.*` metrics read each past
commit straight from git, and metrics that run a command run it in a
temporary copy of the repository, which is removed at the end. A commit that
is already recorded is skipped. The records it writes are committed like any
others.

The files of a project with its own git submodule are measured in the same
way. For the working tree Naima uses `git ls-files --recurse-submodules`. For
a past commit it follows the gitlink that `ls-tree` records into the
submodule's own history at that commit, rather than whatever the submodule
happens to have checked out now. If a submodule was never fetched, or the
submodule's repository doesn't have the commit a gitlink points to, that
commit counts as having no files. Naima says so once and carries on.

**Asking an agent.** You don't need to run any of these commands yourself.
You can say, for example, "plot coverage and complexity over the last 50
commits", and the agent backfills what is missing, writes the chart and shows
it to you.

The timeline follows the history of the current commit, so a record made on
another branch shows up once that branch is merged.

## Beside the work

`naima summary` has a metrics section, and `naima board` and `naima queue`
show the same section at the bottom, next to the tests and the items. For
each metric it gives the last number, the one before, whether that is better
or worse, the bound and a small trend.

```
── metrics
  ✓ complexity      2.98 (was 3.2, better; no bound)  ▃▄▄▅▃▂
  ✗ coverage        78.1 % (was 81.4 %, worse; floor 80 %)  ▅▆▇▆▃
```

## As a gate

The `metrics` [gate](glossary.md#gate) holds when, in the latest record of
the current commit, every metric is within its bound. `naima gates metrics
--check` therefore works as the release condition "no number got worse", and
when it fails it says which number failed and by how much.

```
metrics — The project's metrics: BLOCKED by 0
  ✗ coverage: 78.1 %, past the floor 80
```

Run `naima metrics run --record` first, so that there is a record for the
commit. The gate names the record it read. The `suites` gate does the same
for the test suites ([above](#a-gate-that-says-the-tests-pass)).
