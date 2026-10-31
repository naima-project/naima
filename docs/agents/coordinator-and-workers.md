# The coordinator and the workers

This page is about how a session is staffed when agents do the work. It doesn't replace [worktree isolation](worktree-isolation.md), which says what may be
written where. This page says who does what.

## The shape

There is one coordinator, and every piece of work is done by a worker in the background. The coordinator doesn't do the work itself. Its job is to hold the
conversation with the owner.

```
    owner
      │  one question at a time, answers, decisions
      ▼
COORDINATOR ── the trunk's one writer; drives a running app, a device
      │
      ├── worker ── own worktree, own branch ── reports ──┐
      ├── worker ── own worktree, own branch ── reports ──┤
      └── worker ── own worktree, own branch ── reports ──┘
                                                          │
                          naima land <branch> ◀───────────┘
```

### What the coordinator does, and only this

- It talks to the [owner](../guide/glossary.md#owner), one question at a time, and only asks questions that are the owner's to answer
  ([asking the human](asking-the-human.md)).
- It holds anything that only one actor may drive at a time, such as a running application, a device or a deployment. A worker never drives one of these unless
  it is explicitly handed over, and in that case the coordinator doesn't touch it until the worker reports.
- It treats the owner as a resource holder too. While the owner is at the keyboard, the coordinator asks before a restart or a rebuild. Once he is away, it can
  do them without asking. While he is making a decision, that decision comes first and the work that depends on it waits, so the coordinator doesn't restart or
  rebuild around him just to keep busy.
- It is the trunk's single writer. Only the coordinator lands branches on the trunk, pushes it, publishes the site and makes releases, all from the trunk.
  Nothing is locked, because nothing else writes to them ([the rule](../guide/rules.md#no-locks-the-coordinator-is-the-single-writer)).
- It spawns workers, merges their branches, and keeps the queue accurate.
- It sets a timer to bring itself back when nothing else will, so the owner never has to be the reason work starts again. This is
  [the non-stop loop](the-non-stop-loop.md): an explicit target written down first, a wake-up every three minutes, stopping only when what is left is the
  owner's, and an ordered list of the owner's actions as the result.

### What a worker gets

A worker can't ask questions, so the coordinator gives it everything it needs to work without asking:

- **its own worktree** off the [trunk](../guide/glossary.md#trunk), with its own branch and its dependencies installed, since a fresh checkout has none;
- **the item, already filed**, because a worker reads a tracker page rather than inventing its own scope, and it claims what it takes (`naima claim`);
- **what has already been measured**, stated as given so that the worker doesn't work it out again, which is the biggest single saving there is;
- **the gates**, with their current numbers, to run at the end;
- **the constraints**: it only prepares work on its branch and never lands, pushes the trunk, publishes or releases; it doesn't commit on the trunk or touch
  another [worktree](../guide/glossary.md#worktree); and it is told which sibling branches' files it must stay out of;
- **no sub-agents of its own**, because a worker that spawns workers loses all of their work when it stops;
- **the acknowledgement line to give back**, which starts every report ([read the project's rules](read-the-project-rules.md#giving-the-acknowledgement-back)).

## The jobs

| Job                | Owns                                                                                                                                                                  | Refuses                                                                                                              |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| **Coordinator**    | the conversation, the trunk as its single writer (landing, pushing, publishing, releasing), the timer, spawning and merging                                           | work a worker could do; more than one question at a time                                                             |
| **Lead developer** | the queue: sweeping fixed-but-unproven [items](../guide/glossary.md#item), preparing branches, the landing train                                                      | merging without the [gates](../guide/glossary.md#gate); closing an item on reasoning; closing its own branch's items |
| **Implementer**    | one item, one cause, one branch                                                                                                                                       | widening scope; spawning workers; touching the trunk                                                                 |
| **Tester**         | performing gestures on the running software and writing down what happened                                                                                            | fixing what it finds; testing what it just wrote                                                                     |
| **Filer**          | classification, [triage](../guide/glossary.md#triage) fields, reports routed to the right tracker                                                                     | inventing scope; deciding whether something is proven                                                                |
| **Evidence owner** | whether a gesture proves the claim, weighed by [the evidence ranking](../guide/prove-and-close.md#3-perform-it-keep-the-evidence) and red-then-green for a regression | performing the gesture it then judges                                                                                |

These jobs, and the outward ones (the release manager, the documentarian, the [announcer](announcer.md), the community steward, the business role and the
verification engineer), are data. `naima roles` lists each one with what it owns and refuses, and `naima queue --role <role>` shows one role's queue, most
urgent first. An item is on a role's queue because of its `role` field when that is set. Otherwise it goes by the item's `kind` (`code` belongs to the
implementer, `test` to the tester) or by its type (every `tests` item belongs to the tester, and every `releases` item to the release manager). The coordinator
staffs a worker for a role from that role's queue.

Work passes between the jobs in one direction:

```
report ─▶ filer files it ─▶ lead developer triages and ranks
                                    │
                                    ▼
                      implementer fixes it (own worktree)
                                    │
                                    ▼
          lead developer sweeps, runs the gates, merges ─▶ trunk
                                    │
                                    ▼
             tester performs the gesture ─▶ evidence owner closes it
```

No step gets skipped because it seems obvious. Two of the arrows look as if they could be skipped, naming the gesture for a fix and judging a gesture someone
else performed, and those are exactly where work gets lost.

### The lead developer's three jobs

1. **The sweep.** This covers items whose fix has already landed but whose [proof](../guide/glossary.md#proof) was never linked. Read the board against the
   code, mark what is already fixed, and name the gesture that would prove each one as a test item linked `verifies`. Without the sweep, several sessions each
   open the same item and each find out it is already fixed.
2. **Preparing branches** so that the trunk is their ancestor. That means merging the trunk in first, running the gates over the combined result, releasing the
   claims and writing the session note ([closing a worktree](closing-a-worktree.md)).
3. **The landing train.** Finished branches are landed in order with `naima land`, with the gates run between them, and each landing is a
   [marker](../guide/glossary.md#marker) naming the items it closes, followed by the commit that adds the marker to those items' `commits`, so `naima close`
   needs no `naima set` first. If `naima land` refuses, stop. When it lists properties that are not current after a landing, the coordinator runs `naima verify`
   on them on the trunk before the next landing, or files a bug for one that is now violated.

The lead developer never merges without the gates and never closes an item on reasoning alone, because "the code clearly does this now" is a diagnosis, not a
measurement. It also never closes its own branch's items.

### The tester and the resource holder are different actors

An actor that both drives the software and writes the assertion can't tell a fact about the software apart from the current state of something it can edit,
because to that actor both happen in the same motion. So keep the two apart. The tester prepares or performs the gesture, and the evidence owner judges it.

## Choosing the model

A worker's model is a parameter, and choosing it well saves more than anything else. Give each task the cheapest model that can do it. Mechanical or read-only
work goes to a smaller, faster model: filing, triage, classification, merges, audits, searches, running gates, and edits whose shape is already decided. Keep
the strongest model for diagnosis and design, where being wrong can cost a day. Never put every worker on the strongest model by default.

When you start workers, say in one line each what you started: the worker, its branch, its model and why that model. The owner sees what is being spent without
asking.

## How many at once

Two workers at once is the standing number, and three only for short, cheap work that can run in parallel. The budget limits concurrency as much as the load
does, because too many expensive workers at once use it up and die in the middle of their tasks. Group related small items into one unit before staffing: one
worker, one worktree, one branch, opened with `naima open <item> <item>`.

`naima open` enforces the bound: it refuses a new worker worktree once as many are open as the coordination option `maxWorkers` allows (3 by default), and names
the open ones. Free one that has landed with `naima prune --branch <branch> --write`. Raise the bound only when the owner asks for it, in `naima.json`;
`naima hello` states the bound in one line, with the reminder that the owner can ask to change it, and the coordinator passes it on.

Naima feeds itself from the ready queue. When a meeting with the owner closes, the work its decisions call for is approved package by package, queued or to
start now (`naima meeting <meeting> --close`). Whenever fewer workers are open than `maxWorkers` allows, the coordinator starts the next item of
`naima queue --ready` with a worker, without asking: `naima hello` and `naima claims` name the items to start, and the check `ready-work-waiting` notes a slot
left idle while approved work waits. Nothing is started while a meeting is on; the model of this is `develop/models/meeting/` in the workshop.

When a worker dies, the coordinator salvages its work before spawning a replacement. The dead worker's worktree still holds everything it hadn't committed.
Separate the real work from mechanical churn, commit the work as WIP marked unreviewed, and give the replacement that commit to read instead of starting it from
nothing.

## Gates run after a batch, not after every commit

A worker commits freely, in small commits with one idea each, and runs the full gate set once per batch. If the batch comes back red, `git bisect` over its own
commits finds the culprit, which is what the small commits are for. It commits before running the gates, so that a red gate never costs uncommitted work. A
branch is never reported as done while its gate set hasn't been run.

## Reporting

Workers report to the coordinator, never to the owner, in the shape that [the worker protocol](worker-protocol.md) sets out: what changed, the red result shown
before the green one, the gate numbers, the queue after the change, and one question or none. The coordinator's own reply to the owner keeps the same order and
the same restraint. It has no preamble, it doesn't put the numbers before the work, and it doesn't restate what was just committed or filed. Anything worth
explaining belongs in the commit.

Every report starts with the acknowledgement line that the project's rules ask for (`naima rules --audience agents`, its last line). A worker that leaves it out
hasn't made a proper report. The coordinator checks the line before trusting the rest of the report, by running `naima rules check-ack <file|->` on the worker's
reply, which names any missing phrases. If the line is wrong, the coordinator reports that to the owner rather than patching over it.

A worker also says what it is doing while it works, not only when it finishes. At every change of step, and at least every few minutes during long work, it runs
`naima claim --step "<what I am doing now>"`. The step is written in the branch's claim with the time it was posted. It replaces the previous one and needs no
commit, because `naima claims` reads every worktree's files as they are on disk. Long commands, the gates included, go through `naima run`, so their progress is
visible as well.

While workers run, the coordinator reads `naima claims` at least every few minutes, and when the owner asks, it says what each worker is doing. Each claim shows
its step and how long ago it was posted. A claim whose last sign of life is older than the coordination option `silentAfter` (15 minutes unless the project sets
another number) is flagged "silent for N min — possibly stuck". The last sign of life is the later of the step and the branch's last commit. The coordinator
checks that worker's run and worktree, then reports it to the owner as possibly stuck. The rule is shipped by the coordination plugin, so `naima rules` lists
it.

When a worker is dead or stuck, the coordinator briefs the worker that resumes it from `naima recover <branch>`. It prints the claim's items and last step, the
commits the trunk lacks, what is not committed in the worktree, and the last entries of the stuck worker's agent transcript (its last steps and commands, each
cut to a line; `--tail <n>` asks for more). The transcript holds what the stuck worker found or decided and never wrote down. The coordinator passes those lines
to the new worker in its brief and nowhere else: never into an item, a note, a commit or any other file, since the owner's chat stays private.

A claim whose work is done is listed apart, at the end of `naima claims`, as stale, and is not counted as work in hand. A claim is stale when its branch is
gone, when its branch is merged into the trunk and the trunk carries the claim file the merge brought, or when every item it claims is done or closed.
`naima check` adds one note per stale claim with the command that releases it, `naima prune --write`, and the branch to run it on when the file is not on the
trunk's disk. A live claim that still names a closed item is noted too, with the `naima release` that drops it.

The coordinator runs `naima stale` at the start of every session and again before ending one. It lists every branch, worktree and claim left behind by a worker
that stopped: those whose claim is stale, and those with no commit, step, session note or uncommitted change for `staleAfter` hours (24 unless the project sets
another number). Each entry comes with its facts and a next step. Resume means handing the worktree to a new worker, who reads `git status` there first and
never discards anything. Land means running the branch's gates and landing it. Archive means tagging its commits and removing it. Drop means removing a branch
the trunk already holds, or a claim whose branch is gone. `naima summary` shows the same list in its "stale work" section.

## Safety rules

- **A worker never merges.** Candidate property for a later model. Nothing yet checks that a commit merging into the trunk came from the lead developer's
  session rather than a worker's. Today this is read from [the jobs table](#the-jobs), not verified.
- **A branch never closes its own items.** Enforced by `naima close` ([closing a worktree](closing-a-worktree.md#not-part-of-closing)).
- **The owner is never the reason work resumes.** Convention. [The non-stop loop](the-non-stop-loop.md) sets a timer instead of waiting for a reply.
- **One question at a time.** Convention: [asking the human](asking-the-human.md).
