---
title: "The daily outside-issues intake is no longer spent by a command that cannot run gh, and a tick job can say where it can run"
kind: fix
affects:
  - api
  - usage
---

The intake of outside issues runs once a day, and the first command to tick took the day even when it could not file: a command the launcher does not grant
gh, such as `naima new`, or a checkout of another branch. Under Deno, a program outside the grant is refused with an empty result, which the plugin read as
gh being absent, so the day ended with nothing filed. A tick job may now declare `canRunHere(ctx)`: where it answers false, the tick claims no attempt and
the slot waits for a command that can. The outside-issues job answers true only on the trunk's checkout in a command granted gh (`naima hello` in a project
on GitHub, or `naima issues`), and a refused gh is now told apart from a missing one.
