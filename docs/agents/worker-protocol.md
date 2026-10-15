# Worker protocol

This page sets out what a [worker](coordinator-and-workers.md) owes the
coordinator, in one place, so that no worker makes up its own format. It
doesn't replace [reporting and triage](reporting-and-triage.md), which is
about items, or [closing a worktree](closing-a-worktree.md), which is the
procedure. It covers what a worker's report has to contain and how the work
of several workers is brought back together.

## The report has a fixed shape

1. **The acknowledgement line**, when the project's rules ask for one
   ([giving it back](read-the-project-rules.md#giving-the-acknowledgement-back)).
   It comes first and exactly as printed, so the coordinator can check it
   (`naima rules check-ack`) before reading the rest.
2. **What changed**, described by the worker in a line or two.
3. **Red before green, shown rather than claimed.** "Tests pass" isn't
   evidence, but the failing run before the fix is. If a worker can't show
   the red run, it hasn't proved the green one, so it either reruns the gesture
   from a clean state or says plainly that the red run wasn't captured.
4. **The gate numbers** as the commands print them, each next to the number
   it is compared to
   ([the common gates](coordinator-and-workers.md#gates-run-after-a-batch-not-after-every-commit)).
5. **The queue after the change** (`naima queue`). It may have gone up, and
   that's why it is reported rather than left out.
6. **What the owner must decide**, as one question or none.

The report has no preamble, doesn't put the numbers before the work, and
doesn't restate anything already committed, filed or written in a note. If
something is worth explaining, it goes in the commit, the item or the session
note, not in the chat.

## Two workers, one file

A worker stays inside its own worktree and the files the coordinator gave
it, and it never extends its scope into a file that another worker in the
same wave was given. Detecting when two workers have touched the same file
anyway is a job for a check rather than for this page, and that check is
filed as its own item and not built here. Until it exists, a worker reads the
wave's file list before writing and stops if a path on it isn't its own.

## Finished workers are merged together, not one at a time

The lead developer doesn't merge the first worker that reports and leave the
others for a second pass. Once more than one branch is ready, it runs the
landing train over all of them in one go, with the gates run between
landings and each landing done with `naima land <branch>`. That way a
conflict between two workers' branches shows up during the train, while the
agent doing the merging is looking at both, instead of turning up later as an
unexplained regression on the trunk. A single finished branch with nothing
else ready is merged on its own and doesn't wait for others.

## Safety rules

- **A worker never merges its own branch.** Convention, restated from
  [the jobs table](coordinator-and-workers.md#the-jobs): merging is the lead
  developer's decision, not the implementer's.
- **A worker never closes its own branch's items.** Enforced by `naima close`,
  which refuses an item claimed by the branch you are on
  ([closing a worktree](closing-a-worktree.md#not-part-of-closing)).
- **Red is shown, not claimed.** Candidate property for a later model. No
  check yet confirms that a report included a captured failing run before
  its passing one, so for now this is read rather than verified.
- **No two workers touch one file in a wave.** Candidate property for a later
  model, waiting on the file-overlap check mentioned above.
