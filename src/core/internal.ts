// The core as the composition root and the tests see it: the plugin API, and
// what only the entry point, the loader and the tests use — opening a project,
// loading and composing plugins, the registry, formats and migrations, the
// program's layout. No plugin imports this file: test/arch.test.ts holds it.

export * from "./api.ts"
export { carryRefusal, type Lock, parseConfig, parseLock, PLUGIN_NAME, programOf, readConfig } from "./config.ts"
export { apiFor, composePlugins, type PluginSource } from "./plugins.ts"
export { EXCLUDE_FILES, type Exclusion, exclusions } from "./excludes.ts"
export { agentPointer, AGENTS_FILE, brokenEntryLinks, DEFAULT_ENTRY_FILES, type EntryPointer, pointerLine, upgradePointer, writePointer } from "./pointer.ts"
export { adaptersInUse, type SessionConfig, sessionStartGaps, sessionStartPaths, startSessions } from "./session-start.ts"
export { FORMAT, formatCheck, formatOf, formatRefusal, migrate, MIGRATIONS, type Migrations, type Step } from "./format.ts"
export {
  ABOUT,
  DATA_DIR,
  DEFAULT_PROGRAM,
  findData,
  globalOptions,
  HOME,
  PROGRAM_DIR,
  real,
  RELAUNCH,
  RUNTIME_DIR,
  runtimeOf,
  trackerOf,
  trackerReadme,
} from "./layout.ts"
export { consoleIO, createContext, type IO, type Place } from "./context.ts"
export { PRIVATE_ENV, privateEnv, privateWordsFile } from "./private.ts"
export { buildRegistry, type RegistryOptions } from "./registry.ts"
export { CORE_POINTS } from "./points.ts"
export { migrationsOf } from "./manifest.ts"
export { restoreDeleted, restoredFiles } from "./program.ts"
export { type CliOptions, runCli } from "./cli.ts"
export { type OpenOptions, openProject } from "./project.ts"
