# Showing the owner something in Naima's UI

The MCP server is only an intelligence on top of the open UI's central store. It reads the store and calls the store's own transitions, the same functions
the UI's components call when the owner clicks, and it adds no UI behaviour of its own: which screen a name means, which item, and why a place is refused, the
UI decides. So read with `store`, act with `transition`, and use `show` for the common jumps.

When you want the owner to see something in the project, such as a screen, an item, a commit or a line, show it in the Naima UI they have open rather than
making a page, a chart or an artifact of your own. The UI already draws the project as the owner knows it, and what you show stays live there.

## Adding the server

Naima serves its UI's bridge, the commands the UI itself reads and acts through, as an MCP server on its standard input and output. An agent's client starts it
in the project's folder. In Claude Code:

```sh
claude mcp add naima -- naima ui --mcp
```

Any other MCP client starts the same command. Its answers are short plain text, like a screen at a glance; ask for one thing by its id
for more. Which tool for what:

- `overview`: the project at a glance. Start here.
- `items`: one item by its ref (the slug or the id's start will do), or a search by words, type, status, gate or open, with counts.
- `gates`: every gate in a line each, or one gate by name: why it is blocked and by what.
- `lines`: the trunk, the lines and the branches, or one by name with its goals and last commits.
- `history`: the last days in a line each, or one `day`, or one `commit`.
- `work`: claims, the ready queue, stale work and work at risk, or one `worker`.
- `metrics`: every metric's value and trend, or one metric's recent points.
- `view`: a view's raw data, shortened, in pages (`path`, `offset`, `limit`, `where`, `search`, `since`, `until`, `fields`), only when the tools above do
  not answer.
- `action` and `run`: the UI's short list of actions, run through `naima run`.
- `store`, `transitions` and `transition`: the open UI's central store, read, listed and moved through its own transitions.
- `show`, `read_page` (an outline of what the owner sees; the text with `mode`) and `screenshot` (rarely).

A bare call answers in about 2 000 characters at most; `detail: "full"` gives an item or a gate whole, as compact JSON. No reply passes 20 000 characters,
and a reply cut there says how to narrow the call.

## Reading and moving the open UI's store

The open UI keeps everything it shows in one central store: a set of machines, such as `shell` (the screen, the moment, the item shown), `rail`, `bugs` or
`features`, each with a read-only view and the transitions that change it. Most are generated from a model, and their transitions are the model's inputs.

- `store` answers a summary first: every machine in a line, its fields with a value in short and a list by its length. `machine` gives one machine's view as
  compact JSON, and `path` one part of it, such as `machine: "rail", path: "lines.0"`. Read here what the owner is looking at before you act.
- `transitions` lists the registry of every transition, generated from the machines: each with its arguments, the values an enumerated one takes, what it
  does, and whether it is allowed now where its machine can say. `machine` narrows it to one, such as `shell`. A machine one holds is named by its path
  (`features.gantt`), and one made on demand by the call that makes it, with its argument (`bugs.historyOf(bugs/<slug>)`).
- `transition` calls one, with `machine`, `name` and `args` (a list in order, or an object by the arguments' names), through the very function the UI's
  components call, and answers in one line whether it was taken and what changed, such as `shell.go("BUGS"): taken; shell.screen "HOME" → "BUGS"`. A
  transition the machine does not allow now is refused and changes nothing. It is asked once: when the UI does not answer in time, read `store` to see
  whether it was applied before asking again.

A transition moves what the owner sees: call only what the owner would want shown, never one that starts work or changes the project.

## Showing a place

`show` is the common jump: a named sequence of transitions, which the registry lists as the machine `agent` (`showScreen`, `showView`, `showItem`,
`showCommit`, `showLine`), and `transition` calls the same way. Call `show` with exactly one of:

- `screen`: home, metrics, diary, bugs, features, failed tests, goals, roadmap, map, all projects or more, written as you like (`failed_tests` too);
- `view`: a plugin's view, by its name, as `tabs` lists it;
- `item`: an item's reference, such as `bugs/<slug>`;
- `commit`: a hash or a ref a local branch reaches, which moves the playhead there;
- `line`: a line's name, such as `main` or `line/<gate>`.

Every UI open on the project, the desktop app or a browser tab, goes there at once. The answer says how many open UIs took it, or, when the UI refused the
place, why, in the UI's words. When none is open, `show` opens
one as `naima hello` does, the desktop app when it is installed, else `naima ui` in the browser, and shows the place there; when none could be opened, it says
so: tell the owner to open the UI with `naima ui`, then show again. Say in one line what you showed and why; the owner looks at the UI, not at a copy of it.

## Seeing what the owner sees

`read_page` answers an outline of the open UI's page: its landmarks, its headings each with the first line under it, and its controls with their state, in
about 2 000 characters. `mode: "text"` gives the page's text and `mode: "html"` its raw HTML, in pages, and `selector` reads only the part under a CSS selector. Use it to check what a `show` did and what the owner is looking at. `screenshot` answers a PNG of the UI's window as it is on the screen,
taken with the system's screen capture on macOS; elsewhere it says it cannot. A picture costs far more than the text: take one only for a rare visual check that
the text cannot answer, such as a layout or a colour.
