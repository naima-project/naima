# Metrics and budgets

A [metric](glossary.md#metric) is a name together with the command that
measures it. It might be how long the tests take, the test coverage, how many
lint warnings there are, the size of a build, or how long an analysis runs.
Nothing about it is specific to software, so any command that prints a
number, or that succeeds or fails, can be a metric.

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
not held to anything, except for kind `exit`, which must then equal 0.

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
commit.
