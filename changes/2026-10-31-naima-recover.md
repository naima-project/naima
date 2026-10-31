---
title: naima recover briefs the worker that resumes a dead or stuck one, with the tail of its agent transcript
kind: feature
affects:
  - usage
  - workflow
commands:
  - added recover
---

`naima recover <branch>` prints what the worker that takes over a dead or stuck one needs: the claim's items and last step, the commits the trunk lacks, what is
not committed in its worktree, and the last entries of the stuck worker's agent transcript (12 unless `--tail <n>` says otherwise, each cut to a line). The
transcript is found by the agent tool's own reader, Claude Code's first: a session started in the branch's worktree, or a sub-agent of a session in the main
checkout whose transcript names the worktree or the branch. It is read only to continue the work and nothing of it is written to a file. The launcher lets this
command, and no other, read the folders where the tools keep their transcripts. The coordinator passes those lines to the new worker in its brief, never into
the repository.
