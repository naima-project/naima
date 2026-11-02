---
title: A gate can have steps of its own, sub-goals added without a method and closed like a method's
kind: feature
affects:
  - usage
  - workflow
commands:
  - changed gate
  - changed gates
options:
  - added plugins.gates.options.gates.<name>.steps
checks:
  - changed method-steps
---

`naima gate step add <gate> <step> "<title>" --exit "<exit>"` gives a gate a step of its own, last, after `--after <step>`, or first with `--first`;
`naima gate step remove <gate> <step>` takes one off while no record names it. The steps are stored on the gate in `naima.json`, come after the steps of the
method the gate follows, if any, and close in the same way, in order, with `naima gate step <gate> <step> --by <item>`. `naima gates`, `naima gate show` and
`naima hello` show them with the method's, and the gate holds only once every step is closed. `naima check` notes a record that names a step the gate doesn't
have, and reports a step of the gate's own named like one of its method's.
