// The code-quality metrics the program ships, ready to declare: a metric that
// says `"preset": "code.complexity"` takes the preset's command or measure,
// kind, unit and direction, and may override any of them — the files it reads
// (`include`, `exclude`, `language`), its bound, its command.
//
// code.*  measured in process from the files: no program to start, any language Naima knows.
// deno.*  the Deno toolchain's own numbers: lint, type errors, tests, test time, coverage.
// node.*  Node's test runner.

/** A preset: what a metric declared with it starts from. */
export interface Preset {
  says: string
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
  "code.loc": { says: "lines of code, comments and blank lines left out", measure: "loc", unit: "lines", better: "neither" },
  "code.files": { says: "source files", measure: "files", unit: "files", better: "neither" },
  "code.functions": { says: "functions, methods and arrow functions (TypeScript, JavaScript)", measure: "functions", unit: "functions", better: "neither" },
  "code.function-size": { says: "mean lines per function", measure: "function-size", statistic: "mean", unit: "lines", better: "lower" },
  "code.function-size-max": { says: "the longest function, in lines", measure: "function-size", statistic: "max", unit: "lines", better: "lower" },
  "code.complexity": { says: "mean cyclomatic complexity per function, estimated", measure: "complexity", statistic: "mean", better: "lower" },
  "code.complexity-max": { says: "the most complex function's cyclomatic complexity, estimated", measure: "complexity", statistic: "max", better: "lower" },
  "code.duplication": { says: "code lines in a block of six or more repeated elsewhere", measure: "duplication", unit: "%", better: "lower" },
  "code.todos": { says: "TODO, FIXME, XXX and HACK markers in the code", measure: "todos", unit: "markers", better: "lower" },
  "code.dependencies": { says: "dependencies the manifests declare", measure: "dependencies", unit: "dependencies", better: "lower" },
  "deno.lint": { says: "deno lint warnings", run: ["deno", "lint", "--json"], kind: "json", field: "diagnostics", unit: "warnings", better: "lower" },
  "deno.type-errors": {
    says: "type errors deno check reports",
    run: ["deno", "check", "."],
    kind: "count",
    pattern: "^TS\\d+ \\[ERROR\\]",
    unit: "errors",
    better: "lower",
  },
  "deno.tests": { says: "tests that pass", run: ["deno", "test", "-A"], kind: "number", pattern: "(\\d+) passed", unit: "tests", better: "higher" },
  "deno.test-time": { says: "how long the tests take", run: ["deno", "test", "-A"], kind: "duration", unit: "s", better: "lower" },
  "deno.coverage": {
    says: "line coverage of the tests",
    prepare: ["deno", "test", "-A", "--coverage={tmp}"],
    run: ["deno", "coverage", "{tmp}"],
    kind: "number",
    pattern: "All files[^\\n]*\\|\\s*([\\d.]+)\\s*\\|\\s*$",
    unit: "%",
    better: "higher",
  },
  "node.tests": {
    says: "tests that pass, node --test",
    run: ["node", "--test"],
    kind: "number",
    pattern: "^[#ℹ] pass (\\d+)",
    unit: "tests",
    better: "higher",
  },
  "node.test-time": { says: "how long node --test takes", run: ["node", "--test"], kind: "duration", unit: "s", better: "lower" },
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
