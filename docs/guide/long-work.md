# Long work: run it, wait for it, clean up after it

Some work outlasts a conversation with an agent, such as a benchmark, a batch of model-checking jobs or a build that takes an hour. Naima starts that work,
keeps it within limits, tells you how far along it is and removes what it leaves behind. The agents do all of this for you. The commands below are the ones they
run, so you can check what they did, and you can run them yourself if you want to.

## Start a run

```sh
naima run bench --budget-time 2h --budget-disk 20G --creates /tmp/bench-stores -- 'deno task bench > results.csv'
```

- `bench` is the run's name: lowercase letters, digits, `.`, `_`, `-`.
- `--budget-time` is how long the run may last, and it is required. Once the time is up, the run is ended, meaning the command and everything it started.
- `--budget-disk` goes with `--creates`. What the run creates (stores, temporary folders) may not grow past this size, and if it does, the run is ended. The
  declared paths are also what `naima run clean` removes. Naima refuses a path that is your repository, a folder above it, your home folder, or a folder holding
  a file that git tracks.
- After `--` comes the command. A single argument is treated as a command line for the shell, so pipes and `>` work. Several arguments are treated as a program
  and its arguments, and run exactly as given.

The command runs detached, in the folder you start it from and with your environment, so closing the session doesn't stop it. The variables the launcher sets
for Naima alone, such as `NAIMA_LAUNCHED` or a `NAIMA_DATA` you did not set yourself, are left out, so a Naima the command starts behaves as if you had started
it from your shell. Its output goes to a log, and it reports how far along it is in the file named by `$NAIMA_RUN_PROGRESS` (see below).

## Say how far it is

Long work has to report its progress, because that is [a rule](rules.md#long-work-reports-its-progress-or-says-why-it-cannot-and-what-it-reports-instead). The
command writes one line at a time to `$NAIMA_RUN_PROGRESS`, and only the last line counts. If the line is a JSON object, Naima reads it field by field, and
every field is optional.

```sh
echo '{"stage":"render","done":12,"total":40,"unit":"frames"}' >> "$NAIMA_RUN_PROGRESS"
```

- `stage` is what the command is doing now, and `done`, `total` and `unit` say how much of it is done, out of how much, and counted in what.
- `note` is for anything else worth saying.
- `overall` takes `{ "done", "total", "unit" }` for the larger piece of work the stage belongs to, such as scenes around frames.

Any other line is shown as it is. Naima works out the rate and, when the total is known, the time left, and shows them as
`render: 12/40 frames (30%) · 2/s · ETA 14s`. Some of Naima's own commands (`naima verify`, `naima metrics run` and `naima tools install`) write these lines by
themselves when they run inside `naima run`. Otherwise they print them on the terminal, once they have been running for a couple of seconds.

Some commands really can't say how far along they are, such as a solver that prints nothing while it works. Such a command is started with the reason instead:

```sh
naima run solve --budget-time 12h --no-progress "the solver prints nothing until it ends" -- ./solve.sh
```

It is then shown with its elapsed time and the last line of its log.

## Wait for it, see it, stop it

```sh
naima wait bench --timeout 9m     # blocks until it ends, or 9 minutes pass
naima run list                    # every run: state, time and disk against the budgets, progress
naima run status bench --tail 50  # one run, with the end of its log
naima run stop bench              # end it now
```

While it waits, `naima wait` prints how long the run has been going and its progress, every 30 seconds (`--report`). When the run ends, it prints how it ended
(succeeded, failed with its exit code, killed by a budget, or stopped) together with the end of its log, and it exits 0 only if the run succeeded. If the run is
still going when the timeout passes, it says so and exits 1, so waiting again has to be a deliberate choice.

`naima run list` marks two kinds of runs in capitals. A **STALE** run is still running but has gone quiet. Normally that means no new progress line for the
`--stale` interval, which is 2 minutes by default. For a run started with `--no-progress`, it means nothing new in its log or progress file for 15 minutes. A
**LOST** run is one whose supervisor stopped reporting, because it was killed or the machine restarted, so nobody knows how the run ended.

## When a long run is due

Some work is too long for any landing, such as the whole set of properties of a large model or a benchmark that takes a night. Naima never starts it on its own,
because a run nobody is watching competes with everything else on the same machine ([the rule](rules.md#nothing-runs-unattended)). Instead it tells you when
such a run is due, and you decide when it starts.

The full suite, every gate a release gate waits for, is a long run named `full-suite` without any setup. Other long runs are declared once in `naima.json`, each
with its command, its time budget and what makes it due:

```json
"long-work": { "options": { "longRuns": {
  "full-suite": { "fullSuite": true, "within": "7d", "budgetTime": "8h", "host": "lab",
    "command": "naima verify --all && naima metrics run --record" },
  "lift-model": { "model": "models/lift.mcrl2", "budgetTime": "2d",
    "command": "naima verify --all", "noProgress": "the solver reports nothing" } } } }
```

A long run is due when one of these holds:

- something it covers is no longer current: a property whose model changed since its last run, a property never verified, or a test suite with no recorded run
  of the current commit. `fullSuite` covers every gate of the full suite, `gates` the gates you name, `model` every property verified on that model, and `items`
  the items you name.
- it hasn't succeeded within `within`, counted from the start of its last successful run here.

A property whose current run refutes it doesn't make a run due: running it again would give the same answer, and the property waits for a fix instead. A run
already going isn't due either.

`naima hello` and `naima summary` say each due run in one line:

```text
Long run lift-model is due: not current: properties/doors-close. Ask the owner before starting it: naima run lift-model.
```

To keep track of them, `naima run due` files each due run as a todo, linked to the items it covers that aren't current. It files one todo per run, so running it
again adds nothing new, and it marks the todo done once the run is current again. When you say yes, the agent starts the run by its name:

```sh
naima run lift-model
```

That is an ordinary run with the budgets the declaration gives it, so `naima run list`, `naima wait lift-model` and the rest work on it. A finished record of
the same name is cleaned first, and Naima remembers when a run succeeded even after its record is cleaned.

## Clean up

```sh
naima run clean bench
```

This removes the paths the run declared with `--creates`, and then the run's record. Naima refuses to do it while the run is still going, and it never removes a
file that git tracks.

## On another machine

You declare another machine once, in `naima.json`.

```json
"long-work": { "options": { "hosts": {
  "lab": { "ssh": "me@lab.example.org", "dir": "/home/me/project" } } } }
```

After that, `naima run bench --host lab --budget-time 6h -- 'deno task bench'` runs the work on that machine, using the copy of Naima it already has for the
project, and `wait`, `run list`, `run status`, `run stop` and `run clean` ask it over ssh. A run on another machine must not change any file the repository
tracks there. If it does, the run is reported as failed, and the report names the files.

## Where the records are

Each run has a folder in `naima-tracker/.runs/<name>/`, holding what was asked for (`run.json`), the run's state (`status.json`), its `log` and its `progress`.
The folder tells git to ignore it, so none of it is ever committed.

## Platforms

Everything above works on macOS and Linux. On Windows you get local runs, which are ended with `taskkill`, and a Windows machine can't be a `--host`. Agents are
required to use these commands by the rule [long work goes through naima run](rules.md#long-work-goes-through-naima-run-and-naima-wait), and the rule
[long work reports its progress](rules.md#long-work-reports-its-progress-or-says-why-it-cannot-and-what-it-reports-instead) is the one that asks it to say how
far along it is.
