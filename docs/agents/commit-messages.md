# Commit messages

This page says what a commit message must contain. The
[owner](../guide/glossary.md#owner) reads messages but never diffs, so the
message has to tell them what changed without opening the code, and it has to
let a later reader tell what was actually run against the software from what
was only written. Every agent that commits follows it, whether that is a
worker on its branch or the coordinator. This page is the
contract, and [git, handled for the owner](git-for-the-owner.md) is the wider
practice it belongs to.

## One commit does one thing

If a commit mixes an unrelated rename with a fix, neither can be undone on
its own. Small commits with one idea each are already
[the practice](git-for-the-owner.md#4-use-git-so-nothing-is-ever-lost), and
this page is about what the message then says.

## The subject says what changes, not which function moved

The owner can't read a function name and know what they can now do that they
couldn't before, so write the effect:

- not "refactor `claim()`" — "a claim file now survives a crash mid-write"
- not "update docs.md" — "the triage page explains `effort` before `impact`"

## The body says what was not verified live

Suppose a message lists only what was done and says nothing about what wasn't
checked against the running software. Someone reading it later will assume
the silence means everything was tried, and the message becomes a false
"done". So whenever something was written but not run, such as a path that
wasn't exercised or a case that was reasoned about rather than seen failing
and then passing, the body says so in plain words. It does this every time it
applies, because leaving it out hides a gap that the message should name.

## Tokens reserved for the human verdict

A commit records what an agent did and measured. It never uses the words
that mean a person judged the result, such as "approved", "looks good" or
"signed off". An agent didn't make that judgement, and a message that reads
as if it did leads the next reader to skip the step. Those words appear only
in a [decision](../guide/glossary.md#decision) item or a note attributed to
the owner, and an agent never types them into a commit body.

## The records that go with a change, in the same commit

A record that is meant to be written "later" never gets written, which leaves
a fix with no test to prove it or a change with no note. A project's companion
rules say which records a change must carry in the commit that makes it
([commit hooks](../guide/commit-hooks.md)). Before committing a write to the
tracker:

1. Run `naima hooks` to list the companion rules. The built-in one is
   `fixed-has-test`, which says that setting `fixedOn` comes with a linked
   verifying test.
2. Stage the change, then run `naima check --staged`. Each problem it reports
   names the item, what it lacks and the rule. Add the missing record to the
   same commit.

If the project has run `naima hooks install`, the pre-commit hook runs that
check by itself on any commit that touches the tracker or a rule's paths, and
on no other. `git commit --no-verify` skips the hook, and a commit that skips
it says why in its body.

The hook reads the staged files but never the message. So a commit that sets
`fixedOn` without a line in its body about what was and wasn't verified is
still only caught by someone reading it.

## Safety rules

- **One commit does one thing.** Convention:
  [git for the owner](git-for-the-owner.md#4-use-git-so-nothing-is-ever-lost).
- **No human-verdict token written by an agent.** Candidate property for a
  later model. Nothing yet searches a commit body for a reserved token, and
  that check is filed as its own item rather than built here.
- **The records a change requires are in its commit.** Enforced by the
  `companions` check (`naima check --staged`, and the pre-commit hook once
  installed), described in [commit hooks](../guide/commit-hooks.md).
- **A `fixedOn` commit with no verified/not-verified line is caught.**
  Candidate property for a later model. The pre-commit hook doesn't read the
  message, so until a check does, someone has to read it.
