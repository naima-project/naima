# Long work

Follow this page for any command you expect to take more than a few minutes, or to run on another machine. The rules behind it are on the rules page:
[long work goes through naima run and naima wait](../guide/rules.md#long-work-goes-through-naima-run-and-naima-wait), and
[long work reports its progress](../guide/rules.md#long-work-reports-its-progress-or-says-why-it-cannot-and-what-it-reports-instead).

1. **Start** the run with a name and a time budget you can justify. If it writes stores or temporary data, also say what it creates and give it a disk budget:
   `naima run <name> --budget-time <d> [--budget-disk <size> --creates <path>...] [--host <h>] -- <command>`. The command writes its progress to
   `$NAIMA_RUN_PROGRESS` at least every few seconds, as one JSON line such as `{"stage":"bench","done":3,"total":40,"unit":"cases"}`
   ([the format](../guide/long-work.md#say-how-far-it-is)). A Naima command does this on its own. If the tool really has no way to report progress, start it
   with `--stale <d> --no-progress "<why>"` instead: `--stale` says how long silence is normal for it, and `naima run` refuses `--no-progress` without it. A
   host whose ssh server runs cmd, as the one that comes with Windows does, is declared with `"shell": "cmd"`
   ([on another machine](../guide/long-work.md#on-another-machine)); without it every quoted word arrives there with its quotes. Never run such a command
   directly with a long tool timeout instead: if it never starts, or hangs at once, nobody sees it until the timeout ends. `naima run` returns once the command
   is seen alive, or says why it did not start.
2. **Wait** with `naima wait <name> --timeout <d>`, using a timeout shorter than your tool call's limit, and wait again as often as needed. When the timeout is
   reached it exits 1 and says the run is still going. Its first line, on standard error, comes at once and says what the run is doing. It returns, exiting 1,
   within seconds when the run never started (`naima wait: <name> did not start`) or has still not started after 10 seconds
   (`naima wait: <name> has not started`), and as soon as the run is stuck (no output at all for its `--stale` window). A run that has written no progress line
   after 10 seconds is said to show no progress (`naima wait: <name> shows no progress`): make the command write its progress, or start it with `--no-progress`.
   Then check `naima run list` to see whether the run is stuck, not advancing (its log grows but its progress does not, a warning) or crashed, and whether its
   rate and ETA are moving, do other work if there is any, and decide whether to wait again or to `naima run stop <name>`. A run started on the host itself,
   with no record here, is waited on with `naima wait <name> --host <h> --timeout <d>`; never poll the host over ssh by hand.
3. **Report** from the output of `naima wait`. Give the state, the exit status, the budgets, the progress and the tail of the log, and put each number next to
   the budget or total it is compared to.
4. **Clean** with `naima run clean <name>` once the results are kept somewhere else. It removes exactly what was declared.

To verify a property on a host, don't use `naima run --host`: a remote run must leave tracked files alone, and `naima verify` writes the property. Run the
verification here with `--host`, inside a local run when it is long: `naima run <name> --budget-time <d> -- naima verify <property> --host <h>`. The host's
checkout must be at the commit this one is at, or the run is refused and nothing is written. Tool flags that only change what the tool prints go in
`--tool-args=<flags>` and are kept with the run ([proving on another machine](../guide/prove-and-close.md#properties-proven-by-a-tool)).

Nothing runs unattended ([the rule](../guide/rules.md#nothing-runs-unattended)). Never schedule a run, and never start a long run, such as the full suite or a
model's verification, without the owner's yes. When `naima hello` or `naima summary` says a long run is due, pass the line on, run `naima run due` to file it as
a todo (one per run; it marks the todo done once the run is current), and ask the owner. With their yes, start it by its name, `naima run <name>`, and follow
the steps above ([when a long run is due](../guide/long-work.md#when-a-long-run-is-due)).

Don't wait with a `while`/`until` loop around `sleep`, with `pgrep -f`/`pkill -f`, with a bare `nohup ... &`, or by polling a remote file over ssh by hand.
`naima check` flags waits like these in committed scripts (check `wait-loops`), and a script that really does need a retry loop marks the line
`naima: allow-wait-loop <reason>`. `naima check` also flags a `naima run` in a committed script whose command neither writes progress nor is declared
`--no-progress` with a reason, and a Naima command declared long without saying how it reports (check `progress-declared`).
