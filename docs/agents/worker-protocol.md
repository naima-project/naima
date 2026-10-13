# Worker protocol

What a [worker](coordinator-and-workers.md) owes the coordinator, stated once
so no worker invents its own shape. It does not replace
[reporting and triage](reporting-and-triage.md) (that is for an item) or
[closing a worktree](closing-a-worktree.md) (that is the procedure); this page
is the contract a worker's report must meet, and how several workers are
brought back together.

## The report has a fixed shape

1. **The acknowledgement line**, when the project's rules ask for one
   ([giving it back](read-the-project-rules.md#giving-the-acknowledgement-back)) —
   first, exactly as printed, so the coordinator can check it
   (`naima rules check-ack`) before reading the rest.
2. **What changed** — the work, in the worker's own words, a line or two.
3. **Red before green, shown, not claimed.** "Tests pass" is not evidence;
   the failing run that preceded the fix is. A worker that cannot show the
   red run did not prove the green one — rerun the gesture from a clean
   state, or say plainly that it was not captured.
4. **The gate numbers**, as the commands print them, each with the number it
   is compared to ([the common gates](coordinator-and-workers.md#gates-run-after-a-batch-not-after-every-commit)).
5. **The queue after the change** (`naima queue`), which may go up — that is
   why it is announced, not hidden.
6. **What the owner must decide** — one question, or none.

Never a preamble, never the number before the work, and never a restatement
of what is already committed, filed or noted: if it is worth explaining, it
belongs in the commit, the item or the session note, not in the chat.

## Two workers, one file

A worker stays inside its own worktree and the files the coordinator assigned
it; it never widens scope into a file another worker was given in the same
wave. Catching the case where two workers touched the same file anyway is a
check, not a document — filed as its own item, not built here — but the rule
a worker follows until that check exists is: **read the wave's file list
before writing, and stop if a path on it is not yours.**

## Finished workers are merged together, not one at a time

The lead developer does not merge the first worker to report and leave the
rest waiting on a second pass. Once more than one branch is ready, it runs
the landing train over all of them in one sweep — gates between each
landing, each one `naima land <branch>` — so that a conflict between two workers'
branches surfaces during the train, where whoever is merging is looking at
both, rather than later as a mystery regression on the trunk. A single
finished branch with nothing else ready merges on its own; it does not wait
for company.

## Safety rules

- **A worker never merges its own branch.** Convention, restated from
  [the jobs table](coordinator-and-workers.md#the-jobs): merging is the lead
  developer's refusal to grant, not the implementer's to take.
- **A worker never closes its own branch's items.** Enforced by `naima close`,
  which refuses an item the branch you stand on claims
  ([closing a worktree](closing-a-worktree.md#not-part-of-closing)).
- **Red is shown, not claimed.** Candidate property for a later model: no
  check yet confirms a report carried a captured failing run before its
  passing one; until then this is read, not verified.
- **No two workers touch one file in a wave.** Candidate property for a later
  model, pending the file-overlap check named above.
