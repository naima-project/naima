---
title: naima issues candidate numbers the candidate from the repository's newest tag, as rc.<n>, and cuts it from main once the fix has landed
kind: fix
affects:
  - usage
  - workflow
commands:
  - changed issues
rules:
  - changed Outside issues follow one path, and everything on an issue is public
---

`naima issues candidate` now works out the candidate's version from the version tags of the GitHub repository, read through gh together with the clone's own, in
semantic-version order: after the release 1.1.2 the first candidate is 1.1.3-rc.1, and after 1.1.3-rc.1 it is 1.1.3-rc.2. Before, it read only the clone's tags,
so a project whose released repository is a submodule was offered a version below the newest release. Its steps now tag the head of main, once the fix has
landed, instead of the item's branch.
