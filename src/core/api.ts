// The plugin API: everything a plugin may use of the core, and nothing else.
// A plugin inside the program imports it from this file; any plugin — one a
// project pins from outside the program too — receives the same functions as
// the second argument of its factory, with its own scope, and so needs no
// import at all. Everything the entry point, the loader and the tests use
// besides is in ./internal.ts, which no plugin may import: test/arch.test.ts holds it.

export type * from "./types.ts"
import type * as Api from "./api.ts"
import type { PluginScope } from "./types.ts"

/** What a plugin's factory receives as its second argument: this whole API, with the plugin's own scope. */
export type PluginApi = Omit<typeof Api, "CONTRACT" | "OLDEST_CONTRACT"> & PluginScope & { readonly contract: number }

export { CONTRACT, OLDEST_CONTRACT } from "./contract.ts"

export { bool, type Flags, pairs, parse, type Parsed, positiveInt, str, strs, usageError } from "./args.ts"
export { appliesTo, enumRank, fieldError, type FieldRef, fieldsOf, fieldValue, fieldValues, parseFieldValue, setFieldValue, type ValueOf } from "./fields.ts"
export {
  ATTACHMENTS,
  beforeTextWrite,
  createItem,
  isUuid,
  joinProse,
  listDirs,
  META,
  moveItem,
  NOTES_HEADING,
  README,
  readReadme,
  saveMeta,
  saveProse,
  slugify,
  splitProse,
  today,
  uniqueSlug,
  writeJson,
  type WriteOptions,
} from "./item.ts"
export { storedLinks } from "./repo.ts"
export { groupBy } from "./collections.ts"
export { allowanceLine, findPrivate, guardPrivate, type PrivateContext, privateContext, type PrivateFinding, redactPrivate } from "./private.ts"
export { callerEnv } from "./launched.ts"
export { EXIT, isInternal, message, NaimaError } from "./errors.ts"
export { isRegularFile, NEVER_SOURCE, pathMatches, walkFiles, writeFileAtomic } from "./files.ts"
export { byUrgency, hasFlag, hasTrait, isEvidenceType, isOpen, label, linked, proves, refutes, statusDef, urgency } from "./lifecycle.ts"
export { flagsOf } from "./vocabulary.ts"
export {
  addLink,
  alongside,
  atSessionStart,
  type BoardData,
  boardData,
  type BoardRow,
  type ItemData,
  itemData,
  type ItemLink,
  renderBoard,
  setFields,
  summarySections,
  typeOrThrow,
} from "./base.ts"
export { type CheckReport, runChecks } from "./check.ts"
export {
  behaviourOf,
  type ChangeNote,
  CHANGES,
  CHANGES_CONFIG,
  isNotePath,
  noteGroups,
  notesBetween,
  parseChangeNote,
  releaseNotes,
  unnoted,
} from "./changes.ts"
export {
  type AcrossOptions,
  allRefNames,
  type BranchFile,
  commitExists,
  currentBranch,
  filesAt,
  gitOrNull,
  gitPath,
  gitReason,
  type GitRun,
  isAncestor,
  isGitRepo,
  mustGit,
  projectFiles,
  readAcrossBranches,
  refsWorthReading,
  runGit,
  type StagedChange,
  stagedChanges,
  textsAt,
  toplevel,
  trunk,
  type Worktree,
  worktrees,
} from "./git.ts"
export { DATA_FILE, DEFAULT_DATA, TRACKER_DIR } from "./layout.ts"
export {
  CODE_TRAILER,
  installTrailerHooks,
  pairedBranch,
  pairTracker,
  SIBLING_FILE,
  TRACKER_TRAILER,
  trackerPath,
  trailerHookCurrent,
  trailerOf,
} from "./repos.ts"
export { WAIVERS } from "./waivers.ts"
export { askHost, DEFAULT_REMOTE_NAIMA, type Host, type HostAnswer, readHosts, shellQuote, sshArgs } from "./hosts.ts"
export { installDirOf, installedProgram, type InstalledToolRef, platformKey, PLATFORMS, programFile, RECEIPT, toolsDir } from "./tools.ts"
export { cell, code, sentence, table } from "./markdown.ts"
export { align, cloneIntoNewWorktree, isClone, short, type Target } from "./program.ts"
export { posixRelative } from "./config.ts"
export { commandGaps, commandSection, FIELD_KINDS, optionsTable } from "./points.ts"
export { contributionsOf } from "./manifest.ts"
export { shortOrId } from "./names.ts"
export { cliCommands } from "./entry.ts"
export { asRendered, type Format, FORMATS, linesAs, rendered } from "./rendered.ts"
export {
  type Count,
  estimate,
  NO_PROGRESS,
  type Progress,
  PROGRESS_TIMING,
  type ProgressEstimate,
  progressFor,
  type ProgressLine,
  progressLineOf,
  progressReporter,
  type ProgressSample,
  readProgressLine,
  type ReporterOptions,
  sameStage,
  showCount,
  showDuration,
  showProgress,
  showRate,
} from "./progress.ts"
export { type JobOutcome, type Level, messageId, type Notice } from "./tick.ts"
