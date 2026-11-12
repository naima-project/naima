---
title: naima update reports its progress, and the rehearsal is asked for, not run by default
kind: feature
affects:
  - usage
---

`naima update --check` says whether a newer Naima exists and what it changes, in seconds: it no longer rehearses the new version's `naima check` unless asked
with `--rehearse`, or `--rehearse-in-background`, which starts the rehearsal as a run named `update-rehearsal` and records its result for the next check. The
rehearsal runs its two checks one after the other and reuses what an unchanged commit and project already found. `naima update` and the rehearsal report each
stage with its count (the bytes of the archive, the checksum, the checks done) on standard error, or in the run's progress file; `naima update --no-rehearse`
leaves out the older version's comparison check at its end. The guide Update Naima (docs/guide/update-naima.md) describes them.
