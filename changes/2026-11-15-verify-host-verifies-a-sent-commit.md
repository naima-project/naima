---
title: naima verify --host verifies the commit of this checkout on the host, not what the host's checkout holds
kind: behaviour-change
affects:
  - usage
commands:
  - changed verify
---

`naima verify <property> --host <host>` used to ask the host's own checkout, so a property filed and modelled on a branch the host did not hold could not be
verified there. It now sends the commit this checkout is at to the host under a ref of its own (a git push, or a bundle towards a Windows host whose ssh server
runs cmd), asks the host's Naima to verify on a checkout of that commit made for the run (`naima verify --emit --at <commit>`, new), and removes the ref
afterwards. The checkout made for the run has no submodules. The launcher now lets `naima verify --host` run `scp` as well as `ssh`. A host whose Naima predates
`--at` refuses the call and says so.
