---
title: "Naima ships the working rules for agents to every project"
kind: feature
affects:
  - usage
  - workflow
rules:
  - added Quiet mode
  - added Talking to the owner
  - added Fast mode
  - added Ask before what cannot be undone
  - added Capture, with judgment
  - added Never ask what the rules answer
  - added Close every loop
  - added No new status document
  - changed Use the state-of-the-art method for the job
action: "Read them with naima rules --audience agents and give back the new acknowledgement line; retire any the project does not hold to with the rules plugin's retire option."
---

A new built-in plugin, `working-rules`, ships nine rules to every project, listed by `naima rules --audience agents` beside the project's own: quiet mode ("Quiet mode
on"), talking to the owner ("Simple mode on"), fast mode ("Fast mode on"), asking before what cannot be undone ("Irreversible actions mode on"), capturing with
judgment ("Capture mode on"), never asking what the rules answer ("Rules answer mode on"), closing every loop ("Loops closed mode on"), and, for everyone, no
new status document and the right tool for the job. A project drops one by naming it in the rules plugin's `retire` option, such as `"working-rules/fast-mode"`, and
changes one by retiring it and writing its own rules item in its place.
