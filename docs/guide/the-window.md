# The Naima window

`naima ui` opens a window onto the project. It is served by a small server on your own machine, which only you can reach: it listens on the loopback interface,
and every request has to carry a token made for that run. Closing the window stops the server.

```sh
naima ui              # the window, or the default browser where the window cannot open
naima ui --browser    # the default browser
naima ui --no-open    # print the address, with its token, and serve until Ctrl-C
```

## What the window shows

The window opens on the new interface. At the top is the rail, a thin strip with the project's commits and what is still
ahead; it opens over the page as a metro map when you point at it, click it or reach it with Tab. Under the rail are the
screens: Home, Metrics, Diary, Bugs, Features and Failed tests. Home is described below; the other screens are
placeholders and say so.

### The rail

Closed, the rail is one row: every commit on the map as a small dot, oldest on the left, then the future of the line
the checkout here works on, drawn dashed, with a tick for each step of its gate still open, one for its gate, and one
where it lands on main. The three nearest ticks carry a small grey label; the others show theirs when you point at
them or reach them with Tab.

Open, the rail is a metro map. Main runs across the middle and every open line runs above it, each in its own colour;
the other branches run on lanes of their own, above their line or below main. A branch leaves its base and rejoins it
at 45 degrees and runs straight in between, and the stations where one leaves or lands are drawn larger, as
interchanges. Past the last commit, main and every line go on, dashed, with a station for each goal and step still
ahead in the order they come, and a line's future comes down onto main where it will land. Robots stand on the worker
branches, each with a look of its own and a badge for its status: a gear while it works, a flask while it tests, a
question mark when it waits for an answer, a pause when it is idle or silent, a check when it is done and waits to
land. Working robots step in place at a few frames a second, and stand still when your system asks for reduced
motion. You stand on the line checked out here.

Choosing a commit, on the strip or on the map, shows every screen as the project was at that commit; choosing a mark
ahead shows that goal, step or landing on Home, with its status as it is now. The left and right arrow keys step from
one commit to the next, and on into the marks ahead. Escape, or "Back to live", returns to Live.

### Home

Home is one column under the rail. It says first which moment it shows: Live, with the line, or the commit with its
date, its line and its message. Then:

- **Waiting for you**: the items the owner's gate holds (an open question, a decision) and the tests that wait for
  your proof, each with what it asks of you; the first has the one amber button of the page. At a commit of the past
  the list is as it was then, with no buttons: you act on the live view.
- **Goals**: the next goals in goal order, each with its due date or version, whether it holds or how many items
  block it, how many of its open items are fixed and wait for proof, and its gate's steps; the goals after them in one
  line.
- **Fixed, waiting for proof**: what is fixed and waits for an agent or a build to prove it, and on which gate.
- **Development lines**: main and every open line, with its goal, its last update, how far it lags main and what is
  fixed on it.
- **Who is working**: each agent holding work, with its status and what it does now.

When a goal is chosen on the rail, Home shows that goal instead of what waits for you: its status, its version or due
date, what comes before it, its steps and the items it waits on. Home is built from the views' data, the same the
commands print with `--json`: `naima gates`, `naima queue`, `naima claims`, `naima line list` and `naima summary`.

The earlier window is still there at `/classic` in the same server: the panels of the first screen (the summary, the gates, what is next, the claims) and the
tabs of the boards, the metrics, the session notes and each item with its evidence. Every view's data is at `/data/<view>` as JSON, the same data the matching
command prints with `--json`; the new interface reads it from there.

## Tabs from plugins

Beside the screens are the tabs the project's plugins add, a stance's included, each with its own subtabs when it has some. The UI stance, for instance, adds a
Design tab with a subtab for each step of its design method: mood board, palette, typography, widget shapes and screens. Each subtab shows that step's rounds,
the variants of each in frames side by side, the variant chosen and the decision recorded. The stance finds the design record through `design` in the app's
`stance-ui.json`: the folder of the steps and their `decisions.md` (`design` by default), and, when the comparison pages are kept elsewhere, the folder that
holds them (the stance's README says how).

A tab keeps the moment the window shows: opening a tab or a subtab never changes it, and Live stays one step away whichever tab is open. Opening a tab or a
subtab closes the rail. The views of the earlier window are tabs as well, each showing its page as at `/classic`.

What a plugin shows in a tab is either data, which the window draws with its own components (a list, a table, a chart, a gallery of framed pages, markdown
text), or a page of its own. Every such page runs in a sandboxed frame, cut off from the window: its scripts cannot read the window, its data or its token, nor
run an action, and it can load nothing from outside this server. `/data/tabs` lists the tabs, and `/data/tab/<name>?sub=<subtab>` gives what one shows. How a
plugin adds a tab is in [the plugin contract](../reference/plugin-contract.md#tabs-of-the-window).

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
The moment, the rail, the current screen and the plugin's tab and subtab shown form one state machine, modelled in mCRL2 and checked with its properties, and
naima-codegen generates the code the screens call. How a screen reads its data is a second one, the reader: a change that comes while a screen is still
reading is never lost, since the screen reads once more when the first answer comes, and that answer, which may be of the moment before, is set aside. The
components only read the machines' state and call their transitions. The colours, type and shapes are the design tokens of the interface, and the Inter
typeface comes with it under the SIL Open Font License.

## The state explorer

The state explorer shows every state the interface can be in, without the server and without the project's data. Open
it at `/#explorer` in the window, or open the file `ui/dist/explorer.html` of the Naima checkout straight from the disk.

On the left it lists the states of each state machine of the interface. The shell's are every combination of the moment
(Live, one of two commits of the past, or one of two goals ahead), the rail (closed or open), the screen, or a plugin's
tab and subtab (two of each, as in the model), with the tab and subtab last shown, that the model allows. The home
data's are what Home shows while it reads, once it has read (a recorded project, or an empty one), when the reading
fails, and while a reload waits for the reading on its way. Choose a state and the real interface appears below in that
state, with the map and the project recorded from a real one. Above it, "Path to here" gives the shortest way from the
start to that state, and "Transitions" lists every step out of it; choosing one takes that step. Using the interface in
the preview moves the explorer too. "Every state" shows a thumbnail of the interface in each state of the shell.

The shell's list comes from the code generated from its model, and its count is the model's: the model has 524 states,
280 where the interface rests between two of your actions and 244 it only passes through inside one, while it asks
the screens to read their data again or the tab shown to read its content. The explorer lists the 280 and says how many
the model has.
