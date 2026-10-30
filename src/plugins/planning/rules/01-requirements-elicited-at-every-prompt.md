---
name: requirements-elicited-at-every-prompt
title: Requirements are elicited at every prompt, each with how it is checked or measured
audience: agents
strength: must
ack: Elicitation mode on
enforcedBy: requirements-proven
verifiedBy: requirements-proven
---

At every prompt of the owner, an agent checks whether what was said adds a requirement or changes one, and when it does, files it in the same turn as part of
the report flow, after answering the owner and never before, in the background where it can: a new one with `naima new requirements "<what must hold>"`, a
changed one by revising its page, and a change to exactly how something behaves as the next version of its specification (`naima spec revise`). A vague wish is
restated as something a test can decide, and the agent settles how it will be checked or measured: a test, a property of a model, or, for anything measurable (a
time, a size, a count, a rate), a metric with a budget. The agent proposes the check and asks the owner only for what is theirs to give, such as the number a
budget holds to; the answer goes on the page of the requirement, and the test or property that checks it (for a metric, a test whose gesture is
`naima metrics run <metric>` within its budget) is linked `verifies` once it exists. A requirement on behaviour with states or concurrency is proposed as a
model with its properties.

## Why

the owner keeps stating needs in passing, long after the work has started; a requirement heard in chat and never filed is lost, and one filed with no way to
check it can never be met, so it is argued over instead of measured.
