// The code-quality metrics the program ships, ready to declare: a metric that
// says `"preset": "code.complexity"` takes the preset's command or measure,
// kind, unit and direction, and may override any of them — the files it reads
// (`include`, `exclude`, `language`), its bound, its command.
//
// code.*  measured in process from the files: no program to start, any language Naima knows.
// deno.*  the Deno toolchain's own numbers: lint, type errors, tests, test time, coverage.
// node.*  Node's test runner.

/** A link to further reading on a metric: a paper or a reference page. */
export interface Reference {
  title: string
  url: string
}

/** A preset: what a metric declared with it starts from. */
export interface Preset {
  says: string
  /** What the metric measures and how to read it, in a few plain sentences: the UI's metrics screen shows it above the chart. */
  description: string
  /** Further reading, one or two links. */
  references?: Reference[]
  run?: string[]
  prepare?: string[]
  measure?: string
  kind?: string
  pattern?: string
  field?: string
  statistic?: string
  unit?: string
  better: "higher" | "lower" | "neither"
}

export const PRESETS: Record<string, Preset> = {
  "code.loc": {
    says: "lines of code, comments and blank lines left out",
    description:
      "The lines of the selected files that hold code: comment lines and blank lines are not counted. It measures how much code there is to read and maintain. Neither direction is better in itself; a sudden jump or drop is worth a look.",
    measure: "loc",
    unit: "lines",
    better: "neither",
  },
  "code.files": {
    says: "source files",
    description:
      "How many source files of the selected languages the included paths hold. It shows how the code is split up. Neither direction is better in itself.",
    measure: "files",
    unit: "files",
    better: "neither",
  },
  "code.functions": {
    says: "functions, methods and arrow functions (TypeScript, JavaScript)",
    description:
      "How many functions, methods and arrow functions the files declare, found in the languages Naima can read them in. Read it beside the lines of code: more functions for the same lines means smaller ones. Neither direction is better in itself.",
    measure: "functions",
    unit: "functions",
    better: "neither",
  },
  "code.function-size": {
    says: "mean lines per function",
    description:
      "The mean length of a function in lines, from its first line to its last. Short functions are easier to read, test and change, so lower is better; a rising mean says functions are growing.",
    measure: "function-size",
    statistic: "mean",
    unit: "lines",
    better: "lower",
  },
  "code.function-size-max": {
    says: "the longest function, in lines",
    description: "The length in lines of the longest function in the code. One very long function is often the hardest place to change, so lower is better.",
    measure: "function-size",
    statistic: "max",
    unit: "lines",
    better: "lower",
  },
  "code.complexity": {
    says: "mean cyclomatic complexity per function, estimated",
    description:
      "The mean cyclomatic complexity of a function: one plus the decisions in its body (if, for, while, case, catch, a conditional ?:, &&, || and ??), nested functions counted apart. It estimates how many paths run through a function and so how many cases a test must cover. Lower is better.",
    references: [{
      title: "T. J. McCabe, A Complexity Measure, IEEE Transactions on Software Engineering, 1976",
      url: "https://doi.org/10.1109/TSE.1976.233837",
    }],
    measure: "complexity",
    statistic: "mean",
    better: "lower",
  },
  "code.complexity-max": {
    says: "the most complex function's cyclomatic complexity, estimated",
    description:
      "The cyclomatic complexity of the most complex function: one plus the decisions in its body (if, for, while, case, catch, a conditional ?:, &&, || and ??). It points at the function with the most paths to test. Lower is better.",
    references: [{
      title: "T. J. McCabe, A Complexity Measure, IEEE Transactions on Software Engineering, 1976",
      url: "https://doi.org/10.1109/TSE.1976.233837",
    }],
    measure: "complexity",
    statistic: "max",
    better: "lower",
  },
  "code.duplication": {
    says: "code lines in a block of six or more repeated elsewhere",
    description:
      "The share of code lines that sit inside a run of six or more consecutive lines repeated somewhere else in the code. Repeated code has to be changed in every copy, so lower is better.",
    measure: "duplication",
    unit: "%",
    better: "lower",
  },
  "code.todos": {
    says: "TODO, FIXME, XXX and HACK markers in the code",
    description: "How many TODO, FIXME, XXX and HACK markers the files carry: work the code itself says is left to do. Lower is better.",
    measure: "todos",
    unit: "markers",
    better: "lower",
  },
  "code.dependencies": {
    says: "dependencies the manifests declare",
    description:
      "How many dependencies the project's manifests declare: package.json, the imports of deno.json, requirements.txt, go.mod and Cargo.toml. Each one is code the project relies on without owning it, so lower is better.",
    measure: "dependencies",
    unit: "dependencies",
    better: "lower",
  },
  "deno.lint": {
    says: "deno lint warnings",
    description:
      "The warnings deno lint reports on the code, read from its JSON output. Each is a pattern the linter flags as a likely mistake or a bad habit. Lower is better, and none is the usual aim.",
    run: ["deno", "lint", "--json"],
    kind: "json",
    field: "diagnostics",
    unit: "warnings",
    better: "lower",
  },
  "deno.type-errors": {
    says: "type errors deno check reports",
    description:
      "The type errors deno check reports, counted line by line from its output. A type error is code the type checker cannot prove consistent. Lower is better, and none is the usual aim.",
    run: ["deno", "check", "."],
    kind: "count",
    pattern: "^TS\\d+ \\[ERROR\\]",
    unit: "errors",
    better: "lower",
  },
  "deno.tests": {
    says: "tests that pass",
    description:
      "How many tests pass, read from the summary deno test prints. More passing tests means more behaviour checked on every change, so higher is better; a drop means tests failed or were removed.",
    run: ["deno", "test", "-A"],
    kind: "number",
    pattern: "(\\d+) passed",
    unit: "tests",
    better: "higher",
  },
  "deno.test-time": {
    says: "how long the tests take",
    description:
      "How long the test command takes, in seconds of wall-clock time. Slow tests are run less often, so lower is better; the time varies a little from run to run.",
    run: ["deno", "test", "-A"],
    kind: "duration",
    unit: "s",
    better: "lower",
  },
  "deno.coverage": {
    says: "line coverage of the tests",
    description:
      "The share of lines that the tests run, as deno coverage reports it over all files after deno test runs with coverage on. A line no test runs is never checked, so higher is better; a covered line is not necessarily a tested one.",
    references: [{ title: "M. Ivanković et al., Code Coverage at Google, ESEC/FSE 2019", url: "https://doi.org/10.1145/3338906.3340459" }],
    prepare: ["deno", "test", "-A", "--coverage={tmp}"],
    run: ["deno", "coverage", "{tmp}"],
    kind: "number",
    pattern: "All files[^\\n]*\\|\\s*([\\d.]+)\\s*\\|\\s*$",
    unit: "%",
    better: "higher",
  },
  "node.tests": {
    says: "tests that pass, node --test",
    description: "How many tests pass, read from the summary node --test prints. Higher is better; a drop means tests failed or were removed.",
    run: ["node", "--test"],
    kind: "number",
    pattern: "^[#ℹ] pass (\\d+)",
    unit: "tests",
    better: "higher",
  },
  "node.test-time": {
    says: "how long node --test takes",
    description: "How long node --test takes, in seconds of wall-clock time. Lower is better; the time varies a little from run to run.",
    run: ["node", "--test"],
    kind: "duration",
    unit: "s",
    better: "lower",
  },
}

/** A suite preset: the command a test runner is run with so that it writes a report Naima reads. */
export interface SuitePreset {
  says: string
  run: string[]
  format: string
  report?: string
}

export const SUITE_PRESETS: Record<string, SuitePreset> = {
  deno: {
    says: "deno test, its JUnit report",
    run: ["deno", "test", "-A", "--reporter=junit", "--junit-path={tmp}/report.xml"],
    format: "junit",
    report: "{tmp}/report.xml",
  },
  node: {
    says: "node --test, its JUnit report",
    run: ["node", "--test", "--test-reporter=junit", "--test-reporter-destination={tmp}/report.xml"],
    format: "junit",
    report: "{tmp}/report.xml",
  },
  bun: {
    says: "bun test, its JUnit report",
    run: ["bun", "test", "--reporter=junit", "--reporter-outfile={tmp}/report.xml"],
    format: "junit",
    report: "{tmp}/report.xml",
  },
  pytest: { says: "pytest, its JUnit report", run: ["pytest", "-q", "--junit-xml={tmp}/report.xml"], format: "junit", report: "{tmp}/report.xml" },
  cargo: {
    says: "cargo test, libtest's JSON lines (the nightly toolchain: the format is unstable)",
    run: ["cargo", "+nightly", "test", "--", "-Z", "unstable-options", "--format", "json", "--report-time"],
    format: "libtest-json",
  },
}
