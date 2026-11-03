---
title: Two naima ui runs open in one browser each keep their own window working
kind: fix
affects:
  - usage
---

`naima ui` keeps its token in a cookie named after the run, `naima-ui-` followed by a short digest of the token, instead of one shared name. A browser keeps
cookies per host and not per port, so before this a second run opened in the same browser replaced the first run's cookie, and the first window's requests
were refused until its address was opened again. Each run now reads only its own cookie, which is still kept from scripts and sent only by the window itself.
Nothing needs to be done: the next run sets the new cookie on its first page.
