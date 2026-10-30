---
title: A commit on the trunk that only adds to the tracker data needs no landing; a noted commit can be waived
kind: behaviour-change
affects:
  - usage
  - workflow
checks:
  - changed landings-are-markers
rules:
  - changed Every landing is a marker naming the items it closes
---

After the first landing marker, `landings-are-markers` no longer notes a commit made directly on the trunk when all it does is add to the tracker data: new
files in the data directory, such as an item, a diary entry or a session note, and lines added to an item's `README.md`, as a note does, with the item's
`meta.json` left as it was. The coordinator can file what the owner says without a branch. A commit that changes or deletes a file, or touches `rules/`,
`waivers/` or `naima.json`, still has to land, and a direct one is still noted.

The check now writes one note per commit instead of one for a run of commits, and names the commit as the note's subject, so a commit the project accepts as it
is can be waived once with its reason: `naima waive landings-are-markers <commit> --reason "<why>"`.
