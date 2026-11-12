---
title: naima issues candidate numbers the candidate from the repository's newest tag, as rc.<n>
kind: fix
affects:
  - usage
  - workflow
commands:
  - changed issues
---

`naima issues candidate` now works out the candidate's version from the version tags of the GitHub repository, read through gh together with the clone's own, in
semantic-version order: after the release 1.1.2 the first candidate is 1.1.3-rc.1, and after 1.1.3-rc.1 it is 1.1.3-rc.2. Before, it read only the clone's tags,
so a project whose released repository is a submodule was offered a version below the newest release. The candidate is still cut from the item's branch; if the
fix has already landed, the command says that this skipped the path and cuts it from the trunk's head.
