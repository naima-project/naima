---
title: Plugins and stances add tabs, with subtabs, to the new window
kind: feature
affects:
  - usage
  - api
---

A plugin, a stance included, adds tabs to the new window through the `ui-tabs` point, each with optional subtabs. For the subtab shown and the moment, a tab
gives data the window draws with its own components (a list, a table, a chart, a gallery of framed pages, markdown) or a page of its own, shown in a sandboxed
frame served under a key derived from the run's token, so no code of the plugin runs in the window. Every view of `ui-views` is shown as a tab too. Opening a
tab or a subtab keeps the moment and closes the rail, as the window's model says. `/data/tabs` lists the tabs and `/data/tab/<name>?sub=` gives what one shows.
The UI stance adds a Design tab: the design record, one subtab per step. The guide page The Naima window (docs/guide/the-window.md) and the plugin contract
(docs/reference/plugin-contract.md) describe it.
