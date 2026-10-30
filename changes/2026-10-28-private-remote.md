---
title: "Every repository Naima relies on is offered a private remote"
kind: feature
affects:
  - usage
  - workflow
commands:
  - added backup
  - changed init
  - changed hello
  - changed update
---

When Naima is added to an existing repository, `naima init` says in one sentence which tracker layout it chose and what that layout risks. A repository Naima
relies on that has no remote, such as a tracker kept private beside the code, is no longer left on one machine without a word: the owner is asked whether to
create a private remote for it, and told they can keep working locally instead. On a yes, `naima backup create` installs `gh` locally if it is missing, signs in
through GitHub's one-time code in the browser, creates the private repository and pushes to it; `naima
backup add <address>` uses a repository the owner made by
hand, and `naima backup decline` records a no. After a no, every `naima hello` says in one line that the repository is not backed up by a remote. An existing
installation whose tracker has no remote is asked once, at the next `naima
update`.
