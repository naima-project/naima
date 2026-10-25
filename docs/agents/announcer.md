# Announcer

The announcer is the role that tells the outside world what the project does, in release notes, changelog entries, the copy on the site and in the README, and
announcements. The coordinator staffs a worker for this role from its queue. The worker draws only on what `naima announce` computes as announceable, so the
project never promises something that isn't true.

## Queue, owns, refuses, hand-off

- **Queue**: a release handed off from [the release role](release.md) at its announce stage, items of kind `announcement` (`naima queue --role
  announcer`),
  and a `copy-names-only-announceable` problem from `naima check`.
- **Owns**: the words that go outside. That means what the release notes say and in what order, and what the README and the site claim. They are written from
  `naima announce`, never from memory or from branch names.
- **Refuses**: announcing a feature that isn't announceable, that is, one that isn't user-facing, shipped, documented and checked by a person or end to end. It
  also refuses to decide _when_ to announce, which is the release role's call, and before that the owner's.
- **Hand-off**: the page itself goes to [the documentarian](documentarian.md). If someone wants a feature announced that isn't announceable, it goes back to the
  [lead developer's](coordinator-and-workers.md#the-jobs) queue with a note of what it lacks, and it isn't announced on the promise that it will be.

## What is announceable

Nobody declares a feature announceable, because `naima announce` computes it. A feature is announceable when all four of these hold:

| It is           | Because                                                                                                                                                                                                                                                  |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **user-facing** | `facing=user`: someone using the software sees it; `facing=internal` is never announced                                                                                                                                                                  |
| **shipped**     | its status is `shipped` (the option `shippedStatuses`)                                                                                                                                                                                                   |
| **documented**  | its `docs` field names the page that documents it                                                                                                                                                                                                        |
| **checked**     | a passed item `verifies` it, run by a person (`runBy=human`) or by an agent driving the running software, end to end (`runBy=agent-hands`), or with the owner's gesture as evidence (`evidenceKind=owner-gesture`) — and nothing verifying it refutes it |

A unit test alone doesn't make a feature announceable. It proves the code, but not that someone using the software gets what the copy says.

## Writing release notes

1. Run `naima announce --gate <gate>` for a release off a gate, or `naima announce --since <YYYY-MM-DD>` for everything since the last one. Features marked
   `major=true` come first, so lead with them.
2. `naima announce --all` adds every user-facing feature that isn't announceable, each with what it lacks. Leave those out of the notes, and hand off what they
   lack as described above.
3. Write the notes in the project's words, one line per feature, from the feature's title and its docs page. Nothing from the owner's chat goes in word for word
   ([the rule](../guide/rules.md#the-owners-chat-stays-private)). Where the project keeps change notes (a `changes/` folder with a `config.json`),
   `naima changes --from <previous tag>` gives the changelog part: every change of behaviour in the range, breaking changes and those that need an action first,
   each with what a user has to do. Take what to do from there, and the features to announce from `naima announce`.
4. Before handing off, run `naima check`. Its `copy-names-only-announceable` check fails if the README, or any other file in the option `copy`, names a feature
   that isn't announceable, either by its label or by its full title.

## Safety rules

- **Only announceable features are announced.** Enforced for the copy files by `copy-names-only-announceable` (`naima/src/plugins/announce/index.ts`). For
  release notes it is a convention, kept because they are written from `naima announce`.
- **Announcing waits for the post-release checks.** Convention, held by [the release role](release.md), whose announce stage runs last.
