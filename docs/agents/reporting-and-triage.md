# Reporting and triage

This page explains how something an agent hears, sees or finds becomes an
[item](../guide/glossary.md#item) that someone can still act on months later,
and how that item gets its place in the ranking.

**Who and when.** Whoever hears or finds it files it straight away, before
investigating (step 2). Usually that is the coordinator, working in the
[owner](../guide/glossary.md#owner)'s chat. This happens every time the owner
asks for a feature, reports a problem, or decides or defers something, and
not only when a flow is explicitly invoked. It is a standing habit that runs
in the background, so the work underway carries on. The agent that filed the
item then [triages](../guide/glossary.md#triage) it in the same sitting
(steps 3–7). It rewrites the description in its own words and searches for
duplicates first, with `naima list` or `naima new --dedupe` (which prints
likely duplicates of the same type before writing, and still writes). When it
finds one, it links to it rather than filing again. It records what it
checked and sets the fields with `naima describe`, `naima note` and
`naima triage set` (step 4). The owner may also write an item directly as a
file, and that item is triaged the same way. A report the owner wrote is
never overwritten, because the triage only adds to it.

## 1. Route it

Everything the owner says about the work falls into one of a few kinds, and
each kind has one place in the tracker. A report filed in the wrong place
gets lost, and then the owner has to say it again.

| When they say… | It goes in |
|---|---|
| "this is broken" | `bugs` |
| "this needs doing" — work, a decision, a tidy-up, not a defect | `todos` |
| "I'd like it to do X" — it does not exist | `features`, status `requested` |
| "this exists now" | `features`, status `shipped`, with its `docs` |
| "this still has to be tried" | `tests` |
| "it must always hold that Z" — a condition the result must meet | `requirements`, proven by a test linked `verifies` |
| "the behaviour must be Z" — exactly how something behaves | `specs`: a new one, or the next version of the current one (`naima spec revise`) |
| "yes, do that" / "we go with X" — the owner decides or permits | `decisions`, linked `settles` to the items that waited on it |

A defect doesn't go in `todos`, and a request only becomes a feature once the
code exists. A change of behaviour starts as a change to the spec. The agent
writes the new version of the spec, gets it agreed, and then builds to it
([planning with requirements, specs and decisions](../guide/plan-with-requirements-specs-and-decisions.md)).
If the owner reverses an earlier request, the agent records the reversal and
never overwrites the old request.

## 2. Write it before you understand it

The agent opens the item with what was observed, **then** investigates:

```sh
naima new bugs "<what happened, in one line>"
```

There are three reasons to do it in this order.

- If the diagnosis turns out to be wrong, the observation is still there, and
  the observation was right all along.
- An item opened late competes with whatever the agent is doing at the time,
  instead of being ranked against everything else.
- The report is [evidence](../guide/glossary.md#evidence), and the agent's
  reconstruction of it is not.

The title says what happened, not what to do about it.

## 3. What a report carries

1. **What happened, in the agent's own words.** This covers what happens,
   what should happen, and how to see it. The owner's chat is private, so
   the agent quotes the owner's words, or attaches a file or screenshot they
   shared, only after the owner has explicitly said yes
   ([the rule](../guide/rules.md#the-owners-chat-stays-private)). A report
   that a person wrote as a file is kept as they wrote it.
2. **The evidence.** This can be a log line, a number, a command with its
   output, or a file in `attachments/`, and it travels with the claim it
   supports. A file goes in with `naima attach` (below) and is never copied
   in by hand. It is **redacted before attaching**, because an attachment is
   permanent once it is committed, so a token, a key, a password or a
   private path in a log is cut out first. A command and its output are
   copied exactly, except that machine names, IP addresses, URIs with a
   port, home-directory paths and user names are replaced by `<host>`,
   `<ip>`, `<path>` and `<user>`. The agent redacts before it creates any
   item, note, session note, event, description or attachment
   ([the rule](../guide/rules.md#no-machine-names-or-private-infrastructure-in-a-repository)).
3. **What was measured and what was inferred, kept apart.** "Read in the
   code, certain" is marked differently from what the agent checked, and
   "not reproduced" differently from what it assumes. An item that keeps the
   two apart stays useful even when its boldest claim turns out to be false.
4. **The consequence**, meaning who notices and when. Without it the
   `impact` field has to be guessed, and a guessed impact puts the ranking in
   the wrong order.

A report doesn't include a fix nobody has tried, a cause nobody has checked,
or a severity chosen to get attention. Attention is what the `priority`
field is for.

## 4. Triage when you open it

```sh
naima triage set <item> impact=high priority=next confidence=reported
```

| Field | How to decide it |
|---|---|
| `impact` | if nobody touches this, who notices? `blocker` stops a release or loses work; `high` stops a user; `medium` is worked around; `low` only we would notice |
| `priority` | when: `now` · `next` · `later` · `parked` |
| `confidence` | do we understand it? `measured` · `diagnosed` · `reported` · `unclear` |
| `effort` | **never guessed.** Nothing in a report says what a fix costs, so leave it empty until someone has looked at the code. An unsized item sinks in the ranking, and that is the right outcome |

**Classifiers take the project's values.** The fields `area` (where the
item lives) and `kind` (the mode of work; a role's name is a kind) take the
values the project lists, if it lists any. `naima types` prints each list
with how many items hold each value, and marks any value that is not on the
list. The agent picks a value from the list. A new value is defined in
`naima.json`'s `extends`, with a title and a meaning, in the same commit that
first uses it. If an off-list value is already in the tracker, `naima check`
reports it as a note from the check `values`, naming the items that hold it.
The agent reports that note and never rewrites those items just to make it
go away. `gate` and `epic` are fixed lists, so a gate that no plugin
contributes, or a `part-of` link to an item that is not an epic, fails the
check.

The rule [triage what you touch](../guide/rules.md#triage-what-you-touch)
means that an agent opening, reporting or fixing an item leaves its fields
set. `naima triage` prints coverage per type, and the agent should not add
to what it reports as missing.

A `priority=now` item with nobody's [claim](../guide/glossary.md#claim-file)
on it shouldn't sit waiting for someone to ask about it. `naima view next`
has an age column (days since the field was last confirmed) and marks such
an item `unclaimed`, and `naima check` adds a note for one that has been open
longer than `plugins.triage.options.maxNowAgeDays` (3 days by default). The
agent then either claims it (`naima claim <item>`) or drops it back to `next`
if nobody is actually picking it up.

**The page is written by command, never by hand.** Two commands write the
item's page, `README.md`, and both go through every plugin's write hooks:

```sh
naima describe <item> --file triaged.md          # the description, rewritten in your own words
naima note <item> "Reproduced on 16-bit PNGs only; 8-bit keeps alpha." --by "triage agent"
```

- `naima describe` replaces the description and keeps the title line and the
  Notes section. The agent rewrites a report that an agent filed, but never
  one a person wrote; for those, the triage adds a note instead. The title is
  a field, set with `naima set <item> title="…"`, which also rewrites the
  page's title line in the same write.
- An item filed under the wrong type (a bug that is really a request) is
  moved with `naima move <item> <type>`, which keeps its id, links and notes.
  It refuses a status or a field that the new type does not declare, unless
  you pass `--force`.
- `naima note` appends a dated entry to the Notes section, recording who
  wrote it (`--by`, or else git's `user.name`) and the branch. Notes are
  append-only, so a write that changes an earlier note is refused. This is
  where the agent records what it checked, with what it measured kept apart
  from what it inferred.
- Both commands take `--file` for a longer text, and both refuse an empty one
  (exit 2).
- **What goes in is the agent's own words.** Neither command takes the
  owner's chat, so the agent paraphrases it. A verbatim quote, or a file the
  owner shared, goes in only after the owner's explicit yes, and the note
  says that they gave it
  ([the rule](../guide/rules.md#the-owners-chat-stays-private)).
- `naima attach <item> <file>` copies a file into the item's `attachments/`
  and records whose it is on the item, in the field `attached`. A file the
  owner shared goes in only after their explicit yes, which the agent
  restates, as in `--consent "Yes, attach my screenshot of the export"`. The
  agent's own material, such as a log or a test's output, takes `--own`.
  Without either option the command refuses. It also refuses a file that
  holds a secret (the check `secrets` names the line), in which case the
  agent redacts the file and attaches it again. `--as <name>` renames the
  file, and a name that is already taken is refused.
- Every one of these writes (`new`, `describe`, `note`, `set`, `attach`, and
  also `pass` and `event`) is refused when it adds a machine name, an IP
  address, a URI with a port, a home-directory path, the user's name or a
  word from the private list. The refusal lists each one with its
  placeholder, and the agent rewrites the text with `<host>`, `<ip>`,
  `<path>` and `<user>` and runs the command again. `--allow-private
  "<reason>"` lets a deliberate mention through and records why
  ([the rule](../guide/rules.md#no-machine-names-or-private-infrastructure-in-a-repository)).
- `naima check` enforces both of these. The check `attachment-consent` fails
  on an attachment that a branch adds with no record (because it was copied
  in by hand), on a record whose file is gone, and on a file of the owner's
  with no recorded yes. The check `secrets` fails on a private key with its
  body, or an AWS, GitHub, Slack, API-secret or Google key, in any project
  file or attachment. An exception is listed in the `privacy` plugin's
  options with a reason and an item, and can only be added on the trunk, so
  the list can only get shorter.

## 5. Deferring: say why, and what reopens it

Not everything that gets triaged is worked on now. An item with
`priority=parked`, a bug set to `wontfix` or a todo set to `dropped` is a
**deferral**, and nothing about it is lost. It is captured in full, like any
other item (steps 2–4), with its reason on the page. The agent then sets
[`reopensWhen`](../guide/glossary.md#reopenswhen), either as prose or as a
link to the item or document whose change would make it worth discussing
again. `naima check` reports an item that has no reason or no `reopensWhen`,
because a deferral nobody can act on tends to be argued over again, without
anyone noticing, the next time someone runs into the problem.

`naima view parked` lists every parked, wontfix or dropped item with its
trigger. The agent reads it before opening a new item that looks familiar.
If what is being reported is already there, the agent tells the owner it was
already raised and points to the existing item and its `reopensWhen`,
instead of triaging a duplicate. Once `reopensWhen` has come true, the agent
reopens the item (`naima set <item> priority=next` or
`naima set <item> status=open`) instead of filing a new one.

A project can declare its own authoritative documents, meaning which page to
trust for a given kind of status, in `plugins.triage.options.documents`, and
`naima guide` prints them first. A project rule can also say this
explicitly; this project's rules (`naima rules`) include "no new status or
summary document — update the authoritative one". In that case the agent
updates the document named there and does not start a new one beside it.

## 6. Cross-reference instead of repeating

Items refer to each other by permanent id, using `naima link`, and never by
a slug written in prose:

- a test `verifies` the item it proves;
- a duplicate is `duplicate-of` its twin, and the twin keeps the evidence;
- an item that waits on another is `blocked-by` it.

## 7. Whose hands does the proof need

The field `runBy` says who can perform the
[gesture](../guide/glossary.md#gesture), depending on the instrument it
needs:

- `agent` means a command settles it, such as a unit test, a grep or an API
  call;
- `agent-hands` means an agent driving the running software settles it;
- `human` means only a person can do it, and `humanBecause` says why
  ([asking the human](asking-the-human.md));
- `build` means it needs an artefact that nobody here makes.

This field deserves more care than any other, because it decides who picks
the gesture up, and a mistake in either direction is expensive.

## 8. Closing

A fix on its own doesn't close an item. Closing takes the fix (`fixedOn`), a
gesture that proves it, filed as an item linked `verifies`, and that gesture
performed and passed. Then `naima close` moves the item to the archive along
with its [proof](../guide/glossary.md#proof), so that a regression is
recognised if it comes back. An item that is fixed but not yet proven stays
open, because something that looks right may still behave wrongly.

The proof must also be **current**. `naima close` refuses when:

- an item verifying it **refutes** it, such as a test that `failed` or a
  property that is `violated`, because evidence against a claim outweighs
  any evidence for it;
- `naima check` finds a problem on an item verifying it, such as a property
  whose model, included file, tool version, property text,
  [verifier](../guide/glossary.md#verifier) or options have changed since
  its run. The agent performs the gesture again (`naima verify`) and then
  closes.

An agent never closes an item, or sets `holds`, by editing `meta.json` or
moving a directory. Every write hook that would refuse the change has a
matching check, so a hand edit fails `naima check`. The check
`closed-not-claimed` catches an archived item that the branch you stand on
still claims, and `property-evidence` catches a `holds` with no current run.

## Safety rules

- **No attachment with no consent record.** Enforced by the check
  `attachment-consent`, which fails on a file copied in by hand, on a record
  whose file is gone, and on a file of the owner's with no recorded yes.
- **No secret in an item or an attachment.** Enforced by the check `secrets`.
- **A fixed item is never closed without a passing proof.** Enforced by
  `naima close` and the check `closed-carries-proof`.
- **No write a command would refuse, made by hand.** Enforced by the check
  that matches each write hook protecting a state: `closed-not-claimed`,
  `property-evidence` and `epics`.
- **Evidence against a claim outweighs evidence for it.** Enforced by `naima
  close`, which refuses an item that a verifying item refutes.
