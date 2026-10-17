---
title: Tracker writes that name private infrastructure are refused
kind: feature
affects:
  - usage
  - workflow
rules:
  - added No machine names or private infrastructure in a repository
---

Every command that writes text into the tracker first looks for a machine's
name, an IP address, an address with a port, a home-folder path, a user name,
or a word from your private list, kept outside every repository. If it finds
one, it refuses and lists each finding with the placeholder to use instead,
such as `<host>` or `<path>`. A deliberate mention goes through with
`--allow-private "<reason>"`, and the reason is recorded.
