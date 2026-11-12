---
title: "naima check fails on private data in any tracker file, attachments included"
kind: fix
affects:
  - usage
---

Only the CLI's own writes were checked for private infrastructure, so a file that reached the tracker another way, such as a run record `naima verify` attached
before it redacted them, or a file copied in by hand, could carry a home-directory path unnoticed. The new check `private-data` reads every tracker file with
the same detection the writes use and fails on each home-directory path, machine or user name, address or word of the private list, naming the file, line, kind
and placeholder, never the value. A mention let through with `--allow-private` is not flagged, and a project that keeps private data (`privateData: keep`) is
not checked. A machine named "Mac", the name macOS gives a new one, is no longer taken for a private machine name.
