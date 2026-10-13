---
description: Before merging · the eight steps
---
Flow: [closing a worktree](../../../../docs/agents/closing-a-worktree.md). This is
the sequence, not the reasoning; where the two disagree, the page wins.

0. **Mark the branch preparing**: `naima claim --preparing` — `naima check`
   then notes trunk commits the branch lacks, and those made on the trunk directly.
1. **Every fix names its gesture**: a test item linked `verifies`, with `runBy`
   (and `humanBecause` if a person's).
2. **Triage what is left**: `naima triage missing`; set `effort` where you know it.
3. **Release claims from the worktree**: `naima release <item>...`; commit the deletion.
4. **Session note**: `naima pass "what changed, what is proven, what is left"`,
   redacted first: `<host>`, `<ip>`, `<path>`, `<user>`, never the real ones
   ([the rule](../../../../docs/guide/rules.md#no-machine-names-or-private-infrastructure-in-a-repository)).
5. **Run the gates and read what breaks**, including `naima check`.
6. **Merge the trunk into the branch**; resolve here; run the gates again.
7. **Hand over**: `naima claim --not-preparing`, commit; then `git merge --ff-only <branch>`. If it refuses, STOP.
8. **Only then** `naima prune --branch <branch> --write` (worktree and branch);
   unmerged work needs `--archive`, which tags it `archive/<branch>` first.

Never close the branch's own items: fixed is not resolved.
