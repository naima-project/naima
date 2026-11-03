---
title: A metric's declaration names it on the metrics screen with label, and places its card with card's number
kind: feature
affects:
  - usage
  - api
---

A metric declared in `naima.json` may give `"label"`, the name the metrics screen of `naima ui` shows for it, such as `"Function size, mean"`; without one, the
screen writes its declared name as words, as before. `"card"` takes, besides true and false, a whole number from 1: the metric is a key-number card at that
place, so the cards can come in an order of their own while the list below keeps the order of the declarations. The metrics view's `timeline` gives each
metric's `label` and `cardPlace`. Nothing needs to be done: a declaration without them reads as before.
