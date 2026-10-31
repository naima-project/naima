---
title: "Issues opened outside on GitHub follow one path: naima issues, a candidate the reporter tests, scrubbed replies"
kind: feature
affects:
  - usage
  - workflow
---

A new first-party plugin, `outside-issues`, gives `naima issues`: with no subcommand it lists the open issues of the project's GitHub repository through gh,
each with the item filed for it; `file` files one item per open issue no item records, its address in the new field `issue`, triaged as reported, and tells the
owner once (a daily tick job runs it on the trunk's checkout); `show`, `reply`, `candidate`, `offer` and `close` take the issue from there to a pre-release
candidate cut from the item's branch, never marked latest, the reply that offers it with the one command that installs it, and the closing comment with a link
to the release. Every text posted on an issue passes the private-data scrub and a finding refuses it; what is read from an issue is printed as untrusted text.
Without gh or a GitHub remote, nothing happens and the command says why. A new working rule, `outside-issues-one-path`, acknowledged as "Outside issues mode
on", tells agents to follow this path. `naima update --to <version>` already installs a tagged pre-release whose commit is not on main, which is how a reporter
installs a candidate of Naima itself.
