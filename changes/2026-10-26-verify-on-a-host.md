---
title: naima verify --host runs a property's verifier on a declared host, and --tool-args passes the tool's output flags
kind: feature
affects:
  - usage
---

`naima verify <property> --host <host>` runs the verifier in the checkout of a host declared in the long-work plugin's `hosts` option, through that host's own
Naima, and attaches the run here, with `host` set in its record. The run is kept only when it was made on exactly what this checkout has; otherwise it is
refused and nothing is written. The host runs `naima verify --emit`, which prints the run as JSON and writes nothing, so the host's Naima must be at a version
that has it.

`--tool-args=<flags>` passes tool flags that change only what the tool prints, those the verifier declares (for mCRL2 `--verbose` and `--timings`). They are
kept in the run's record as `toolArgs` and are not part of its identity.
