---
title: "A worktree that runs another Naima than the trunk moves nothing and prints a prompt for the main checkout"
kind: fix
affects:
  - usage
commands:
  - changed hello
  - changed verify
  - changed run
---

A worktree whose program was a symbolic link to the trunk's clone moved that clone to the worktree's own, older lock on every run, so the trunk ran an older
Naima than it locked, and nothing said so; a worktree whose branch never took the trunk's newer lock kept running the older Naima, unsaid. Naima now never moves
a program that is a link, and in a worktree whose lock differs from the trunk's, or whose program is a link, it moves nothing at all: `naima hello`,
`naima verify` and `naima run` print a prompt to paste into a conversation on the main checkout, naming the worktree, its branch, the Naima it runs and the
trunk's, and what to do (merge the trunk into the branch, land the update, or replace the link with a clone of its own). In the main checkout, a program linked
elsewhere is left as it is, and every run says when it is not at the lock. Nothing to do, except what the prompt says where it appears.
