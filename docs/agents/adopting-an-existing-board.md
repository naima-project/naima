# Adopting an existing board

Sometimes a project that starts using Naima already keeps its work in a file,
such as a `TODO.md`, a notes file or an issue list in markdown. Bring that
file in with `naima adopt` rather than retyping it, because a report that
gets retyped can get lost on the way. The person's side is
[adopt an existing board](../guide/adopt-an-existing-board.md), and this page
is the procedure. A worker does it on its own branch, and the owner only
decides what the audit and the link proposals leave open.

## The procedure

1. **Claim and branch** as for any other work
   ([opening a worktree](opening-a-worktree.md)).
2. **Propose**, and read the dry run of `naima adopt propose <file>`. Then
   run it with `--write` and read `git diff <file>`, which must add lines and
   delete none. Where the guess is wrong, fix the markers by hand, whether
   that is a type, a key, a status, or a pair of markers that cuts one item
   in two. Commit the marked file on its own, so that the items'
   `adoptedFrom` names a commit.
3. **Split** with `naima adopt split <file>`, then again with `--write`.
   Commit the new items and `naima-data/adopted/<file>.json` together.
4. **Audit** with `naima adopt audit <file>`. It exits 1 as long as some line
   of any committed version isn't carried by an item or by board prose. Each
   such line is either carried, by putting it back in the file and adopting
   it or by writing it into an item by hand, or it is reported to the owner
   as a decision. None is dropped without saying so.
5. **Links** come from `naima adopt links <file>`. Write only the proposed
   ones (`--write`), which rest on a real commit that both items name and on
   shared wording. The rest, meaning links with only a shared commit or only
   shared wording, and gate candidates, go to the owner as a list to decide
   ([asking the human](asking-the-human.md)). Don't link items or declare a
   gate on wording alone.
6. **Triage** the new items like any others
   ([reporting and triage](reporting-and-triage.md)).

## Never

- Delete, empty, move or rewrite the source file. Retiring it is the owner's
  decision, once the audit says nothing is missing.
- Edit an adopted item to match a later change in the source. `split`
  reports the change, and if it matters you carry it over with `naima note`.
- Edit the record in `naima-data/adopted/`, because it is what proves the
  round trip.
