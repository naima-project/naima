---
name: naima
description: Run a project with Naima — born for software, usable for any versioned work (a data analysis, a paper) — whose bugs, todos, features, tests, rules and proofs are kept as files under naima-tracker/, for an owner who only decides. Use when a repository has naima-tracker/, when asked to report, triage, claim, fix, verify or close an item, or when asked to start tracking a project with Naima.
---

# Naima

Naima is born for software: a silent software house in which you and other
agents apply industry-grade practice (tests, [metrics](../../docs/guide/glossary.md#metric),
reviews, [gates](../../docs/guide/glossary.md#gate)) and
[formal methods](../../docs/guide/glossary.md#formal-methods) for an owner who decides and need not know any of them. It
runs any other versioned work too — a data analysis, a paper with
colleagues — with that work's own checks in place of tests. Its
items are files in the repository, under one folder, `naima-tracker/`, and
its board is derived by a CLI, never edited by hand
([what Naima is for](../../docs/purpose.md)). This skill is a pointer: the
rules and the procedures live in Naima's own documentation, linked below,
and win wherever this page is shorter.

The owner need not know git, code or project management. You take all of it
on, and bring them only what is genuinely theirs. Their chat with you is
private: never copy it into the repository verbatim, and attach a file they
shared only after their explicit yes, with
`naima attach <item> <file> --consent "<their yes, restated>"`; your own
evidence goes in with `--own`, redacted first
([the rule](../../docs/guide/rules.md#the-owners-chat-stays-private)).
Evidence is copied exactly, but redact before creating any item, note,
session note, event, description or attachment: no machine name, IP
address, URI with a port, home-directory path or user name — write `<host>`,
`<ip>`, `<path>`, `<user>`; the CLI refuses such a write
([the rule](../../docs/guide/rules.md#no-machine-names-or-private-infrastructure-in-a-repository)).
Before every write of free text or a file to the tracker (`new`, `describe`,
`note`, `set` of a title or text field, `pass`, `event`, `attach`), read the
text against the [no-leaks checklist](../../docs/agents/NOLEAKS.md) and then
sign it by adding `--revised naima-tracker/naima/docs/agents/NOLEAKS.md`;
without it the CLI refuses the write. Only the agent talking to the owner
writes text taken from the owner's words; a worker writes its own observations
([the rule](../../docs/guide/rules.md#free-text-and-files-are-signed-against-the-no-leaks-checklist)).

**Capture now, act later — always, not only on `/flow:report`.** Whenever
the owner, in chat, asks for a feature, reports a problem, makes a decision
or defers something, file it at once, in the background, without derailing
whatever you are doing: restated in your own words, never the chat verbatim;
duplicates searched first (`naima list`, or `naima new --dedupe`, which
prints likely duplicates of the same type before writing and still writes)
and linked instead of refiled; triaged on the spot (impact, priority,
confidence); a decision recorded with `naima new decisions`, a deferral with
its reason. "I already told you" means a report was lost: file it now and
say so — never argue that it was already said. The full shape of a report
is [reporting and triage](../../docs/agents/reporting-and-triage.md); this
line is so it happens even when nobody typed `/flow:report`.

The same holds for requirements: check every prompt for a requirement it
adds or changes, file or revise it, and settle how it is checked — a test, a
property of a model, or a metric with a budget
([elicit](../../docs/agents/reporting-and-triage.md#elicit-the-requirements-it-carries)).
A fact the owner gives, a finding an investigation reaches, and a lesson a
mistake teaches are each a `knowledge` entry with its basis and its evidence
linked, a lesson with kind `lesson` ([knowledge](../../docs/guide/knowledge.md)).
Behaviour with states or concurrency is designed from a model first
([design with a model](../../docs/guide/design-with-a-model.md)). A decision
taken with the owner, a change of direction or a notable event outside the
tracker gets one diary entry, never routine work
([the rule](../../docs/guide/rules.md#agents-keep-the-diary)).

In this page, `naima` means, from the project's root:

```sh
deno run -A naima-tracker/naima/naima.ts
```

## 0. Have git and a repository

Run `git --version`; install git if it is missing. If the project folder is
not a repository, `git init`, and write a `.gitignore` that keeps secrets and
private data out before the first commit. Commit small, never force-push,
never rewrite history, never commit a secret
([git, handled for the owner](../../docs/agents/git-for-the-owner.md)).

## 1. Have Deno

Run `deno --version`. If it is missing, install it with its official
installer, once per machine: `curl -fsSL https://deno.land/install.sh | sh`
([installing](../../docs/guide/install.md#deno-once-per-machine)).

## 2. Have a project

When the repository has `naima-tracker/naima-data/naima.json` but no
`naima-tracker/naima/` (a fresh clone, a new worktree), run the launcher of
any Naima at hand from inside the project — the main worktree's, or a
shallow clone of the `source` that `naima.json` names, outside the project.
The run clones the locked commit into the program by itself
([fresh clones and worktrees](../../docs/guide/install.md#fresh-clones-and-worktrees)).

When there is none and the work is to be tracked here:

```sh
git clone https://github.com/naima-project/naima.git naima-tracker/naima
deno run -A naima-tracker/naima/naima.ts init
```

`init` writes the rest of `naima-tracker/` and touches nothing else. Commit
`naima-tracker/` with the work; git never shows `naima-tracker/naima/`, which
is ignored ([bootstrap a project](../../docs/guide/install.md#bootstrap-a-project)).

When the project already keeps a TODO.md, a notes file or an issue list,
bring it in with `naima adopt` (propose, split, audit, links), never by
retyping it, and never delete the file
([adopting an existing board](../../docs/agents/adopting-an-existing-board.md)).

When a run refuses, it says why in one line and what to do: local changes in
the program, a commit the source does not have, data in another format.

## 3. Announce Naima at the start of every session

```sh
naima hello
```

Run it at the start of every session, unless its output is already in the
conversation because a session-start hook ran it: then pass that output on
and don't run it again. Show the user its first line exactly as printed, for example `I'm Naima, the
No-guesswork Artificial Intelligence Meta-Agent, active in this repository:
version 1.0.0, commit 45ba22c1134c.` Then pass on
what it says about newer versions and any long run it says is due, and offer
the three things it lists: explaining Naima and showing its documentation
(`naima guide`), checking for an update, and updating.

### Messages during the session

Every naima command starts with the tick, which runs what is due (the daily
update check, the hourly look for due long runs) and prints what the owner
should know as lines on standard error that start with `NAIMA-MESSAGE`,
followed by JSON with `id`, `level`, `text` and `ack`. When you see one,
tell the owner what its text says at once, in plain words, before going on.
An urgent one says so. Never run its `ack` command yourself: only the owner
acknowledges a message (`naima messages ack <id>`), and you run it only when
the owner tells you to. A turn-end hook may stop you at the end of a turn
with the same messages; say them, then end the turn. `naima messages` lists
what is waiting ([messages](../../docs/agents/messages.md)).

How much it checks depends on `updates` in `naima.json`, which is `off`,
`check` (the default) or `update`. If the owner asks you to change it, run
`naima update --mode <value>`.

When an update is available and the owner wants to hear about it, tell them
what it changes: the breaking changes and the actions its change notes ask
for first, then the rest, any migration, rules added or removed, settings
that would stop being read, and what the rehearsal says would newly fail.
Then ask. Only when they say yes, run `naima update`. It renames and removes
settings as the notes say, names the rules to acknowledge again — read them
with `naima rules --audience agents` and give them back in your next session
note — runs `naima check` and files a todo for each new finding it could not
fix. Commit `naima-tracker/` as one change. `naima rollback` goes back to the previous version, also as one
commit. Never update without asking
([update Naima](../../docs/guide/update-naima.md)). To check on request, run
`naima update --check`.

## 4. Read the project's rules

```sh
naima rules --audience agents
```

The project's own rules for agents — how to work and report here — kept as
items of its tracker. Obey them for the whole session; `naima guide` prints
them first too ([read the project's rules](../../docs/agents/read-the-project-rules.md)).

Before asking the owner anything, run `naima decisions <words>`: a settled
decision answers it, and the owner's answer to a new question is recorded as
one ([asking the human](../../docs/agents/asking-the-human.md)).

A command that will outlast a few minutes, or run on another machine, goes
through `naima run <name> --budget-time <d> -- <command>` and `naima wait
<name> --timeout <d>`, never a hand-written wait loop
([long work](../../docs/agents/long-work.md)).

Nothing runs unattended: never schedule a run, and never start a long run on
your own. When `naima hello` or `naima summary` says a long run is due, pass
the line on, file it with `naima run due`, and ask the owner before starting
it with `naima run <name>`
([nothing runs unattended](../../docs/guide/rules.md#nothing-runs-unattended)).

A tool a verifier needs that is missing (`tool missing:`) is installed with
`naima tools install <tool>`, only after showing the owner the plan and
getting their yes, passed as `--consent "<their yes, restated>" --by <who>`
([tools](../../docs/agents/tools.md)).

## 5. Work by the rules and the flows

Read the rules before acting, then the flow that applies. They are plain
files in the clone; `naima guide` prints where:

- [the rules](../../docs/guide/rules.md): every rule a project holds to, each
  marked enforced by a check or kept by convention — read them; they are
  written there and nowhere else
- [for agents](../../docs/agents/README.md): how an agent learns a project, and
  the flows, with when each applies
- [concepts](../../docs/guide/concepts.md): items, links, fixed / resolved / closed
- [the format](../../docs/reference/format.md): every file and field
- [reference](../../docs/reference/reference.md): every command, type, status, field and gate
- [metrics and budgets](../../docs/guide/metrics-and-budgets.md): code-quality
  metrics (complexity, duplication, coverage and more) per commit, read back
  as a trend, a table or a chart
- [glossary](../../docs/guide/glossary.md): every term, defined once

`naima help` lists the commands of the Naima in use; `naima summary` says where
the project stands.
