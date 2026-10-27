---
description: Route what was said, seen or found · to its tracker, triaged
argument-hint: [what was said]
---
$ARGUMENTS

Flow: [reporting and triage](../../../../docs/agents/reporting-and-triage.md) —
it owns the routing table.

1. **Write it before you understand it**: `naima new <type> "<what happened>"`
   — add `--dedupe` to see likely duplicates of the same type before it
   writes (it still writes; link, don't refile). Broken → `bugs`; work →
   `todos`; wanted → `features`; to be tried → `tests`; a decision → `decisions`;
   a deferral → say why.
2. **The page carries**: what happened, in your own words (the owner's words or
   files only with their yes), the evidence, measured apart from
   inferred, the consequence. Write it with `naima describe <item> "<text>"`
   and record what you checked with `naima note <item> "<text>" --by <who>`;
   never edit `README.md` by hand. Commands and output exactly, but redacted
   first: `<host>`, `<ip>`, `<path>`, `<user>` for machine names, addresses,
   home paths and user names
   ([the rule](../../../../docs/guide/rules.md#no-machine-names-or-private-infrastructure-in-a-repository)).
3. **Triage it now**: `naima triage set <item> impact=… priority=… confidence=…`.
   `effort` only if you have looked at the code. For a feature or a bug,
   record whether its behaviour has states or concurrency:
   `naima set <item> stateful=true` (or `false`); a stateful one starts
   from a model.
4. **Elicit the requirement it carries**: does it add or change one? File it
   (`naima new requirements … --dedupe`), revise it, or `naima spec revise`;
   restate it so a test can decide it; settle how it is checked (a test, a
   property of a model, or a metric with a budget), asking the owner only
   for the number
   ([elicit](../../../../docs/agents/reporting-and-triage.md#elicit-the-requirements-it-carries)).
5. **Link, don't repeat**: `naima link <a> <relation> <b>`.
6. `naima check`.

"I already told you" means it was lost: write it now and say it was missing.
