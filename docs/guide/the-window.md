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

Each project has an app window of its own, and the app tells them apart. Its icon is the Naima logo (a rounded square, with the margin macOS icons have; a plain
square on Windows and Linux). The window's title is the project's name, and the icon in the Dock (macOS) or the taskbar (Windows, Linux) carries a round badge
in the corner: the project's initial, on a colour taken from its name, so the same project always has the same one. Switching to another recent project in the
window changes the title and the badge with it. Wayland does not let an application set its own window icon, so on a Wayland desktop the window shows the plain
one.

In the desktop app, Cmd+R on macOS (View, Reload) and Ctrl+R or F5 on Windows and Linux reload the page, as a browser does. The address holds every state of the
window, so a reload brings you back to the same place.

### Testing the window while it is being changed

`naima ui --watch` is for whoever changes the UI and wants to see each change as it lands in the bundle. The window reloads by itself whenever the UI is rebuilt
(`deno task ui build` in the workshop rewrites `ui/dist`, and the files of a study's view count too). A reload keeps the screen, since the address holds it, and
the scroll place, and the window says "Updated" for a moment in a corner. The rebuild is taken as finished once the files have been quiet for a third of a
second and `index.html`, written last, is there again.

With the desktop app installed, `naima ui --watch` opens the app on the project running this Naima instead of the one the project pins: the app's page comes
from this Naima's bundle and its sidecar runs this Naima's program, so a branch that has not landed, new bridge commands included, shows in the app. This is a
window of its own, apart from one already open on the project. It reads two variables the command sets, `NAIMA_PROGRAM` (the Naima's folder) and `NAIMA_DENO`
(the Deno that runs it); started by hand with them set, the app does the same. With `--browser` or `--no-open`, or without the app, `--watch` serves the page in
the browser and tells it to reload. Without `--watch` nothing is watched and nothing changes.

### What agents use

An agent reaches Naima through two MCP servers, which keep the screen and the tracker apart. `naima ui --mcp` (named `naima-ui` in an agent's client) is the
window seen as a person uses it: the agent shows you a place, reads what the window shows, takes its picture and moves its store through the same transitions
your clicks call, all by asking the window you have open. `naima ui --mcp-tracker` (named `naima-tracker`) never touches the window: it reads the items, gates,
lines, history, work and metrics straight from the project, and runs the window's short list of actions. The agents' page on
[showing the owner](../agents/showing-the-owner.md) lists which tool is on which server and how to add them.

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

Every screen with entries (the Diary, Bugs, Features, Failed tests, Goals, Roadmap, Meetings and the list of Metrics) has the same Filter button above its list.
It opens a panel under it: words to search for in the titles and what the entries say, then a menu for each thing the screen's entries can be told apart by (the
kind of item, the goal, the line of work, the person or agent who asked, the status in the screen's own words), each value with how many entries it would keep,
and the time window: All time, the last 7, 30 or 90 days. The time window is the time filter above, so choosing one narrows every screen, as zooming the
timeline does. A menu shows only when the screen's entries differ in it. What you chose shows beside the button as chips, each with a cross that takes it away,
with Clear all when there are two or more, and "Showing 12 of 87" says how many entries are shown of all the screen lists. The Diary filters its moments and the
folded routine of each day alike.

Each screen keeps its own choice, and the window remembers it for your next visit. The address carries it too, after the screen's name, as in
`#bugs?goal=release-2&q=slow`, so a link opens the screen filtered the same way; changing the choice replaces the address rather than adding a step to Back. An
agent can set the same choice through the UI's MCP server (`naima-ui`), with the store's `filters` transitions: `pick`, `drop`, `search`, `clear`, `within`,
`show` and `hide`.

### Lists, links and the item drawer

Bugs, Features and the Requirements of Specs open on their answer: how many bugs are to fix now, how many features are being built, how many requirements are
proven of how many, then the other states with their counts, and one sentence saying what the screen lists. Each count shows only its rows in the table under
it, and pressed again shows them all; the same choice is the row of chips marked "Show only". Grouping, the columns shown, closer rows and saved views are in
the Arrange menu beside the search. A feature built and not yet landed on the main line is listed as built and waiting to land, as a fixed bug is.

What a screen names is a link. A release or goal in a row, in the item drawer or on All projects opens the Plan with What's left on that goal unfolded; a worker
holding an item opens Workers; an item named by its reference in a description or a note (bugs/<slug> and the like) opens in the drawer. A row opens its item in
the drawer, a panel on the right: its kind and where it stands, its release, priority and dates in plain words, why it waits, what it is about, its links and
its history, with "Open its page" at the top. The drawer closes when another screen is shown. Every item's address is `#item/<type>/<slug>`, so a link opened in
a new tab shows that item's page.

### Bringing anything to the chat

Anything in the window can be brought to the chat you have with your agent: an item's row or its page, a count such as the bugs waiting for you, a goal, a day,
the diary, a study on Models, or a few words you selected. Right-click it (on a touch screen, press and hold; from the keyboard, the menu key on what has the
focus). A strip at the foot of the window says what will be brought, for example "Bring to the chat: the item bugs/login-fails", and its button brings it. What
reaches the chat says what the thing is, its reference when it has one, the screen you were on and a short text, so the agent can take it up without asking
which one you meant. Shift with the right-click gives the browser's own menu, and a field keeps its own menu as usual.

The strip then says how it went. "Sent to the chat" means your chat session's Naima server took the message and wrote it into the session; "In the chat" means
the agent has said it has it. When no chat session is listening, which is the case when your chat is the Claude desktop app, the window copies the message at
once and the strip says "Copied — paste it in your chat", with the text shown and a "Copy again" button. It offers the same copy when the agent has not taken
the message within about five seconds, which usually means the session was started without Naima's channel; a message nobody took by then is withdrawn, so it
never arrives later as well as pasted.

The message travels through Claude Code's channels, which deliver an outside event into a running session. They work in Claude Code's terminal app, not yet in
the desktop app, and while they are a research preview a channel that is not on Anthropic's list is turned on for one session at its start. Start Claude Code in
the project's folder with the name its MCP settings give `naima ui --mcp` (often `naima` or `naima-ui`):

```sh
claude --dangerously-load-development-channels server:naima
```

Claude Code asks you once to confirm, and then shows that messages from that server reach the session. A session started without the flag still works as before;
the window simply offers the copy.

### Days, on the left of every screen

Every screen has a Days button at the top left. It opens a time panel down the left side of the window, and closes it again; the window remembers whether you
left it open, and it starts closed. The panel is a table of contents of the project's time, told for the screen you are on, drawn like the metro map: one thick
line with a white station for each day, newest first, and under each day its moments of note. On Home and the Diary they are the diary's moments; on Bugs, the
bugs filed and fixed that day; on Features, what was asked for, started and shipped; on Failed tests, the tests that started failing and passed again; on
Metrics, the recorded runs; on Goals, the steps of the goals done; the other screens list the diary's days. At the top is Now, with Home's sections when you are
on Home, and under it each helper at work as a small robot, with what it works on and its state in plain words: working, asking you, idle or done. Pointing at a
helper lights its line, and its items on the Plan's What's left; a click on its robot lists what it holds on the goal open there, or opens its lane on Workers.

Click a station and the page goes there: on a screen with its own moments, to that bug, feature, test, chart or goal (a folded group opens first, and an item
the screen does not show opens on its own page); on Home and the other screens the Diary opens at that day or moment. "See it then", beside a day, shows the
project as it was at the end of that day, on every screen, and "Back to now" returns.

Expand turns the panel into the vertical metro map: the same stations on the line, with the lines of work drawn beside it, one colour for each, from their first
day of changes to their last, each helper as a robot at the top of the line it works on, and a key at the top that names each line. Collapse goes back to the
list; the window remembers which you chose. The panel never moves the page's items apart and does not scroll with them; it scrolls on its own. On a phone it is
a sheet over the bottom of the page until you close it. It follows the time filter, so it lists only the days the timeline's window covers.

### Home

Home is one board under the bar, with little text, about what matters now. It fits the window, and the page itself never scrolls: the board is a header over a
stage, the one place for details, described at the end of this section. At the top is the day, or, when the timeline shows a commit of the past, "As it was on"
that day, with "Back to today". Beside the day, a row of quiet words opens the other pages: Models, UI when the project declares it, then Bugs, Tests, Health
and History, described in [The calm pages](#the-calm-pages). Then the goal nearest its expected date that still has work left: a ring with how much of it is
done, its title, and one line with its expected date and how sure that date is, such as "Expected 2 January · 85% sure by 17 January" (its due date when there
is no forecast yet). Beside it is a green dot for each agent at work, and how many there are in words. Under them are the goal's three numbers, always shown:
the items left to do, the items of the goal the agents hold, and how many items closed a day lately. A click on the number left to do opens What's left of the
goal in the stage. Its legend names each state with its count, each a link to that part of the goal's list; when more waits for you across the project than in
this goal, the goal's part ("2 waiting for you here") is followed by the whole of it as a link of its own ("19 in all"), which opens Waiting for you. When the
goal has a development line, the items already fixed on it are not counted as left: a quiet green line under the number says how many there are, for example
"195 fixed on the line · closes at the release", since they close on main only when the line lands. The ring counts them as done, and What's left says them
apart in the same words.

A click on the ring, or Enter on it, turns the board over. The ring and its words fade out and, in their place, the chart fades in, showing how much of the goal
was done over time: an orange line of its percent done, on axes in the goal's own unit. Faint lines mark none, half and all of its items, each named by its
count at the right, the top one with how many are closed ("403 items · 342 closed"); under the plot, the window's first day, today, the expected date and the
date it is 85% sure by are ticked and named. Ahead of today a faint band runs from the percent now to 100% at the expected date, widening to the 85% date. An
item fixed on the goal's development line counts as done from the day its fix landed on the line, at every moment the chart shows, so the line has no step where
the counts read at past commits meet today's. Its time is the river's, so each moment stands right above the same moment on the river, and the band ends above
the goal's milestone; dragging, zooming or moving the river's today line moves the chart with it. The line passes through the goal's exact percent at the last
landing of each of the last 30 days, and of each week before them, read from the tracker as it was at that commit. These are read in the background while the
chart is shown, the newest first, and each commit only once, so a pan or a zoom reads only the days it adds. Until a day is read, that stretch shows an estimate
from the dates the goal's items were planned and closed, and the line moves to each exact point as it arrives. The band ahead comes from the recent pace, as the
expected date does. A click on the chart, Escape or Back turns the board back to the ring. The address says which side is up (`#home/chart`), so Back, Forward
and a reload keep it. With reduced motion one side simply replaces the other.

The top of Home shows one metric at a time, as a watch shows one face, while the river below stays where it is. The goal's ring is the first face. By default
the others are Activity, the landings on main as soft bars, one for each slice of the river; Decisions, the decisions taken with you as orange stars joined by a
thin line, larger when a decision touched more items; and Pace, the items closed a day over the week before each day, as a line. Each face is drawn over the
river's window, so a pan, a zoom or the today line moves it as it moves the chart, and the value at the today line stands beside it. Under each face are a few
numbers for the window, as the goal's three stand under the ring. To change face, swipe the top sideways with a finger, the mouse or a trackpad, use the left
and right arrow keys while it has the focus, or pick a name on the hairline under it. At rest the hairline shows only the current face's name, with a short
orange mark where that face stands among the others; the other names appear when you point near their place or at the face, or when you reach them with Tab, and
on a phone when you tap the current name. The first time a browser shows Home, the top slides a little towards the next face and back, to show there is more.
The address names the face (`#home/metric/activity`), so Back, Forward and a reload keep it.

The "+" at the end of the hairline opens a gallery in place of the faces. It shows every metric Home can draw as a small picture of its face, grouped by kind:
levels as a line (the pace, and the key numbers you recorded with [`naima metrics`](metrics-and-budgets.md)), distributions as a line with a pale band (the
complexity across functions, when the project records two statistics of it, such as the median and the largest), amounts as bars (landings, lines changed,
commits, items filed, bugs filed, items closed) and events as stars (decisions, releases). Two more faces sit there. Goals shows the goals with work left, up to
four, two by two, each a smaller ring with its name and its day under it; the goal Home shows has a short orange mark under its name, and a click on another
makes it Home's goal: its ring grows into the large one, Home follows that goal's development line when it has one, and the address keeps the choice (`?g=`
names the goal). Flow shows your tasks, bugs, features and epics by where their work stands, one layer for each state over the river's window: done at the
bottom in grey, then waiting for proof, in progress and to do in shades of orange. An item counts as in progress from its claim, back to do when the claim is
released without a landing, waiting for proof from its landing, and done when it is closed. The bottom of the drawing is what was done before the window starts.
Under it, each state's count at the moment shown; a click on a layer or a count lists that state's items in the stage. A click puts a metric on Home or takes it
off. Home shows at most four faces, the goal's ring always first, and a metric the project does not measure says "not measured here". This browser remembers the
choice for each project. Escape, the "+" again or Done close the gallery.

Under a hairline, one sentence says what needs you: "Nothing needs you.", or, for example, "Three decisions need you.". It counts what Waiting for you lists, at
the moment Home shows: at a day of the past it says what needed you then. It is a link that opens [Waiting for you](discussions-and-meetings.md#waiting-for-you)
in the stage. The key d still takes the decisions one at a time. When what needs you is an agent gone quiet, its detail on Home links to that agent's entry in
Waiting for you, where one click brings the case to the chat.

Last is the river, the board's widest part, about a fifth of its width tall (on a window less than about 800 pixels high it is lower, with one row of names
above the line, so that it and the choices under it stay in view). It shows the future first: at rest today stands near its left edge, after a short stub of the
last few days, and the window reaches the next three goals with a date and every goal after them that follows the one before within a month, at most twelve.
Ahead of today the river spends its width on what happens rather than on empty weeks: each stretch between two goals gets room by how long it is, but a long
empty stretch is drawn shorter, with two small slashes across the line where time is skipped, and goals a day apart still stand well apart. Because of this,
every goal and deadline carries its day in words. Each goal in the window, each due date of a milestone, sub-goal or epic, and each goal overdue is named above
the line with its day and how far ahead it is, for example "1.2" over "26 Dec · in 5 weeks", in up to three rows so that no two names run into each other; the
nearest ones are darker and the focused goal's name is bold. A due date is a ring with a dot at its heart, a forecast date a dashed ring, and a date only
projected at the present pace a dotted one, said "about 11 Jan". Under the river you choose how much of the future it shows: a week, a month, a quarter, up to
the next deadline, or everything. The days shown are written beside the choices (for example "21 Nov – 20 Dec"), with − and + to widen or narrow them. Ctrl or
Cmd with the wheel, or a pinch on a trackpad, zooms around the pointer, and a double-click on an empty part of the river zooms in there. Dragging the river
works as a music editor's timeline does: sideways it moves through time, up it zooms in around the pointer and down it zooms out, both at once in one drag. The
river follows the pointer continuously, frame by frame, each mark keeping its size, and settles into place when the drag ends or the pointer rests. A mark
leaves the river only once it is wholly out of view, and a label or small ring the zoom has no room for fades out and back in rather than popping; the
calendar's ticks and month names come and go by degrees. The plain wheel scrolls the page, never the river. The goals after the end of the window are gathered
into one marker at its right edge, for example "12 more, to Jul 2027 →"; a click on it widens the window until they all show.

The past is reached by dragging the river to the right, or by swiping it. The commits on main are grey dots on one line, each dot the commits of a part of the
time shown, larger when they changed more lines. The agents at work are drawn where their work is going: under the line, a green lane runs from today to the
ring of the goal whose work they hold, as the count beside the ring says them, named on the lane, for example "4 agents towards 1.2"; work for no goal in view
is a short lane, "1 agent on other work". A click on a lane shows its agents. Today is a small orange tick on the line, and the river's one orange line stands
at the goal's ring: the focus horizon. By default it stands at the next major goal of the line Home follows, such as the next release. Every goal with a due day
has its ring ahead until that day, even one with no work left in it, so every deadline of the project can be seen on the river. Each ring is named by its own
words: when several goals share the start of their titles (as "CAV 2027: full paper submitted" and "CAV 2027: author response" do), each is named by the rest of
its title, and the full title shows when the pointer rests on the ring.

Everything before the horizon is shown in full and is what Home counts: the goals between today and it, their meetings, milestones and epics, and what needs you
from them, in the sentence, in Waiting for you and in "for when you have time". Beyond it the river is only a sketch of the road ahead, drawn faint: every later
goal as a grey ring, those with no expected or due day after the dated ones in goal order, and the milestones, with no epics or sub-goals. A question that only
concerns a goal beyond the horizon, even on a meeting with no date, waits there until the horizon reaches it.

To move the focus, drag the horizon onto another goal's ring (take the orange line anywhere along its height), press the arrow keys on it, or pick that goal's
day on the calendar: the horizon glides there. At a later goal its events appear in full and its meetings and questions join what needs you; at an earlier one
the focus narrows to what comes before it. The ring at the top, its caption and the faces follow that goal. The arrow keys step it one goal at a time (the left
one goes a day into the past from the first goal ahead), and Home (the wordmark or the key H) or the Home key on the line brings it back to its default goal.
The horizon moved is written in the address as `h=` and the goal, so Back, Forward and a reload show the same focus.

A click on anything drawn on the river, in the past or ahead, only shows it under the river and never moves the orange line, Home's moment or the page's scroll.
A goal's ring ahead shows the goal and, at once, the items that have to close before it can be reached: its own open items and those of every goal it comes
after, in an order in which they can be done, each item after the ones it waits on and the earlier goal's items first. A click on an item opens it. The small
rings ahead of the sub-goals and epics show the same list for themselves. Moving through time is done only with the orange line, by dragging it or with its
keys, or by picking a day on the calendar.

A goal missed, whose due day has passed with work still left, is not drawn ahead. While today is in view, its red ring stands just before today, named "overdue
since 17 Nov"; when the river is dragged into the past, it stands at its due day, named "missed 17 Nov". When today is out of view and that day is before the
window shown, a red "‹ 1 missed" under the river takes the window back to it. A click on the ring shows the goal.

Every dated thing, on the river and in the stage's lists, says how urgent it is, quietly. It is drawn as usual while all is well. It turns amber when it is at
risk: its forecast passes its due day, or its due day is two days away or less with work left. It turns red once it is late: its due day has passed with work
left (a goal or a milestone missed, a meeting whose day passed unheld). On the river the ring's stroke (or a meeting's two rings) takes the colour; in a list,
the row's date does, and the words say it under the title ("at risk, due 2 Dec"). Every ring's description, read by a screen reader, says it too.

On Home's upper part, what can be clicked says what it does with a faint mark after its words. A small chevron (⌄) reveals something in place, just under it,
and turns over once open, as the goal's caption, the agents and two of the three numbers do. A small arrow down (↓) opens a list in the stage below: what is
left to do, what needs you, the bugs, the features, the questions for when you have time.

Everything else ahead that has a day stands on the river too, as a small grey ring at that day: the milestones the goals' rings leave out, the sub-goals with a
due or expected day, and the epics with work left and a planned or expected end. A ring is larger when there is more of it: the items a milestone has left, the
days of work an epic is expected to take. At the week only the heaviest few show; zooming in reveals more of them, each growing into place, and none is drawn
over another ring. A click on a small ring, or Enter on it, shows it under the river with what has to close before it. Ahead, in the stage's index, is the list
of everything ahead with a day, nearest first; the address says so (`s=ahead` and the item), so Back, Forward and a reload come back to it.

A goal that is closed sits on the river as a small grey crown at the day it was released: the day its version was tagged, or else the day its release was filed.
A click on a crown shows the goal under the river. When a goal closes while Home is open, its ring ahead shrinks and travels back to that day, settling there as
the crown; with reduced motion it is simply there.

Your meetings with a date stand on the river ahead at their day, before the horizon only, each as two small rings overlapping, people meeting, with the number
of questions waiting on it. A click on a meeting, or Enter on it, holds that meeting in the stage, one question at a time: the question up is large, the next
ones recede behind it. A click on the question up brings it into the chat, where the agent raises it with you at once (as `naima meeting raise` would); once it
is answered there it goes, and the next one rises into its place. A click on a question behind brings that one up and into the chat instead. The questions of
the meetings with no date, those that concern a goal before the horizon, are one quiet phrase beside the caption, such as "and 3 for when you have time", and a
click on it holds them in the stage the same way.

A meeting's date can be changed from Home. Drag it along the river to another day, drag it off the river to take its date away, or drag a meeting with no date
onto the river; with the keyboard, the arrow keys on a meeting move it a day at a time, and Escape gives the move up. The meeting held in the stage also has its
date to pick, or No date. Each change runs `naima meeting date`, the command an agent would run, and the meeting stays where you put it while the command runs;
if it fails, it goes back to its day.

The day's date at the top of Home is drawn with a small calendar bearing today's number, with an orange dot on it when a deadline or a meeting falls in the
coming week. A click on the date, or Enter on it, opens the month under it. Every deadline is marked on its day, met or not, and so are the forecasts of the
goals, the meetings held and to come, and the releases; pointing at a day, or reading it with a screen reader, says what each mark is. Picking a day travels
there: a day of the past shows Home as it was at the end of that day, a day ahead with a goal on it moves the focus horizon to that goal, and Today brings Home
back to now. The arrow keys move through the days, Page Up and Page Down through the months, and Escape or a click outside closes it.

Calendar, in the stage's index (its title, described below, marked with the same small calendar), shows the month as a calendar in the stage: a grid of its days
with no lines, a small square on a day with a meeting, a small ring on a day a goal is due or expected, a small crown on a day a release was tagged, and today's
number in orange. It shows the month of the moment Home shows; ‹ and › show the month before and after. A click on a day opens it beside the grid, which narrows
to a column: the day in full, its meetings with their questions (a click holds one in the stage) and its goals. The address says what the stage holds
(`s=meeting~<name>`, `s=calendar~<month>` with `i=` for the day), so Back, Forward and a reload come back to it.

When the project has development lines (`naima line`), the river carries them beside main. The line Home follows runs under main as a full tributary: it
branches off where the line was cut, carries its own commits as dots and its agents as green lines, and its dotted orange path leads from today back up to main
at its goal's ring, where the line will land. By default Home follows the line of the goal it shows. Every other line is a faint thread above main, branching
off and rejoining it the same way at its own goal's ring. The line followed is named under its tributary, after today, as a quiet menu, "line release-1.2" with
a small chevron: it lists the open lines, and choosing one follows it. A thread under the pointer lifts and says its line's name. A click on a thread, the menu,
or Enter on the threads (the next line each time, named while they hold the focus) follows that line: the tributary moves to it, and the ring, its caption, the
faces and the diary turn to that line's goal and its work. The line followed is written in the address as `l=` and the line's goal, so Back and Forward step
through the lines followed and a reload shows the same one; with no `l=`, Home follows its own goal's line again. A line that has landed rejoins main where it
landed, with a small ring on main at that moment; a click on it shows that landing and the items it closed.

The orange line can also be dragged back along the river, past today, with the mouse, a trackpad or a finger, to see the whole of Home as it was at that moment:
the ring and its percent, the goal's line and its expected day, the agents at work then and what needed you then, all read at the newest commit of main before
the moment. The day at the top says "As it was on" that day, the ring and the agents' dots lose some of their colour, the line carries the day, and the commits
after it fade. The left arrow key on the line at its default goal takes it a day back; in the past the arrow keys on the line move it a day back or on, and the
calendar takes it to any day. Dragged past today at the river's left edge, the river opens on the past behind it. "Back to today", or the quiet "now" where
today stands on the river (or at the edge it lies beyond), brings Home back to now, the line gliding to the horizon's goal. Each moment you drop the line at is
a place in the browser's history, written in the address as `t=` and the time in seconds, so Back and Forward step through the moments seen and a reload shows
the same one.

A click on a dot of the river opens that part of the week's commits in the stage, each with its hour and its subject, and under a landing the items it closed;
the same dot again gives the stage back to the diary.

Under the river, in the stage, is the diary, one row a day, newest first: the day on the left, a dot, and on the right the day in one short sentence of about
ten words, taken from the day's own words: its main decision (the one that touched the most items), or else what happened that day, its release or its finding,
cut to its first clause; a day when only the agents worked says what they did in numbers ("3 pieces of work landed, 19 items filed"). The dot is orange on a day
when you decided something or something happened, grey on a day that only landed work. Today is the first row and the largest; the rows get smaller and paler
the further back they go. The last seven days are named (Today, Yesterday, then the weekday with its date under it), the rest of this month by the day's number,
and each older month is one thin grey layer, thicker when more happened in it, with its decisions as small orange stars along it; a click on a layer opens its
days. The diary scrolls smoothly with the wheel, a trackpad, a finger or the keys, its top and bottom fading out, and scrolling it walks the whole of Home back
in time: the day on the line just under the top fade is the moment Home shows, moving smoothly between one day and the next, and the river slides so that this
moment stands under the orange line, as when you drag it. Scrolling back to the top brings Home back to now. Each place the scroll stops at is a moment in the
browser's history, as a drop of the line is, so Back, Forward and a reload return to it; and when the moment changes another way (the line dragged, ‹ and ›,
"Back to today") the diary scrolls to that day. Pointing at a day, or reaching it with Tab, lights that day on the river. The diary is a list like the others
below: a click on a day, or Enter, opens its story beside it, sliding in from the right, while the diary narrows to a column of dates on the left (Today,
Yesterday, the weekdays, the day numbers and the months' layers) to go from day to day, by clicking or with the arrow keys; the column still scrolls through
time as the whole diary does. The story says the day in short sentences: what you decided, what else happened, what landed, and how many decisions, landings and
items filed or closed there were. Each item it names is a link by its short name and opens in the story's place, the day still marked in the column; the day's
date in the stage's title, Back or Escape bring the story back, and a click on "Diary", or Escape again, the whole diary. The address keeps the day as `i=` and
its date, with the item opened from its story after a `~`. With reduced motion nothing glides.

The stage under the river holds the diary by default, or the list a click above opened in it: Waiting for you, What's left, a part of the week's commits, the
bugs or the features. A quiet title says what it holds, with "‹ Diary" to go back; Escape goes back too. The title is also the stage's index: a click on it
lists the Diary, Waiting for you, What's left, Ahead, Bugs, Features and Calendar, so every list is two clicks away. Under the goal's numbers a quiet line says
how many bugs are to fix now and how many features are being built, and each opens its list; a goal's ring on the river shows how many bugs and features that
goal has, and each opens that goal's own list. The bugs come in three groups, those blocking the goal, those to fix now and the rest, and the features in three,
being built, built and waiting for their proof, and asked; each row is one line, with its age and who holds it. Every list follows the moment Home shows and the
line it follows. Every list looks the same, the diary's too: one row each, its date, its age or its hour on the left, a dot for what it is, and its sentence. A
click on a row, or Enter, opens it beside the list: the item slides in from the right and the list narrows to a column on the left, so you can go from one item
to the next as in a mail app, by clicking in the column or with the arrow keys. The item is said in plain words: what it is and where it stands, why it waits
(with **Bring it to the chat** for an entry of Waiting for you), when and where a commit was made and what it closed, what the item is about, what it is linked
to and its history; every item it names opens there in its place. Under the title of an item of the tracker is a row of what you can do with it: **Start now**
puts it on the queue the coordinator starts first (`naima start`); **Move to a goal or release** picks one of the open goals and releases and puts it there, off
the others; **Decide** or **Approve** settles the open question it is, or the one it is blocked by, or confirms a proposed requirement; **Comment** adds a note
in your name; **Close as won't fix** asks why and closes it with the status its kind keeps for work deliberately not done (`naima close --wont-fix`). An action
the item does not allow is greyed, with the reason under its name. A form opens under the row for those that ask something; each change runs as a command in
your name, one at a time, and the row says how it goes and how it ended, then the item is read again. Back, Escape or a click on the stage's title give the
whole list back. On a phone the column hides and the item takes the stage. Whatever opens in the stage, a list, an item, a day's story or a part of What's left,
condenses everything above it at once, in one smooth move, since the full board beside a list is only noise, and folds what was open up there: the chart turns
back to the ring, a detail closes, the gallery of faces shuts. The top and the stage take turns: while the stage shows anything but the diary's own list the top
stays the bar, and scrolling never unfolds it over the list; and whatever you open up top, the chart, a detail, another face or the gallery, gives the stage
back to the diary. Going back to the diary leaves the top condensed, and the bar brings Home back: the diary under the full board. So Home never shows more than
two things open at once, such as a list and one item beside it, or the chart and one of its details. Scrolling down in the stage, with the wheel, a trackpad, a
finger or the keys, first condenses everything above it: the top scrolls away flat, nothing in it scaled or tilted, while the stage takes the room freed, and
once it has gone Home folds into the window's top bar, beside the project's name, where it fades in: the goal's ring with its percent (and its name when there
is room), its counts (left to do, fixed on the line, and what is waiting for you, in orange when anything is), each other face chosen as a small chart, and the
river in one line. That line is the river's own window, its first and last day at its ends: today an orange tick near the left, the goals ahead ringed as the
river rings them, the nearest named with their short day, the deadlines as small rings, the agents at work as short green lanes, and how many goals lie after
the window. Dragging that line moves the river as dragging the river does, sideways through time and up or down to zoom; a click on it unfolds Home. The top bar
keeps the same height folded or not, so nothing moves. A long list in the stage scrolls flat too; when it is longer than its room its top and bottom edges fade
softly, and only where there is more to scroll to. Only then does the stage itself scroll, so scrolling the diary never walks Home back in time while the board
is open. Scrolling back to the diary's top unfolds everything again, and a click, a tap or Enter anywhere on the folded bar brings Home back at once, on the
face that was up. A scroll that stops half way goes on to the nearer end. What the stage holds is a place in the browser's history, written in the address as
`s=` (with `i=` for the item open beside the list, and `w=` for an entry of Waiting for you sent to the chat), and the condensed top as `c=1`, so Back and
Forward step through what the stage showed and a reload keeps it, condensed or not. With reduced motion nothing fades or slides: the folded bar simply appears
once the top is condensed, and the item appears beside the column at once.

The word "naima" at the top left of every screen is the way Home: a click on it, or Enter while it has the focus, returns to Home from wherever you are. On
another screen it shows Home; on Home it gives Home back as it starts, in one smooth move: the stage closes back to the diary with no item open, the condensed
top unfolds, the ring turns back to its front and the first face comes up, no detail is left open, the moment returns to now with the river there and the orange
line, the focus horizon, at its default goal. The line you follow does not change. Its only cue is that it dims a little under the pointer. The key H does the
same from any screen, and so does pressing Escape twice in a row on Home. Back and Forward step through it as through any other move, and with reduced motion
the top unfolds at once and nothing glides.

When a goal is chosen on the timeline, Home shows that goal in the ring. Each part is drawn as soon as what it needs has been read, and until the goal can be
drawn a quiet line says what is being read, such as "Reading the schedule… 7 of 10". Home is built from the views' data, the same the commands print with
`--json`: `naima gates`, `naima queue`, `naima
claims`, `naima line list` and the schedule, and from the view `week`, the commits of main in the seven days
before the moment shown, each with the lines it changed.

### Plan

The Plan draws every goal with a date or a forecast on one time axis, its name and its dates in a column on the left. A goal has one expected date, the same on
Now, on the Plan and in What's left, with how sure it is beside it: "Expected Fri 4 Dec, 85 % sure by Mon 14 Dec". The date is the day by which half of many
replays of the last four weeks' pace would have finished what is left; the second day is when most of them would have. "How this date is worked out" says so in
What's left.

Clicking a goal's name or its bar unfolds What's left on that goal under the chart, and clicking it again folds it; a goal with no date yet, under Now, Next and
Later, unfolds it there. It opens with a summary: how many items are left, how many are still to do, how many an agent is working on, and how many are done but
wait for the test or check that proves them, then one row for each kind of item (bugs, to-dos, features, requirements, tests and the rest) with a bar split by
those states. Every number is a link: it opens the list with exactly the items it counts. Under the summary are the few that matter first, each group only when
it has items: what only you can do or prove, what was marked fixed but fails its proof, what agents hold now, what is urgent and open, and what an agent could
do that no agent holds yet; then the chain of items waiting on each other that decides the date. The List button shows every item left, its kind first on each
row, then its state and who does it. An agent holding an item is named with its robot and the colour of its line in the Days panel: pointing at it lights that
line, and clicking it lists what it holds on the goal.

### The calm pages

Bugs, Tests, Health and History are pages in Home's look, each opened from the stage's index on Home (All bugs, Tests, Health, History) and kept at its own
address (`#bugs`, `#failed_tests`, `#metrics`, `#diary`), so Back returns to Home. Each opens with the day, then a ring beside the page's title and one sentence
saying how things stand. The ring is split into arcs by how things stand, with the number that matters at its centre, and only what waits for you is orange.
Under a hairline comes the page's list, the same list as everywhere else, with its controls folded into one quiet line and Adjust. A click on a row, or Enter,
opens it beside the list, which narrows to a column, and the page does not scroll.

Bugs lists every bug by where it stands: what needs you, what to fix now, next, not sorted yet and later, then what is fixed and waiting to land or proven. Its
ring counts the open bugs, and a line under the sentence says how many are fixed and how many were found and fixed this week. A bug opened beside the list says
its release or goal, its age and who holds it, with a link to its own page.

Tests lists the tests and properties that fail, those you run first at the top, and folds those that pass again this week. Its sentence is the same one Home's
checks say. A test opened beside the list says since when it fails and when it last passed, what to do about it, and its runs over time. Under the list, the
last 14 days day by day and every test's runs are one click away.

History is the diary: what was decided and what changed the project, a day to a group, newest first, each moment with its hour and the day's routine in one
quiet row. A choice under the sentence shows the moments, only what was decided with you, only what was finished, or everything. A moment opened beside the list
is told whole, with the item it names and who worked on what that day. Earlier days come with "Show earlier days".

Health is the metrics page, described next.

### Formal models and UI design

Two pages show the project's stances, each opened from the stage's index on Home.

Formal models lists every machine the project models in mCRL2, with how many of its properties are proven, owed or refuted and, where a run recorded it, how
many states it has. Above the list come the measures taken over every state, such as how much of Home can be open at once. A click on a machine opens it beside
the list: what it models and what it leaves out, as its opening comment says, the refinement its generated code is checked by, and each property in the sentence
its author recorded with `naima explain`, with a plain phrase under each part of its formula. "Draw it and step through it" opens the same machine in Specs,
Models, where it is drawn and can be explored.

UI design describes how the app is built: the UI stance and the commit it is pinned at, its mood, every colour of the mood board drawn in the theme the page is
shown in, the tokens by group, and the two rules the look is held to. Every action declares how it is offered, which the stance's affordances check holds, and
Home stays uncluttered, which the properties of Home's noise model hold. The widgets the app is made of and the stance's checks, as they last ran, close the
page.

### Metrics

Health shows the project's [metrics](metrics-and-budgets.md) at the moment the window shows. Two buttons at the top choose how: every metric large, or one at a
time. Every metric large uses the window's whole width: each metric, grouped by what it measures, has its value now and how it moved, its last change ("Last
change +23 tests on 27 Oct") and its bound ("budget 6 s, met"), then its chart on axes in its own unit (its least, middle and most value), with a faint band
where its bound is not met and its trend as a dashed straight line, green when it goes the metric's good way. The charts share one time axis and one set of zoom
buttons; clicking a point selects its commit and opens the record of its run under the charts, as on the large chart below. Home opens Health this way in one
step: the small charts of the folded top bar, and the quiet link "Every metric, large" at the top left of the ring's chart. Its ring has an arc for the metrics
getting better, one for those getting worse and one for the steady ones, and its sentence says whether the project is getting healthier: how many metrics got
better, worse or stayed steady since the first day the charts show. Under it are the key numbers, as Home's numbers stand: the value, its name, its change, the
date of its record and a small chart of its history. Live, a number shows the newest record and its change since the record before, named by that record's day
("+23 since 26 Oct"). At a commit of the past it shows the value then and its change against live, and says "recorded at this commit" or, when that commit has
no record, "no record at this commit, nearest:" with the date of the last record at or before it, the one that holds then. Under the numbers is the list of
every metric, grouped by what it measures, with its value, the group of the metric picked open; picking one shows it in the large chart under the list, with
what it means and how it is measured above the chart, and underlines its number. Every chart runs along the trunk's commits in order, labelled with their dates;
a commit of the past is marked by an amber line, and a bound by a dashed one. The range picks every commit or the last 500 or 100. Each chart has a text summary
that screen readers read. Clicking a point of the large chart, or pressing Enter on the one the arrow keys are on, selects its commit, so the whole window shows
that moment, and opens below the chart the record of the run that measured it: the value and whether it kept its bound, when it was recorded, and how it was
taken. For a test suite's number that is the suite's run, with its command, its counts, its time and the end of its log, or the earlier run it reused because
nothing the suite reads had changed; for a command's number, the command; for a code measure, the measure. A metric becomes a card with `"card": true` in its
declaration, or with its place among the cards, `"card": 2`, and goes under a heading of the list with `"group"`; with no card marked, the first six metrics
with records are the cards. The cards with a place come first, in that order, and the others after them in the list's order, which is the order of the
declarations. The screen names a metric by its `"label"`, such as `"Function size, mean"`, or else by its declared name written as words, `function-size` as
Function size. Right under how old the numbers are, the screen says how many of the newest commits have no record, with the main action Record metrics, which
runs `naima metrics run --record` on the commit checked out, under `naima run` with a budget of two hours, and says how the run goes until it ends; one
recording runs at a time, and when it succeeds the window reads the new records. Its data is the metrics view's, whose `timeline` places every record on the
trunk; at a commit it gives each metric's record at that commit, read from the records as they are now, since a commit's own tree holds none of the records made
after it. How the screen reads a moment is a small model of its own, checked like the shell's: an answer that arrives after the moment changed is dropped and
the new moment read. So is Record metrics: it starts one recording at a time, asks for its run's state one request at a time and only while it runs, and reads
again when it succeeded. The record of a point is the metrics plugin's metric-run view, which the bridge's `data` command reads with the metric and the commit
as its query.

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
once, then reads everything again a moment later, and shows what changed meanwhile as a live change. On a large project this is what keeps the first screen from
waiting for every view to be computed.

A tab shows its content within a second of the click the first time, and within a fifth of a second when you open it again. The server computes each view and
each plugin's tab in a few worker threads started with it, never on the thread that answers the page, so a slow one holds nothing else. A moment after the first
screen is drawn, while you look at it, the window reads ahead what you have not opened yet among the screens whose code it holds (All projects, the slowest to
compute, among them) and the plugins' tabs the navigation offers. A screen or tab opened again draws at once from what it showed last, its own and never another
tab's, and reads again only when the project has changed.

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
one), claim items or post a step (`claim`), release a claim (`release`), name a commit of the map (`name-stop`), and take a meeting, bring a question into the
chat or change a meeting's date (`meeting take`, `meeting raise`, `meeting date`). Each runs as a run of `naima run`, exactly as if you typed the command, on
the data the window shows, so every rule and check applies, and the window can follow the run: its state, its exit code and what it printed. None of them
rewrites history. Another page in your browser cannot run one.

## How it is built

The interface is a Svelte app that ships with Naima, already built: Naima needs no npm package and no network to show it. It is built with the
[UI stance](stances.md): its tokens, widgets, store and rules, which the stance's checks hold it to. Everything it reads and does goes through the stance's
bridge, as commands of Naima's own: `describe`, `data` (a view's data, live or at a commit), `tabs`, `tab` (what a tab shows), `metro` (the rail's map),
`studies` (the Models tab's studies, each declared by a `%@ui` block of an mCRL2 file of the project) and `study` (one of them, with its stepper's bytes and the
addresses of its frames), `action` and `run`, and the feed `changes`, which says when the project changed. In the browser the bridge is `POST /bridge/<command>`
and, for the feed, a stream of server-sent events at `/bridge/changes`, behind the run's token; a command is refused from any page but the server's own. Its
logic is generated from a model. The moment, the rail, the current screen and the plugin's tab and subtab shown form one state machine, modelled in mCRL2 and
checked with its properties, and naima-codegen generates the code the screens call. How a screen reads its data is a second one, the reader: a change that comes
while a screen is still reading is never lost, since the screen reads once more when the first answer comes, and that answer, which may be of the moment before,
is set aside. The components only read the machines' state and call their transitions. The colours, type and shapes are the design tokens of the interface, and
the Inter typeface comes with it under the SIL Open Font License.

## Every state of the interface

The interface's own state machines are studied in the UI tab of Naima's workshop, beside Models: each machine of the interface opens with its states, its steps
and the real interface in the state the machine is in, and its card "Every state" shows a picture of the interface in each state the machine rests in
([studying a model](study-a-model.md#the-ui-tab)). The address `/#explorer` opens the UI tab.
