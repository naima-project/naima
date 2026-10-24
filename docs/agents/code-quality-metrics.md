# Code-quality metrics over time

Sometimes the owner asks how the quality of the code is changing, with
requests like "plot coverage and complexity over the last 50 commits", "is
the code getting more complex?" or "show me the lint warnings since the
release". The answer comes from the project's
[metrics](../guide/glossary.md#metric), which are recorded per commit in
`naima-tracker/naima-data/metrics/` and read back along the commit timeline.
The person's side is [metrics and budgets](../guide/metrics-and-budgets.md),
and this page is what the agents do. The coordinator takes the request from
the owner and shows them the result, and a worker does the measuring on its
own branch.

## 1. Make sure the metrics are declared

```sh
naima metrics            # what is declared, and the last number of each
naima metrics presets    # the ready ones: code.*, deno.*, node.*
```

If the owner names a metric that isn't declared, declare it from a preset
under `plugins.metrics.options.metrics` in `naima-tracker/naima-data/naima.json`,
for example `"coverage": { "preset": "deno.coverage" }`. Fit the preset to
the project by putting its own test command in `run` and its source
directories in `include`, and say what you assumed. A bound is the owner's
decision, so declare the metric without one unless they gave you one.

## 2. Fill the timeline

```sh
naima metrics backfill coverage complexity --last 50
```

This measures each commit on the first-parent line that has no record of
those metrics yet, and writes one record file per commit. Code measures
(`code.*`) read the commit from git's objects and take well under a second
each. A metric that runs a command, such as tests or coverage, runs it in a
temporary worktree for every commit, so fifty commits of a slow test suite
means fifty test runs. In that case use `--every 5` and say so. The working
tree is never touched. If a commit's command fails, the commit is recorded
with no number, and it shows as a gap in the chart rather than as a zero.

Commit the records on your branch, like any other evidence
([closing a worktree](closing-a-worktree.md#5-run-the-gates-and-read-what-breaks)).

## 3. Draw it, and show it

```sh
naima metrics plot coverage complexity --last 50 --out quality.svg
naima metrics plot coverage complexity --last 50 --html --out quality.html
naima metrics history coverage complexity --last 50 --csv
```

The SVG has one panel per metric, with commit dates on the x axis, the value
on the y axis and the bound as a dashed line, and it needs nothing else to
render. The HTML page adds a table giving the first and last value of each
metric and whether the change is better or worse according to the metric's
`better`. Show the owner the chart, not the commands. If they want numbers to
work with themselves, give them the CSV.

If the owner wants to look at the metrics themselves rather than at a file,
`naima metrics plot --html --out <file>` writes a chart and a table they can
open in a browser.

The window's first screen shows the summary, the gates, what is next and the
claims. Its other views include the boards, the session notes, and a single
item with its evidence. Each view's data, `/data/<view>`, is exactly what the
matching command prints with `--json`: `naima summary --json`,
`naima gates --json`, `naima view --json next`, `naima claims --json`,
`naima board <type> --json` (`/data/board?type=<type>`),
`naima pass --list [n] --json` (`/data/notes?n=<n>`) and
`naima show <item> --json` (`/data/item?item=<item>`). So as an agent, read
the commands rather than the window.

A plugin adds a tab to that window by contributing a view to the `ui-views`
extension point. The view has a `name`, `title`, `says`, `order`, `panel`
(true puts it on the first screen instead of in a tab) and
`render(params, ctx) → { data, html, css? }`, and it is rendered on each
request ([the reference](../reference/reference.md)). The ui plugin never
names the plugins it shows.

Under the launcher, Naima may only write inside the tracker directory. If
`--out` is refused, print the chart and redirect it instead, with
`naima metrics plot coverage > quality.svg`.

## 4. Read it before you report it

Say what the chart shows in one line, with the numbers it is drawn from
(`naima metrics history` prints them), for example "coverage 78 % → 84 % over
50 commits; complexity flat at 3.0, the worst function went from 41 to 52".
The complexity numbers are an estimate, made by scanning the tokens of
TypeScript and JavaScript rather than parsing them, so report a trend and
don't present a single function's score as a fact.
