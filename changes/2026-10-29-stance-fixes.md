---
title: naima stances says which repositories are not stances, stance adopt takes the stance's options, and no warning about tools not installed
kind: fix
affects:
  - usage
---

A plugin published in its own repository describes itself as data in `naima-plugin.json` at the repository's root: its name, its entry module, its
contract, and optionally its kind (`stance` for a stance), examples and attribution. A plugin loaded from git whose manifest disagrees with that file is
not loaded, and the message names each difference. `naima stances` reads the file by git, with a shallow clone that fetches only it (GitHub's API only
when git cannot reach the repository), and marks a repository without it, or whose file does not declare the kind stance, as `not a stance`, with the
reason. `naima stance adopt <name>` writes the options the stance declares, such as
`--app <folder>`, into its entry in `naima.json` and passes the rest to its adoption. Before running the adoption it says where it will write, and
refuses to write at the project's root when the root holds no app and a subfolder does, unless `--app .` is given. Run from another worktree with the
trunk checkout's Naima, it is served from that worktree's data, or refused when the worktree has none, so it never writes into the trunk's checkout.
The launcher grants only the programs it finds, so Deno no longer warns at every command that it cannot resolve a tool that is not installed.
