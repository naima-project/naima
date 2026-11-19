# Showing the owner something in Naima's UI

Naima serves two MCP servers, split by what they touch. Register both.

- **`naima-ui`** drives the screen the way a person does. It imports only the UI stance's registry and its agent channel, so every call (`show`, `store`,
  `transitions`, `transition`, `read_page`, `screenshot`) goes through that channel to the UI the owner has open, one request at a time, and the UI answers. It
  reads and calls the open UI's central store, the same functions the UI's components call when the owner clicks, and adds no UI behaviour of its own: which
  screen a name means, which item, and why a place is refused, the UI decides.
- **`naima-tracker`** never touches the screen. It reads Naima's core directly (items, gates, lines, history, work, metrics, the views) and runs the UI's short
  list of actions. Use it when you need to know the project, not to show anything.

When you want the owner to see something in the project, such as a screen, an item, a commit or a line, show it in the Naima UI they have open rather than
making a page, a chart or an artifact of your own. The UI already draws the project as the owner knows it, and what you show stays live there.

## Adding the servers

An agent's client starts each one in the project's folder. In Claude Code:

```sh
claude mcp add naima-ui -- naima ui --mcp
claude mcp add naima-tracker -- naima ui --mcp-tracker
```

Any other MCP client starts the same commands. Their answers are short plain text, like a screen at a glance; ask for one thing by its id for more. Which tool
is on which server:

`naima-tracker`:

- `overview`: the project at a glance. Start here.
- `items`: one item by its ref (the slug or the id's start will do), or a search by words, type, status, gate or open, with counts.
- `gates`: every gate in a line each, or one gate by name: why it is blocked and by what.
- `lines`: the trunk, the lines and the branches, or one by name with its goals and last commits.
- `history`: the last days in a line each, or one `day`, or one `commit`.
- `work`: claims, the ready queue, stale work and work at risk, or one `worker`.
- `metrics`: every metric's value and trend, or one metric's recent points.
- `meetings`: the meetings, and what is on each agenda.
- `view`: a view's raw data, shortened, in pages (`path`, `offset`, `limit`, `where`, `search`, `since`, `until`, `fields`), only when the tools above do not
  answer.
- `action` and `run`: the UI's short list of actions, run through `naima run`, and the run they start.

`naima-ui`:

- `store`, `transitions` and `transition`: the open UI's central store, read, listed and moved through its own transitions.
- `show`, `read_page` (an outline of what the owner sees; the text with `mode`) and `screenshot` (rarely).

A bare call answers in about 2 000 characters at most; `detail: "full"` gives an item or a gate whole, as compact JSON. No reply passes 20 000 characters, and a
reply cut there says how to narrow the call. Each tool kept its name when the single server was split in two; only the server's name in the client's tool list
changed (`naima-tracker` and `naima-ui`).

## Reading and moving the open UI's store

The open UI keeps everything it shows in one central store: a set of machines, such as `shell` (the screen, the moment, the item shown), `rail`, `bugs` or
`features`, each with a read-only view and the transitions that change it. Most are generated from a model, and their transitions are the model's inputs.

- `store` answers a summary first: every machine in a line, its fields with a value in short and a list by its length. `machine` gives one machine's view as
  compact JSON, and `path` one part of it, such as `machine: "rail", path: "lines.0"`. Read here what the owner is looking at before you act.
- `transitions` lists the registry of every transition, generated from the machines: each with its arguments, the values an enumerated one takes, what it does,
  and whether it is allowed now where its machine can say. `machine` narrows it to one, such as `shell`. A machine one holds is named by its path
  (`features.gantt`), and one made on demand by the call that makes it, with its argument (`bugs.historyOf(bugs/<slug>)`).
- `transition` calls one, with `machine`, `name` and `args` (a list in order, or an object by the arguments' names), through the very function the UI's
  components call, and answers in one line whether it was taken and what changed, such as `shell.go("BUGS"): taken; shell.screen "HOME" → "BUGS"`. A transition
  the machine does not allow now is refused and changes nothing. It is asked once: when the UI does not answer in time, read `store` to see whether it was
  applied before asking again.

A transition moves what the owner sees: call only what the owner would want shown, never one that starts work or changes the project. On Home, for example,
`board.unfold` unfolds the goal's numbers under its ring and `board.fold` folds them again. `stage.home` goes Home from any screen: the Diary in the stage,
nothing open beside it, the header unfolded. `stage.bugs` and `stage.features` open the open bugs or the features in Home's stage, grouped by what matters; with
a goal's gate as their argument (`stage.bugs("release-1.2")`) they hold that goal's own, and `stage.item` then opens one beside the list. `stage.item` with a
day (`2026-11-17`) opens that day's story beside the Diary narrowed to a column of dates, `stage.inner` with an item's reference opens an item the story names
in its place, `stage.story` gives the story back and `stage.list` the whole Diary. `stage.meeting` holds a meeting in Home's stage by its name (none: the
questions of the meetings with no date), and `stage.calendar` shows the month as a calendar there. `meetingHeld.bring` brings the question up into the chat and
`meetingDate.choose` changes a meeting's date: both change the project (they run `naima meeting raise` and `naima meeting date`), so call them only when the
owner asked for that. `mark.reach` with the gate of a goal ahead (`mark.reach("release-1.5")`), later or earlier than the default, moves Home's focus horizon
there, so what Home counts as waiting for the owner widens to that goal's events, meetings and questions, or narrows to what comes before it; a missed goal (its
due day passed) is drawn in the past and is never a horizon. `mark.now` brings it back to the default goal, the next major goal of the line followed.

## Showing a place

`show` is the common jump: a named sequence of transitions, which the registry lists as the machine `agent` (`showScreen`, `showView`, `showItem`, `showCommit`,
`showLine`), and `transition` calls the same way. Call `show` with exactly one of:

- `screen`: home, metrics, diary, bugs, features, failed tests, goals, roadmap, map, all projects or more, written as you like (`failed_tests` too);
- `view`: a plugin's view, by its name, as `tabs` lists it;
- `item`: an item's reference, such as `bugs/<slug>`;
- `commit`: a hash or a ref a local branch reaches, which moves the playhead there;
- `line`: a line's name, such as `main` or `line/<gate>`.

Every UI open on the project, the desktop app or a browser tab, goes there at once. The answer says how many open UIs took it, or, when the UI refused the
place, why, in the UI's words. When none is open, `show` opens one as `naima hello` does, the desktop app when it is installed, else `naima ui` in the browser,
and shows the place there; when none could be opened, it says so: tell the owner to open the UI with `naima ui`, then show again. Say in one line what you
showed and why; the owner looks at the UI, not at a copy of it.

## Seeing what the owner sees

`read_page` and `screenshot` ask the open UI too, over the same channel as the store: `read_page` for the page's text and `screenshot` for where its window is,
which the server captures. `read_page` answers an outline of the open UI's page: its landmarks, its headings each with the first line under it, and its controls
with their state, in about 2 000 characters. `mode: "text"` gives the page's text and `mode: "html"` its raw HTML, in pages, and `selector` reads only the part
under a CSS selector. Use it to check what a `show` did and what the owner is looking at. `screenshot` answers a PNG of the UI's window as it is on the screen,
taken with the system's screen capture on macOS; elsewhere it says it cannot. A picture costs far more than the text: take one only for a rare visual check that
the text cannot answer, such as a layout or a colour.
