# The Naima window

`naima ui` opens a window onto the project. It is served by a small server on your own machine, which only you can reach: it listens on the loopback interface,
and every request has to carry a token made for that run. Closing the window stops the server.

```sh
naima ui              # the window, or the default browser where the window cannot open
naima ui --browser    # the default browser
naima ui --no-open    # print the address, with its token, and serve until Ctrl-C
```

## What the window shows

The window opens on the new interface. At the top is the rail, a strip that will hold the map of the project's lines and commits; for now it opens onto a short
note that the map is still to come. Beside it is the moment the window shows, Live: what the files hold now, kept current as they change. Choosing a commit of
the past comes with the map (see [planned](../planned.md)). Under the rail are the screens: Home, Metrics, Diary, Bugs, Features and Failed tests. Home shows
the summary of the project, the same sections `naima summary` prints, each under its name. The other screens are placeholders and say so.

The earlier window is still there at `/classic` in the same server: the panels of the first screen (the summary, the gates, what is next, the claims) and the
tabs of the boards, the metrics, the session notes and each item with its evidence. Every view's data is at `/data/<view>` as JSON, the same data the matching
command prints with `--json`; the new interface reads it from there.

## Live, and the past

The window follows the project as it changes. The server looks at it every second: a new commit, a branch or tag that moved, a file of the tracker written (an
item, a note, a claim). When something changed and has settled, it sends one event on `/events`, a stream of server-sent events behind the same token, naming
what kinds of change it saw. While the window shows Live, the screens read their data again; while it shows a commit of the past, nothing moves until you go
back to Live. That rule is part of the interface's model and is checked there.

Any view's data can be read as a commit had it: `/data/<view>?at=<commit>` answers what the same view answers on a checkout of that commit, read only, from the
tracker in that commit's tree. A commit is named by its hash or by any name git knows, such as a branch or `HEAD~3`. One git does not know, or one that no local
branch reaches, is refused with a plain message. The commits looked at are kept, so going back to one is quick.

`/data/metro` gives what the rail's map draws: the trunk and every open line, the other branches that left or rejoined in the last 60 commits of the trunk, each
with its commits and where it left and rejoined; every worker branch with its claim and a status; and, for the trunk and each line, the goals still ahead in
goal order. A line's goals are its gate's steps not yet closed, then the gate. The trunk's are the goals not yet finished, with each line's gate shown as that
line landing. The parts come from the commands that own them (`naima line list`, `naima claims`, `naima gates`, each with `--json`), so the map and the commands
always agree.

A worker's status is derived, and the data says how in its `why` field:

- **done, waiting to land**: its branch has commits its base lacks and no live claim, as a worker leaves it when it hands its work over;
- **idle**: its claim has been silent longer than the coordination option `silentAfter`;
- **question**: its last step says it asks or waits for an answer;
- **testing**: its last step says it is testing, verifying or checking;
- **working**: any other live claim.

## Actions

The window can run a few naima commands for you: record a decision (`decide`), add a note (`note`), close a gate's step (`gate step`, not adding or removing
one), claim items or post a step (`claim`) and release a claim (`release`). Each runs through the command line exactly as if you typed it, so every rule and
check applies, and the window shows what the command printed and its exit code. None of them rewrites history, and the window asks you to confirm before running
one.

An action is a `POST` to `/action/<name>` (`gate-step` for `gate step`) with the body `{"args": [...]}`, the arguments after the command. The server refuses it
unless it carries the token's cookie, this run's CSRF value (which the page reads from `/session`), the server's own address as its Origin and, when the browser
sends it, `Sec-Fetch-Site:
same-origin`. Another page in your browser cannot run one.

## How it is built

The interface is a Svelte app that ships with Naima, already built: Naima needs no npm package and no network to show it. Its logic is generated from a model.
The moment, the rail and the current screen form one state machine, modelled in mCRL2 and checked with its properties, and naima-codegen generates the code the
screens call. The components only read that machine's state and call its transitions. The colours, type and shapes are the design tokens of the interface, and
the Inter typeface comes with it under the SIL Open Font License.

## The state explorer

The state explorer shows every state the interface can be in, without the server and without the project's data. Open
it at `/#explorer` in the window, or open the file `ui/dist/explorer.html` of the Naima checkout straight from the disk.

On the left it lists the states of each state machine of the interface. The shell's are every combination of the moment
(Live, or one of two commits of the past), the rail (closed or open) and the screen that the model allows. The summary's
are what Home shows while it reads, once it has read (the summary, or an empty one) and when the reading fails. Choose
a state and the real interface appears below in that state, with a summary recorded from a real project and scrubbed of
its details. Above it, "Path to here" gives the shortest way from the start to that state, and "Transitions" lists every
step out of it; choosing one takes that step. Using the interface in the preview moves the explorer too. "Every state"
shows a thumbnail of the interface in each state of the shell.

The shell's list comes from the code generated from its model, and its count is the model's: the model has 60 states,
36 where the interface rests between two of your actions and 24 it only passes through inside one, while it asks the
screens to read their data again. The explorer lists the 36 and says how many the model has.
