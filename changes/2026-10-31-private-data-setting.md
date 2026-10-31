---
title: "Scrubbing private data is the project's choice, asked of the owner once: scrub by default, or keep"
kind: feature
affects:
  - api
  - workflow
commands:
  - added privacy
---

While a project has not chosen, the refusal of a tracker write that holds a machine name, an address, a home path or a user name ends with the question the
agent puts to the owner once: keep scrubbing, or keep the information. The answer is the privacy plugin's option `privateData`, set with `naima privacy scrub`
(the default) or `naima privacy keep`; once it is set, the refusal stops asking. With `keep`, the tracker's writes let private data through while the tracker is
private, each recorded with the reason. `naima privacy keep` warns that a tracker committed with the code is published with it, and refuses on a tracker that is
or may be public unless `--despite-public` restates the owner's choice. What leaves the project is scrubbed either way. The no-leaks checklist's third point
says so, which changes its hash: agents sign with the new copy.
