---
title: Agents get two MCP servers: one drives the screen through the open UI, one reads the tracker
kind: feature
affects:
  - usage
---

`naima ui --mcp` now serves only what a person does in the window: `show`, `store`, `transitions`, `transition`, `read_page` and `screenshot`, each through the
UI stance's agent channel to the UI open on the project, one request at a time (a question about the page, which went on the feed `show`, now travels on the feed
`agent` like the store's). The server imports only the standard library, the bridge's own modules and the agent channel. The tracker's reads (`overview`, `items`,
`gates`, `lines`, `history`, `work`, `metrics`, `meetings`, `view`) and the actions (`action`, `run`) moved to a new server, `naima ui --mcp-tracker`, which reads
Naima's core directly and has nothing of the screen in it. Every tool kept its name and its answers. Add both: `claude mcp add naima-ui -- naima ui --mcp` and
`claude mcp add naima-tracker -- naima ui --mcp-tracker` (the single server was named `naima`). The guide page The Naima window and the agents' page Showing the owner
say which server has which tool.
