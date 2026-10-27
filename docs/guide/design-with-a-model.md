# Design with a model

Some behaviour has states. A job is queued, runs, fails and is tried again. An order is paid, shipped and perhaps returned. Two processes read and write the
same data at the same time. Behaviour like this tends to go wrong in an order of events that nobody thought to test, because there are far more orders than
anyone can try by hand.

So in a project that uses Naima, such behaviour is designed with a [model](glossary.md#model) first. The model is a short description of the states and of the
moves between them, written before the code. A [model checker](glossary.md#model-checker) then explores every order of events the model allows and says whether
each [property](glossary.md#property) you care about holds, such as "a job is never retried more than twice". When a property fails, the checker shows the exact
steps that break it. The agents write the model, the properties and the code. You decide what the behaviour must and must not do
([the rule](rules.md#behaviour-with-states-is-modelled-and-verified-before-it-is-coded)).

## When a model is written

A model is written before implementing anything that has states or concurrency: a lifecycle, a protocol, a scheduler, a retry loop, or two processes sharing
data. A trivial change doesn't need one, such as renaming a state or fixing a message. If the agent skips the model for behaviour that isn't trivial, it files the
exception, with its reason, as a waiver of the check, so the choice can be inspected and questioned at any time.

```sh
naima waive model-first features/job-retries --reason "<the reason>"
```

When a requirement you state concerns behaviour like this, the agent proposes the model and its properties as the way to check it
([requirements come from every conversation](plan-with-requirements-specs-and-decisions.md#requirements-come-from-every-conversation)).

## Which form the model takes

Any form that a tool can check is welcome. These three are the usual ones.

- A **state machine**, kept as data (a table of states, actions and next states) or drawn. It is the easiest form to read, and a good start when the behaviour
  is a single thing moving through states.
- An **mCRL2 specification**, for processes that run side by side and talk to each other. The mCRL2 verifier checks it
  ([the mCRL2 model checker](prove-and-close.md#the-mcrl2-model-checker)).
- A **state machine encoded in mCRL2**, which reads like the table and can still be checked. The template below is one.

Naima has no state-machine language of its own. A state machine is written as a table or a drawing, or encoded in mCRL2 as shown here.

## A state machine in mCRL2: a template

This template describes a job. It starts queued, runs, and either finishes or fails. A failed job is retried, at most twice, or given up, and a finished or
given-up job can be reset to start again. The comment at the top is the state machine as a table, and each row of the table is one line of the process below it.

```mcrl2
% A job as a state machine, encoded in mCRL2.
%
%   from      action    to        when
%   Queued    start     Running
%   Running   finish    Done
%   Running   fail      Failed
%   Failed    retry     Running   fewer than 2 retries so far
%   Failed    give_up   GivenUp
%   Done      reset     Queued
%   GivenUp   reset     Queued

sort State = struct Queued | Running | Done | Failed | GivenUp;

act start, finish, fail, retry, give_up, reset;

% One summand per row of the table: (guard) -> action . Machine(next state).
proc Machine(s: State, retries: Nat) =
    (s == Queued) -> start . Machine(Running, retries)
  + (s == Running) -> finish . Machine(Done, retries)
  + (s == Running) -> fail . Machine(Failed, retries)
  + (s == Failed && retries < 2) -> retry . Machine(Running, retries + 1)
  + (s == Failed) -> give_up . Machine(GivenUp, retries)
  + (s == Done || s == GivenUp) -> reset . Machine(Queued, 0);

init Machine(Queued, 0);
```

To adapt it, the agent lists the states in the `sort` line and the actions in the `act` line, then writes one line of the process for each row of the table. The
part before `->` is the condition under which the move is possible, and the call after the action is the state the move leads to. Data that the behaviour
remembers, such as the number of retries here, is an extra parameter of the process. `init` names the state the machine starts in.

Each property is a formula in its own `.mcf` file. These three hold of the template, and they show the usual kinds. The first says the job never gets stuck.

```mcf
% The job never gets stuck: some action is always possible.
[true*]<true>true
```

The second says something bad never happens, here a third retry before a reset.

```mcf
% A job is retried at most twice before it is reset.
[true* . retry . (!reset)* . retry . (!reset)* . retry]false
```

The third says that one event never follows another, here a job that was given up and then finishes.

```mcf
% A job that was given up never finishes before it is reset.
[true* . give_up . (!reset)* . finish]false
```

If the condition `retries < 2` were changed to `retries < 3`, the second property would fail, and the checker would show the steps of a job retried three times.

## Each property is an item

The model and its formulas are files in the project, for example under `models/`. Each property is a [property item](glossary.md#property), so it is tracked,
proven and kept current like any other proof. The agent creates it, points it at the model and the formula, links it to the feature or requirement it proves,
and runs the check.

```sh
naima new properties "A job is retried at most twice"
naima set properties/job-retried-at-most-twice verifier=mcrl2 model=models/job.mcrl2 property=models/job-at-most-two-retries.mcf
naima link properties/job-retried-at-most-twice verifies features/job-retries
naima verify properties/job-retried-at-most-twice
```

The mCRL2 verifier is switched on in `naima.json`, and its tools are installed once per machine ([tools](tools.md)). How a property becomes `holds`, and what
happens when it doesn't, is in [prove and close](prove-and-close.md#properties-proven-by-a-tool).

## Keep the model in step with the code

The model describes the code, so the two change together, in the same change. When the behaviour changes, the agent changes the model first, checks the
properties again, and then changes the code to match. A property whose model or formula has changed since its last run is reported by `naima check` as no longer
current, and `naima verify` runs it again.

## Generate the code from the model

Once the model of a state machine holds its properties, the code that runs it can be generated from the model instead of written by hand.
[naima-codegen](https://github.com/naima-project/naima-codegen) is a public tool of the Naima project that does this. It reads a process written in mCRL2,
in the subset it accepts, and writes the same state machine as a Rust crate, a Python package, or TypeScript modules with a Svelte 5 class for user
interfaces. Each output is checked against mCRL2 itself, and its tests compare the outputs with each other. The generated code decides which events are
allowed and what comes next; the code around it only carries out the actions the model names, so a change of behaviour is a change of the model.

The model has to be one linear process, `proc Core`, whose every summand is a condition, one labelled action and the next state, each label declared an input
(an event from outside) or an output (an action the process decides). A model outside that subset is refused with a list of problems, each naming the part of
naima-codegen's specification it breaks. The tool needs the mCRL2 tools at the version the model pins, and Python 3.11 or later.

When the project has a model, `naima hello` says once that the code can be generated from it. The agent then works like this:

1. It writes the naima-codegen project beside the model: `codegen.toml`, which declares each parameter, each label as input or output, and the languages to
   write, and the model under `model/` (`core.mcrl2` with `proc Core`, and `codegen-init.mcrl2` with its initial state).
2. It runs `naima-codegen generate --front-end` to learn whether the model is in the subset, and fixes the model until it is, checking its properties again with
   `naima verify` after each change.
3. It runs `naima-codegen generate`, which writes the code under `generated/`, never edited by hand, and commits it with the model in the same change.
4. When the model comes with a policy, it runs `naima-codegen check-refinement`, which checks that the generated stepping rules stay inside the model.
5. After every later change of the model, `naima-codegen generate --check` says whether `generated/` is still what the model gives.

How to write `codegen.toml`, the policy and the checks is in naima-codegen's own documentation, with two complete examples: a job queue with retries, and a
form for a user interface.
