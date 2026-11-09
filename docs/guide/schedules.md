# Planned, expected and actual schedules

Every piece of work Naima tracks, such as a feature, a bug or a todo, can carry three schedules on one time axis. The planned schedule is when it was meant to
start and end. The expected schedule is Naima's forecast of when it will really start and end. The actual schedule is when it really started, paused, stalled
and ended. Laid side by side they show how far each piece drifted from its plan, which pieces ran into each other, and how far Naima's forecasts can be trusted.
The schedule plugin works all of this out; the new interface draws it as a Gantt chart.

## The actual schedule

You never enter the actual schedule. Naima reads it from what the project already records as the agents work:

- a claim on the piece (`naima open` or `naima claim`) starts the work;
- each step a worker posts (`naima claim --step`) and each commit on the claiming branch is a sign of life;
- when no sign of life comes for the stall window, the work counts as stalled until the next one;
- when the claim goes away before the piece lands, the work is paused until someone claims it again;
- the landing that names the piece ends it, and so does its close when it never landed.

The end is the first landing or close after the last claim. A later landing of the same work, such as its line landing on the trunk, and the close that follows
a landing leave the end where it was. A commit or a step after the end does not reopen the piece; only a new claim does. These rules are a small state machine,
modelled in mCRL2 and checked before it was coded, so they hold in every order the records can come in.

The stall window is the schedule option `stallAfter`, in minutes. By default it is the coordination option `silentAfter`, the same silence after which
`naima claims` flags a worker as possibly stuck.

## The planned schedule

A piece gets a plan when it is planned, from the project's pace or by hand:

```sh
naima schedule propose features/export                                   # from the project's pace
naima schedule plan features/export --start 2026-11-04 --end 2026-11-05   # dates given
naima schedule plan features/export --start 2026-11-04T09:00Z --end 2026-11-04T15:00Z --basis "half a day, as the import took"
```

A day given to `--start` means its start, and a day given to `--end` means its end. Each plan records who proposed it: the git user, or the name given with
`--by`, and the role of the checkout it was made in. Each plan is one new file in the tracker's `schedules/` folder, committed like a note. A later plan
replaces the one in force, and the first is kept as the baseline, so the chart can still show the plan as first set.

`propose` places the piece after the expected end of whatever it waits on (the items it is linked `blocked-by`), and gives it the median duration of the pieces
of the same kind that ended. With no ended work of that kind, it gives it eight hours.

## The expected schedule

The forecast moves as work happens. A piece that ended is expected where it actually was. A piece under way is expected to end its kind's pace after it started,
and never before now. A piece not started is expected after what it waits on and after its planned start, for the length of its plan corrected by how plans of
that kind of work turned out: if features have taken 1.5 times their plan so far, a feature planned for four hours is expected to take six.

Each forecast comes with a confidence: high, medium, low, or none when there is no finished work of that kind to judge by. It is the share of past pieces of the
same kind that ended within the tolerance of their plan, lowered while there are only a few of them. The tolerance is the option `tolerance`, in hours, 24 by
default. A kind with fewer than three finished pieces borrows the figures of all kinds together.

## Drift, overlap and prediction quality

For each piece with a plan, the drift says how late or early it started and ended, in hours, and how many times its planned duration it took. While the piece
runs, the end drift is measured against the expected end and marked provisional.

Two kinds of overlap are reported:

- by dependency: a piece that started while one it waits on had not ended, with how long the two ran together;
- by capacity: a day on which more pieces had work going on than the agents can carry. That limit is the option `capacity`, by default the coordination option
  `maxWorkers`. The day-by-day count is the resource histogram, actual up to today and forecast after it, and the days above capacity are over-allocated.

The prediction quality is measured per kind of work and for all kinds together, overall and month by month: how many finished pieces had a plan, the mean error
of their end, the mean error of their duration, and the share that ended within the tolerance.

## Seeing it

```sh
naima view schedule                         # every piece with a plan or a record
naima schedule features/export bugs/crash   # some pieces only
naima schedule --json                       # the data
```

The data is the shape written in the product's `src/plugins/schedule/types.ts`. The new interface reads the same data through its bridge, as the view
`schedule`, and draws the Gantt from it. The roadmap, goals and features screens all draw the one Gantt component. For each piece it shows the planned, the expected and the actual schedule on one time
axis, with the drift and the overlap worked out from them. The chart only shows. Moving a planned bar in the interface is not part of this plugin.

## Options

Set them with `naima plugin set schedule <option>=<value>`.

| Option       | What it is                                                        | Default                               |
| ------------ | ----------------------------------------------------------------- | ------------------------------------- |
| `stallAfter` | minutes without a sign of life after which work counts as stalled | the coordination option `silentAfter` |
| `tolerance`  | hours within which an end counts as on plan                       | 24                                    |
| `capacity`   | the most pieces of work that run at once                          | the coordination option `maxWorkers`  |
