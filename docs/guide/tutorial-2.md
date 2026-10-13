# A second tutorial: let the company run, not just the ledger

The [first tutorial](tutorial.md) shows filing and closing one bug, by
yourself, in one checkout. This one shows the company running itself: a
feature with its definition of done, your go, a coordinator starting one
worker in its own worktree, a property proven by a verifier beside the test,
a release gate that blocks and then holds, and what is left for you at the
end. Fifteen minutes. Every output below is what the commands printed when
this tutorial was run; yours differs only in ids, dates and commit hashes.

What you need: the same as the first tutorial — a terminal and git. Pick up
from an installed project, or install one again
([install](install.md#bootstrap-a-project)); this one starts from the same
tiny `greet.sh` script.

## 1. File a feature, with a definition of done

```console
$ naima new features "Greet by name, in the user's own language"
naima-tracker/naima-data/features/greet-by-name-user-s-own-language/  a7c9927e-1a14-497e-abe0-18576aeff93b
```

Open its page and write what "done" means before anyone touches the code —
not a feeling, something the next step can check against:

```markdown
# Greet by name, in the user's own language

Today `greet.sh` always prints English. Add a second argument, the
language, and greet in that language when it is one of `en`, `it`, `fr`;
fall back to English otherwise.

## Done

- `sh greet.sh Ada` prints "Hello, Ada" (unchanged: no language given).
- `sh greet.sh Ada it` prints "Ciao, Ada".
- `sh greet.sh Ada xx` prints "Hello, Ada" (unknown language falls back).
```

Triage it, so it carries how it ranks against everything else open:

```console
$ naima triage set features/greet-by-name-user-s-own-language impact=medium priority=next confidence=reported
features/greet-by-name-user-s-own-language: impact=medium priority=next confidence=reported
```

## 2. The owner's go

A `requested` feature is only asked for; nothing starts until you say go.
That answer is a status, not a chat message lost the moment it scrolls past:

```console
$ naima set features/greet-by-name-user-s-own-language status=planned
features/greet-by-name-user-s-own-language: status=planned
```

Commit it, so the feature — filed, written up, triaged, approved — is part
of the trunk before anyone branches off it:

```console
$ git add naima-tracker && git commit -qm "File the greet-by-language feature, triaged, owner's go"
```

## 3. A coordinator starts one worker

The coordinator does not write the code; it starts a worker in a worktree of
its own, on its own branch, claiming the item there
([work on several branches at once](several-branches.md)):

```console
$ naima open features/greet-by-name-user-s-own-language --as worker --name greet-lang --note "implement the language argument"
opened ../demo-worktrees/greet-lang on worker/greet-lang, from main
claimed features/greet-by-name-user-s-own-language in naima-tracker/naima-data/claims/ecfcc32f-42c7-425f-aea7-934bf716101b.json — commit it on worker/greet-lang with the work
next: cd ../demo-worktrees/greet-lang, and install the dependencies a fresh checkout lacks
```

## 4. The worker: code, a test, and a property

From inside the worktree, the worker writes the fix:

```console
$ cd ../demo-worktrees/greet-lang
$ cat greet.sh
#!/bin/sh
case "$2" in
  it) echo "Ciao, $1" ;;
  fr) echo "Bonjour, $1" ;;
  *) echo "Hello, $1" ;;
esac
$ sh greet.sh Ada
Hello, Ada
$ sh greet.sh Ada it
Ciao, Ada
$ sh greet.sh Ada xx
Hello, Ada
```

Every "Done" line holds. Now the proof, two ways at once: a test, red on the
old code and green on the new —

```console
$ naima new tests "greet.sh greets Ada in English, Italian, and falls back on an unknown language"
naima-tracker/naima-data/tests/greet-sh-greets-ada-english-italian-falls/  c9bf0c9a-c403-45de-a806-c4e1788bf830
$ git show main:greet.sh | sh -s Ada it   # the old code: red
Hello, Ada
$ sh greet.sh Ada it                      # the new code: green
Ciao, Ada
$ naima link tests/greet-sh-greets-ada-english-italian-falls verifies features/greet-by-name-user-s-own-language
tests/greet-sh-greets-ada-english-italian-falls verifies features/greet-by-name-user-s-own-language
$ naima set tests/greet-sh-greets-ada-english-italian-falls status=passed evidenceKind=diff redSeen=2026-10-01
tests/greet-sh-greets-ada-english-italian-falls: status=passed evidenceKind=diff redSeen=2026-10-01
```

— and a [property](prove-and-close.md#properties-proven-by-a-tool), checked
by a verifier rather than read by eye. The example adapter every project
ships (`example-regex`) treats the script itself as the model and a regular
expression as the property; a real project would name `mcrl2` or `voxlogica`
here instead, over its own model:

```console
$ naima new properties "greet.sh greets in Italian"
naima-tracker/naima-data/properties/greet-sh-greets-italian/  a05aac81-2d94-479e-8aa6-d609e0dcb765
$ naima set properties/greet-sh-greets-italian verifier=example-regex model=greet.sh property='some it\) echo "Ciao'
properties/greet-sh-greets-italian: verifier=example-regex model=greet.sh property=some it\) echo "Ciao
$ naima verify properties/greet-sh-greets-italian
holds     properties/greet-sh-greets-italian  greet.sh greets in Italian
```

A feature backed by a test and a property is backed twice over: the test
proves the behaviour a person cares about, the property states a fact about
the code itself and a tool checks it on every run, not only the day it was
written.

## 5. Ship it, commit, release the claim

```console
$ naima set features/greet-by-name-user-s-own-language status=shipped docs=USAGE.md
features/greet-by-name-user-s-own-language: docs=USAGE.md
$ git add -A && git commit -qm "Greet by name, in the user's own language"
$ naima set features/greet-by-name-user-s-own-language commits=9d81f04
features/greet-by-name-user-s-own-language: commits=9d81f04
$ naima release features/greet-by-name-user-s-own-language
released 1 on worker/greet-lang
removed naima-tracker/naima-data/claims/ecfcc32f-42c7-425f-aea7-934bf716101b.json — commit the deletion on worker/greet-lang
$ naima pass "Greet by language shipped, proven by a test and a property; owes nothing"
wrote naima-tracker/naima-data/passes/2026-10-01-40d543d9-b61b-4251-a5b2-f5dccc1f51dc.md — commit it on worker/greet-lang with the work it describes
$ git add -A && git commit -qm "Release the claim, session note"
```

`docs=USAGE.md` is the rule
([features are documented as part of their implementation](rules.md#features-are-documented-as-part-of-their-implementation))
held automatically: a feature cannot be marked `shipped` without naming where
it is written up.

## 6. The coordinator lands, and declares a release gate

Back in the main checkout, `naima land` puts the branch on the trunk as one
[marker](glossary.md#marker) commit naming the item it closes, taken from
the claim the branch released. It refuses rather than risk an overwrite if
the trunk had moved underneath:

```console
$ cd ../demo
$ naima land worker/greet-lang
landed worker/greet-lang on main: 9ec50a9d41c2, closing features/greet-by-name-user-s-own-language
next: naima close each item once its proof is checked, then naima prune --branch worker/greet-lang --write
```

By hand, the same commit is `git merge-base --is-ancestor main
worker/greet-lang && git merge --no-ff worker/greet-lang -m "Land
worker/greet-lang" -m "Closes: <item id>"`.

Then the gate a release waits on
([plan with epics, milestones and gates](plan-with-epics-milestones-and-gates.md)):

```console
$ naima gate new v1 "First release" --says "Greeting speaks the user's language" --version v1
gate v1 declared in naima-tracker/naima-data/naima.json — put items on it: naima gate add v1 <item>...
$ naima gate add v1 features/greet-by-name-user-s-own-language
features/greet-by-name-user-s-own-language: on gate v1
$ naima gates v1 --check
v1 — First release (version v1): HOLDS
```

Had the gate been declared before the merge, it would have printed `BLOCKED
by 1` and named the feature — this is what "a release gate holding" means in
practice: nothing is said to hold until the work that backs it is actually on
the trunk.

## 7. What is left for you

```console
$ naima queue --human
all gates: 0 open — agent 0, human 0, build 0, unclassified 0
  with no code yet: 0; owing only proof: 0
$ naima claims
no claims
```

Nothing. The feature was asked for, approved once, built by a worker in its
own worktree, proven twice (a test and a property), shipped with its
documentation, merged, and its gate holds — without you doing any of the
work, and without being asked anything you had not already decided in step 2.
[How the project runs](how-the-project-runs.md) is the same flow, in full;
[what happens while you are away](while-you-are-away.md) is what a coordinator
does with several workers at once.
