// The commands the entry point answers itself, before any plugin is loaded:
// init, update, rollback, hello, plugin, guide, help. Documented like any plugin's command, so
// the reference lists them, and reserved: no plugin command may take one.

import { DATA_DIR, DATA_FILE, PROGRAM_DIR, TRACKER_DIR } from "./layout.ts"
import type { Command } from "./types.ts"

/** The commands the entry point answers itself, before any plugin is loaded. Documented like any other. */
export const cliCommands: Omit<Command, "run">[] = [
  {
    name: "init",
    says:
      `make the git repository around the program a Naima project, as its first run does by itself: beside the program, a git clone of Naima at ${TRACKER_DIR}/${PROGRAM_DIR}/, create ${DATA_DIR}/${DATA_FILE}, locked to the clone's origin and its HEAD, which must be on the origin's main, and the tracker folder's README.md and .gitignore; print the line that keeps the program out of each host tool configuration it finds (deno.json, tsconfig.json, .prettierignore), and the one line that tells agents where Naima is; nothing outside ${TRACKER_DIR}/ is touched unless --write-excludes or --write-agent-pointer is given`,
    enforces:
      "the program is locked to a commit of its source's main, with nothing uncommitted, and nothing outside the tracker folder is written unless --write-excludes or --write-agent-pointer asks",
    usage: "init [--write-excludes] [--write-agent-pointer]",
    options: [
      {
        name: "--write-excludes",
        says:
          "also write those lines into the host's own files: deno.json and tsconfig.json when they are plain JSON, .prettierignore; a file with comments is left to be edited by hand",
      },
      {
        name: "--write-agent-pointer",
        says:
          "also write the line telling agents where Naima is into the host's AGENTS.md, else its CLAUDE.md, else a new AGENTS.md, unless one of its entry files has it",
      },
    ],
    examples: ["init", "init --write-excludes", "init --write-agent-pointer"],
  },
  {
    name: "update",
    says:
      `move the lock to the head of the source's main, or to the commit --to names: say what changes (the commits, the change notes they add — breaking first, then those that ask an action —, the data formats, the rules added or removed, the options it no longer reads), fetch it into the program, check it out, rename and remove options in naima.json as the change notes say and remove those it reads nowhere, each said with its value, and record the new commit; moving forward, the new Naima finishes: it migrates the data if its format moved, names the rules agents acknowledge again, runs naima check, and files an item in the type with the trait follow-up for each problem or note that is new since the commit before; all as one change to commit; the only command, with rollback, that moves the lock; with --mode, set what a session start does about a newer Naima`,
    enforces:
      "the lock moves only to a commit of the source's main, with the data migrated forward in the same change; never back past a migration, which runs forward only; a source naima.json names other than the program's origin is refused, by every command, until --accept-source",
    usage: "update [--check | --to <commit> | --mode off|check|update | --accept-source]",
    options: [
      {
        name: "--check",
        says:
          "only say whether the source's main has moved past the locked commit, and what it changes — and rehearse it: its own naima check, run on the project from a temporary copy of it, writing nothing, says what would newly fail or be noted; exit 1 when it has moved",
      },
      {
        name: "--to",
        says:
          "move the lock to this commit of the source's main, forward or back; back across a data format is refused, naming the commit to revert; the option updates is removed when that commit does not know it, and said",
      },
      {
        name: "--mode",
        says:
          `set naima.json's updates, what naima hello does at a session start: off (nothing asked of the source), check (say when a newer Naima exists), update (say what it changes, and offer it; applied only after the owner's yes)`,
        default: "check",
      },
      {
        name: "--accept-source",
        says:
          "trust the source naima.json now names, after reviewing why it changed: every other command refuses to run a program from a source other than its origin; points the program's origin at the new source, checks out the locked commit, and moves nothing else",
      },
    ],
    examples: ["update --check", "update", "update --to 0123456789ab", "update --mode update", "update --accept-source"],
  },
  {
    name: "rollback",
    says:
      "move the lock back to the one naima.json recorded before it, found in its git history, as one change to commit: what update --to does with that commit",
    enforces:
      "the lock goes back only to a commit that reads the data's formats: a migration is undone by reverting its commit, never by running an older Naima on newer data",
    usage: "rollback",
    examples: ["rollback"],
  },
  {
    name: "hello",
    says:
      `what an agent says first in a session: the banner (Naima is active in this repository, its version and commit); then, as naima.json's updates says, whether a newer Naima exists and, under update, what it changes and its rehearsal, as update --check says them; then, one line each, what waits on the owner's decision, such as a long run that is due, never started; then what it offers on request: what Naima is and its documentation, an update check, an update after the owner's yes`,
    enforces: "nothing: it never moves the lock, writes the project nor starts a run; it asks the source only when updates is check or update",
    usage: "hello",
    examples: ["hello"],
  },
  {
    name: "plugin",
    says:
      "turn a plugin on or off, or set one of its options, in naima.json's plugins table — validated the way the project is validated on every load, instead of a hand-edit of the file",
    enforces:
      "a name must be a first-party plugin (loaded or opt-in) or one the table already names with its own source; an option set on one whose options are known here must be one it declares; the whole file is re-validated before it is written, so nothing a later load would refuse ever reaches disk",
    usage: "plugin enable <name> | plugin disable <name> | plugin set <name> <option>=<value>... | plugin show [<name>]",
    examples: [
      "plugin enable verifier-mcrl2",
      "plugin set verifier-mcrl2 bin=/usr/local/bin",
      "plugin disable rule-templates",
      "plugin show verifier-mcrl2",
      "plugin show",
    ],
  },
  {
    name: "guide",
    says:
      "inside a project, first print what its plugins contribute to the guide, such as the project's active rules for agents; then where the running Naima's documentation is: the skill, the docs map, the guide for people, the rules, the pages for agents, the format, installing; read them as files",
    enforces: "nothing: it only prints",
    usage: "guide",
    examples: ["guide"],
  },
  {
    name: "help",
    says: "list every command the loaded plugins provide, with its usage",
    enforces: "nothing: it only prints",
    usage: "help",
    examples: ["help"],
  },
]

/** The names no plugin command may take: the entry point answers them first. */
export const RESERVED: readonly string[] = cliCommands.map((c) => c.name)
