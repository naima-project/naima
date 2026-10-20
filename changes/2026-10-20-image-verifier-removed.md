---
title: The opt-in verifier plugin for images is removed; mCRL2 is the model checker that ships
kind: breaking
affects:
  - api
action: "If naima.json names, under plugins, the opt-in verifier plugin for images (the one that checked .imgql sessions), remove that entry: Naima refuses a plugins entry that is no first-party plugin."
---

The opt-in verifier plugin that checked properties of images, from a session
in an `.imgql` file, no longer ships, and neither does its verifier. A
project that switched it on removes its entry from the `plugins` table of
`naima.json`, since Naima now refuses to load with it; `naima verify` refuses a
property that names its verifier until the property names another one. The model checker that ships is mCRL2, in
the opt-in `verifier-mcrl2` plugin.
