---
title: "naima retire ends an item of any type that no longer applies; a missing model file is said as missing"
kind: feature
affects:
  - api
  - workflow
commands:
  - added retire
  - changed list
  - changed verify
checks:
  - added retired-items
  - changed requirements-proven
  - changed property-evidence
  - changed closed-carries-proof
  - changed closed-names-its-commits
---

`naima retire <item> --reason "<why>" [--replaced-by <item>] --consent "<the owner's yes, restated>"` ends an item of any type that stopped applying, on the
owner's word. It moves the item to `closed/` with the new status `retired`, keeps the reason in `retiredBecause` and the consent in `retiredConsent`, and links
it `replaced-by` the replacement, which shows `replaces`. There is no delete: an item filed by mistake is retired with that reason. Only `naima retire` sets the
status. A retired item leaves every queue, gate and long run and `naima hello`'s due list; `naima show` still reads it, `naima list closed --status retired`
lists them, and the timeline and `naima diary` show each one with its reason.

A retirement never hides a failing proof: `naima check` lists every retired item (`retired-items`), `naima gates` shows a retired item or proof a gate depended
on (`! depended on …`), and a requirement no longer counts a retired proof, flagged as a problem while it is `met` with no other passed proof.

A property whose model file, or the formula file its verifier says it names (an mCRL2 `.mcf` file), no longer exists is said as "model file missing" (or
"property file missing") by `naima verify`, `naima check`, `naima gates` and `naima hello`, with `naima retire` suggested, instead of being reported as stale or
making a long run due. `naima verify --all` goes on with the other properties. A verifier adapter may declare `propertyFile(property, root)` for this.
