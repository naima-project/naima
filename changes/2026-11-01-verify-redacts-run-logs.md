---
title: "naima verify redacts what the tool printed before it attaches a run"
kind: fix
affects:
  - usage
---

A run `naima verify` attached kept the tool's output, counterexample and details exactly as printed, so the home-directory path of the machine it ran on went
into the property's committed `attachments/`. They are now redacted with the same detection the tracker's writes use: the project's root becomes `<root>`, and a
home-directory path, a machine or user name and an address become `<path>`, `<host>`, `<user>` and `<ip>`. A run made on a host with `--host` is redacted here
too. The inputs, their digests, the tool's version and the options, which key the run, are kept as they are.
