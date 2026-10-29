// The commands the entry point answers itself, before any plugin is loaded:
// init, update, rollback, hello, tick, plugin, stances, stance, guide, help. Documented like any plugin's command, so
// the reference lists them, and reserved: no plugin command may take one.

import { DATA_DIR, DATA_FILE, PROGRAM_DIR, TRACKER_DIR } from "./layout.ts"
import type { Command } from "./types.ts"

/** The commands the entry point answers itself, before any plugin is loaded. Documented like any other. */
export const cliCommands: Omit<Command, "run">[] = [
  {
    name: "init",
    says:
      `make the git repository around the program a Naima project, as its first run does by itself: beside the program, a git clone of Naima at ${TRACKER_DIR}/${PROGRAM_DIR}/, create ${DATA_DIR}/${DATA_FILE}, locked to the clone's origin and its HEAD, which must be on the origin's main — with the release's version and checksum when the installer unpacked a release into it —, and the tracker folder's README.md and .gitignore; print the line that keeps the program out of each host tool configuration it finds (deno.json, tsconfig.json, .prettierignore); and write what makes an agent run naima hello at the start of every session: the line that tells agents where Naima is and to run it, into the host's AGENTS.md, else the first entry file it has, else a new AGENTS.md, and the hooks of each agent tool the project uses that has them (naima.json's agents; absent it, those whose files the project holds and the one Naima runs inside): a session-start hook that runs naima hello, and a turn-end hook that runs the tick when the agent ends its turn; for a repository that is public on GitHub, offer the topic naima, for the agent to ask the owner before adding it (never for a private one); nothing else outside ${TRACKER_DIR}/ is touched unless --write-excludes is given`,
    enforces:
      "the program is locked to a commit of its source's main, with nothing uncommitted; outside the tracker folder, only the pointer line, the session-start hooks and, with --write-excludes, the exclusion lines are written",
    usage: "init [--private-tracker | --tracker <url> [--private-url] | --tracker-inside | --remote-private] [--write-excludes] [--no-session-hook]",
    options: [
      {
        name: "--private-tracker",
        says:
          `keep the tracker private beside the code: ${DATA_DIR}/ becomes a git repository of its own, created on this machine with no remote, ignored by the project's git, and ${TRACKER_DIR}/tracker.json, committed with the code, says so; the two repositories' commits are paired by Tracker: and Code: trailers (a commit-msg hook in both) and their branches by name. A tracker already committed with the code is moved there with its history (git filter-branch of the code's trunk to ${DATA_DIR}/; the code's repository stops tracking it in one commit, its files left in place, nothing deleted), and a todo is filed, once, at the highest priority, to sweep the tracker for private and confidential information. Without any of these options, init keeps the tracker inside a project with no remote, or a private one; it stops when the remote is public, saying the tracker must be private, and with the question to ask the owner when its visibility cannot be told (GitHub's public API, asked without credentials)`,
      },
      {
        name: "--tracker",
        says:
          `like --private-tracker, from an existing tracker repository: ${DATA_DIR}/ becomes a git clone of the one at <url>, whose address tracker.json records`,
      },
      { name: "--private-url", says: "with --tracker: keep the tracker's address out of tracker.json, in this clone's git config (naima.tracker)" },
      {
        name: "--tracker-inside",
        says:
          "commit the tracker with the code when the visibility of its remote cannot be told: the owner's answer to init's question that the remote is private, recorded as --remote-private records it; refused when the remote is public",
      },
      {
        name: "--remote-private",
        says:
          `in a project that has its tracker: record the owner's answer that the tracker's remotes whose visibility cannot be told are private, in ${DATA_DIR}/${DATA_FILE}'s privateRemotes, by a hash of each address, so the question is not asked again; refused for a remote GitHub says is public`,
      },
      {
        name: "--write-excludes",
        says:
          "also write those lines into the host's own files: deno.json and tsconfig.json when they are plain JSON, .prettierignore; a file with comments is left to be edited by hand",
      },
      {
        name: "--no-session-hook",
        says: "install no agent tool's session-start hook: only the pointer line is written; naima check notes the hook missing, and naima update installs it",
      },
    ],
    examples: [
      "init",
      "init --private-tracker",
      "init --remote-private",
      "init --tracker git@example.invalid:me/tracker.git --private-url",
      "init --write-excludes",
      "init --no-session-hook",
    ],
  },
  {
    name: "update",
    says:
      `move the lock to the newest release of the source, or to the version or commit --to names: download the release's archive, check it against its SHA-256 and against the commit its tag names, and record the version and checksum with the commit (a source that publishes no releases, or --main, follows the head of its main instead; a lock that still names a commit of main moves to the newest release once, and says so; a commit of main past the newest release stays until a newer release; with no network the lock stays where it is, and says why); say what changes (the commits, the change notes they add — breaking first, then those that ask an action —, the data formats, the rules added or removed, the options it no longer reads), fetch it into the program, check it out, rename and remove options in naima.json as the change notes say and remove those it reads nowhere, each said with its value, and record the new commit; moving forward, the new Naima finishes: it migrates the data if its format moved, names the rules agents acknowledge again, runs naima check, and files an item in the type with the trait follow-up for each problem or note that is new since the commit before; writes, and says, what makes agents run naima hello at every session start where it is missing — the pointer line, rewritten when it does not say so, and each session-start hook as naima init installs them; all as one change to commit; the only command, with rollback, that moves the lock; with --mode, set what a session start does about a newer Naima`,
    enforces:
      "the lock moves only to a release whose archive matches its checksum and its tag's commit, or, for a source without releases or with --main, to a commit of the source's main, with the data migrated forward in the same change; never back past a migration, which runs forward only; a source naima.json names other than the program's origin is refused, by every command, until --accept-source; with the tracker in a repository of its own, an update that moves the lock is refused on the code's trunk while the trunk guard runs there, before anything moves, and is made in an item's worktree, the tracker moved first to the branch that pairs with the code's, so that its two halves land together with naima land",
    usage: "update [--check | --to <version|commit> | --main | --pre | --mode off|check|update | --accept-source]",
    options: [
      {
        name: "--check",
        says:
          "only say whether a newer release exists (for a source without releases, whether its main has moved past the locked commit), and what it changes — and rehearse it: its own naima check, run on the project from a temporary copy of it, writing nothing, says what would newly fail or be noted; exit 1 when it has moved",
      },
      {
        name: "--to",
        says:
          "move the lock to this release (1.2.0 or v1.2.0), or to this commit of the source's main, forward or back; back across a data format is refused, naming the commit to revert; the option updates is removed when that commit does not know it, and said",
      },
      {
        name: "--main",
        says:
          "follow the head of the source's main rather than its releases, as for Naima's own development or a fork that publishes no releases; the lock then names a commit, with no version, and is not counted as an install of a release",
      },
      {
        name: "--pre",
        says: "include pre-releases (1.2.0-rc.1) when choosing the newest release; a project that already runs a pre-release includes them without it",
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
    examples: ["update --check", "update", "update --to 1.2.0", "update --to 0123456789ab", "update --main", "update --mode update", "update --accept-source"],
  },
  {
    name: "rollback",
    says:
      "move the lock back to the one naima.json recorded before it, found in its git history, as one change to commit: what update --to does with that commit, its version and checksum recorded again when it named a release",
    enforces:
      "the lock goes back only to a commit that reads the data's formats: a migration is undone by reverting its commit, never by running an older Naima on newer data; with the tracker in a repository of its own, refused on the code's trunk while the trunk guard runs there, as update is",
    usage: "rollback",
    examples: ["rollback"],
  },
  {
    name: "hello",
    says:
      `what an agent says first in a session: the banner (I'm Naima, the No-guesswork Artificial Intelligence Meta-Agent, active in this repository, with its version and commit); then, as naima.json's updates says, whether a newer Naima exists and, under update, what it changes and its rehearsal, as update --check says them; then where the project is going, as the plugins say it, such as the nearest gate with a due date and the next release, each with its verdict as naima gates gives it; then, one line each, what waits on the owner's decision, such as a long run that is due, never started, or that nothing does; then what it offers on request: what the plugins offer, such as generating code from a model the project has, then what Naima is and its documentation, an update check, an update after the owner's yes; last, the offer to explain what Naima can do from the basics (docs/guide/the-basics.md). Under --hook, the agent is told to open its first reply with the introduction, its name in bold, and how to explain the basics`,
    enforces:
      "it never moves the lock nor starts a run; it asks the source only when updates is check or update, and records that check as the day's, and the session it starts (naima origin), in the tick's state outside the repository; the only thing it may write in the project is an urgent message the tick raises",
    usage: "hello [--hook <tool>] [--session <id>]",
    options: [
      {
        name: "--session",
        says:
          "the id of the session it starts, which every write in this worktree records until the next hello (naima origin); without it, the agent tool's own when its hook is given one, else a new one: the day and eight hex digits",
      },
      {
        name: "--hook",
        says:
          "print the greeting as the session-start hook of that agent tool wants it, named as naima.json's agents names it: the greeting for the owner to see directly, and what the agent is to say first, in the form the tool's adapter gives (src/core/adapters/)",
      },
    ],
    examples: ["hello", "hello --hook <tool>"],
  },
  {
    name: "tick",
    says:
      "run the tick now, as every command does before its own work: each job that is due — the update check once a day, unless updates is off; the jobs plugins contribute, such as the due long runs once an hour — run by whichever naima process wins it, a failed one retried an hour later, a week of failed update checks raising an urgent message; then say what is due to the owner, each message once, an urgent one once an hour until the owner acknowledges it (naima messages). Every other command says them after its own output, on standard error, one line each: NAIMA-MESSAGE, a space, and the message as a JSON object with the keys id, level (info, warning or urgent), text and ack, where ack is the command that acknowledges it, or null for a message said once",
    enforces:
      "no lock: every decision is a file created only if it does not exist, kept outside the repository in the clone's git directory, so any number of naima processes, in any worktree of the clone, run each due job once; nothing is applied and no long work starts: it finds and says",
    usage: "tick [--json] [--hook <tool>]",
    options: [
      { name: "--json", says: "print the jobs run here and the messages to show as JSON" },
      {
        name: "--hook",
        says:
          "run as the turn-end hook of that agent tool, named as naima.json's agents names it: when a message is due, print what keeps the agent from ending its turn and tells it what to tell or ask the owner, in the form the tool's adapter gives; nothing otherwise; it never fails",
      },
    ],
    examples: ["tick", "tick --json", "tick --hook <tool>"],
  },
  {
    name: "subagent",
    says:
      "run as the sub-agent-start hook of that agent tool, named as naima.json's agents names it: put the project's rules for agents, as naima rules --audience agents prints them, in the starting sub-agent's context, in the form the tool's adapter gives, and mark, by the sub-agent's id, that it has them, so the tool's guard lets its calls through; the guard holds the calls of a sub-agent with no mark until it runs naima rules, and the hook on its stop sends one that never had them back to read them (docs/agents/read-the-project-rules.md)",
    enforces:
      "it never fails and never blocks a sub-agent from starting: a project that does not open, or an input with no agent id, prints nothing and leaves the guard to hold the sub-agent until it reads the rules; the mark is kept outside the repository, in the clone's git directory",
    usage: "subagent --hook <tool>",
    options: [{ name: "--hook", says: "the agent tool whose sub-agent-start hook runs it, named as naima.json's agents names it" }],
    examples: ["subagent --hook <tool>"],
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
    name: "stances",
    says:
      "list the stances available to adopt — plugins of the kind stance, each a set of authored choices and rules a project takes as a whole — with what each says of itself, marking those this project has adopted; for now they are the repositories named naima-stance-<name> of the naima-project organisation on GitHub, asked of GitHub's public API without credentials; with no network, it says it cannot reach it",
    enforces: "nothing: it only reads",
    usage: "stances",
    examples: ["stances"],
  },
  {
    name: "stance",
    says:
      "adopt a stance, show the ones adopted, or list a stance's examples. adopt <name> resolves the name to its repository, github.com/naima-project/naima-stance-<name>, pins the commit at the head of its default branch in naima.json's plugins as stance-<name> (its module plugin/index.mjs), loads it, and runs its adoption when it declares one: its own command stance-<name> with adopt, given the arguments after the name; adopting again moves the pin to the newest commit. status shows each adopted stance, its pinned commit, and whether a newer one exists. examples <name> lists the example paths an adopted stance declares, each with where it is in its checkout, from the project's root",
    enforces:
      "a stance is pinned by commit, as every plugin from git is, and the whole file is re-validated before it is written; what is adopted must declare the kind stance, or naima.json is put back as it was",
    usage: "stance adopt <name> [<arguments of its adoption>...] | stance status | stance examples <name>",
    examples: ["stance adopt ui", "stance adopt ui --mood dusk", "stance status", "stance examples ui"],
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
