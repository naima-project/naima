---
title: A contributing page, which agents read live, says how to report to Naima
kind: feature
affects:
  - usage
  - workflow
---

`docs/CONTRIBUTING.md` says how a person or an agent reports a problem with Naima, asks for a feature or sends a fix, as an issue or a pull request on the
public repository: the owner's yes on the exact text first, redacted, after a search for an existing one. The skill has a new step: when an agent finds a
problem in Naima, or the owner wants something Naima does not do, it reads that page live from the product's `main`, so the page can change without a Naima
update, and falls back to the local copy only when it cannot be fetched.
