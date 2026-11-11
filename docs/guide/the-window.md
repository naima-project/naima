# The Naima window

`naima ui` opens a window onto the project. When the desktop app is installed (on macOS, Naima.app in an Applications folder), it opens the app on the project,
and if the app already has a window open on it, it brings that window to the front instead of opening a second one. Otherwise it opens the window in your
default browser: `naima ui` starts a small web server on your own machine, on a free port it picks each time, and the window is a page of that server. Ctrl-C in
the terminal stops the server, and the window with it.

```sh
naima ui                     # the desktop app on the project when it is installed, otherwise the browser
naima ui --browser           # the browser, even with the desktop app installed
naima ui --no-open           # print the address, with its token, and serve until Ctrl-C
naima ui --install-desktop   # build the desktop app and install it, on macOS
```

`naima ui` goes to the browser by itself when the app is not installed, and on macOS it then says that `naima ui --install-desktop` would install it. It goes
there too when the app cannot start, and says why.

### Installing the desktop app

On macOS, `naima ui --install-desktop` builds the desktop app on your machine and installs it as `Naima.app` in the Applications folder of your home folder,
which needs no administrator. It needs Rust (from [rustup.rs](https://rustup.rs)); Tauri's build tool is fetched as it runs. The first build takes some minutes,
since it compiles a couple of hundred Rust crates, and it says where it is as it goes: copying, then the crates compiled of the count the last build ended on,
then installing. It builds in Naima's folder of your caches (`~/Library/Caches/naima/desktop`), which it keeps, so a later build, after an update of Naima,
compiles only what changed; the build's output is in `build.log` there. Run it again after updating Naima to install the app that goes with it. The app takes
the project it shows from its first argument too, so `open -a Naima --args <project folder>` opens it on a project from the Finder's side.

You rarely need to type it. When an agent session starts, `naima hello` opens the window on the project by itself, in the background, and its one-line greeting
says so, with the address: the desktop app when it is installed (on macOS, Naima.app in an Applications folder), otherwise `naima ui` in the browser. If a
window is already open on the project, it is reused rather than opened a second time. It stays closed on CI, with `NAIMA_NO_UI` or `NAIMA_DATA` set, and in a
worktree other than the clone's main checkout, so agents working in their own worktrees never open one. To turn it off for a project, run
`naima plugin set ui atStart=false`; to turn it off for yourself everywhere, put `{"atStart": false}` in `ui.json` in your Naima config folder
(`~/.config/naima/` on macOS and Linux).

## The token in the address

The address `naima ui` opens looks like `http://127.0.0.1:53817/?token=9f3c…`, with a long string of letters and digits at the end. That string is the token.
`naima ui` makes a new one, at random, every time it starts, and the server answers only requests that carry it. A request without it gets a short error saying
that the address needs the token it was opened with.

The browser gets the token from the address and from nowhere else. When the first page arrives, the server also stores the token in a cookie of its own, named
`naima-ui-` followed by a few characters that come from the token, and from then on the browser sends that cookie with every request the window makes: its
scripts, the data of each screen, the actions, and the live feed that says when the project changed. This is why only the first address needs the token. The
cookie is marked so that no script can read it, and so that the browser sends it only with requests made by the window itself, never with requests that a page
of another site starts. The pages a plugin's tab shows run in a sandbox without the cookie; they load their own files under a separate key that the server
derives from the token, which opens those files and nothing else.

The token lasts as long as the run. When you stop `naima ui` and start it again, you get a new port and a new token, and the old address stops working. Each run
names its cookie differently, so two runs open in one browser at the same time, for two projects or two worktrees, each keep working with their own.

### What the token protects against

The server listens only on the loopback interface, 127.0.0.1, so no other computer on the network can reach it. Everything running on your own machine can,
though, and without the token any of it could read your project through the window's server and run the window's actions (record a decision, add a note, close a
gate's step, claim or release items). That includes:

- another program running on your machine, or another person logged in to it;
- a web page open in another tab of your browser, since a page is allowed to send requests to 127.0.0.1;
- a site that points its own name at 127.0.0.1 so that the browser treats the window's server as part of that site (an attack called DNS rebinding).

None of them knows the token, so the server refuses all of them. Actions have a second guard: the server runs one only when the request comes from the window's
own page, and refuses it from a page of any other origin even when the request carries the cookie.

The token does not protect against someone who can see the address. It is printed in your terminal and kept in the browser's history, so while the run lasts
treat it like a password. Nor is it meant to stop a program running under your own user account from reading the project's files directly, which it can do
without the window.

The desktop app needs no token. It shows the same window without a web server: it starts `naima ui --sidecar` itself and talks to it through that process's
standard input and output, so there is no port for anything else on the machine to reach.

## Using the window from another machine, over ssh

When the project is on another machine that you reach with ssh, run `naima ui` there and look at the window in the browser of the machine in front of you. The
server keeps listening only on the other machine's loopback interface, and ssh carries your browser's requests to it.

1. On the other machine, in the project's folder, start the server without opening a browser:

   ```sh
   naima ui --no-open
   ```

   It prints a line such as `naima ui: serving http://127.0.0.1:53817/?token=9f3c… — open it in a browser; Ctrl-C stops it`. Note the port, 53817 here, and
   leave it running.

2. On your own machine, in another terminal, forward the same port to it:

   ```sh
   ssh -N -L 53817:127.0.0.1:53817 <user>@<host>
   ```

   `-L` connects port 53817 on your machine to port 53817 on the other machine's loopback interface, and `-N` tells ssh not to open a shell. Leave it running
   too.

3. Open the printed address, token included, in your browser.

The port changes with every run, so forward it again whenever you restart `naima ui`. If that port is already in use on your machine, forward another one, for
instance `-L 8080:127.0.0.1:53817`, and change only the port in the address, `http://127.0.0.1:8080/?token=9f3c…`; the token stays the same. Do not add `-g` to
the ssh command, since that would open the forwarded port to the rest of your network. When you are done, press Ctrl-C in both terminals.

## What the window shows

The window opens on the new interface. At the top is the rail, a thin band with the newest stretch of the project's metro map and what is still ahead; it opens
over the page as the whole map when you point at it, reach it with Tab or press "Open the map". Under the rail are the screens: Home, Diary, Bugs, Features,
Failed tests and Metrics, then More, which lists the views the plugins add. Home and Metrics are described below; Diary, Bugs, Features and Failed tests are
placeholders and say so.

The strip at the top of the window, with the project and the moment, stays on screen while a screen scrolls under it, on every screen and at every width.

### Switching project

Beside the name "naima" at the top is the name of the project shown. Click it for the projects you opened recently, the most recent first, and pick one: the
same window opens it, and every screen shows that project. In a browser, `naima ui` stops serving this project and serves the one you picked at the same
address, so the page reloads on it by itself; the terminal where `naima ui` runs keeps it, and Ctrl-C stops it as before. The desktop app restarts its Naima in
the project you picked.

The list is `projects.json` in your standard config folder: `~/Library/Application Support/Naima` on macOS, `%APPDATA%\Naima` on Windows,
`$XDG_CONFIG_HOME/naima` (or `~/.config/naima`) on Linux. Each time `naima ui` or the desktop app opens a project, that project moves to the top, and a project
whose folder is gone is dropped. The All projects screen reads the same list.

### The rail

Closed, the rail is the metro map drawn small, over the newest 24 commits only: main and the open lines in their colours, the branches that leave and rejoin
within those commits, round stations, the robots on the worker branches and you on your line. A line that left main before those commits comes in from the left
edge; the older commits are on the open map. Past the last commit, main and every line go on, dashed, with a tick for each step of a line's goal still open, one
for each goal, and one where a line lands on main. The three nearest ticks carry a small grey label; the others show theirs when you point at them or reach them
with Tab.

Only goals are drawn ahead. A gate is a goal when it has a version (a release), a due date or steps, or when it is ordered with other gates (it comes after one,
or one comes after it); a goal's steps are its sub-goals. A gate with none of these, such as the one that collects what waits for you or the one that holds
while every property holds, is not a milestone and is not drawn.

Open, the rail is a metro map. Main runs across the middle and every open line runs above it, each in its own colour; the other branches run on lanes of their
own, above their line or below main. A branch leaves its base and rejoins it at 45 degrees and runs straight in between, and the stations where one leaves or
lands are drawn larger, as interchanges. Past the last commit, main and every line go on, dashed, with a station for each goal and step still ahead in the order
they come, and a line's future comes down onto main where it will land. Robots stand on the worker branches, each with a look of its own and a badge for its
status: a gear while it works, a flask while it tests, a question mark when it waits for an answer, a pause when it is idle or silent, a check when it is done
and waits to land. Working robots step in place at a few frames a second, and stand still when your system asks for reduced motion. The people of the project
stand on the map too, each under their own name: whoever is checked out here (git's `user.name`) on the branch checked out, and every other author of the
commits the map draws on the route of their newest commit. A small pin marks where the main checkout and each worktree stand, on the commit each has checked
out, with its name and branch; the main checkout's label and the one the window is served from are always shown, the others when you point at them. A commit you
have named with `naima name-stop <commit> "<name>"` shows that name under its station, and says it when you reach it with Tab, on the open map and on the closed
rail alike. You can also name it from the window: with a commit chosen and the map open, a field under the map holds that commit's name; type one and press
Name, or empty the field and press Remove name. The window runs `naima name-stop` for you, says when the name is kept, and reads the map again. The names are
kept in the tracker's `stops/` folder, one file per commit, written on the trunk like any other addition to the tracker.

Choosing a commit, on the strip or on the map, shows every screen as the project was at that commit; choosing a mark ahead shows that goal, step or landing on
Home, with its status as it is now. The left and right arrow keys step from one commit to the next on the rail, and on into the marks ahead. Escape, or the one
"Back to live" button, beside the moment at the top of the page, returns to Live. Amber marks only the stop or mark shown and the page's one main action.

The window the timeline shows is also the time filter of the screens. Zoom in or move the window, and the screens show only the days it covers: the Diary lists
those days alone, and the screen says which ones in words, for example "Showing Mon 3 – Sun 9 Nov", with an All time button beside it. All time, or zooming out
until the window covers the whole history, shows every day again. Until you zoom or move the window, every day is shown.

### The Filter button

Every screen with entries (the Diary, Bugs, Features, Failed tests, Goals, Roadmap, Meetings and the list of Metrics) has the same Filter button above its
list. It opens a panel under it: words to search for in the titles and what the entries say, then a menu for each thing the screen's entries can be told apart
by (the kind of item, the goal, the line of work, the person or agent who asked, the status in the screen's own words), each value with how many entries it
would keep, and the time window: All time, the last 7, 30 or 90 days. The time window is the time filter above, so choosing one narrows every screen, as
zooming the timeline does. A menu shows only when the screen's entries differ in it. What you chose shows beside the button as chips, each with a cross that
takes it away, with Clear all when there are two or more, and "Showing 12 of 87" says how many entries are shown of all the screen lists. The Diary filters its
moments and the folded routine of each day alike.

Each screen keeps its own choice, and the window remembers it for your next visit. The address carries it too, after the screen's name, as in
`#bugs?goal=release-2&q=slow`, so a link opens the screen filtered the same way; changing the choice replaces the address rather than adding a step to Back.
An agent can set the same choice through the UI's MCP server, with the store's `filters` transitions: `pick`, `drop`, `search`, `clear`, `within`, `show`
and `hide`.

### Days, on the left of every screen

Every screen has a Days button at the top left. It opens a time panel down the left side of the window, and closes it again; the window remembers whether you
left it open, and it starts closed. The panel is a table of contents of the project's time, told for the screen you are on, drawn like the metro map: one thick
line with a white station for each day, newest first, and under each day its moments of note. On Home and the Diary they are the diary's moments; on Bugs, the
bugs filed and fixed that day; on Features, what was asked for, started and shipped; on Failed tests, the tests that started failing and passed again; on
Metrics, the recorded runs; on Goals, the steps of the goals done; the other screens list the diary's days. At the top is Now, with Home's sections when you are
on Home, and under it each helper at work as a small robot, with what it works on and its state in plain words: working, asking you, idle or done.

Click a station and the page goes there: on a screen with its own moments, to that bug, feature, test, chart or goal (a folded group opens first, and an item
the screen does not show opens on its own page); on Home and the other screens the Diary opens at that day or moment. "See it then", beside a day, shows the
project as it was at the end of that day, on every screen, and "Back to now" returns.

Expand turns the panel into the vertical metro map: the same stations on the line, with the lines of work drawn beside it, one colour for each, from their first
day of changes to their last, each helper as a robot at the top of the line it works on, and a key at the top that names each line. Collapse goes back to the
list; the window remembers which you chose. The panel never moves the page's items apart and does not scroll with them; it scrolls on its own. On a phone it is
a sheet over the bottom of the page until you close it. It follows the time filter, so it lists only the days the timeline's window covers.

### Home

Home is one column under the rail. It says first which moment it shows: Live, with the line, or the commit with its date, its line and its message. Then:

- **Waiting for you**: the items the owner's gate holds and the tests that wait for your proof. Each says in plain words what it is (a discussion to settle, a
  decision, a bug, a feature, a test to run), what it asks of you (for example "Waiting for your decision: answer it so the work on it can go on"), and has one
  button, "Open it", that shows the item; the first is the one amber button of the page. At a commit of the past the list is as it was then, with no buttons:
  you act on the live view.
- **Goals**: the next goals in goal order, only gates that are goals, each with its due date or version, whether it holds or how many items block it, and how
  many of its open items are fixed and wait for proof; the goals after them in one line.
- **Development lines**: which line the view shows, then main and every open line, with its goal, its last update, how far it lags main and what is fixed on it.
- **Who is working**: each agent holding work, with its status and what it does now.

When a goal is chosen on the rail, Home shows that goal instead of what waits for you, in plain words: what it is (a release goal and its version, a goal and
its due date, a step of a goal, or where a line lands on main), what blocks it, and what you can do about it; then its steps and the items it waits on, each
saying what it is and whose hands it waits for, with "Open it". Home is built from the views' data, the same the commands print with `--json`: `naima gates`,
`naima queue`, `naima claims`, `naima line list` and `naima summary`.

### Metrics

Metrics shows the project's [metrics](metrics-and-budgets.md) at the moment the window shows. At the top are the key numbers, one card each: the value, its
change, the date of its record and a small chart of its history. Live, a card shows the newest record and its change since the record before. At a commit of the
past it shows the value then and its change against live, and says "recorded at this commit" or, when that commit has no record, "no record at this commit,
nearest:" with the date of the last record at or before it, the one that holds then. Clicking a card shows its metric in the large chart below. Beside that
chart is the list of every metric with its value, its change and a small chart; picking one shows it in the large chart. Every chart runs along the trunk's
commits in order, labelled with their dates; a commit of the past is marked by an amber line, and a bound by a dashed one. The range picks every commit or the
last 500 or 100. Each chart has a text summary that screen readers read. Clicking a point of the large chart, or pressing Enter on the one the arrow keys are
on, selects its commit, so the whole window shows that moment, and opens below the chart the record of the run that measured it: the value and whether it kept
its bound, when it was recorded, and how it was taken. For a test suite's number that is the suite's run, with its command, its counts, its time and the end of
its log, or the earlier run it reused because nothing the suite reads had changed; for a command's number, the command; for a code measure, the measure. A
metric becomes a card with `"card": true` in its declaration, or with its place among the cards, `"card": 2`, and goes under a heading of the list with
`"group"`; with no card marked, the first six metrics with records are the cards. The cards with a place come first, in that order, and the others after them in
the list's order, which is the order of the declarations. The screen names a metric by its `"label"`, such as `"Function size, mean"`, or else by its declared
name written as words, `function-size` as Function size. Below, the screen says how many of the newest commits have no record, with the main action Record
metrics, which runs `naima metrics run --record` on the commit checked out, under `naima run` with a budget of two hours, and says how the run goes until it
ends; one recording runs at a time, and when it succeeds the window reads the new records. Its data is the metrics view's, whose `timeline` places every record
on the trunk; at a commit it gives each metric's record at that commit, read from the records as they are now, since a commit's own tree holds none of the
records made after it. How the screen reads a moment is a small model of its own, checked like the shell's: an answer that arrives after the moment changed is
dropped and the new moment read. So is Record metrics: it starts one recording at a time, asks for its run's state one request at a time and only while it runs,
and reads again when it succeeded. The record of a point is the metrics plugin's metric-run view, which the bridge's `data` command reads with the metric and
the commit as its query.

The views of the earlier window are tabs: the summary, the gates, what is next, the claims, the boards, the session notes and each item with its evidence. Every
view's data is the same data the matching command prints with `--json`, and the new interface reads it from there.

## Tabs from plugins

Beside the screens are the tabs the project's plugins add, a stance's included, each with its own subtabs when it has some. The UI stance, for instance, adds a
Design tab with a subtab for each step of its design method: mood board, palette, typography, widget shapes and screens. Each subtab shows that step's rounds,
the variants of each in frames side by side, the variant chosen and the decision recorded. The stance finds the design record through `design` in the app's
`stance-ui.json`: the folder of the steps and their `decisions.md` (`design` by default), and, when the comparison pages are kept elsewhere, the folder that
holds them (the stance's README says how).

The tabs wait behind More, the last and quietest entry of the navigation: More lists every tab with what it shows, and choosing one opens it, while More stays
marked as the place you are. A tab opens from More or from another tab, never straight from a screen, so Home shows only what it is made of; that rule is part
of the interface's model and is checked there. A tab keeps the moment the window shows: opening a tab or a subtab never changes it, and Live stays one step away
whichever tab is open. Opening a tab or a subtab closes the rail. The views of the earlier window are tabs as well, each showing its page.

What a plugin shows in a tab is either data, which the window draws with its own components (a list, a table, a chart, a gallery of framed pages, markdown
text), or a page of its own. Every such page runs in a sandboxed frame, cut off from the window: its scripts cannot read the window, its data or its token, nor
run an action, and it can load nothing from outside. How a plugin adds a tab is in [the plugin contract](../reference/plugin-contract.md#tabs-of-the-window).

## Live, and the past

The window follows the project as it changes. Naima looks at it every second: a new commit, a branch or tag that moved, a file of the tracker written (an item,
a note, a claim). When something changed and has settled, it sends one event, naming what kinds of change it saw. While the window shows Live, the screens read
their data again; while it shows a commit of the past, nothing moves until you go back to Live. That rule is part of the interface's model and is checked there.

What the window last read is kept on disk, in Naima's folder inside the project's git directory (or the folder `NAIMA_VIEW_CACHE` names), with what Naima
watches: HEAD, the branches and tags, and the tracker's files by size and time. The window opened again on a project where none of these moved draws from it at
once, then reads everything again a moment later, and shows what changed meanwhile as a live change. On a large project this is what keeps the first screen
from waiting for every view to be computed.

What a live change brings is shown as it arrives. New cards, rows, items and stations fade in with a slight rise, what went away fades out, and what changed
place slides to its new one. In the Days panel a new day or moment grows into its space, so the line of days lengthens as the project fills. Only what is new
since the last reading moves: opening the window, changing screen or choosing a filter shows the page at once. When your system asks for reduced motion, every
change is shown at once, with no movement.

Any view's data can be read as a commit had it: what the same view answers on a checkout of that commit, read only, from the tracker in that commit's tree. A
commit is named by its hash or by any name git knows, such as a branch or `HEAD~3`. One git does not know, or one that no local branch reaches, is refused with
a plain message. The commits looked at are kept, so going back to one is quick.

The rail's map is drawn from the trunk and every open line, the other branches that left or rejoined in the last 60 commits of the trunk, each with its commits
and where it left and rejoined; every worker branch with its claim and a status; and, for the trunk and each line, the goals still ahead in goal order. A line's
goals are its gate's steps not yet closed, then the gate. The trunk's are the gates not yet finished that are goals, by the rule in The rail above, with each
line's gate shown as that line landing. The parts come from the commands that own them (`naima line list`, `naima claims`, `naima gates`, each with `--json`),
so the map and the commands always agree.

A worker's status comes from the records Naima keeps of its branch, never from the words of its step: its claim and the time of its last step, its commits, the
runs started from its worktree with `naima run` (each run records the branch it was started on), the discussions still open on an item it claims, and the
silences between them. The records are read oldest first by a small state machine, generated with naima-codegen from its mCRL2 model
(`develop/models/ui/worker-status` in the workshop), whose properties are checked; its `why` field lists the records it was given. While the branch holds a
claim, the first of these that applies is its status:

- **question**: a discussion on one of its items is still open;
- **testing**: a run started from its worktree is still going;
- **idle**: no record for longer than the coordination option `silentAfter` since its last sign of life (a step, a commit, a run starting or ending);
- **working**: otherwise.

With no live claim, a branch that has commits its base lacks is **done, waiting to land**, as a worker leaves it when it hands its work over.

## Actions

The window can run a few naima commands for you: record a decision (`decide`), add a note (`note`), close a gate's step (`gate step`, not adding or removing
one), claim items or post a step (`claim`), release a claim (`release`) and name a commit of the map (`name-stop`). Each runs as a run of `naima run`, exactly
as if you typed the command, so every rule and check applies, and the window can follow the run: its state, its exit code and what it printed. None of them
rewrites history. Another page in your browser cannot run one.

## How it is built

The interface is a Svelte app that ships with Naima, already built: Naima needs no npm package and no network to show it. It is built with the
[UI stance](stances.md): its tokens, widgets, store and rules, which the stance's checks hold it to. Everything it reads and does goes through the stance's
bridge, as commands of Naima's own: `describe`, `data` (a view's data, live or at a commit), `tabs`, `tab` (what a tab shows), `metro` (the rail's map),
`action` and `run`, and the feed `changes`, which says when the project changed. In the browser the bridge is `POST /bridge/<command>` and, for the feed, a
stream of server-sent events at `/bridge/changes`, behind the run's token; a command is refused from any page but the server's own. Its logic is generated from
a model. The moment, the rail, the current screen and the plugin's tab and subtab shown form one state machine, modelled in mCRL2 and checked with its
properties, and naima-codegen generates the code the screens call. How a screen reads its data is a second one, the reader: a change that comes while a screen
is still reading is never lost, since the screen reads once more when the first answer comes, and that answer, which may be of the moment before, is set aside.
The components only read the machines' state and call their transitions. The colours, type and shapes are the design tokens of the interface, and the Inter
typeface comes with it under the SIL Open Font License.

## The state explorer

The state explorer shows every state the interface can be in, without the server and without the project's data. Open it at `/#explorer` in the window, or open
the file `ui/dist/explorer.html` of the Naima checkout straight from the disk.

On the left it lists the states of each state machine of the interface. The shell's are every combination of the moment (Live, one of two commits of the past,
or one of two goals ahead), the rail (closed or open), the screen, or a plugin's tab and subtab (two of each, as in the model), with the tab and subtab last
shown, that the model allows. The home data's are what Home shows while it reads, once it has read (a recorded project, or an empty one), when the reading
fails, and while a reload waits for the reading on its way. Choose a state and the real interface appears below in that state, with the map and the project
recorded from a real one. Above it, "Path to here" gives the shortest way from the start to that state, and "Transitions" lists every step out of it; choosing
one takes that step. Using the interface in the preview moves the explorer too. "Every state" shows a thumbnail of the interface in each state of the shell.

The shell's list comes from the code generated from its model, and its count is the model's: the model has 596 states, 320 where the interface rests between two
of your actions and 276 it only passes through inside one, while it asks the screens to read their data again or the tab shown to read its content. The explorer
lists the 320 and says how many the model has.
