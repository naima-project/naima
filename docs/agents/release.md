# Release

A build that has gone out can't be called back. This page is the runbook for
the steps between a [gate](../guide/glossary.md#gate) going green and the
world seeing the result, and it describes the role that runs it: what is in
its queue, what it owns, what it refuses, and where it hands off. Releases are
made from the trunk, so this is the coordinator's work.

A release is a tag, an artefact and an announcement, and the runbook below
makes sure none of them happens before the one before it is true.

## Queue, owns, refuses, hand-off

- **Queue**: a [gate](plan-with-epics-and-gates.md) that holds, with nothing
  open on it, as `naima gates --check` reports. Nothing is released from a
  gate that doesn't hold.
- **Owns**: opening the `releases` item, running every stage in order,
  recording the output of each stage, and the one question to the owner, the
  [decision](../guide/glossary.md#decision) to ship, which this role never
  answers itself.
- **Refuses**: to judge whether the code is good enough, since that was the
  gate's job and was settled before this role starts, and to announce
  anything that isn't true yet.
- **Hand-off**: to the [documentarian](documentarian.md), for the page that
  tells people the release happened, once it has.

## Proposing a release

1. Find a gate that holds with `naima gates --check`, or with
   `naima gate show <name>` for a particular one. Don't propose a gate that
   doesn't hold.
2. Build the changelog. Where the project keeps change notes (a `changes/`
   folder with a `config.json`; Naima does), start from them:
   `naima changes --from <previous tag> > changelog.md` lists every change of
   behaviour since the last release, breaking changes and those that need an
   action first, each with what a user has to do
   ([the format](../../changes/README.md)). Then add what the gate's
   [epic](../guide/glossary.md#epic), or the gate itself, has closed since the
   last release. Run `naima list <type>` for each type the gate touches and
   keep the items whose `closedOn` is after the previous release's date
   (`naima show <previous release>` has that date in its Notes). Write one
   line per item in the owner's language rather than copying the item's
   title, because a changelog is read by users and a tracker item is written
   for agents.
3. Open the trace item at its first stage and propose the release to the
   owner with the changelog attached:
   ```sh
   naima new releases "<name or version>"
   naima describe <release> --file changelog.md
   naima decisions release   # has the owner already said go for this gate?
   ```
   If there is no standing decision, ask once, as a single question
   ([asking the human](asking-the-human.md)): "the gate holds, here is the
   changelog — ship it?" Record the answer with `naima new decisions "…"`,
   linked `settles` to the release.

## The runbook

The release item starts as `staging`, at its first stage, and
`naima view releases` shows what it still needs. Record the output of each
stage with `naima note <release> "Stage: <name>\n<what happened>"` before the
next stage starts. If a stage is skipped on purpose, the note says who
decided, as `Stage: <name> — skipped, decided by <who>`. The project refuses
a write that asks for `status=released` while a stage is unrecorded
(`release-stages`, in `naima/src/plugins/planning/index.ts`). The check works
out what it expects from the repository itself, meaning the gate's state,
whether the tag exists yet and whether the build ran, and not from what the
person or agent running the stage says happened.

1. **Pre-release checks.** The gate still holds, because things can change
   between proposing the release and running the runbook. `naima check` and
   the project's full set of gates pass from a clean checkout, not from the
   worktree that has been edited all afternoon.
2. **Private draft.** The artefact is built and put somewhere only the
   release role can see it, such as a draft release or an unlisted build, and
   not yet in the public location.
3. **Test the artefact, not the code.** Install or run the thing that was
   built rather than the source it came from, because a build step can
   quietly drop a file the tests never touched. Write down the gesture as you
   would for any [proof](../guide/glossary.md#proof): what was run, on what,
   and what appeared.
4. **Issues found → stop.** If any of the three stages above finds a problem,
   the runbook ends there. Open the bug, and go back to stage 1 once it is
   fixed. A runbook that mostly worked doesn't get published.
5. **Publish.** This means the tag, the public artefact, or making the draft
   public, whichever fits how the project is distributed. For Naima itself,
   the tag goes on the product repository (`vincenzoml/naima`), never on the
   workshop that develops it. This step can't be undone, so confirm with the
   owner first if the decision in step 2 of proposing didn't already cover it.
6. **Post-release checks.** Fetch or install the public release from where a
   stranger would get it, not from the build directory.
7. **Announce only what is true.** The changelog goes out once, after step 6
   has passed, and never earlier on the assumption that it will. Hand off to
   the [announcer](announcer.md), who writes the announcement from
   `naima announce --gate <gate>` with only the features that can be
   announced, and to the [documentarian](documentarian.md) for the page
   itself.
8. **Rollback.** This is available at any stage from publishing onwards. The
   tag isn't force-moved. Instead a fixed version is published (`vX.Y.Z+1`,
   never a rewritten `vX.Y.Z`), and the item records why, as
   `Stage: rollback`.

Whoever wrote the code doesn't run the runbook for their own branch's
release. The gate has already made sure that the merge was someone else's
decision, and this role carries out the runbook without reopening what the
gate settled.

## Safety rules

- **Nothing is released off a gate that does not hold.** Convention: run
  `naima gates --check` before stage 1, every time.
- **A release is never marked done with a stage unrecorded.** Enforced by
  the `release-stages` write hook and the matching check in
  `naima/src/plugins/planning/index.ts`.
- **Announcing precedes nothing it depends on.** Convention: step 7 runs only
  after step 6 has passed, never at the same time.
- **A rewritten tag is never published as a fix.** Convention: a rollback
  ships a new version and never force-moves the old tag.
