---
title: A Windows machine can be a host, and a run on Windows outlives the ssh session that started it
kind: fix
affects:
  - api
  - usage
commands:
  - changed run
options:
  - changed plugins.long-work.options.hosts
action: "For a host whose ssh server runs cmd, such as the one that comes with Windows, add \"shell\": \"cmd\" to it in plugins.long-work.options.hosts."
---

A host in the long-work plugin's `hosts` option now says which shell its ssh server runs commands through: `"shell": "posix"`, the default, or `"shell": "cmd"`.
For cmd, `naima run --host`, `naima wait` and `naima tools --host` change directory with `cd /d` and quote every word in double quotes, with cmd's own
characters escaped, where before each word was single-quoted for a POSIX shell and reached the program with its quotes.

On Windows, `naima run` starts the run's supervisor through WMI, by PowerShell, instead of as a detached child. The Windows ssh server ends every process of a
session when the session ends, a detached one included, so a run started over ssh was lost with it; a process WMI creates is not part of the session, and the
run now keeps going until it ends on its own.
