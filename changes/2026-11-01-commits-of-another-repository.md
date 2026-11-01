---
title: An item fixed in another repository closes with that repository's commit
kind: feature
affects:
  - usage
---

An item's `commits` can name a commit of another repository as `<repository>@<hash>`, for a fix made in a stance, a plugin or Naima itself. `naima close` and
`naima check` accept it when the repository is one the project declares (the Naima it runs, a plugin pinned from git, or one listed in the trackers option
`repositories`) and git shows the commit on that repository's default branch; when the repository cannot be read they say so and do not accept it. Such an item
no longer needs `naima close --force`.
