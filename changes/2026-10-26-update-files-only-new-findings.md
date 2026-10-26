---
title: naima update files only findings new in what they found
kind: fix
affects:
  - workflow
---

`naima update` files a follow-up for each finding of `naima check` that the
older Naima did not have, and compared the two by their whole text. A newer
Naima that words a finding's advice differently, such as the command it
suggests, made every such finding look new and filed one item each. Findings
are now compared without the advice that follows what they found.
